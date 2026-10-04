/**
 * Phase 3 Increment 3 gate — the benchmark ledger, end to end.
 *
 *   pnpm --filter @dtp/api vision:benchcheck
 *
 * Needs the API on :3000 (`VISION_E2E_API`), whatever `DATABASE_URL` points at
 * (never production), the object store the API is configured with, and the worker's
 * Python environment (`VISION_WORKER_PYTHON`, default the repo's venv) -- because the
 * numbers the fake pod reports are produced by the **real** evaluator on the **real**
 * files the export wrote, not typed into this script. The expected values beside them
 * were worked out by hand.
 *
 * Three claims are on trial:
 *
 *   1. A run that could not mean anything is refused before a job is queued: a draft
 *      gold set, no export, a gold member with no detect job by this version, a model
 *      that is not a detector.
 *   2. The worker reads only what the job declared, and the evaluator's numbers on
 *      the exported gold match the arithmetic done by hand.
 *   3. A completion becomes metric rows per slice and a verdict under a named
 *      thresholds version, the version moves candidate -> benchmarked, a retry is
 *      recognised, and a job that fails for good marks its run failed.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
import { assertDevDatabase, closeGate, onInterrupt, removeGateWorkers } from "./gate-harness";

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
function pod(token: string) {
  const headers = { "x-vision-worker-token": token };
  return {
    claim: () =>
      call("/vision/worker/jobs/claim", headers, {
        method: "POST",
        body: JSON.stringify({ resourceClasses: ["cpu_small"], contractVersion: VISION_CONTRACT_VERSION }),
      }),
    inputUrl: (jobId: string, body: unknown) =>
      call(`/vision/worker/jobs/${jobId}/input-url`, headers, { method: "POST", body: JSON.stringify(body) }),
    complete: (jobId: string, body: unknown) =>
      call(`/vision/worker/jobs/${jobId}/complete`, headers, { method: "POST", body: JSON.stringify(body) }),
    fail: (jobId: string, body: unknown) =>
      call(`/vision/worker/jobs/${jobId}/fail`, headers, { method: "POST", body: JSON.stringify(body) }),
  };
}

// ── Fixture ────────────────────────────────────────────────────────────────

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

/* The gold truth, by hand. Proxy 1280x720 at 25fps, offset 0.
     source 1,000ms -> frame 25 -> FiftyOne 26:  player (0.1,0.1,0.1,0.2), ball (0.5,0.5,0.02,0.03)
     source 1,960ms -> frame 49 -> FiftyOne 50:  player (0.3,0.3,0.1,0.2)
   The detector's artifact, in pixels, 0-based:
     frameIndex 25: player conf .9 at (128,72,128,144) = (0.1,0.1,0.1,0.2) -> hit
                    player conf .4 at (900,500,100,100)                  -> false positive
     frameIndex 49: nothing                                               -> the player is missed
   So: player  2 truths, 1 hit, 1 fp -> precision 0.5, recall 0.5, AP 0.5 (hit ranked first)
       ball    1 truth, nothing      -> recall 0, AP 0
       all     3 truths, tp 1, fp 1  -> precision 0.5, recall 1/3; mAP = mean(0.5, 0) = 0.25
       frames  2 labelled, 2 scored */
const GOLD_BOXES = [
  { sourceTimeMs: 1_000, class: "player", x: 0.1, y: 0.1, width: 0.1, height: 0.2 },
  { sourceTimeMs: 1_000, class: "ball", x: 0.5, y: 0.5, width: 0.02, height: 0.03 },
  { sourceTimeMs: 1_960, class: "player", x: 0.3, y: 0.3, width: 0.1, height: 0.2 },
];
const DETECT_ARTIFACT = (modelVersionId: string) => ({
  contractVersion: VISION_CONTRACT_VERSION,
  role: "detections",
  modelVersionId,
  proxy: { fps: 25, sourceOffsetMs: 0 },
  frames: [
    {
      sampleIndex: 1,
      frameIndex: 25,
      proxyTimeMs: 1000,
      sourceTimeMs: 1000,
      qualityFlags: ["ball_unknown"],
      detections: [
        { class: "player", confidence: 0.9, box: { x: 128, y: 72, width: 128, height: 144 } },
        { class: "player", confidence: 0.4, box: { x: 900, y: 500, width: 100, height: 100 } },
      ],
    },
    { sampleIndex: 2, frameIndex: 49, proxyTimeMs: 1960, sourceTimeMs: 1960, qualityFlags: ["ball_unknown"], detections: [] },
  ],
});

async function seed(): Promise<Fixture> {
  const partner = await prisma.visionSourcePartner.create({
    data: { name: `Benchmark gate ${RUN}`, contactEmail: "gate@example.test" },
  });
  const record = await prisma.visionSourceVideoRecord.create({
    data: {
      partnerId: partner.id,
      title: `Benchmark gate record ${RUN}`,
      sourceQualityRank: "broadcast",
      originalAvailable: true,
      acquisitionStatus: "acquired",
      acquisitionMethod: "partner_direct_upload",
    },
  });
  await prisma.visionRightsScope.create({
    data: { partnerId: partner.id, grantLevel: "partner", canAnalyze: true, canTrain: true, canPublishHighlight: false, canShareWithScout: false, grantedAt: new Date() },
  });
  const proxyKey = `proxies/gate-${RUN}-bench/proxy.mp4`;
  const asset = await prisma.visionVideoAsset.create({
    data: {
      sourceVideoRecordId: record.id,
      corpus: "dtp_owned",
      objectKey: `originals/gate-${RUN}-bench/source.mp4`,
      bytes: BigInt(1024),
      mimeType: "video/mp4",
      checksumSha256: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64),
      width: 1280,
      height: 720,
      durationMs: 120_000,
      ingestState: "ready",
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
  // Runs cascade with the model's versions; they must go before the datasets they restrict.
  await prisma.visionModel.deleteMany({ where: { id: { in: fx.modelIds } } });
  await prisma.visionDatasetMember.deleteMany({ where: { videoAssetId: fx.assetId } });
  await prisma.visionDatasetVersion.deleteMany({ where: { label: { contains: RUN } } });
  await prisma.visionVideoAsset.deleteMany({ where: { id: fx.assetId } });
  await prisma.visionLabelSchemaVersion.deleteMany({ where: { version: { contains: RUN } } });
  await removeGateWorkers(prisma, fx.workerIds);
  await prisma.visionAuditLog.deleteMany({ where: { targetId: { in: [...fx.modelIds, ...fx.taskIds, ...fx.datasetIds, ...fx.jobIds] } } });
  await prisma.visionRightsScope.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourceVideoRecord.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourcePartner.deleteMany({ where: { id: fx.partnerId } });
}

async function main() {
  assertDevDatabase({ api: API });
  const config = loadVisionConfig();
  const store: ObjectStore = config.storage.backend === "r2" ? new R2ObjectStore(config.storage) : new InMemoryObjectStore();

  console.log("Vision benchmark ledger — refusals, the evaluator on real files, and the rows");
  console.log(`  api ${API}`);
  console.log(`  object store ${store.backendId}`);
  console.log(`  evaluator ${PYTHON}`);
  console.log(`  run ${RUN}`);
  if (!existsSync(PYTHON)) throw new Error(`No worker Python at ${PYTHON}; set VISION_WORKER_PYTHON`);

  let fx: Fixture | null = null;
  onInterrupt(async () => {
    await cleanup(fx, store);
    await closeGate(prisma);
  });
  try {
    fx = await seed();

    // ── 1. A gold set with boxes, frozen and exported ─────────────────────
    section("1. A frozen, double-reviewed, exported gold set");

    const model = await post("/vision/models", { key: `detector/gate-${RUN}`, task: "detect" });
    fx.modelIds.push(String(model.body.id));
    const version = await post(`/vision/models/${model.body.id}/versions`, {
      version: "0.1",
      gitCommit: "3eeec6e0",
      configKey: `models/gate-${RUN}/config.json`,
      workerImage: "dtp-vision-engine:0.1",
      licenceNote: "Gate fixture: torchvision BSD-3-Clause; no DTP data.",
    });
    const versionId = String(version.body.id);
    check("a candidate detector is registered", version.body.stage, "candidate");

    const schema = await post("/vision/annotation/schemas", {
      version: `gate-${RUN}-schema`,
      definitions: { player: "a player", ball: "the ball" },
    });
    const task = await post("/vision/annotation/tasks", {
      videoAssetId: fx.assetId,
      labelSchemaVersionId: String(schema.body.id),
      samplingStrategy: "low_confidence",
      startMs: 1_000,
      endMs: 2_000,
    });
    const taskId = String(task.body.id);
    fx.taskIds.push(taskId);
    const submitted = await post(`/vision/annotation/tasks/${taskId}/submit`, {
      payload: { windowSourceStartMs: 1_000, windowSourceEndMs: 2_000, uncertain: false, notes: null, boxes: GOLD_BOXES },
      annotatorId: `gate-ann-${RUN}`,
    });
    check("three gold boxes submitted", submitted.status, 201);
    for (const who of ["one", "two"]) {
      await prisma.visionReviewDecision.create({
        data: { annotationVersionId: String(submitted.body.id), targetKind: "vision_annotation_version", targetId: String(submitted.body.id), decision: "approved", reviewerId: `gate-reviewer-${who}-${RUN}` },
      });
    }

    const gold = await post("/vision/datasets", {
      label: `gold benchmark ${RUN}`,
      splitPolicy: { train: 0, val: 0, test: 0, gold: 100, seed: `g-${RUN}` },
    });
    const goldId = String(gold.body.id);
    fx.datasetIds.push(goldId);
    await post(`/vision/datasets/${goldId}/members`, { videoAssetIds: [fx.assetId] });
    await post(`/vision/datasets/${goldId}/splits`, {});
    const frozen = await post(`/vision/datasets/${goldId}/freeze`, {});
    check("the gold version freezes (two reviewers)", frozen.status, 201);

    // ── 2. Refusals, in the order a person would hit them ─────────────────
    section("2. A run that could not mean anything is refused");

    const unexported = await post(`/vision/models/versions/${versionId}/benchmark`, { datasetVersionId: goldId });
    check("no export yet: refused", unexported.body.error, "DatasetNotExported");

    await store.putSmallObject("derived", fx.proxyKey, "not really a video", "video/mp4");
    fx.wrote.push({ bucket: "derived", key: fx.proxyKey });
    const exported = await post(`/vision/datasets/${goldId}/export`, {});
    check("the gold set exports with its boxes", exported.body.qa?.boxes, 3);

    const undetected = await post(`/vision/models/versions/${versionId}/benchmark`, { datasetVersionId: goldId });
    check("no detect job by this version: refused", undetected.body.error, "DetectionsMissing");
    check("…naming the member", undetected.body.members?.[0], fx.assetId);

    const draft = await post("/vision/datasets", { label: `gate-${RUN}-v1` });
    fx.datasetIds.push(String(draft.body.id));
    const onDraft = await post(`/vision/models/versions/${versionId}/benchmark`, { datasetVersionId: draft.body.id });
    check("a draft gold set: refused", onDraft.body.error, "DatasetNotFrozen");

    const tracker = await post("/vision/models", { key: `tracker/gate-${RUN}`, task: "track" });
    fx.modelIds.push(String(tracker.body.id));
    const trackerVersion = await post(`/vision/models/${tracker.body.id}/versions`, {
      version: "0.1", gitCommit: "3eeec6e0", configKey: "c", workerImage: "i", licenceNote: "Gate fixture: nothing shipped.",
    });
    const notDetector = await post(`/vision/models/versions/${trackerVersion.body.id}/benchmark`, { datasetVersionId: goldId });
    check("a tracker with no track run on the gold footage has nothing to be scored on", notDetector.body.error, "TracksMissing");

    // A succeeded detect job by this version, with its artifact really in the store.
    const detectJobId = randomUUID();
    const detectKey = `${visionKeys.inferencePrefix(detectJobId, 1)}detections.json`;
    await prisma.visionJob.create({
      data: {
        id: detectJobId, type: "detect", resourceClass: "gpu_24gb", state: "succeeded", videoAssetId: fx.assetId, modelVersionId: versionId,
        inputSpec: { videoAssetId: fx.assetId }, outputPrefix: visionKeys.inferencePrefix(detectJobId, 1), budgetSeconds: 600, budgetUsdCents: 100,
        contractVersion: VISION_CONTRACT_VERSION, finishedAt: new Date(),
        progress: { artifacts: [{ key: detectKey, bucket: "derived", role: "detections" }], summary: { modelVersionId: versionId } },
      },
    });
    fx.jobIds.push(detectJobId);
    await store.putSmallObject("derived", detectKey, JSON.stringify(DETECT_ARTIFACT(versionId)), "application/json");
    fx.wrote.push({ bucket: "derived", key: detectKey });

    // ── 3. The run, and the worker that reads only what was declared ──────
    section("3. The run is queued, and the worker reads only what it was told");

    const requested = await post(`/vision/models/versions/${versionId}/benchmark`, { datasetVersionId: goldId });
    check("benchmark requested", requested.status, 201);
    const runId = String(requested.body.id);
    const jobId = String(requested.body.jobId);
    fx.jobIds.push(jobId);
    check("one gold member", requested.body.goldMembers, 1);
    const jobRow = await api(`/vision/jobs/${jobId}`);
    check("a benchmark job is queued on the CPU class", jobRow.body.job?.resourceClass, "cpu_small");
    check("…carrying the model version", jobRow.body.job?.modelVersionId, versionId);
    check("…and the gold version", jobRow.body.job?.datasetVersionId, goldId);

    const provisioned = await post("/vision/workers/provision", { resourceClass: "cpu_small", providerId: "mock" });
    fx.workerIds.push(String(provisioned.body.workerId));
    const registered = await call("/vision/worker/register", { "x-vision-bootstrap-token": String(provisioned.body.bootstrapToken) }, { method: "POST" });
    const worker = pod(String(registered.body.workerToken));

    const claimed = await worker.claim();
    const claimedId = claimed.body.job?.jobId;
    if (claimedId && claimedId !== jobId) await worker.fail(claimedId, { reason: "gate claimed a job that was not its own", retryable: true });
    check("the worker claimed the benchmark job", claimedId, jobId);
    const params = claimed.body.job?.inputs?.params ?? {};
    const goldKey = visionKeys.datasetExport(goldId, "samples.json").key;
    check("the job names the gold export", params.goldLabelsKey, goldKey);
    check("…and the one detect artifact, as a detector's predictions", `${params.task}/${params.predictions?.length}/${params.predictions?.[0]?.key}`, `detect/1/${detectKey}`);
    check("…and declares exactly those two keys", claimed.body.job?.inputs?.readKeys?.length, 2);

    const allowed = await worker.inputUrl(jobId, { role: "declared", key: goldKey });
    check("a declared key is readable", allowed.status, 201);
    const forbidden = await worker.inputUrl(jobId, { role: "declared", key: "originals/somebody/source.mp4" });
    check("an undeclared key is refused", forbidden.status, 403);
    const noAsset = await worker.inputUrl(jobId, { role: "proxy" });
    check("an asset role on an asset-less job is refused", noAsset.status, 400);

    // ── 4. The real evaluator on the real files ───────────────────────────
    section("4. The evaluator's numbers on the exported gold, by hand");

    fx.tmp = mkdtempSync(join(tmpdir(), `dtp-bench-${RUN}-`));
    const samples = await store.getSmallObject("derived", goldKey);
    writeFileSync(join(fx.tmp, "samples.json"), samples!);
    writeFileSync(join(fx.tmp, "det.json"), JSON.stringify(DETECT_ARTIFACT(versionId)));
    const evaluated = spawnSync(
      PYTHON,
      ["-m", "dtp_vision_worker.evaluate", "--gold", join(fx.tmp, "samples.json"), "--detections", `${fx.assetId}=${join(fx.tmp, "det.json")}`, "--iou", "0.5"],
      { cwd: WORKER_DIR, encoding: "utf8" }
    );
    if (evaluated.status !== 0) throw new Error(`evaluator failed: ${evaluated.stderr}`);
    const report = JSON.parse(evaluated.stdout) as { framesLabelled: number; framesScored: number; metrics: { metric: string; slice: string; value: number | null; support: number }[] };
    const value = (metric: string, slice = "all") => report.metrics.find((m) => m.metric === metric && m.slice === slice)?.value;
    check("two labelled frames", report.framesLabelled, 2);
    check("both sampled by the detector", report.framesScored, 2);
    approx("player precision 0.5 (one hit, one false positive)", value("precision:player"), 0.5);
    approx("player recall 0.5 (the frame-50 player was missed)", value("recall:player"), 0.5);
    approx("player AP 0.5 (the hit ranked first)", value("ap:player"), 0.5);
    check("ball recall 0", value("recall:ball"), 0);
    approx("overall recall 1/3", value("recall:all"), 1 / 3);
    approx("mAP 0.25, the mean over classes with boxes", value("ap:all"), 0.25);
    check("goalkeeper has nothing to measure", value("recall:goalkeeper"), null);
    approx("the broadcast slice carries the same numbers", value("recall:all", "quality:broadcast"), 1 / 3);

    // ── 5. The completion becomes rows, a verdict and a stage ─────────────
    section("5. Rows, a verdict, and candidate -> benchmarked");

    const prefix = String(claimed.body.job?.outputPrefix);
    const artifact = { key: `${prefix}benchmark.json`, bucket: "models", bytes: 1024, contentType: "application/json", role: "benchmark" };
    const summary = { benchmarkRunId: runId, modelVersionId: versionId, datasetVersionId: goldId, ...report };
    const completed = await worker.complete(jobId, { idempotencyKey: `gate-${RUN}-bench`, artifacts: [artifact], summary, modelVersionIds: [] });
    check("completion accepted", completed.status, 201);
    check("…and applied", completed.body.applied?.applied, true);
    check("…naming the verdict", String(completed.body.applied?.detail ?? "").includes("verdict unthresholded"), true);

    const run = await api(`/vision/models/benchmarks/${runId}`);
    check("the run is completed", run.body.run?.state, "completed");
    check("the verdict is unthresholded: no baseline has set a bar yet", run.body.run?.verdict, "unthresholded");
    check("…under a named thresholds version", typeof run.body.run?.thresholdsVersion, "string");
    // 5 metrics x (4 classes + all) = 25 per slice; slices: all, quality:broadcast, vfr:false.
    check("75 metric rows: 25 per slice over three slices", run.body.run?.metrics?.length, 75);
    const row = (run.body.run?.metrics ?? []).find((m: any) => m.metric === "ap:all" && m.slice === "all");
    approx("the mAP row is stored", row?.value, 0.25);
    check("…with its support", row?.support, 3);
    check("the report key is recorded", run.body.run?.reportKey, artifact.key);

    const afterRun = await api(`/vision/models/versions/${versionId}`);
    check("the version moved to benchmarked", afterRun.body.version?.stage, "benchmarked");

    const retried = await worker.complete(jobId, { idempotencyKey: `gate-${RUN}-bench`, artifacts: [artifact], summary, modelVersionIds: [] });
    check("a retried completion is recognised", retried.body.alreadyApplied, true);
    const stillOne = await prisma.visionMetricResult.count({ where: { benchmarkRunId: runId } });
    check("…and writes no second set of rows", stillOne, 75);

    const listed = await api(`/vision/models/versions/${versionId}/benchmarks`);
    check("the run is listed on its version", listed.body.runs?.[0]?.id, runId);

    // ── 6. A job that fails for good marks its run ────────────────────────
    section("6. A failed job is a failed run");

    const second = await post(`/vision/models/versions/${versionId}/benchmark`, { datasetVersionId: goldId });
    const secondJob = String(second.body.jobId);
    fx.jobIds.push(secondJob);
    const claimedAgain = await worker.claim();
    if (claimedAgain.body.job?.jobId && claimedAgain.body.job.jobId !== secondJob) await worker.fail(claimedAgain.body.job.jobId, { reason: "not mine", retryable: true });
    check("the second benchmark job is claimed", claimedAgain.body.job?.jobId, secondJob);
    await worker.fail(secondJob, { reason: "StageRefusal", detail: "the gold export records no frame size", retryable: false });
    const failedRun = await api(`/vision/models/benchmarks/${second.body.id}`);
    check("the run is failed", failedRun.body.run?.state, "failed");
    check("…with the worker's reason", String(failedRun.body.run?.failureReason ?? "").includes("no frame size"), true);
    const stillBenchmarked = await api(`/vision/models/versions/${versionId}`);
    check("a failed run does not move the version back", stillBenchmarked.body.version?.stage, "benchmarked");

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
