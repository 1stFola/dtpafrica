/**
 * Phase 5 Increment 2 gate — camera cuts proposed, and filed beside a person's.
 *
 *   pnpm --filter @dtp/api vision:cutscheck
 *
 * Needs the API on :3000 (`VISION_E2E_API`), whatever `DATABASE_URL` points at
 * (never production), the object store the API is configured with, the worker's
 * Python environment and the seeded `vision_reviewer` role. FFmpeg is not needed:
 * the gate hands the worker's own arithmetic a log FFmpeg once printed, and
 * posts what it proposes as the completion.
 *
 * Three claims are on trial:
 *
 *   1. A cuts job is queued like any stage after transcode, carries the proxy's
 *      clock, and the worker reads the proxy by role.
 *   2. The proposer turns three cuts into three segments in source time, with a
 *      sliver absorbed, and the completion files them as `scene_detect`
 *      segments -- except where a person already declared one.
 *   3. A retried completion adds nothing; a second run replaces proposals nobody
 *      calibrated and keeps one somebody did; a person may remove a proposal
 *      and may not remove a calibrated segment.
 */
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { VISION_CONTRACT_VERSION, visionKeys } from "@dtp/vision-contracts";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { invert3, project, type Homography } from "../src/vision/calibration/homography";
import { landmarkById } from "../src/vision/calibration/pitch-model";
import { loadVisionConfig } from "../src/vision/config/vision.config";
import { InMemoryObjectStore } from "../src/vision/storage/in-memory-object-store";
import { R2ObjectStore } from "../src/vision/storage/r2-object-store";
import type { ObjectStore } from "../src/vision/storage/object-store";
import { assertDevDatabase, closeGate, createGateMatch, onInterrupt, removeGateMatch, removeGateWorkers, type GateMatch } from "./gate-harness";

loadApiEnv();

const API = process.env.VISION_E2E_API ?? "http://localhost:3000/api/v1";
const WORKER_DIR = resolve(__dirname, "../../vision-worker");
const PYTHON =
  process.env.VISION_WORKER_PYTHON ??
  (process.platform === "win32" ? join(WORKER_DIR, ".venv/Scripts/python.exe") : join(WORKER_DIR, ".venv/bin/python"));
const prisma = new PrismaClient();
const RUN = randomUUID().slice(0, 8);

/* The gate's own match, for its footage to belong to. It took whichever match came first,
   so it could not run on an empty database (docs/vision/65). */
let gateMatch: GateMatch | null = null;

let checks = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(68)} ${ok ? String(actual) : `expected ${expected}, got ${actual}`}`);
}
function section(t: string) {
  console.log(`\n${t}\n${"-".repeat(t.length)}`);
}
function adminHeaders(): Record<string, string> {
  const key = process.env.ADMIN_API_KEY?.trim();
  if (!key) throw new Error("ADMIN_API_KEY is not set");
  return { "x-admin-api-key": key, "Content-Type": "application/json" };
}
type Reply = { status: number; body: Record<string, any> };
async function call(path: string, headers: Record<string, string>, init?: RequestInit): Promise<Reply> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", ...headers } });
  const text = await res.text();
  let body: Record<string, any> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body };
}
const api = (path: string, init?: RequestInit) => call(path, adminHeaders(), init);
const post = (path: string, body: unknown) => api(path, { method: "POST", body: JSON.stringify(body) });

/* What FFmpeg printed for a ten-minute proxy with cuts at 61.2s, 61.32s (a two-frame insert) and 180s. */
const SHOWINFO = `
[Parsed_showinfo_1 @ 0x1] n:   0 pts:   1530 pts_time:61.2     pos:  1 fmt:yuv420p sar:1/1 s:1280x720 i:P iskey:1 type:I checksum:0 plane_checksum:[0]
[Parsed_metadata_2 @ 0x2] lavfi.scene_score=0.731
[Parsed_showinfo_1 @ 0x1] n:   1 pts:   1533 pts_time:61.32    pos:  2 fmt:yuv420p sar:1/1 s:1280x720 i:P iskey:0 type:P checksum:0 plane_checksum:[0]
[Parsed_metadata_2 @ 0x2] lavfi.scene_score=0.512
[Parsed_showinfo_1 @ 0x1] n:   2 pts:   4500 pts_time:180      pos:  3 fmt:yuv420p sar:1/1 s:1280x720 i:P iskey:1 type:I checksum:0 plane_checksum:[0]
[Parsed_metadata_2 @ 0x2] lavfi.scene_score=0.904
frame=  3 fps=0.0 q=-0.0 Lsize=N/A time=00:10:00.00 bitrate=N/A speed= 600x
`;
const CAMERA: Homography = [9.2, -3.1, 160, 0.4, 2.6, 80, 0.0004, 0.011, 1];
const SIX = ["corner_left_near", "corner_left_far", "halfway_near", "halfway_far", "left_penalty_spot", "centre_spot"];
function clicks() {
  const by = landmarkById({ lengthM: 105, widthM: 68 });
  return SIX.map((id) => {
    const l = by.get(id)!;
    const p = project(CAMERA, { x: l.xM, y: l.yM })!;
    return { landmark: id, px: p.x, py: p.y };
  });
}
void invert3;

type Fixture = { partnerId: string; assetId: string; jobIds: string[]; workerIds: string[]; userIds: string[]; wrote: { bucket: "derived"; key: string }[]; tmp: string | null };

async function person(fx: Fixture, roleSlug: string, label: string): Promise<{ id: string; token: string }> {
  const role = await prisma.adminRole.findUnique({ where: { slug: roleSlug }, select: { id: true } });
  if (!role) throw new Error(`Role ${roleSlug} is not seeded; run the RBAC seed first`);
  const email = `gate-${label}-${RUN}@example.test`;
  const oneTimeCredential = randomBytes(24).toString("hex");
  const user = await prisma.adminUser.create({
    data: { email, name: `Gate ${label} ${RUN}`, passwordHash: await bcrypt.hash(oneTimeCredential, 4), roleId: role.id, isActive: true, allCompetitions: true },
  });
  fx.userIds.push(user.id);
  const login = await call("/admin/auth/login", {}, { method: "POST", body: JSON.stringify({ email, password: oneTimeCredential }) });
  if (!login.body.token) throw new Error(`login failed for ${label}: ${JSON.stringify(login.body).slice(0, 200)}`);
  return { id: user.id, token: String(login.body.token) };
}

async function seed(): Promise<Fixture> {
  gateMatch = await createGateMatch(prisma, RUN);
  const sbMatch = gateMatch;
  const partner = await prisma.visionSourcePartner.create({ data: { name: `Cuts gate ${RUN}`, contactEmail: "gate@example.test" } });
  const record = await prisma.visionSourceVideoRecord.create({
    data: { partnerId: partner.id, title: `Cuts gate record ${RUN}`, sourceQualityRank: "broadcast", originalAvailable: true, acquisitionStatus: "acquired", acquisitionMethod: "partner_direct_upload" },
  });
  await prisma.visionRightsScope.create({
    data: { partnerId: partner.id, grantLevel: "partner", canAnalyze: true, canTrain: true, canPublishHighlight: false, canShareWithScout: false, grantedAt: new Date() },
  });
  const asset = await prisma.visionVideoAsset.create({
    data: {
      sourceVideoRecordId: record.id, sbMatchId: sbMatch.id, corpus: "dtp_owned", objectKey: `originals/gate-${RUN}-cuts/source.mp4`, bytes: BigInt(1024), mimeType: "video/mp4",
      checksumSha256: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64), width: 1280, height: 720, durationMs: 620_000, ingestState: "ready",
      variants: { create: { kind: "proxy", objectKey: `proxies/gate-${RUN}-cuts/proxy.mp4`, width: 1280, height: 720, fps: 25, durationMs: 600_000, sourceOffsetMs: 9000 } },
    },
  });
  const jobIds: string[] = [];
  for (const type of ["probe", "transcode"] as const) {
    const id = randomUUID();
    jobIds.push(id);
    await prisma.visionJob.create({
      data: { id, type, resourceClass: "cpu_small", state: "succeeded", videoAssetId: asset.id, inputSpec: {}, outputPrefix: visionKeys.inferencePrefix(id, 1), budgetSeconds: 600, budgetUsdCents: 100, contractVersion: VISION_CONTRACT_VERSION, finishedAt: new Date() },
    });
  }
  return { partnerId: partner.id, assetId: asset.id, jobIds, workerIds: [], userIds: [], wrote: [], tmp: null };
}

async function cleanup(fx: Fixture | null, store: ObjectStore) {
  if (!fx) {
    await removeGateMatch(prisma, gateMatch);
    return;
  }
  for (const w of fx.wrote) await store.delete(w.bucket, w.key).catch(() => undefined);
  if (fx.tmp) rmSync(fx.tmp, { recursive: true, force: true });
  await prisma.visionVideoAsset.deleteMany({ where: { id: fx.assetId } });
  await removeGateWorkers(prisma, fx.workerIds);
  await prisma.visionAuditLog.deleteMany({ where: { OR: [{ actorId: { in: fx.userIds } }, { targetId: { in: [...fx.jobIds, fx.assetId] } }] } });
  await prisma.adminUser.deleteMany({ where: { id: { in: fx.userIds } } });
  await prisma.visionRightsScope.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourceVideoRecord.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourcePartner.deleteMany({ where: { id: fx.partnerId } });
  await removeGateMatch(prisma, gateMatch);
}

async function main() {
  assertDevDatabase({ api: API });
  const config = loadVisionConfig();
  const store: ObjectStore = config.storage.backend === "r2" ? new R2ObjectStore(config.storage) : new InMemoryObjectStore();
  console.log("Vision cuts — camera segments proposed, and filed beside a person's");
  console.log(`  api ${API}`);
  console.log(`  object store ${store.backendId}`);
  console.log(`  run ${RUN}`);
  if (!existsSync(PYTHON)) throw new Error(`No worker Python at ${PYTHON}; set VISION_WORKER_PYTHON`);

  let fx: Fixture | null = null;
  onInterrupt(async () => {
    await cleanup(fx, store);
    await closeGate(prisma);
  });
  try {
    fx = await seed();
    const reviewer = await person(fx, "vision_reviewer", "reviewer");
    const R = {
      post: (path: string, body: unknown) => call(path, { Authorization: `Bearer ${reviewer.token}` }, { method: "POST", body: JSON.stringify(body) }),
      del: (path: string) => call(path, { Authorization: `Bearer ${reviewer.token}` }, { method: "DELETE" }),
    };

    // ── 1. Queueing ──────────────────────────────────────────────────────
    section("1. A cuts job follows transcode and carries the proxy's clock");

    const manual = await R.post(`/vision/review/${fx.assetId}/camera-segments`, { startMs: 60_000, endMs: 65_000, kind: "replay" });
    check("a person declared a replay segment over the first cut", manual.status, 201);

    const queued = await post("/vision/jobs", { type: "cuts", videoAssetId: fx.assetId });
    check("cuts queued", queued.status, 201);
    const jobId = String(queued.body.id);
    fx.jobIds.push(jobId);
    const row = await prisma.visionJob.findUnique({ where: { id: jobId } });
    check("…on the CPU class", row?.resourceClass, "cpu_small");
    check("…with no model", row?.modelVersionId, null);
    check("…and the proxy clock", (row?.inputSpec as any)?.proxy?.sourceOffsetMs, 9000);

    const provisioned = await post("/vision/workers/provision", { resourceClass: "cpu_small", providerId: "mock" });
    fx.workerIds.push(String(provisioned.body.workerId));
    const registered = await call("/vision/worker/register", { "x-vision-bootstrap-token": String(provisioned.body.bootstrapToken) }, { method: "POST" });
    const wh = { "x-vision-worker-token": String(registered.body.workerToken) };
    const claimed = await call("/vision/worker/jobs/claim", wh, { method: "POST", body: JSON.stringify({ resourceClasses: ["cpu_small"], contractVersion: VISION_CONTRACT_VERSION }) });
    const claimedId = claimed.body.job?.jobId;
    if (claimedId && claimedId !== jobId) await call(`/vision/worker/jobs/${claimedId}/fail`, wh, { method: "POST", body: JSON.stringify({ reason: "not mine", retryable: true }) });
    check("the worker claimed the cuts job", claimedId, jobId);
    const proxy = await call(`/vision/worker/jobs/${jobId}/input-url`, wh, { method: "POST", body: JSON.stringify({ role: "proxy" }) });
    check("the proxy is readable by role", proxy.status, 201);

    // ── 2. The proposer ──────────────────────────────────────────────────
    section("2. Three cuts, a sliver absorbed, three segments in source time");

    fx.tmp = mkdtempSync(join(tmpdir(), `dtp-cuts-${RUN}-`));
    const logPath = join(fx.tmp, "showinfo.txt");
    writeFileSync(logPath, SHOWINFO);
    const proposed = spawnSync(PYTHON, ["-m", "dtp_vision_worker.cuts", "--showinfo", logPath, "--duration-ms", "600000", "--offset-ms", "9000"], { cwd: WORKER_DIR, encoding: "utf8" });
    if (proposed.status !== 0) throw new Error(`proposer failed: ${proposed.stderr}`);
    const result = JSON.parse(proposed.stdout);
    check("three cuts read", result.cuts.length, 3);
    check("…the second a sliver, absorbed: three segments", result.segments.length, 3);
    check("the first segment runs from the source offset to the first cut", `${result.segments[0].startMs}-${result.segments[0].endMs}`, "9000-70200");
    check("the last to the end of the proxy, in source time", result.segments[2].endMs, 609_000);

    const prefix = String(claimed.body.job?.outputPrefix);
    const artifactKey = `${prefix}cuts.json`;
    await store.putSmallObject("derived", artifactKey, JSON.stringify({ ...result, role: "cuts", contractVersion: VISION_CONTRACT_VERSION }), "application/json");
    fx.wrote.push({ bucket: "derived", key: artifactKey });
    const completion = {
      idempotencyKey: `gate-${RUN}-cuts`,
      artifacts: [{ key: artifactKey, bucket: "derived", bytes: 1, contentType: "application/json", role: "cuts" }],
      summary: { threshold: 0.4, minSegmentMs: 2000, durationMs: 600_000, cuts: 3, segments: result.segments },
    };
    const completed = await call(`/vision/worker/jobs/${jobId}/complete`, wh, { method: "POST", body: JSON.stringify(completion) });
    check("completion accepted and applied", `${completed.status}/${completed.body.applied?.applied}`, "201/true");
    check("…two filed, one skipped for the replay a person declared", String(completed.body.applied?.detail).includes("2 new, 0 already there, 1 skipped"), true);

    const listed = await api(`/vision/review/${fx.assetId}/camera-segments`);
    const segs = (listed.body.segments ?? []) as any[];
    check("three segments on the asset", segs.length, 3);
    check("…in order: the replay first, then the two proposals", segs.map((s) => s.source).join(","), "manual,scene_detect,scene_detect");
    check("…proposals are of kind unknown", segs.filter((s) => s.source === "scene_detect").every((s) => s.kind === "unknown"), true);
    check("…the second proposal spans the second and third cuts", `${segs[1]?.startMs}-${segs[1]?.endMs}`, "70200-189000");

    // ── 3. Retries, replacement, removal ─────────────────────────────────
    section("3. A retry adds nothing; a second run replaces what nobody calibrated");

    const retried = await call(`/vision/worker/jobs/${jobId}/complete`, wh, { method: "POST", body: JSON.stringify(completion) });
    check("a retried completion is recognised", retried.body.alreadyApplied, true);
    check("…and adds no segments", await prisma.visionCameraSegment.count({ where: { videoAssetId: fx.assetId } }), 3);

    const last = segs[2];
    const calibrated = await R.post(`/vision/review/camera-segments/${last.id}/calibration`, { points: clicks(), pitch: { lengthM: 105, widthM: 68 } });
    check("a person calibrates the last proposal", `${calibrated.status}/${calibrated.body.quality}`, "201/good");

    const again = await post("/vision/jobs", { type: "cuts", videoAssetId: fx.assetId, params: { threshold: 0.6 } });
    fx.jobIds.push(String(again.body.id));
    const claimed2 = await call("/vision/worker/jobs/claim", wh, { method: "POST", body: JSON.stringify({ resourceClasses: ["cpu_small"], contractVersion: VISION_CONTRACT_VERSION }) });
    check("the worker claimed the second cuts job", claimed2.body.job?.jobId, again.body.id);
    check("…with the threshold it was given", claimed2.body.job?.inputs?.params?.threshold, 0.6);
    const key2 = `${claimed2.body.job?.outputPrefix}cuts.json`;
    await store.putSmallObject("derived", key2, "{}", "application/json");
    fx.wrote.push({ bucket: "derived", key: key2 });
    // A second run that found one cut: one proposal over the middle, one over the end that a person calibrated.
    const second = { ...completion, idempotencyKey: `gate-${RUN}-cuts-2`, artifacts: [{ ...completion.artifacts[0]!, key: key2 }], summary: { ...completion.summary, cuts: 1, segments: [{ startMs: 9000, endMs: 189_000 }, { startMs: 189_000, endMs: 609_000 }] } };
    const completed2 = await call(`/vision/worker/jobs/${again.body.id}/complete`, wh, { method: "POST", body: JSON.stringify(second) });
    check("the second run applied", completed2.body.applied?.applied, true);
    const detail2 = String(completed2.body.applied?.detail);
    check("…the calibrated proposal kept, the uncalibrated one replaced", detail2.includes("1 already there") && detail2.includes("1 earlier proposal(s) replaced"), true);
    check("…and the new middle proposal skipped for overlapping the replay", detail2.includes("1 skipped"), true);
    const after = await api(`/vision/review/${fx.assetId}/camera-segments`);
    const afterSegs = (after.body.segments ?? []) as any[];
    check("two segments remain: the replay and the calibrated proposal", afterSegs.map((s) => `${s.source}:${s.calibration ? s.calibration.quality : "-"}`).join(","), "manual:-,scene_detect:good");

    const removeCalibrated = await R.del(`/vision/review/camera-segments/${last.id}`);
    check("a calibrated segment cannot be removed", removeCalibrated.body.error, "SegmentCalibrated");
    const removeKeyed = await api(`/vision/review/camera-segments/${manual.body.id}`, { method: "DELETE" });
    check("the operator key cannot remove one", removeKeyed.body.error, "CalibrationNeedsAPerson");
    const removed = await R.del(`/vision/review/camera-segments/${manual.body.id}`);
    check("a person removes the replay segment", removed.body.removed, manual.body.id);
    check("…and one segment remains", await prisma.visionCameraSegment.count({ where: { videoAssetId: fx.assetId } }), 1);

    await post(`/vision/workers/${provisioned.body.workerId}/retire`, {});
  } catch (error) {
    failures += 1;
    console.error("\nGate aborted:", error);
  } finally {
    await cleanup(fx, store).catch((e) => console.error("cleanup failed:", e));
    await closeGate(prisma);
  }

  console.log(`\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ""}`);
  process.exitCode = failures ? 1 : 0;
}

void main();
