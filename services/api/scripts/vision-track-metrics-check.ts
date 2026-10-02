/**
 * Phase 4 Increment 2 gate — gold tracks, and a tracker scored against them.
 *
 *   pnpm --filter @dtp/api vision:trackmetricscheck
 *
 * Needs the API on :3000 (`VISION_E2E_API`), whatever `DATABASE_URL` points at
 * (never production), the object store the API is configured with, and the
 * worker's Python environment: the numbers the fake pod reports come from the real
 * scorer on the real export, and the expected values were worked out by hand.
 *
 * Three claims are on trial:
 *
 *   1. A submission whose boxes contradict their own tracks -- one track with two
 *      classes, one track twice on a frame -- is refused at the door by name.
 *   2. Linked boxes export as FiftyOne `index` per label, numbered from one, with
 *      the annotator's id beside them.
 *   3. A tracker version is benchmarked against those gold tracks: MOTA, IDF1,
 *      switches and fragmentations per class and slice, from a track artifact the
 *      control plane found by this version -- and the numbers match the paper
 *      arithmetic: one identity switch mid-track gives MOTA 0.95 and IDF1 0.75.
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
function approx(label: string, actual: unknown, expected: number) {
  checks += 1;
  const ok = typeof actual === "number" && Math.abs(actual - expected) < 1e-9;
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
  taskIds: string[];
  datasetIds: string[];
  jobIds: string[];
  workerIds: string[];
  wrote: { bucket: "derived" | "models"; key: string }[];
  tmp: string | null;
};

/* Gold, by hand: two players A and B on ten consecutive frames (source 1,000ms + 40ms
   steps on a 25fps proxy with no offset -> FiftyOne frames 26..35), each at a fixed place. */
const A = { x: 0.1, y: 0.1, width: 0.05, height: 0.1 };
const B = { x: 0.6, y: 0.6, width: 0.05, height: 0.1 };
const GOLD_BOXES = Array.from({ length: 10 }, (_, i) => [
  { sourceTimeMs: 1_000 + 40 * i, class: "player", ...A, trackId: "A" },
  { sourceTimeMs: 1_000 + 40 * i, class: "player", ...B, trackId: "B" },
]).flat();

/* The tracker's artifact (pixels, 0-based frames 25..34): track 1 follows A throughout;
   B is track 2 for the first five frames and track 3 for the last five.
   One identity switch, no fragmentation, no miss, no false positive.
   MOTA = 1 - 1/20 = 0.95. IDF1: A<->1 (10) + B<->2 (5) = 15 of 20 -> 30/40 = 0.75. */
function trackArtifact(trackerVersionId: string, detectorVersionId: string) {
  const pos = (frame: number, box: typeof A) => ({
    frameIndex: frame, proxyTimeMs: Math.round((frame / 25) * 1000), sourceTimeMs: Math.round((frame / 25) * 1000),
    box: { x: box.x * 1280, y: box.y * 720, width: box.width * 1280, height: box.height * 720 }, confidence: 0.9,
  });
  const frames = Array.from({ length: 10 }, (_, i) => 25 + i);
  const t = (id: number, fs: number[], box: typeof A) => ({
    localTrackId: id, class: "player", startFrame: fs[0], endFrame: fs.at(-1), startMs: 0, endMs: 0, detectionCount: fs.length, confirmed: true,
    positions: fs.map((f) => pos(f, box)),
  });
  return {
    contractVersion: VISION_CONTRACT_VERSION, role: "tracks", trackerVersionId, detectorVersionId, sampleFps: 25, proxy: { fps: 25, sourceOffsetMs: 0 },
    tracks: [t(1, frames, A), t(2, frames.slice(0, 5), B), t(3, frames.slice(5), B)],
  };
}

async function seed(): Promise<Fixture> {
  const partner = await prisma.visionSourcePartner.create({ data: { name: `Track metrics gate ${RUN}`, contactEmail: "gate@example.test" } });
  const record = await prisma.visionSourceVideoRecord.create({
    data: { partnerId: partner.id, title: `Track metrics gate record ${RUN}`, sourceQualityRank: "broadcast", originalAvailable: true, acquisitionStatus: "acquired", acquisitionMethod: "partner_direct_upload" },
  });
  await prisma.visionRightsScope.create({
    data: { partnerId: partner.id, grantLevel: "partner", canAnalyze: true, canTrain: true, canPublishHighlight: false, canShareWithScout: false, grantedAt: new Date() },
  });
  const proxyKey = `proxies/gate-${RUN}-trackmetrics/proxy.mp4`;
  const asset = await prisma.visionVideoAsset.create({
    data: {
      sourceVideoRecordId: record.id, corpus: "dtp_owned", objectKey: `originals/gate-${RUN}-trackmetrics/source.mp4`, bytes: BigInt(1024), mimeType: "video/mp4",
      checksumSha256: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64), width: 1280, height: 720, durationMs: 120_000, ingestState: "ready",
      variants: { create: { kind: "proxy", objectKey: proxyKey, width: 1280, height: 720, fps: 25, durationMs: 120_000, sourceOffsetMs: 0 } },
    },
  });
  return { partnerId: partner.id, assetId: asset.id, proxyKey, modelIds: [], taskIds: [], datasetIds: [], jobIds: [], workerIds: [], wrote: [], tmp: null };
}

async function cleanup(fx: Fixture | null, store: ObjectStore) {
  if (!fx) return;
  for (const w of fx.wrote) await store.delete(w.bucket, w.key).catch(() => undefined);
  for (const taskId of fx.taskIds) {
    const page = await store.list("derived", `annotations/${taskId}/`).catch(() => null);
    for (const key of page?.keys ?? []) await store.delete("derived", key).catch(() => undefined);
  }
  for (const id of fx.datasetIds) {
    const page = await store.list("derived", `datasets/${id}/`).catch(() => null);
    for (const key of page?.keys ?? []) await store.delete("derived", key).catch(() => undefined);
  }
  for (const jobId of fx.jobIds) {
    for (const bucket of ["derived", "models"] as const) {
      const page = await store.list(bucket, `inference/${jobId}/`).catch(() => null);
      for (const key of page?.keys ?? []) await store.delete(bucket, key).catch(() => undefined);
    }
  }
  if (fx.tmp) rmSync(fx.tmp, { recursive: true, force: true });
  await prisma.visionJob.deleteMany({ where: { OR: [{ datasetVersionId: { in: fx.datasetIds } }, { id: { in: fx.jobIds } }] } });
  await prisma.visionReviewDecision.deleteMany({ where: { reviewerId: { contains: RUN } } });
  await prisma.visionModel.deleteMany({ where: { id: { in: fx.modelIds } } });
  await prisma.visionDatasetMember.deleteMany({ where: { videoAssetId: fx.assetId } });
  await prisma.visionDatasetVersion.deleteMany({ where: { label: { contains: RUN } } });
  await prisma.visionVideoAsset.deleteMany({ where: { id: fx.assetId } });
  await prisma.visionLabelSchemaVersion.deleteMany({ where: { version: { contains: RUN } } });
  await prisma.visionWorker.deleteMany({ where: { id: { in: fx.workerIds } } });
  await prisma.visionAuditLog.deleteMany({ where: { targetId: { in: [...fx.modelIds, ...fx.taskIds, ...fx.datasetIds, ...fx.jobIds] } } });
  await prisma.visionRightsScope.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourceVideoRecord.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourcePartner.deleteMany({ where: { id: fx.partnerId } });
}

async function main() {
  const config = loadVisionConfig();
  const store: ObjectStore = config.storage.backend === "r2" ? new R2ObjectStore(config.storage) : new InMemoryObjectStore();

  console.log("Vision track metrics — gold tracks at the door, in the export, and under a tracker");
  console.log(`  api ${API}`);
  console.log(`  object store ${store.backendId}`);
  console.log(`  run ${RUN}`);
  if (!existsSync(PYTHON)) throw new Error(`No worker Python at ${PYTHON}; set VISION_WORKER_PYTHON`);

  let fx: Fixture | null = null;
  try {
    fx = await seed();

    // ── 1. Gold tracks at the door ────────────────────────────────────────
    section("1. A submission's tracks are checked at the door");

    const schema = await post("/vision/annotation/schemas", { version: `gate-${RUN}-schema`, definitions: { player: "a player", ball: "the ball" } });
    const task = await post("/vision/annotation/tasks", {
      videoAssetId: fx.assetId, labelSchemaVersionId: String(schema.body.id), samplingStrategy: "low_confidence", startMs: 1_000, endMs: 2_000,
    });
    const taskId = String(task.body.id);
    fx.taskIds.push(taskId);
    const submit = (boxes: unknown) =>
      post(`/vision/annotation/tasks/${taskId}/submit`, {
        payload: { windowSourceStartMs: 1_000, windowSourceEndMs: 2_000, uncertain: false, notes: null, boxes },
        annotatorId: `gate-ann-${RUN}`,
      });

    const twoClasses = await submit([GOLD_BOXES[0], { ...GOLD_BOXES[2], class: "ball" }]);
    check("one track, two classes: refused", twoClasses.body.problems?.[0]?.kind, "track_class_conflict");
    const twiceOnFrame = await submit([GOLD_BOXES[0], { ...GOLD_BOXES[1], trackId: "A" }]);
    check("one track twice on a frame: refused", twiceOnFrame.body.problems?.[0]?.kind, "track_frame_conflict");
    const badId = await submit([{ ...GOLD_BOXES[0], trackId: "" }]);
    check("an empty track id: refused", badId.body.problems?.[0]?.kind, "box_bad_track_id");

    const accepted = await submit(GOLD_BOXES);
    check("twenty boxes on two tracks accepted", accepted.status, 201);
    const versionId = String(accepted.body.id);
    for (const who of ["one", "two"]) {
      await prisma.visionReviewDecision.create({ data: { annotationVersionId: versionId, targetKind: "vision_annotation_version", targetId: versionId, decision: "approved", reviewerId: `gate-reviewer-${who}-${RUN}` } });
    }

    // ── 2. The export ────────────────────────────────────────────────────
    section("2. Linked boxes export as FiftyOne index");

    const gold = await post("/vision/datasets", { label: `gold benchmark ${RUN}`, splitPolicy: { train: 0, val: 0, test: 0, gold: 100, seed: `g-${RUN}` } });
    const goldId = String(gold.body.id);
    fx.datasetIds.push(goldId);
    await post(`/vision/datasets/${goldId}/members`, { videoAssetIds: [fx.assetId] });
    await post(`/vision/datasets/${goldId}/splits`, {});
    const frozen = await post(`/vision/datasets/${goldId}/freeze`, {});
    check("the gold version freezes", frozen.status, 201);
    await store.putSmallObject("derived", fx.proxyKey, "not really a video", "video/mp4");
    fx.wrote.push({ bucket: "derived", key: fx.proxyKey });
    const exported = await post(`/vision/datasets/${goldId}/export`, {});
    check("the export succeeds", exported.status, 201);
    check("twenty boxes", exported.body.qa?.boxes, 20);
    check("two gold tracks", exported.body.qa?.goldTracks, 2);
    const goldKey = visionKeys.datasetExport(goldId, "samples.json").key;
    const samples = JSON.parse(String(await store.getSmallObject("derived", goldKey))) as { samples: { frames: Record<string, any> }[] };
    const f26 = samples.samples[0]!.frames["26"]?.detections?.detections ?? [];
    check("frame 26 carries both tracks", f26.length, 2);
    check("…numbered from one in order of appearance", `${f26[0]?.index},${f26[1]?.index}`, "1,2");
    check("…with the annotator's ids kept", `${f26[0]?.track_id},${f26[1]?.track_id}`, "A,B");
    check("…and the same index on frame 35", samples.samples[0]!.frames["35"]?.detections?.detections?.[0]?.index, 1);

    // ── 3. A tracker scored against them ─────────────────────────────────
    section("3. A tracker version is benchmarked against gold tracks");

    const detectorModel = await post("/vision/models", { key: `detector/gate-${RUN}`, task: "detect" });
    fx.modelIds.push(String(detectorModel.body.id));
    const detector = await post(`/vision/models/${detectorModel.body.id}/versions`, { version: "0.1", gitCommit: "3eeec6e0", configKey: "c", workerImage: "i", licenceNote: "Gate fixture: nothing shipped." });
    const trackerModel = await post("/vision/models", { key: `tracker/gate-${RUN}`, task: "track" });
    fx.modelIds.push(String(trackerModel.body.id));
    const tracker = await post(`/vision/models/${trackerModel.body.id}/versions`, { version: "0.1", gitCommit: "3eeec6e0", configKey: "tracking.Params()", workerImage: "dtp-vision-worker:0.1", licenceNote: "Gate fixture: in-house association." });
    const trackerId = String(tracker.body.id);

    const noTracks = await post(`/vision/models/versions/${trackerId}/benchmark`, { datasetVersionId: goldId });
    check("no track job by this tracker: refused", noTracks.body.error, "TracksMissing");

    const trackJobId = randomUUID();
    const trackKey = `${visionKeys.inferencePrefix(trackJobId, 1)}tracks.json`;
    const artifact = trackArtifact(trackerId, String(detector.body.id));
    await prisma.visionJob.create({
      data: {
        id: trackJobId, type: "track", resourceClass: "cpu_small", state: "succeeded", videoAssetId: fx.assetId, modelVersionId: trackerId, inputSpec: { videoAssetId: fx.assetId },
        outputPrefix: visionKeys.inferencePrefix(trackJobId, 1), budgetSeconds: 600, budgetUsdCents: 100, contractVersion: VISION_CONTRACT_VERSION, finishedAt: new Date(),
        progress: { artifacts: [{ key: trackKey, bucket: "derived", role: "tracks" }], summary: { trackerVersionId: trackerId } },
      },
    });
    fx.jobIds.push(trackJobId);
    await store.putSmallObject("derived", trackKey, JSON.stringify(artifact), "application/json");
    fx.wrote.push({ bucket: "derived", key: trackKey });

    const requested = await post(`/vision/models/versions/${trackerId}/benchmark`, { datasetVersionId: goldId });
    check("benchmark requested for the tracker", requested.status, 201);
    const runId = String(requested.body.id);
    const jobId = String(requested.body.jobId);
    fx.jobIds.push(jobId);

    const provisioned = await post("/vision/workers/provision", { resourceClass: "cpu_small", providerId: "mock" });
    fx.workerIds.push(String(provisioned.body.workerId));
    const registered = await call("/vision/worker/register", { "x-vision-bootstrap-token": String(provisioned.body.bootstrapToken) }, { method: "POST" });
    const wh = { "x-vision-worker-token": String(registered.body.workerToken) };
    const claimed = await call("/vision/worker/jobs/claim", wh, { method: "POST", body: JSON.stringify({ resourceClasses: ["cpu_small"], contractVersion: VISION_CONTRACT_VERSION }) });
    const claimedId = claimed.body.job?.jobId;
    if (claimedId && claimedId !== jobId) await call(`/vision/worker/jobs/${claimedId}/fail`, wh, { method: "POST", body: JSON.stringify({ reason: "not mine", retryable: true }) });
    check("the worker claimed the benchmark job", claimedId, jobId);
    check("the job says it scores a tracker", claimed.body.job?.inputs?.params?.task, "track");
    check("…against the track artifact", claimed.body.job?.inputs?.params?.predictions?.[0]?.key, trackKey);

    fx.tmp = mkdtempSync(join(tmpdir(), `dtp-trkm-${RUN}-`));
    writeFileSync(join(fx.tmp, "samples.json"), (await store.getSmallObject("derived", goldKey))!);
    writeFileSync(join(fx.tmp, "tracks.json"), JSON.stringify(artifact));
    const scored = spawnSync(PYTHON, ["-m", "dtp_vision_worker.evaluate", "--task", "track", "--gold", join(fx.tmp, "samples.json"), "--tracks", `${fx.assetId}=${join(fx.tmp, "tracks.json")}`], { cwd: WORKER_DIR, encoding: "utf8" });
    if (scored.status !== 0) throw new Error(`scorer failed: ${scored.stderr}`);
    const report = JSON.parse(scored.stdout) as { framesLabelled: number; framesScored: number; metrics: { metric: string; slice: string; value: number | null; support: number }[] };
    const value = (metric: string, slice = "all") => report.metrics.find((m) => m.metric === metric && m.slice === slice)?.value;
    check("ten labelled frames, all scored", `${report.framesLabelled}/${report.framesScored}`, "10/10");
    check("one identity switch", value("idsw:player"), 1);
    check("no fragmentation: B was matched every frame", value("frag:player"), 0);
    approx("MOTA 0.95 = 1 - 1 switch / 20 boxes", value("mota:player"), 0.95);
    approx("IDF1 0.75 = 2*15 / (2*15 + 5 + 5)", value("idf1:player"), 0.75);
    check("two gold tracks", value("tracks:player"), 2);
    approx("the broadcast slice carries the same numbers", value("mota:all", "quality:broadcast"), 0.95);
    check("the ball has nothing to measure", value("mota:ball"), null);

    const prefix = String(claimed.body.job?.outputPrefix);
    const completed = await call(`/vision/worker/jobs/${jobId}/complete`, wh, {
      method: "POST",
      body: JSON.stringify({
        idempotencyKey: `gate-${RUN}-trkm`,
        artifacts: [{ key: `${prefix}benchmark.json`, bucket: "models", bytes: 1, contentType: "application/json", role: "benchmark" }],
        summary: { benchmarkRunId: runId, modelVersionId: trackerId, datasetVersionId: goldId, task: "track", ...report },
        modelVersionIds: [],
      }),
    });
    check("completion accepted and applied", completed.body.applied?.applied, true);
    const run = await api(`/vision/models/benchmarks/${runId}`);
    check("the run is completed", run.body.run?.state, "completed");
    const row = (run.body.run?.metrics ?? []).find((m: any) => m.metric === "idf1:player" && m.slice === "all");
    approx("the IDF1 row is stored", row?.value, 0.75);
    check("…with its support", row?.support, 20);
    check("the tracker moved to benchmarked", (await api(`/vision/models/versions/${trackerId}`)).body.version?.stage, "benchmarked");

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
