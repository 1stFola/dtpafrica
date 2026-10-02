/**
 * Phase 5 Increment 1 gate — a homography per camera segment, and the rule that
 * an invalid one cannot silently produce a distance.
 *
 *   pnpm --filter @dtp/api vision:calibrationcheck
 *
 * Needs the API on :3000 (`VISION_E2E_API`), whatever `DATABASE_URL` points at
 * (never production), the object store the API is configured with, and the
 * seeded `vision_reviewer` role. The gate invents a camera -- a known homography
 * from the pitch to the picture -- seeds a track walking twenty metres across it,
 * and has a signed-in person declare segments and click landmarks the camera
 * would have shown them.
 *
 * Three claims are on trial:
 *
 *   1. Camera segments are a person's, inside the footage, and never overlap.
 *   2. Six landmarks recover the camera: the calibration is `good`, and the
 *      track's positions come back in metres with a twenty-metre distance.
 *   3. A calibration that failed the bar supersedes it, and from then on the
 *      positions and the distance are suppressed and say why -- docs/vision/10,
 *      Phase 5: invalid calibration cannot silently produce speed or distance.
 */
import { randomBytes, randomUUID } from "node:crypto";
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

loadApiEnv();

const API = process.env.VISION_E2E_API ?? "http://localhost:3000/api/v1";
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
function near(label: string, actual: unknown, expected: number, tolerance: number) {
  checks += 1;
  const ok = typeof actual === "number" && Math.abs(actual - expected) <= tolerance;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(68)} ${ok ? String(actual) : `expected ${expected}±${tolerance}, got ${actual}`}`);
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

/* The camera: a stand on the near touchline, looking across. Pitch metres -> proxy pixels. */
const CAMERA: Homography = [9.2, -3.1, 160, 0.4, 2.6, 80, 0.0004, 0.011, 1];
const see = (xM: number, yM: number) => project(CAMERA, { x: xM, y: yM })!;
const PITCH = { lengthM: 105, widthM: 68 };
function clicks(ids: string[], noisePx = 0) {
  const by = landmarkById(PITCH);
  let s = 7;
  const rand = () => {
    s = (s * 48271) % 2147483647;
    return s / 2147483647 - 0.5;
  };
  return ids.map((id) => {
    const l = by.get(id)!;
    const p = see(l.xM, l.yM);
    return { landmark: id, px: p.x + rand() * 2 * noisePx, py: p.y + rand() * 2 * noisePx, frameIndex: 0 };
  });
}
const SIX = ["corner_left_near", "corner_left_far", "halfway_near", "halfway_far", "left_penalty_spot", "centre_spot"];

type Fixture = { partnerId: string; assetId: string; jobIds: string[]; userIds: string[]; wrote: { bucket: "derived"; key: string }[] };

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

async function seed(store: ObjectStore): Promise<{ fx: Fixture; trackId: string }> {
  const sbMatch = await prisma.sbMatch.findFirst({ select: { id: true } });
  if (!sbMatch) throw new Error("No SbMatch in the database to link an asset to");
  const partner = await prisma.visionSourcePartner.create({ data: { name: `Calibration gate ${RUN}`, contactEmail: "gate@example.test" } });
  const fx: Fixture = { partnerId: partner.id, assetId: "", jobIds: [], userIds: [], wrote: [] };
  const record = await prisma.visionSourceVideoRecord.create({
    data: { partnerId: partner.id, title: `Calibration gate record ${RUN}`, sourceQualityRank: "broadcast", originalAvailable: true, acquisitionStatus: "acquired", acquisitionMethod: "partner_direct_upload" },
  });
  await prisma.visionRightsScope.create({
    data: { partnerId: partner.id, grantLevel: "partner", canAnalyze: true, canTrain: true, canPublishHighlight: false, canShareWithScout: false, grantedAt: new Date() },
  });
  const asset = await prisma.visionVideoAsset.create({
    data: {
      sourceVideoRecordId: record.id, sbMatchId: sbMatch.id, corpus: "dtp_owned", objectKey: `originals/gate-${RUN}-calibration/source.mp4`, bytes: BigInt(1024), mimeType: "video/mp4",
      checksumSha256: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64), width: 1280, height: 720, durationMs: 120_000, ingestState: "ready",
      variants: { create: { kind: "proxy", objectKey: `proxies/gate-${RUN}-calibration/proxy.mp4`, width: 1280, height: 720, fps: 25, durationMs: 120_000, sourceOffsetMs: 9000 } },
    },
  });
  fx.assetId = asset.id;
  const trackJob = randomUUID();
  fx.jobIds.push(trackJob);
  await prisma.visionJob.create({
    data: { id: trackJob, type: "track", resourceClass: "cpu_small", state: "succeeded", videoAssetId: asset.id, inputSpec: {}, outputPrefix: visionKeys.inferencePrefix(trackJob, 1), budgetSeconds: 600, budgetUsdCents: 100, contractVersion: VISION_CONTRACT_VERSION, finishedAt: new Date() },
  });
  // One player walking from (10, 34) to (30, 34) metres over 41 frames at 25fps, seen by the camera.
  const positions = [];
  for (let i = 0; i <= 40; i += 1) {
    const foot = see(10 + i * 0.5, 34);
    const ms = Math.round((i / 25) * 1000);
    positions.push({ frameIndex: i, proxyTimeMs: ms, sourceTimeMs: ms + 9000, box: { x: foot.x - 20, y: foot.y - 80, width: 40, height: 80 }, confidence: 0.9 });
  }
  const key = `${visionKeys.inferencePrefix(trackJob, 1)}tracks.json`;
  await store.putSmallObject("derived", key, JSON.stringify({ contractVersion: VISION_CONTRACT_VERSION, role: "tracks", trackerVersionId: "gate", proxy: { fps: 25, sourceOffsetMs: 9000 }, tracks: [{ localTrackId: 1, class: "player", positions }], trackCount: 1 }), "application/json");
  fx.wrote.push({ bucket: "derived", key });
  const track = await prisma.visionTrack.create({
    data: { videoAssetId: asset.id, inferenceJobId: trackJob, localTrackId: 1, class: "player", startMs: 9000, endMs: 10600, startFrame: 0, endFrame: 40, detectionCount: 41, confirmed: true, artifactKey: key },
  });
  return { fx, trackId: track.id };
}

async function cleanup(fx: Fixture | null, store: ObjectStore) {
  if (!fx) return;
  for (const w of fx.wrote) await store.delete(w.bucket, w.key).catch(() => undefined);
  // Segments and calibrations cascade with the asset; so do tracks and jobs.
  await prisma.visionVideoAsset.deleteMany({ where: { id: fx.assetId } });
  await prisma.visionAuditLog.deleteMany({ where: { OR: [{ actorId: { in: fx.userIds } }, { targetId: { in: [...fx.jobIds, fx.assetId] } }] } });
  await prisma.adminUser.deleteMany({ where: { id: { in: fx.userIds } } });
  await prisma.visionRightsScope.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourceVideoRecord.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourcePartner.deleteMany({ where: { id: fx.partnerId } });
}

async function main() {
  const config = loadVisionConfig();
  const store: ObjectStore = config.storage.backend === "r2" ? new R2ObjectStore(config.storage) : new InMemoryObjectStore();
  console.log("Vision calibration — a homography per camera segment, and a distance that will not lie");
  console.log(`  api ${API}`);
  console.log(`  object store ${store.backendId}`);
  console.log(`  run ${RUN}`);

  let fx: Fixture | null = null;
  try {
    const seeded = await seed(store);
    fx = seeded.fx;
    const trackId = seeded.trackId;
    const reviewer = await person(fx, "vision_reviewer", "reviewer");
    const R = {
      post: (path: string, body: unknown) => call(path, { Authorization: `Bearer ${reviewer.token}` }, { method: "POST", body: JSON.stringify(body) }),
    };

    // ── 1. Segments ──────────────────────────────────────────────────────
    section("1. Camera segments are a person's, inside the footage, and never overlap");

    const keyed = await post(`/vision/review/${fx.assetId}/camera-segments`, { startMs: 9000, endMs: 60_000, kind: "wide" });
    check("the operator key cannot declare a segment", keyed.body.error, "CalibrationNeedsAPerson");
    const empty = await R.post(`/vision/review/${fx.assetId}/camera-segments`, { startMs: 9000, endMs: 9000, kind: "wide" });
    check("an empty segment: refused", empty.body.error, "SegmentEmpty");
    const outside = await R.post(`/vision/review/${fx.assetId}/camera-segments`, { startMs: 9000, endMs: 130_000, kind: "wide" });
    check("a segment past the footage: refused", outside.body.error, "SegmentOutsideAsset");
    const bad = await R.post(`/vision/review/${fx.assetId}/camera-segments`, { startMs: 9000, endMs: 60_000, kind: "drone" });
    check("an unknown kind: refused", bad.status, 400);
    const first = await R.post(`/vision/review/${fx.assetId}/camera-segments`, { startMs: 9000, endMs: 60_000, kind: "wide" });
    check("a wide segment over the first minute", `${first.status}/${first.body.source}/${first.body.createdBy === reviewer.id}`, "201/manual/true");
    const overlap = await R.post(`/vision/review/${fx.assetId}/camera-segments`, { startMs: 50_000, endMs: 70_000, kind: "close" });
    check("an overlapping segment: refused", overlap.body.error, "SegmentOverlaps");
    const second = await R.post(`/vision/review/${fx.assetId}/camera-segments`, { startMs: 60_001, endMs: 120_000, kind: "close" });
    check("a segment beside it", second.status, 201);
    const segmentId = String(first.body.id);

    const landmarks = await api(`/vision/calibration/landmarks`);
    check("the landmark catalogue has thirty-three places on a standard pitch", landmarks.body.landmarks?.length, 33);
    const small = await api(`/vision/calibration/landmarks?lengthM=90&widthM=55`);
    check("…and places the penalty spot eleven metres out on a short pitch", small.body.landmarks?.find((l: any) => l.id === "right_penalty_spot")?.xM, 79);
    const silly = await api(`/vision/calibration/landmarks?lengthM=20&widthM=10`);
    check("…and refuses dimensions no pitch has", typeof silly.body.problem, "string");

    // ── 2. Calibration ───────────────────────────────────────────────────
    section("2. Six landmarks recover the camera, and a track walks twenty metres");

    const before = await api(`/vision/review/tracks/${trackId}/pitch-positions`);
    check("before any calibration, nothing is placed", before.body.summary?.placed, 0);
    check("…and the distance is suppressed, saying why", `${before.body.distance?.suppressed}/${String(before.body.distance?.reason).includes("segment_not_calibrated")}`, "true/true");

    const few = await api(`/vision/calibration/preview`, { method: "POST", body: JSON.stringify({ points: clicks(SIX.slice(0, 3)) }) });
    check("a preview of three points says too few", `${few.body.ok}/${few.body.reason}`, "false/too_few_points");
    const exact = await api(`/vision/calibration/preview`, { method: "POST", body: JSON.stringify({ points: clicks(SIX), pitch: PITCH }) });
    check("a preview of six exact landmarks is good", exact.body.quality, "good");
    near("…with no reprojection error to speak of", exact.body.reprojectionErrorM, 0, 0.01);
    const noisy = await api(`/vision/calibration/preview`, { method: "POST", body: JSON.stringify({ points: clicks(SIX, 4), pitch: PITCH }) });
    check("four pixels of click noise is still a fit", noisy.body.ok, true);
    check("…with an error in metres a person can read", typeof noisy.body.reprojectionErrorM === "number" && noisy.body.reprojectionErrorM > 0.01, true);

    const keyedCal = await post(`/vision/review/camera-segments/${segmentId}/calibration`, { points: clicks(SIX), pitch: PITCH });
    check("the operator key cannot calibrate", keyedCal.body.error, "CalibrationNeedsAPerson");
    const degenerate = await R.post(`/vision/review/camera-segments/${segmentId}/calibration`, { points: clicks(["corner_left_near", "halfway_near", "corner_right_near", "left_box_near_goalline"]), pitch: PITCH });
    check("three landmarks on one line: refused, nothing saved", degenerate.body.error, "CalibrationDegenerate");
    const good = await R.post(`/vision/review/camera-segments/${segmentId}/calibration`, { points: clicks(SIX), pitch: PITCH });
    check("six landmarks: filed as good", `${good.status}/${good.body.quality}/${good.body.method}`, "201/good/manual");
    check("…by the reviewer, under the provisional thresholds", `${good.body.decidedBy === reviewer.id}/${String(good.body.thresholdsVersion).includes("provisional")}`, "true/true");

    const placed = await api(`/vision/review/tracks/${trackId}/pitch-positions`);
    check("every position is placed", `${placed.body.summary?.placed}/${placed.body.summary?.positions}`, "41/41");
    near("the first step is at ten metres", placed.body.positions?.[0]?.xM, 10, 0.05);
    near("…on the halfway line across", placed.body.positions?.[0]?.yM, 34, 0.05);
    near("the last at thirty", placed.body.positions?.[40]?.xM, 30, 0.05);
    check("the distance is not suppressed", placed.body.distance?.suppressed, false);
    near("…and is twenty metres", placed.body.distance?.metres, 20, 0.1);
    check("the pitch's dimensions travel with the answer", `${placed.body.pitch?.lengthM}x${placed.body.pitch?.widthM}`, "105x68");

    // ── 3. The rule ──────────────────────────────────────────────────────
    section("3. An invalid calibration cannot silently produce a distance");

    const swapped = clicks(SIX);
    [swapped[0]!.landmark, swapped[1]!.landmark] = [swapped[1]!.landmark, swapped[0]!.landmark];
    const failed = await R.post(`/vision/review/camera-segments/${segmentId}/calibration`, { points: swapped, pitch: PITCH });
    check("two landmarks swapped: a homography exists and it failed the bar", `${failed.status}/${failed.body.quality}`, "201/failed");
    check("…with an error in metres that says so", typeof failed.body.reprojectionErrorM === "number" && failed.body.reprojectionErrorM > 2, true);
    const segments = await api(`/vision/review/${fx.assetId}/camera-segments`);
    const seg = (segments.body.segments ?? []).find((s: any) => s.id === segmentId);
    check("the failed calibration is the segment's current one", seg?.calibration?.quality, "failed");
    check("…and the good one is superseded, not erased", seg?.superseded, 1);
    check("calibrated coverage counts only what passed the bar", segments.body.coverage?.calibratedMs, 0);
    check("segmented coverage counts both segments", segments.body.coverage?.segmentedMs, 51_000 + 59_999);

    const after = await api(`/vision/review/tracks/${trackId}/pitch-positions`);
    check("now nothing is placed", after.body.summary?.placed, 0);
    check("…every position says the calibration failed", after.body.summary?.reasons?.calibration_failed, 41);
    check("…the distance is suppressed", after.body.distance?.suppressed, true);
    check("…and labelled", String(after.body.distance?.reason).includes("calibration_failed"), true);
    check("…with no number anywhere in it", JSON.stringify(after.body).includes('"metres"'), false);

    const audit = await prisma.visionAuditLog.groupBy({ by: ["action"], where: { actorId: reviewer.id }, _count: { _all: true } });
    const count = (a: string) => audit.find((r) => r.action === a)?._count._all ?? 0;
    check("the audit trail: two segments declared", count("camera.segment.declared"), 2);
    check("…two calibrations set", count("calibration.set"), 2);
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
