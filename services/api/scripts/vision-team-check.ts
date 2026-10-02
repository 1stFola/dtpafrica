/**
 * Phase 4 Increment 3 gate — which side each track is on, by kit.
 *
 *   pnpm --filter @dtp/api vision:teamcheck
 *
 * Needs the API on :3000 (`VISION_E2E_API`), whatever `DATABASE_URL` points at
 * (never production), the object store the API is configured with, and the
 * worker's Python environment: the kits are read off a frame this script paints
 * by the **real** histogram, the sides are found by the **real** clustering, and
 * what they should say was worked out by hand.
 *
 * Three claims are on trial:
 *
 *   1. An identify job cannot be queued without a succeeded track job, nor without
 *      an identify version in production or named; queued, it declares the one
 *      track artifact and the proxy clock.
 *   2. On a frame with four red kits, four blue, a purple one and a goalkeeper, the
 *      arithmetic names two sides, keeps the purple track unknown, never clusters
 *      the goalkeeper, and says the same thing twice.
 *   3. The completion becomes one assignment per track on record, idempotently,
 *      and the rows are readable on the tracks.
 *
 * What this gate does not do: decode a real proxy with FFmpeg. The frame decoder
 * is exercised with an injected frame in the worker's tests and for real on a pod.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { VISION_CONTRACT_VERSION, visionKeys } from "@dtp/vision-contracts";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { loadVisionConfig } from "../src/vision/config/vision.config";
import { InMemoryObjectStore } from "../src/vision/storage/in-memory-object-store";
import { R2ObjectStore } from "../src/vision/storage/r2-object-store";
import type { ObjectStore } from "../src/vision/storage/object-store";

loadApiEnv();

const API = process.env.VISION_E2E_API ?? "http://localhost:3000/api/v1";
const WORKER_DIR = resolve(__dirname, "../../vision-worker");
const PYTHON =
  process.env.VISION_WORKER_PYTHON ??
  (process.platform === "win32" ? join(WORKER_DIR, ".venv/Scripts/python.exe") : join(WORKER_DIR, ".venv/bin/python"));
const prisma = new PrismaClient();
const RUN = randomUUID().slice(0, 8);

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

type Fixture = {
  partnerId: string;
  assetId: string;
  modelIds: string[];
  jobIds: string[];
  workerIds: string[];
  wrote: { bucket: "derived" | "models"; key: string }[];
  tmp: string | null;
};

/* The frame, by hand: 640x360, a green pitch, and ten figures painted as solid
   blocks the torso region of each track's box falls inside.
     tracks 1-4   red     (220, 30, 30)    players
     tracks 5-8   blue    (30, 40, 220)    players
     track  9     purple  (130, 30, 130)   a player in neither kit: as far from red as from blue
     track 10     yellow  (230, 220, 40)   the goalkeeper
   So: two sides, red and blue; eight assigned; purple unknown with no margin at all;
   the goalkeeper never clustered. */
const W = 640;
const H = 360;
const RED: [number, number, number] = [220, 30, 30];
const BLUE: [number, number, number] = [30, 40, 220];
const PURPLE: [number, number, number] = [130, 30, 130];
const YELLOW: [number, number, number] = [230, 220, 40];
const PITCH: [number, number, number] = [40, 160, 50];

type Figure = { localTrackId: number; class: string; box: { x: number; y: number; width: number; height: number }; colour: [number, number, number] };
function figures(): Figure[] {
  const out: Figure[] = [];
  for (let i = 0; i < 4; i += 1) out.push({ localTrackId: i + 1, class: "player", box: { x: 20 + i * 80, y: 40, width: 50, height: 100 }, colour: RED });
  for (let i = 0; i < 4; i += 1) out.push({ localTrackId: i + 5, class: "player", box: { x: 340 + i * 80, y: 40, width: 50, height: 100 }, colour: BLUE });
  out.push({ localTrackId: 9, class: "player", box: { x: 100, y: 200, width: 50, height: 100 }, colour: PURPLE });
  out.push({ localTrackId: 10, class: "goalkeeper", box: { x: 300, y: 200, width: 50, height: 100 }, colour: YELLOW });
  return out;
}
function paintFrame(figs: Figure[]): Buffer {
  const px = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i += 1) px.set(PITCH, i * 3);
  for (const f of figs) {
    for (let y = f.box.y; y < f.box.y + f.box.height; y += 1) {
      for (let x = f.box.x; x < f.box.x + f.box.width; x += 1) px.set(f.colour, (y * W + x) * 3);
    }
  }
  return px;
}

async function seed(): Promise<Fixture> {
  const sbMatch = await prisma.sbMatch.findFirst({ select: { id: true } });
  if (!sbMatch) throw new Error("No SbMatch in the database to link an asset to");
  const partner = await prisma.visionSourcePartner.create({ data: { name: `Teams gate ${RUN}`, contactEmail: "gate@example.test" } });
  const record = await prisma.visionSourceVideoRecord.create({
    data: { partnerId: partner.id, title: `Teams gate record ${RUN}`, sourceQualityRank: "broadcast", originalAvailable: true, acquisitionStatus: "acquired", acquisitionMethod: "partner_direct_upload" },
  });
  await prisma.visionRightsScope.create({
    data: { partnerId: partner.id, grantLevel: "partner", canAnalyze: true, canTrain: true, canPublishHighlight: false, canShareWithScout: false, grantedAt: new Date() },
  });
  const asset = await prisma.visionVideoAsset.create({
    data: {
      sourceVideoRecordId: record.id, sbMatchId: sbMatch.id, corpus: "dtp_owned", objectKey: `originals/gate-${RUN}-teams/source.mp4`, bytes: BigInt(1024), mimeType: "video/mp4",
      checksumSha256: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64), width: W, height: H, durationMs: 120_000, ingestState: "ready",
      variants: { create: { kind: "proxy", objectKey: `proxies/gate-${RUN}-teams/proxy.mp4`, width: W, height: H, fps: 25, durationMs: 120_000, sourceOffsetMs: 9000 } },
    },
  });
  const jobIds: string[] = [];
  for (const type of ["transcode", "detect"] as const) {
    const id = randomUUID();
    jobIds.push(id);
    await prisma.visionJob.create({
      data: { id, type, resourceClass: type === "detect" ? "gpu_24gb" : "cpu_small", state: "succeeded", videoAssetId: asset.id, inputSpec: {}, outputPrefix: visionKeys.inferencePrefix(id, 1), budgetSeconds: 600, budgetUsdCents: 100, contractVersion: VISION_CONTRACT_VERSION, finishedAt: new Date() },
    });
  }
  return { partnerId: partner.id, assetId: asset.id, modelIds: [], jobIds, workerIds: [], wrote: [], tmp: null };
}

/** A succeeded track job with its artifact in the store and one `VisionTrack` row per figure. */
async function trackJob(fx: Fixture, store: ObjectStore, trackerVersionId: string, figs: Figure[]) {
  const id = randomUUID();
  const key = `${visionKeys.inferencePrefix(id, 1)}tracks.json`;
  const tracks = figs.map((f) => ({
    localTrackId: f.localTrackId, class: f.class, startFrame: 0, endFrame: 0, startMs: 9000, endMs: 9000, detectionCount: 1, confirmed: true,
    positions: [{ frameIndex: 0, proxyTimeMs: 0, sourceTimeMs: 9000, box: f.box, confidence: 0.9 }],
  }));
  const artifact = { contractVersion: VISION_CONTRACT_VERSION, role: "tracks", trackerVersionId, proxy: { fps: 25, sourceOffsetMs: 9000 }, tracks, trackCount: tracks.length };
  await prisma.visionJob.create({
    data: {
      id, type: "track", resourceClass: "cpu_small", state: "succeeded", videoAssetId: fx.assetId, modelVersionId: trackerVersionId,
      inputSpec: { videoAssetId: fx.assetId }, outputPrefix: visionKeys.inferencePrefix(id, 1), budgetSeconds: 600, budgetUsdCents: 100,
      contractVersion: VISION_CONTRACT_VERSION, finishedAt: new Date(),
      progress: { artifacts: [{ key, bucket: "derived", role: "tracks" }], summary: { trackerVersionId, tracks: tracks.length } },
    },
  });
  fx.jobIds.push(id);
  await prisma.visionTrack.createMany({
    data: tracks.map((t) => ({
      videoAssetId: fx.assetId, inferenceJobId: id, localTrackId: t.localTrackId, class: t.class, startMs: t.startMs, endMs: t.endMs, startFrame: 0, endFrame: 0,
      detectionCount: 1, confirmed: true, trackerVersionId, detectorVersionId: null, artifactKey: key,
    })),
  });
  await store.putSmallObject("derived", key, JSON.stringify(artifact), "application/json");
  fx.wrote.push({ bucket: "derived", key });
  return { id, key };
}

function python(args: string[]): string {
  const run = spawnSync(PYTHON, ["-m", "dtp_vision_worker.kits", ...args], { cwd: WORKER_DIR, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`kits ${args[0]} failed: ${run.stderr}`);
  return run.stdout;
}

async function cleanup(fx: Fixture | null, store: ObjectStore) {
  if (!fx) return;
  for (const w of fx.wrote) await store.delete(w.bucket, w.key).catch(() => undefined);
  for (const jobId of fx.jobIds) {
    const page = await store.list("derived", `inference/${jobId}/`).catch(() => null);
    for (const key of page?.keys ?? []) await store.delete("derived", key).catch(() => undefined);
  }
  if (fx.tmp) rmSync(fx.tmp, { recursive: true, force: true });
  // Assignments cascade with tracks, tracks and jobs with the asset.
  await prisma.visionVideoAsset.deleteMany({ where: { id: fx.assetId } });
  await prisma.visionModel.deleteMany({ where: { id: { in: fx.modelIds } } });
  await prisma.visionWorker.deleteMany({ where: { id: { in: fx.workerIds } } });
  await prisma.visionAuditLog.deleteMany({ where: { targetId: { in: [...fx.modelIds, ...fx.jobIds] } } });
  await prisma.visionRightsScope.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourceVideoRecord.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourcePartner.deleteMany({ where: { id: fx.partnerId } });
}

async function main() {
  const config = loadVisionConfig();
  const store: ObjectStore = config.storage.backend === "r2" ? new R2ObjectStore(config.storage) : new InMemoryObjectStore();

  console.log("Vision teams — which side each track is on, by kit, with the real arithmetic");
  console.log(`  api ${API}`);
  console.log(`  object store ${store.backendId}`);
  console.log(`  run ${RUN}`);
  if (!existsSync(PYTHON)) throw new Error(`No worker Python at ${PYTHON}; set VISION_WORKER_PYTHON`);

  let fx: Fixture | null = null;
  try {
    fx = await seed();
    const figs = figures();

    // ── 1. Queueing ──────────────────────────────────────────────────────
    section("1. An identify job is refused until everything it needs exists");

    const noTrack = await post("/vision/jobs", { type: "identify", videoAssetId: fx.assetId });
    check("identify before track has succeeded: refused", noTrack.status, 400);

    const trackerModel = await post("/vision/models", { key: `tracker/gate-${RUN}`, task: "track" });
    fx.modelIds.push(String(trackerModel.body.id));
    const tracker = await post(`/vision/models/${trackerModel.body.id}/versions`, {
      version: "0.1", gitCommit: "3eeec6e0", configKey: "tracking.Params()", workerImage: "dtp-vision-worker:0.1",
      licenceNote: "In-house ByteTrack-style association (dtp_vision_worker/tracking.py); no third-party tracking code linked.",
    });
    const trackerId = String(tracker.body.id);
    const tracked = await trackJob(fx, store, trackerId, figs);

    const noModel = await post("/vision/jobs", { type: "identify", videoAssetId: fx.assetId });
    check("no identify version in production and none named: refused", noModel.body.error, "NoProductionModel");

    const identifyModel = await post("/vision/models", { key: `identify/gate-${RUN}`, task: "identify" });
    fx.modelIds.push(String(identifyModel.body.id));
    const identify = await post(`/vision/models/${identifyModel.body.id}/versions`, {
      version: "0.1", gitCommit: "3eeec6e0", configKey: "kits.Params()", workerImage: "dtp-vision-worker:0.1",
      licenceNote: "In-house kit colour clustering (dtp_vision_worker/kits.py); standard library only.",
    });
    const identifyId = String(identify.body.id);
    await prisma.visionModelVersion.update({ where: { id: identifyId }, data: { stage: "production" } });

    const queued = await post("/vision/jobs", { type: "identify", videoAssetId: fx.assetId });
    check("identify queued on a succeeded track job", queued.status, 201);
    const jobId = String(queued.body.id);
    fx.jobIds.push(jobId);
    const row = await prisma.visionJob.findUnique({ where: { id: jobId } });
    check("the job carries the identify version", row?.modelVersionId, identifyId);
    check("…and is on the CPU class", row?.resourceClass, "cpu_small");
    const spec = (row?.inputSpec ?? {}) as Record<string, any>;
    check("…declaring the track artifact", spec.tracks?.key, tracked.key);
    check("…the track job it came from", spec.tracks?.jobId, tracked.id);
    check("…the tracker that made it", spec.tracks?.trackerVersionId, trackerId);
    check("…one readable key", spec.readKeys?.length, 1);
    check("…and the proxy clock", spec.proxy?.sourceOffsetMs, 9000);
    const named = await post("/vision/jobs", { type: "identify", videoAssetId: fx.assetId, params: { trackJobId: randomUUID() } });
    check("naming a track job that does not exist: refused", named.body.error, "TracksMissing");

    // ── 2. The worker, and the arithmetic by hand ─────────────────────────
    section("2. The worker reads the declared artifact and the proxy; the kits by hand");

    const provisioned = await post("/vision/workers/provision", { resourceClass: "cpu_small", providerId: "mock" });
    fx.workerIds.push(String(provisioned.body.workerId));
    const registered = await call("/vision/worker/register", { "x-vision-bootstrap-token": String(provisioned.body.bootstrapToken) }, { method: "POST" });
    const wh = { "x-vision-worker-token": String(registered.body.workerToken) };
    const claimed = await call("/vision/worker/jobs/claim", wh, { method: "POST", body: JSON.stringify({ resourceClasses: ["cpu_small"], contractVersion: VISION_CONTRACT_VERSION }) });
    const claimedId = claimed.body.job?.jobId;
    if (claimedId && claimedId !== jobId) await call(`/vision/worker/jobs/${claimedId}/fail`, wh, { method: "POST", body: JSON.stringify({ reason: "not mine", retryable: true }) });
    check("the worker claimed the identify job", claimedId, jobId);
    check("the claim names the identify version", claimed.body.job?.inputs?.modelVersionIds?.[0], identifyId);
    const allowed = await call(`/vision/worker/jobs/${jobId}/input-url`, wh, { method: "POST", body: JSON.stringify({ role: "declared", key: tracked.key }) });
    check("the declared track artifact is readable", allowed.status, 201);
    const proxy = await call(`/vision/worker/jobs/${jobId}/input-url`, wh, { method: "POST", body: JSON.stringify({ role: "proxy" }) });
    check("…and so is the proxy, by role", proxy.status, 201);
    const refused = await call(`/vision/worker/jobs/${jobId}/input-url`, wh, { method: "POST", body: JSON.stringify({ role: "declared", key: `${visionKeys.inferencePrefix(fx.jobIds[1]!, 1)}detections.json` }) });
    check("the detect artifact is not", refused.status, 403);

    fx.tmp = mkdtempSync(join(tmpdir(), `dtp-teams-${RUN}-`));
    const framePath = join(fx.tmp, "frame.rgb");
    const boxesPath = join(fx.tmp, "boxes.json");
    const featuresPath = join(fx.tmp, "features.json");
    writeFileSync(framePath, paintFrame(figs));
    writeFileSync(boxesPath, JSON.stringify(figs.map((f) => ({ localTrackId: f.localTrackId, class: f.class, box: f.box }))));
    const featuresText = python(["--frame", framePath, "--width", String(W), "--height", String(H), "--boxes", boxesPath]);
    const features = JSON.parse(featuresText) as { localTrackId: number; feature: number[] | null; samples: number }[];
    check("ten kits read off the frame", features.filter((f) => f.feature !== null).length, 10);
    check("a red kit is all in one bin", features[0]!.feature!.filter((v) => v > 0).length, 1);
    writeFileSync(featuresPath, featuresText);
    const resultText = python(["--features", featuresPath]);
    const result = JSON.parse(resultText);
    const kits = (result.kits as { team: string; description: string }[]).map((k) => k.description).sort().join("/");
    check("two kits, red and blue", kits, "blue/red");
    check("nine tracks clustered (the goalkeeper is not)", result.clusteredTracks, 9);
    check("eight assigned", result.assigned, 8);
    check("one unknown", result.unknown, 1);
    check("no outliers", result.outliers, 0);
    const rows = new Map<number, any>((result.rows as any[]).map((r) => [r.localTrackId, r]));
    const sideOf = (id: number) => rows.get(id)?.team;
    check("the four reds share a side", [1, 2, 3, 4].every((i) => sideOf(i) === sideOf(1) && sideOf(1)), true);
    check("the four blues share the other", [5, 6, 7, 8].every((i) => sideOf(i) === sideOf(5) && sideOf(5)), true);
    check("…and the sides differ", sideOf(1) !== sideOf(5), true);
    check("a red kit's margin is the whole distance", rows.get(1)?.confidence, 1);
    check("purple, as far from red as from blue, has no side", sideOf(9), null);
    check("…and no margin at all", rows.get(9)?.confidence, 0);
    check("…but was clustered, not skipped", rows.get(9)?.method, "kit_cluster");
    check("the goalkeeper was never clustered", rows.get(10)?.method, "not_clustered");
    check("the parameters are recorded", result.params?.minMargin, 0.15);
    check("the same features say the same thing twice", python(["--features", featuresPath]) === resultText, true);

    // ── 3. Rows ──────────────────────────────────────────────────────────
    section("3. The completion becomes assignments on the tracks, once");

    const prefix = String(claimed.body.job?.outputPrefix);
    const artifactKey = `${prefix}identity.json`;
    await store.putSmallObject("derived", artifactKey, JSON.stringify({ ...result, role: "identity", identifyVersionId: identifyId, trackerVersionId: trackerId, trackJobId: tracked.id }), "application/json");
    fx.wrote.push({ bucket: "derived", key: artifactKey });
    const summary = {
      identifyVersionId: identifyId, trackerVersionId: trackerId, trackJobId: tracked.id, framesDecoded: 1,
      kits: result.kits, kitDistance: result.kitDistance, clusteredTracks: result.clusteredTracks, assigned: result.assigned, unknown: result.unknown,
      // One row for a track the track job never reported: skipped and counted, not fatal.
      teamRows: [...result.rows, { localTrackId: 99, class: "player", team: "A", confidence: 0.9, method: "kit_cluster", samples: 1 }],
    };
    const completion = { idempotencyKey: `gate-${RUN}-identify`, artifacts: [{ key: artifactKey, bucket: "derived", bytes: 1, contentType: "application/json", role: "identity" }], summary, modelVersionIds: [identifyId] };

    const impostor = await call(`/vision/worker/jobs/${jobId}/complete`, wh, { method: "POST", body: JSON.stringify({ ...completion, modelVersionIds: [trackerId] }) });
    check("a completion naming the tracker as the identifier: refused", impostor.body.error, "ProvenanceMismatch");

    const completed = await call(`/vision/worker/jobs/${jobId}/complete`, wh, { method: "POST", body: JSON.stringify(completion) });
    check("completion accepted", completed.status, 201);
    check("…and applied", completed.body.applied?.applied, true);
    const detail = String(completed.body.applied?.detail ?? "");
    check("…ten assignments, eight with a side", detail.includes("10 assignment(s), 8 with a side"), true);
    check("…naming the kits", detail.includes(": red") && detail.includes(": blue"), true);
    check("…two unknown, ten new", detail.includes("2 unknown, 10 new"), true);
    check("…and the row for no track on record skipped", detail.includes("1 for tracks not on record"), true);

    const listed = await api(`/vision/assets/${fx.assetId}/tracks`);
    const onTrack = new Map<number, any>((listed.body.tracks ?? []).map((t: any) => [t.localTrackId, t.teamAssignments?.[0] ?? null]));
    check("every track row carries its assignment", [...onTrack.values()].every((a) => a !== null), true);
    check("a red track's assignment names its kit", onTrack.get(1)?.kitDescription, "red");
    check("a blue track's names the other", onTrack.get(5)?.kitDescription, "blue");
    check("…on different sides", onTrack.get(1)?.team !== onTrack.get(5)?.team && !!onTrack.get(1)?.team, true);
    check("purple is unknown, with no kit named", `${onTrack.get(9)?.team}/${onTrack.get(9)?.kitDescription}`, "null/null");
    check("the goalkeeper's row says it was not clustered", onTrack.get(10)?.method, "not_clustered");
    check("every assignment names the identify version", [...onTrack.values()].every((a) => a?.identifyVersionId === identifyId), true);
    check("…and starts unreviewed", [...onTrack.values()].every((a) => a?.reviewState === "unreviewed"), true);

    const retried = await call(`/vision/worker/jobs/${jobId}/complete`, wh, { method: "POST", body: JSON.stringify(completion) });
    check("a retried completion is recognised", retried.body.alreadyApplied, true);
    check("…and adds no rows", await prisma.visionTeamAssignment.count({ where: { inferenceJobId: jobId } }), 10);
    check("two rows in the database have no side", await prisma.visionTeamAssignment.count({ where: { inferenceJobId: jobId, team: null } }), 2);

    await post(`/vision/workers/${provisioned.body.workerId}/retire`, {});
  } catch (error) {
    failures += 1;
    console.error("\nGate aborted:", error);
  } finally {
    await cleanup(fx, store).catch((e) => console.error("cleanup failed:", e));
    await prisma.$disconnect();
  }

  console.log(`\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ""}`);
  process.exitCode = failures ? 1 : 0;
}

void main();
