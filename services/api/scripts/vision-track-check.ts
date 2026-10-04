/**
 * Phase 4 Increment 1 gate — tracks, from a detect artifact to rows.
 *
 *   pnpm --filter @dtp/api vision:trackcheck
 *
 * Needs the API on :3000 (`VISION_E2E_API`), whatever `DATABASE_URL` points at
 * (never production), the object store the API is configured with, and the
 * worker's Python environment: the tracks the fake pod reports are produced by the
 * **real** tracker on the **real** artifact in the store, and the expected tracks
 * were worked out by hand.
 *
 * Three claims are on trial:
 *
 *   1. A track job cannot be queued without a tracker in production or named, nor
 *      without a succeeded detect job, nor on detections too sparse to link.
 *   2. The worker reads the one declared artifact, and the tracker's output on it
 *      matches the arithmetic by hand: two players, one ball with a gap, one lone
 *      box dropped as noise.
 *   3. The completion becomes one row per track naming both models, idempotently,
 *      and the rows are readable per asset.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { VISION_CONTRACT_VERSION, visionKeys } from "@dtp/vision-contracts";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { loadVisionConfig } from "../src/vision/config/vision.config";
import { InMemoryObjectStore } from "../src/vision/storage/in-memory-object-store";
import { R2ObjectStore } from "../src/vision/storage/r2-object-store";
import type { ObjectStore } from "../src/vision/storage/object-store";
import { PROVISION_KEY_HEADER, provisionKeyFor } from "../src/vision/worker/provision-key";
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

type Fixture = {
  partnerId: string;
  assetId: string;
  proxyKey: string;
  modelIds: string[];
  jobIds: string[];
  workerIds: string[];
  wrote: { bucket: "derived" | "models"; key: string }[];
  tmp: string | null;
};

/* The footage, by hand, at 25fps for 60 frames:
     player A walks right, x 100 -> 395, 5px a frame, every frame        -> one track, 60 hits
     player B stands at x 700, every frame                                -> one track, 60 hits
     the ball at (400,300) frames 0-19, hidden 20-29, back 30-59          -> one track, 50 hits, a gap
     a lone box at frame 40, (900,500), once                              -> noise, not a track
   So: 3 tracks (player 2, ball 1), 170 linked, 1 unlinked. */
function detectArtifact(modelVersionId: string, fps = 25) {
  const frames = [];
  for (let i = 0; i < 60; i += 1) {
    const ms = Math.round((i / 25) * 1000);
    const detections: unknown[] = [
      { class: "player", confidence: 0.9, box: { x: 100 + 5 * i, y: 100, width: 40, height: 80 } },
      { class: "player", confidence: 0.85, box: { x: 700, y: 120, width: 40, height: 80 } },
    ];
    if (i < 20 || i >= 30) detections.push({ class: "ball", confidence: 0.6, box: { x: 400, y: 300, width: 10, height: 10 } });
    if (i === 40) detections.push({ class: "player", confidence: 0.9, box: { x: 900, y: 500, width: 40, height: 80 } });
    frames.push({ sampleIndex: i + 1, frameIndex: i, proxyTimeMs: ms, sourceTimeMs: ms + 9000, qualityFlags: [], detections });
  }
  return { contractVersion: VISION_CONTRACT_VERSION, role: "detections", modelVersionId, proxy: { fps: 25, sourceOffsetMs: 9000 }, sampleFps: fps, frames };
}

async function seed(): Promise<Fixture> {
  gateMatch = await createGateMatch(prisma, RUN);
  const sbMatch = gateMatch;
  const partner = await prisma.visionSourcePartner.create({ data: { name: `Tracks gate ${RUN}`, contactEmail: "gate@example.test" } });
  const record = await prisma.visionSourceVideoRecord.create({
    data: { partnerId: partner.id, title: `Tracks gate record ${RUN}`, sourceQualityRank: "broadcast", originalAvailable: true, acquisitionStatus: "acquired", acquisitionMethod: "partner_direct_upload" },
  });
  await prisma.visionRightsScope.create({
    data: { partnerId: partner.id, grantLevel: "partner", canAnalyze: true, canTrain: true, canPublishHighlight: false, canShareWithScout: false, grantedAt: new Date() },
  });
  const proxyKey = `proxies/gate-${RUN}-tracks/proxy.mp4`;
  const asset = await prisma.visionVideoAsset.create({
    data: {
      sourceVideoRecordId: record.id, sbMatchId: sbMatch.id, corpus: "dtp_owned", objectKey: `originals/gate-${RUN}-tracks/source.mp4`, bytes: BigInt(1024), mimeType: "video/mp4",
      checksumSha256: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64), width: 1280, height: 720, durationMs: 120_000, ingestState: "ready",
      variants: { create: { kind: "proxy", objectKey: proxyKey, width: 1280, height: 720, fps: 25, durationMs: 120_000, sourceOffsetMs: 9000 } },
    },
  });
  // transcode succeeded, so detect and track prerequisites can be satisfied.
  const transcodeId = randomUUID();
  await prisma.visionJob.create({
    data: { id: transcodeId, type: "transcode", resourceClass: "cpu_small", state: "succeeded", videoAssetId: asset.id, inputSpec: {}, outputPrefix: visionKeys.inferencePrefix(transcodeId, 1), budgetSeconds: 600, budgetUsdCents: 100, contractVersion: VISION_CONTRACT_VERSION, finishedAt: new Date() },
  });
  return { partnerId: partner.id, assetId: asset.id, proxyKey, modelIds: [], jobIds: [transcodeId], workerIds: [], wrote: [], tmp: null };
}

async function detectJob(fx: Fixture, store: ObjectStore, detectorVersionId: string, fps: number) {
  const id = randomUUID();
  const key = `${visionKeys.inferencePrefix(id, 1)}detections.json`;
  const artifact = detectArtifact(detectorVersionId, fps);
  await prisma.visionJob.create({
    data: {
      id, type: "detect", resourceClass: "gpu_24gb", state: "succeeded", videoAssetId: fx.assetId, modelVersionId: detectorVersionId,
      inputSpec: { videoAssetId: fx.assetId, sampleFps: fps }, outputPrefix: visionKeys.inferencePrefix(id, 1), budgetSeconds: 600, budgetUsdCents: 100,
      contractVersion: VISION_CONTRACT_VERSION, finishedAt: new Date(),
      progress: { artifacts: [{ key, bucket: "derived", role: "detections" }], summary: { modelVersionId: detectorVersionId, sampleFps: fps, framesSampled: 60 } },
    },
  });
  fx.jobIds.push(id);
  await store.putSmallObject("derived", key, JSON.stringify(artifact), "application/json");
  fx.wrote.push({ bucket: "derived", key });
  return { id, key, artifact };
}

async function cleanup(fx: Fixture | null, store: ObjectStore) {
  if (!fx) {
    await removeGateMatch(prisma, gateMatch);
    return;
  }
  for (const w of fx.wrote) await store.delete(w.bucket, w.key).catch(() => undefined);
  for (const jobId of fx.jobIds) {
    const page = await store.list("derived", `inference/${jobId}/`).catch(() => null);
    for (const key of page?.keys ?? []) await store.delete("derived", key).catch(() => undefined);
  }
  if (fx.tmp) rmSync(fx.tmp, { recursive: true, force: true });
  // Tracks and jobs cascade with the asset; model versions are SetNull on jobs.
  await prisma.visionVideoAsset.deleteMany({ where: { id: fx.assetId } });
  await prisma.visionModel.deleteMany({ where: { id: { in: fx.modelIds } } });
  await removeGateWorkers(prisma, fx.workerIds);
  await prisma.visionAuditLog.deleteMany({ where: { targetId: { in: [...fx.modelIds, ...fx.jobIds] } } });
  await prisma.visionRightsScope.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourceVideoRecord.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourcePartner.deleteMany({ where: { id: fx.partnerId } });
  await removeGateMatch(prisma, gateMatch);
}

async function main() {
  assertDevDatabase({ api: API });
  const config = loadVisionConfig();
  const store: ObjectStore = config.storage.backend === "r2" ? new R2ObjectStore(config.storage) : new InMemoryObjectStore();

  console.log("Vision tracks — from a detect artifact to rows, with the real tracker");
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

    // ── 1. Queueing ──────────────────────────────────────────────────────
    section("1. A track job is refused until everything it needs exists");

    const detectorModel = await post("/vision/models", { key: `detector/gate-${RUN}`, task: "detect" });
    fx.modelIds.push(String(detectorModel.body.id));
    const detector = await post(`/vision/models/${detectorModel.body.id}/versions`, {
      version: "0.1", gitCommit: "3eeec6e0", configKey: "c", workerImage: "dtp-vision-engine:0.1", licenceNote: "Gate fixture: torchvision BSD-3-Clause; no DTP data.",
    });
    const detectorId = String(detector.body.id);

    const noDetect = await post("/vision/jobs", { type: "track", videoAssetId: fx.assetId });
    check("track before detect has succeeded: refused", noDetect.status, 400);

    const sparse = await detectJob(fx, store, detectorId, 2);
    const noTracker = await post("/vision/jobs", { type: "track", videoAssetId: fx.assetId });
    check("no tracker in production and none named: refused", noTracker.body.error, "NoProductionModel");

    const trackerModel = await post("/vision/models", { key: `tracker/gate-${RUN}`, task: "track" });
    fx.modelIds.push(String(trackerModel.body.id));
    const tracker = await post(`/vision/models/${trackerModel.body.id}/versions`, {
      version: "0.1", gitCommit: "3eeec6e0", configKey: "tracking.Params()", workerImage: "dtp-vision-worker:0.1",
      licenceNote: "In-house ByteTrack-style association (dtp_vision_worker/tracking.py); no third-party tracking code linked.",
    });
    const trackerId = String(tracker.body.id);
    await prisma.visionModelVersion.update({ where: { id: trackerId }, data: { stage: "production" } });

    const tooSparse = await post("/vision/jobs", { type: "track", videoAssetId: fx.assetId });
    check("detections at 2fps: refused as too sparse", tooSparse.body.error, "DetectionsTooSparse");

    const dense = await detectJob(fx, store, detectorId, 25);
    // Two camera segments on the footage, as the cuts stage leaves them: the second starts where the camera changes.
    await prisma.visionCameraSegment.createMany({ data: [
      { videoAssetId: fx.assetId, startMs: 9000, endMs: 10_200, kind: "unknown", source: "scene_detect" },
      { videoAssetId: fx.assetId, startMs: 10_200, endMs: 11_400, kind: "unknown", source: "scene_detect" },
    ] });
    const queued = await post("/vision/jobs", { type: "track", videoAssetId: fx.assetId, params: { cuts: [1, 2, 3] } });
    check("track queued on dense detections", queued.status, 201);
    const jobId = String(queued.body.id);
    fx.jobIds.push(jobId);
    const row = await prisma.visionJob.findUnique({ where: { id: jobId } });
    check("the job carries the tracker version", row?.modelVersionId, trackerId);
    check("…and is on the CPU class", row?.resourceClass, "cpu_small");
    const spec = (row?.inputSpec ?? {}) as Record<string, any>;
    check("…declaring the dense detect artifact, not the sparse one", spec.detections?.key, dense.key);
    check("…with the detector version", spec.detections?.modelVersionId, detectorId);
    check("…and the proxy clock", spec.proxy?.sourceOffsetMs, 9000);
    check("…and the camera cut: the start of the second segment, not what the caller sent", JSON.stringify(spec.cuts), "[10200]");
    const named = await post("/vision/jobs", { type: "track", videoAssetId: fx.assetId, params: { detectJobId: sparse.id } });
    check("naming the sparse detect job explicitly: refused too", named.body.error, "DetectionsTooSparse");

    // ── 2. The worker and the real tracker ────────────────────────────────
    section("2. The worker reads the declared artifact; the tracker's output by hand");

    const provisioned = await post("/vision/workers/provision", { resourceClass: "cpu_small", providerId: "mock" });
    fx.workerIds.push(String(provisioned.body.workerId));
    const registered = await call("/vision/worker/register", { "x-vision-bootstrap-token": String(provisioned.body.bootstrapToken) }, { method: "POST" });
    const wh = { "x-vision-worker-token": String(registered.body.workerToken) };
    const claimed = await call("/vision/worker/jobs/claim", wh, { method: "POST", body: JSON.stringify({ resourceClasses: ["cpu_small"], contractVersion: VISION_CONTRACT_VERSION }) });
    const claimedId = claimed.body.job?.jobId;
    if (claimedId && claimedId !== jobId) await call(`/vision/worker/jobs/${claimedId}/fail`, wh, { method: "POST", body: JSON.stringify({ reason: "not mine", retryable: true }) });
    check("the worker claimed the track job", claimedId, jobId);
    check("the claim names the tracker", claimed.body.job?.inputs?.modelVersionIds?.[0], trackerId);
    check("…and declares one key", claimed.body.job?.inputs?.readKeys?.length, 1);
    const allowed = await call(`/vision/worker/jobs/${jobId}/input-url`, wh, { method: "POST", body: JSON.stringify({ role: "declared", key: dense.key }) });
    check("the declared artifact is readable", allowed.status, 201);
    const refused = await call(`/vision/worker/jobs/${jobId}/input-url`, wh, { method: "POST", body: JSON.stringify({ role: "declared", key: sparse.key }) });
    check("the other detect artifact is not", refused.status, 403);

    fx.tmp = mkdtempSync(join(tmpdir(), `dtp-track-${RUN}-`));
    const detPath = join(fx.tmp, "detections.json");
    writeFileSync(detPath, (await store.getSmallObject("derived", dense.key))!);
    const outPath = join(fx.tmp, "tracks.json");
    const linked = spawnSync(PYTHON, ["-m", "dtp_vision_worker.tracking", "--detections", detPath, "--out", outPath], { cwd: WORKER_DIR, encoding: "utf8" });
    if (linked.status !== 0) throw new Error(`tracker failed: ${linked.stderr}`);
    const result = JSON.parse(readFileSync(outPath, "utf8"));
    check("three tracks", result.tracks.length, 3);
    check("two players", result.tracksByClass?.player, 2);
    check("one ball", result.tracksByClass?.ball, 1);
    check("170 detections linked", result.detectionsLinked, 170);
    check("the lone box dropped as noise", result.detectionsUnlinked, 1);
    const ball = result.tracks.find((t: any) => t.class === "ball");
    check("the ball track spans the gap", `${ball?.startFrame}-${ball?.endFrame}`, "0-59");
    check("…with fifty observations, not sixty", ball?.detectionCount, 50);
    check("…and no position inside the gap", ball?.positions.some((p: any) => p.frameIndex >= 20 && p.frameIndex < 30), false);
    const walker = result.tracks.find((t: any) => t.class === "player" && t.positions[0].box.x === 100);
    check("the walking player is one track", walker?.detectionCount, 60);
    check("…ending where he walked to", walker?.positions.at(-1)?.box.x, 395);
    check("times are source time (offset 9s applied)", ball?.startMs, 9000);

    check("…and every frame the tracker was given, with or without a track on it", `${result.trackedFrames?.length}/${JSON.stringify(result.trackedFrames?.[0])}/${result.framesTracked}`, "60/[0,9000]/60");
    check("…aged by the clock, not by a count of frames", `${result.params?.maxAgeMs}/${result.params?.maxAge}`, "1200/undefined");
    check("with no cut declared, no track ended at one", `${result.cuts}/${result.tracksEndedAtCuts}`, "0/0");

    // The same detections with the declared cut: the frame at 10,200 ms is another camera's picture.
    const cutPath = join(fx.tmp, "tracks-cut.json");
    const cutRun = spawnSync(PYTHON, ["-m", "dtp_vision_worker.tracking", "--detections", detPath, "--out", cutPath, "--cuts", (spec.cuts ?? []).join(",")], { cwd: WORKER_DIR, encoding: "utf8" });
    if (cutRun.status !== 0) throw new Error(`tracker with cuts failed: ${cutRun.stderr}`);
    const cut = JSON.parse(readFileSync(cutPath, "utf8"));
    const walkerParts = cut.tracks.filter((t: any) => t.class === "player" && [100, 250].includes(t.positions[0].box.x)).map((t: any) => `${t.startMs}-${t.endMs}`).sort();
    check("at the cut the walking player's track ends and another begins on the frame of the cut", walkerParts.join(","), "10200-11360,9000-10160");
    check("…as every track alive there does", `${cut.cuts}/${cut.tracksEndedAtCuts >= 2}/${cut.tracks.length > result.tracks.length}`, "1/true/true");
    check("…and no detection is lost by it", cut.detectionsLinked + cut.detectionsUnlinked, result.detectionsLinked + result.detectionsUnlinked);

    const sparseCheck = spawnSync(PYTHON, ["-m", "dtp_vision_worker.tracking", "--detections", detPath.replace("detections.json", "sparse.json")], { cwd: WORKER_DIR, encoding: "utf8" });
    writeFileSync(detPath.replace("detections.json", "sparse.json"), JSON.stringify(sparse.artifact));
    const sparseRun = spawnSync(PYTHON, ["-m", "dtp_vision_worker.tracking", "--detections", detPath.replace("detections.json", "sparse.json")], { cwd: WORKER_DIR, encoding: "utf8" });
    void sparseCheck;
    check("the tracker itself refuses sparse detections", sparseRun.status, 2);

    // ── 3. Rows ──────────────────────────────────────────────────────────
    section("3. The completion becomes rows, once");

    const prefix = String(claimed.body.job?.outputPrefix);
    const artifactKey = `${prefix}tracks.json`;
    await store.putSmallObject("derived", artifactKey, JSON.stringify({ ...result, role: "tracks", trackerVersionId: trackerId, detectorVersionId: detectorId }), "application/json");
    fx.wrote.push({ bucket: "derived", key: artifactKey });
    const summary = {
      trackerVersionId: trackerId, detectorVersionId: detectorId, detectJobId: dense.id, sampleFps: 25,
      tracks: result.tracks.length, tracksByClass: result.tracksByClass, framesTracked: result.framesTracked,
      detectionsLinked: result.detectionsLinked, detectionsUnlinked: result.detectionsUnlinked, meanTrackFrames: result.meanTrackFrames,
      trackRows: result.summaryRows,
    };
    const completion = { idempotencyKey: `gate-${RUN}-track`, artifacts: [{ key: artifactKey, bucket: "derived", bytes: 1, contentType: "application/json", role: "tracks" }], summary, modelVersionIds: [trackerId] };

    const impostor = await call(`/vision/worker/jobs/${jobId}/complete`, wh, { method: "POST", body: JSON.stringify({ ...completion, modelVersionIds: [detectorId] }) });
    check("a completion naming the detector as the tracker: refused", impostor.body.error, "ProvenanceMismatch");

    const completed = await call(`/vision/worker/jobs/${jobId}/complete`, wh, { method: "POST", body: JSON.stringify(completion) });
    check("completion accepted", completed.status, 201);
    check("…and applied", completed.body.applied?.applied, true);
    check("…naming both models", String(completed.body.applied?.detail ?? "").includes(`tracker ${trackerId}, detector ${detectorId}`), true);

    const listed = await api(`/vision/assets/${fx.assetId}/tracks`);
    check("three rows for the asset", listed.body.count, 3);
    check("…two players and a ball", `${listed.body.byClass?.player}/${listed.body.byClass?.ball}`, "2/1");
    const ballRow = (listed.body.tracks ?? []).find((t: any) => t.class === "ball");
    check("the ball row spans source 9,000-11,360ms", `${ballRow?.startMs}-${ballRow?.endMs}`, "9000-11360");
    check("…with 50 detections", ballRow?.detectionCount, 50);
    check("…naming the tracker", ballRow?.trackerVersionId, trackerId);
    check("…and the detector", ballRow?.detectorVersionId, detectorId);
    check("…and where its positions are", ballRow?.artifactKey, artifactKey);

    const retried = await call(`/vision/worker/jobs/${jobId}/complete`, wh, { method: "POST", body: JSON.stringify(completion) });
    check("a retried completion is recognised", retried.body.alreadyApplied, true);
    check("…and adds no rows", await prisma.visionTrack.count({ where: { inferenceJobId: jobId } }), 3);

    /* The review screen's boxes: every track of the latest run in one answer (docs/vision/59). */
    const boxes = await api(`/vision/review/${fx.assetId}/positions`);
    check("every track's positions come in one answer", boxes.status, 200);
    check("…for this track run, the only one", `${boxes.body.trackJobId === jobId}/${boxes.body.trackJobs}`, "true/1");
    check("…keyed by the three rows", Object.keys(boxes.body.positions ?? {}).sort().join(","), (listed.body.tracks as { id: string }[]).map((t) => t.id).sort().join(","));
    check("…the ball's fifty among them", boxes.body.positions?.[ballRow?.id]?.length, 50);
    const noAsset = await api(`/vision/review/${randomUUID()}/positions`);
    check("an asset that does not exist: not found", noAsset.status, 404);
    /* Over HTTP, the shape every Vision refusal has (docs/vision/64): a name, and what to do next.
       An admin route, and the worker's door, which answers before any guard has a worker to name. */
    const noTracks = await api(`/vision/assets/${randomUUID()}/tracks`);
    check("…and a refusal says which refusal it is and what to do", `${noTracks.status}/${noTracks.body.error}/${typeof noTracks.body.remediation}`, "404/NotFound/string");
    /* The provision key (docs/vision/67): what the worker on the box holds in place of the
       operator key. It provisions and retires the local worker, and does nothing else. */
    const provisionKey = provisionKeyFor(process.env.ADMIN_API_KEY) ?? "";
    const withKey = (path: string, body: unknown, key = provisionKey) => call(path, { [PROVISION_KEY_HEADER]: key }, { method: "POST", body: JSON.stringify(body) });
    const ownWorker = await withKey("/vision/workers/provision", { resourceClass: "cpu_small", providerId: "local" });
    check("the provision key provisions the box's own worker", `${ownWorker.status}/${typeof ownWorker.body.bootstrapToken}/${ownWorker.body.requestedBy}`, "201/string/provision_key");
    if (ownWorker.body.workerId) fx.workerIds.push(String(ownWorker.body.workerId));
    const hosted = await withKey("/vision/workers/provision", { resourceClass: "cpu_small", providerId: "mock" });
    check("…and no other provider's", `${hosted.status}/${hosted.body.error}`, "403/ProvisionKeyScope");
    const wrongKey = await withKey("/vision/workers/provision", { resourceClass: "cpu_small", providerId: "local" }, "0".repeat(64));
    check("a wrong provision key: refused", `${wrongKey.status}/${wrongKey.body.error}`, "401/ProvisionKeyInvalid");
    const operatorAsProvision = await withKey("/vision/workers/provision", { resourceClass: "cpu_small", providerId: "local" }, process.env.ADMIN_API_KEY ?? "");
    check("the operator key is not the provision key", operatorAsProvision.status, 401);
    const elsewhere = await call("/vision/overview", { [PROVISION_KEY_HEADER]: provisionKey });
    check("the provision key opens no other route", elsewhere.status, 401);
    const asAdminKey = await call("/vision/overview", { "x-admin-api-key": provisionKey });
    check("…and is not an operator key under the operator's header", asAdminKey.status, 401);
    const retireMock = await withKey(`/vision/workers/${provisioned.body.workerId}/retire`, {});
    check("the provision key cannot retire another provider's worker", `${retireMock.status}/${retireMock.body.error}`, "403/ProvisionKeyScope");
    const retireOwn = await withKey(`/vision/workers/${ownWorker.body.workerId}/retire`, {});
    check("…and retires its own", `${retireOwn.status}/${retireOwn.body.ok}`, "201/true");
    const retireGone = await withKey(`/vision/workers/${randomUUID()}/retire`, {});
    check("a worker that does not exist: not found, not a 500", `${retireGone.status}/${retireGone.body.error}`, "404/NotFound");
    /* Each provision and each retire is on the audit trail (docs/vision/68), under who did it.
       A refused retire ended nothing, and left no row. */
    const trailOf = async (workerId: unknown) =>
      (await prisma.visionAuditLog.findMany({ where: { targetKind: "vision_worker", targetId: String(workerId) }, orderBy: { createdAt: "asc" }, select: { action: true, actorMethod: true, actorId: true, data: true } }))
        .map((a) => `${a.action}:${a.actorMethod}:${a.actorId}`)
        .join(" ");
    check("the box's worker: provisioned and retired, by the provision key", await trailOf(ownWorker.body.workerId), "worker.provisioned:provision_key:null worker.retired:provision_key:null");
    check("the gate's worker: provisioned by the operator key, and the refused retire left nothing", await trailOf(provisioned.body.workerId), "worker.provisioned:api_key:null");
    const ownRow = await prisma.visionAuditLog.findFirst({ where: { action: "worker.provisioned", targetId: String(ownWorker.body.workerId) }, select: { data: true } });
    check("…the row names the provider and the class", `${(ownRow?.data as { providerId?: string } | null)?.providerId}/${(ownRow?.data as { resourceClass?: string } | null)?.resourceClass}`, "local/cpu_small");
    check("…and never the token", JSON.stringify(ownRow?.data ?? {}).includes(String(ownWorker.body.bootstrapToken)), false);

    const noToken = await call("/vision/worker/jobs/claim", {}, { method: "POST", body: JSON.stringify({}) });
    check("…at the worker's door too", `${noToken.status}/${noToken.body.error}/${typeof noToken.body.remediation}`, "401/WorkerTokenRequired/string");

    /* The footage list: the latest job of each stage, picked by the database (docs/vision/60).
       This is the only run of that query against Postgres; the unit tests cannot see raw SQL. */
    const footageAssetId = fx.assetId;
    const footage = await api(`/vision/assets?q=${encodeURIComponent(`Tracks gate record ${RUN}`)}`);
    const listedAsset = (footage.body.assets as { id: string; stages: { type: string; state: string }[]; counts: { tracks: number } }[] | undefined)?.find((a) => a.id === footageAssetId);
    check("the footage list names the asset's stages, one row a stage", listedAsset?.stages.map((s) => `${s.type}:${s.state}`).sort().join(","), "detect:succeeded,track:succeeded,transcode:succeeded");
    check("…and counts its tracks", listedAsset?.counts.tracks, 3);
    const rerun = randomUUID();
    await prisma.visionJob.create({
      data: { id: rerun, type: "track", resourceClass: "cpu_small", state: "failed", videoAssetId: fx.assetId, inputSpec: {}, outputPrefix: visionKeys.inferencePrefix(rerun, 1), budgetSeconds: 600, budgetUsdCents: 100, contractVersion: VISION_CONTRACT_VERSION, queuedAt: new Date(Date.now() + 60_000), error: { kind: "gate" } },
    });
    fx.jobIds.push(rerun);
    const footageAfter = await api(`/vision/assets?q=${encodeURIComponent(`Tracks gate record ${RUN}`)}`);
    const rowAfter = (footageAfter.body.assets as { id: string; stages: { type: string; state: string }[] }[] | undefined)?.find((a) => a.id === footageAssetId);
    check("a later run of a stage replaces the earlier one in the list, and adds no row", rowAfter?.stages.map((s) => `${s.type}:${s.state}`).sort().join(","), "detect:succeeded,track:failed,transcode:succeeded");

    const filtered = await api(`/vision/assets/${fx.assetId}/tracks?class=ball`);
    check("rows filter by class", filtered.body.count, 1);

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
