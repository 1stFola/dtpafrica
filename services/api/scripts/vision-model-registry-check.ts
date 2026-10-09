/**
 * Phase 3 Increment 1 gate — the model registry, and provenance on every prediction.
 *
 *   pnpm --filter @dtp/api vision:modelcheck
 *
 * Unit tests prove the logic; this proves the refusals survive the HTTP boundary and
 * the real database. It needs the API on :3000 (`VISION_E2E_API`) and whatever
 * `DATABASE_URL` points at — a developer's Postgres or staging's, never production.
 * Nothing is written to the object store: the completion the gate drives names an
 * artifact key, and the control plane validates the key, not the bytes.
 *
 * Three claims are on trial:
 *
 *   1. A model version cannot be registered without the lineage that makes it
 *      reproducible, and never against a dataset that is a draft, holds revoked
 *      footage, or trains on another version's gold.
 *   2. A model-bound job cannot be queued without resolving to exactly one model
 *      version, and the job carries the proxy's clock the worker cannot work out.
 *   3. A worker's completion is refused at the door unless it names the version the
 *      job was dispatched with and the weights the version is pinned to.
 *
 * The third is driven over the worker surface exactly as a pod would: provision,
 * register, claim, complete — with a fake worker that never runs a model, because
 * what is under test is what the control plane accepts, not what torchvision finds.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { DETECTOR_CONFIG_BASE, VISION_CONTRACT_VERSION, visionKeys } from "@dtp/vision-contracts";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { assertDevDatabase, closeGate, createGateMatch, onInterrupt, removeGateMatch, removeGateWorkers, type GateMatch } from "./gate-harness";

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
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(66)} ${
      ok ? String(actual) : `expected ${expected}, got ${actual}`
    }`
  );
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

/** Returns status and body together: the refusals are the subject, not exceptions. */
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

/** The worker surface, authenticated the way a pod is. */
function worker(token: string) {
  const headers = { "x-vision-worker-token": token };
  return {
    claim: (resourceClasses: string[]) =>
      call("/vision/worker/jobs/claim", headers, {
        method: "POST",
        body: JSON.stringify({ resourceClasses, contractVersion: VISION_CONTRACT_VERSION }),
      }),
    complete: (jobId: string, body: unknown) =>
      call(`/vision/worker/jobs/${jobId}/complete`, headers, { method: "POST", body: JSON.stringify(body) }),
    fail: (jobId: string, reason: string) =>
      call(`/vision/worker/jobs/${jobId}/fail`, headers, {
        method: "POST",
        body: JSON.stringify({ reason, detail: "gate released a job it did not expect", retryable: true }),
      }),
  };
}

const SHA_FIRST = "1".repeat(64);
const SHA_OTHER = "2".repeat(64);

// ── Fixtures ───────────────────────────────────────────────────────────────

type Fixture = {
  partnerId: string;
  assetIds: Record<string, string>;
  modelIds: string[];
  workerIds: string[];
};

/* The gate's own match, for its assets to belong to. It took whichever match came first,
   so it could not run on an empty database. */
let gateMatch: GateMatch | null = null;

async function seed(): Promise<Fixture> {
  gateMatch = await createGateMatch(prisma, RUN);
  const sbMatch = gateMatch;

  const partner = await prisma.visionSourcePartner.create({
    data: { name: `Model registry gate ${RUN}`, contactEmail: "gate@example.test" },
  });
  const record = await prisma.visionSourceVideoRecord.create({
    data: {
      partnerId: partner.id,
      title: `Gate record ${RUN}`,
      sourceQualityRank: "broadcast",
      originalAvailable: true,
      acquisitionStatus: "acquired",
      acquisitionMethod: "partner_direct_upload",
    },
  });
  await prisma.visionRightsScope.create({
    data: {
      partnerId: partner.id,
      grantLevel: "partner",
      canAnalyze: true,
      canTrain: true,
      canPublishHighlight: false,
      canShareWithScout: false,
      grantedAt: new Date(),
    },
  });

  const asset = async (slug: string): Promise<[string, string]> => {
    const row = await prisma.visionVideoAsset.create({
      data: {
        sourceVideoRecordId: record.id,
        sbMatchId: sbMatch.id,
        corpus: "dtp_owned",
        objectKey: `originals/gate-${RUN}-${slug}/source.mp4`,
        bytes: BigInt(1024),
        mimeType: "video/mp4",
        checksumSha256: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64),
        width: 1280,
        height: 720,
        ingestState: "ready",
      },
    });
    return [slug, row.id];
  };

  const entries = await Promise.all([asset("gold"), asset("train"), asset("run")]);
  return { partnerId: partner.id, assetIds: Object.fromEntries(entries), modelIds: [], workerIds: [] };
}

/** A succeeded transcode and its proxy, written behind the service's back. */
async function transcoded(videoAssetId: string, proxy: { fps: number | null; sourceOffsetMs: number }) {
  const id = randomUUID();
  await prisma.visionJob.create({
    data: {
      id,
      type: "transcode",
      resourceClass: "cpu_small",
      state: "succeeded",
      videoAssetId,
      inputSpec: { videoAssetId },
      outputPrefix: visionKeys.inferencePrefix(id, 1),
      budgetSeconds: 600,
      budgetUsdCents: 100,
      contractVersion: VISION_CONTRACT_VERSION,
      finishedAt: new Date(),
    },
  });
  return prisma.visionVideoVariant.create({
    data: {
      videoAssetId,
      kind: "proxy",
      objectKey: visionKeys.proxy(videoAssetId).key,
      fps: proxy.fps,
      height: 720,
      durationMs: 60_000,
      sourceOffsetMs: proxy.sourceOffsetMs,
    },
  });
}

async function frozenDataset(label: string, members: { videoAssetId: string; split: string }[], revoked = false) {
  return prisma.visionDatasetVersion.create({
    data: {
      label,
      frozenAt: new Date(),
      frozenBy: `gate-${RUN}`,
      containsRevokedMembers: revoked,
      members: {
        create: members.map((m) => ({
          videoAssetId: m.videoAssetId,
          split: m.split,
          checksumSha256: "0".repeat(64),
          groupKey: `asset:${m.videoAssetId}`,
        })),
      },
    },
  });
}

async function cleanup(fx: Fixture | null) {
  if (!fx) {
    await removeGateMatch(prisma, gateMatch);
    return;
  }
  const ids = Object.values(fx.assetIds);
  // Jobs cascade with their asset; model versions are SetNull on the job side.
  await prisma.visionDatasetMember.deleteMany({ where: { videoAssetId: { in: ids } } });
  await prisma.visionDatasetVersion.deleteMany({ where: { label: { contains: RUN } } });
  await prisma.visionVideoAsset.deleteMany({ where: { id: { in: ids } } });
  const versions = await prisma.visionModelVersion.findMany({
    where: { modelId: { in: fx.modelIds } },
    select: { id: true },
  });
  await prisma.visionAuditLog.deleteMany({
    where: { targetId: { in: [...fx.modelIds, ...versions.map((v) => v.id)] } },
  });
  await prisma.visionModel.deleteMany({ where: { id: { in: fx.modelIds } } });
  await removeGateWorkers(prisma, fx.workerIds);
  await prisma.visionRightsScope.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourceVideoRecord.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourcePartner.deleteMany({ where: { id: fx.partnerId } });
  await removeGateMatch(prisma, gateMatch);
}

async function main() {
  assertDevDatabase({ api: API });
  console.log("Vision model registry — lineage, dispatch and provenance");
  console.log(`  api ${API}`);
  console.log(`  run ${RUN}`);

  let fx: Fixture | null = null;
  onInterrupt(async () => {
    await cleanup(fx);
    await closeGate(prisma);
  });
  try {
    fx = await seed();
    const a = fx.assetIds;

    // ── 1. Registry ──────────────────────────────────────────────────────
    section("1. Registering a model and a version");

    const model = await post("/vision/models", { key: `detector/gate-${RUN}`, task: "detect" });
    check("model registered", model.status, 201);
    const modelId = String(model.body.id ?? "");
    fx.modelIds.push(modelId);

    const twice = await post("/vision/models", { key: `detector/gate-${RUN}`, task: "detect" });
    check("same key refused", twice.body.error, "ModelKeyExists");

    const registration = {
      version: "0.1",
      gitCommit: "3eeec6e0",
      // A detector a worker can run: detect is refused for any other (docs/vision/95).
      configKey: DETECTOR_CONFIG_BASE,
      workerImage: "dtp-vision-engine:0.1",
      licenceNote: "Gate fixture: torchvision BSD-3-Clause; COCO weights via torchvision; no DTP data.",
    };

    const unlicensed = await post(`/vision/models/${modelId}/versions`, { ...registration, licenceNote: "" });
    check("blank licence note refused at the DTO", unlicensed.status, 400);

    const badCommit = await post(`/vision/models/${modelId}/versions`, { ...registration, gitCommit: "main" });
    check("non-hex commit refused", badCommit.status, 400);

    const version = await post(`/vision/models/${modelId}/versions`, registration);
    check("version registered", version.status, 201);
    check("starts as a candidate", version.body.stage, "candidate");
    check("no checksum until a worker reports one", version.body.weightsChecksum, null);
    const versionId = String(version.body.id ?? "");

    const sameVersion = await post(`/vision/models/${modelId}/versions`, registration);
    check("same version string refused", sameVersion.body.error, "ModelVersionExists");

    const listed = await api("/vision/models");
    const mine = (listed.body.models ?? []).find((m: { id: string }) => m.id === modelId);
    check("listed with its version", mine?.versions?.[0]?.id, versionId);

    const got = await api(`/vision/models/versions/${versionId}`);
    check("version readable by id", got.body.version?.model?.key, `detector/gate-${RUN}`);

    // ── 2. Lineage ───────────────────────────────────────────────────────
    section("2. A version's dataset lineage");

    const draft = await prisma.visionDatasetVersion.create({ data: { label: `gate-${RUN}-v1` } });
    const onDraft = await post(`/vision/models/${modelId}/versions`, {
      ...registration,
      version: "0.2",
      datasetVersionId: draft.id,
    });
    check("draft dataset refused", onDraft.body.error, "DatasetNotFrozen");

    const revoked = await frozenDataset(`gate-${RUN}-v2`, [{ videoAssetId: a.train!, split: "train" }], true);
    const onRevoked = await post(`/vision/models/${modelId}/versions`, {
      ...registration,
      version: "0.2",
      datasetVersionId: revoked.id,
    });
    check("dataset with revoked footage refused", onRevoked.body.error, "DatasetContainsRevokedMembers");

    // The gold asset is held out by a frozen benchmark, and a second frozen version
    // trains on it. Registering a model against the second is how the contamination
    // would be recorded as a fact.
    await frozenDataset(`gold benchmark ${RUN}`, [{ videoAssetId: a.gold!, split: "gold" }]);
    const contaminated = await frozenDataset(`gate-${RUN}-bad`, [{ videoAssetId: a.gold!, split: "train" }]);
    const onGold = await post(`/vision/models/${modelId}/versions`, {
      ...registration,
      version: "0.2",
      datasetVersionId: contaminated.id,
    });
    check("dataset that trains on gold refused", onGold.body.error, "GoldContamination");
    check("the offending member is named", onGold.body.members?.[0]?.videoAssetId, a.gold);

    const clean = await frozenDataset(`gate-${RUN}-export`, [{ videoAssetId: a.train!, split: "train" }]);
    const onClean = await post(`/vision/models/${modelId}/versions`, {
      ...registration,
      version: "0.2",
      datasetVersionId: clean.id,
    });
    check("frozen, rights-clean dataset accepted", onClean.status, 201);
    check("lineage recorded", onClean.body.datasetVersionId, clean.id);

    // ── 3. Dispatch ──────────────────────────────────────────────────────
    section("3. Queueing detect resolves a model and the proxy's clock");

    const beforeTranscode = await post("/vision/jobs", { type: "detect", videoAssetId: a.run });
    check("detect refused before transcode has succeeded", beforeTranscode.status, 400);

    const variant = await transcoded(a.run!, { fps: 25, sourceOffsetMs: 9000 });

    const unresolved = await post("/vision/jobs", { type: "detect", videoAssetId: a.run });
    check("no production detector: refused rather than guessed", unresolved.body.error, "NoProductionModel");

    const tracker = await post("/vision/models", { key: `tracker/gate-${RUN}`, task: "track" });
    fx.modelIds.push(String(tracker.body.id));
    const trackerVersion = await post(`/vision/models/${tracker.body.id}/versions`, registration);
    const wrongTask = await post("/vision/jobs", {
      type: "detect",
      videoAssetId: a.run,
      modelVersionId: trackerVersion.body.id,
    });
    check("a track model cannot run detect", wrongTask.body.error, "ModelTaskMismatch");

    const explicit = await post("/vision/jobs", {
      type: "detect",
      videoAssetId: a.run,
      modelVersionId: versionId,
      // A caller trying to forge the clock. The row's values must win.
      params: { sampleFps: 1, proxy: { fps: 1, sourceOffsetMs: 0 } },
    });
    check("explicit candidate version accepted", explicit.status, 201);
    const jobId = String(explicit.body.id ?? "");
    const jobRow = await prisma.visionJob.findUnique({ where: { id: jobId } });
    check("job carries the model version", jobRow?.modelVersionId, versionId);
    const spec = (jobRow?.inputSpec ?? {}) as Record<string, any>;
    check("job carries the proxy's frame rate from the variant", spec.proxy?.fps, 25);
    check("job carries the proxy's source offset from the variant", spec.proxy?.sourceOffsetMs, 9000);
    check("the operator's own parameters survive", spec.sampleFps, 1);
    check("job is told the detector config its version names", spec.detector?.configKey, DETECTOR_CONFIG_BASE);

    const unknownConfig = await post(`/vision/models/${modelId}/versions`, { ...registration, version: "0.2-unknown-config", configKey: `models/gate-${RUN}/config.json` });
    const unrunnable = await post("/vision/jobs", { type: "detect", videoAssetId: a.run, modelVersionId: unknownConfig.body.id });
    check("a version whose detector config no worker runs: refused", unrunnable.body.error, "DetectorConfigUnknown");
    await prisma.visionModelVersion.update({ where: { id: String(unknownConfig.body.id) }, data: { stage: "archived" } });

    await prisma.visionModelVersion.update({ where: { id: versionId }, data: { stage: "production" } });
    const implicit = await post("/vision/jobs", { type: "detect", videoAssetId: a.run });
    check("production version resolved when none is named", implicit.status, 201);
    const implicitRow = await prisma.visionJob.findUnique({ where: { id: String(implicit.body.id) } });
    check("and recorded on the job", implicitRow?.modelVersionId, versionId);

    const second = await prisma.visionModelVersion.create({
      data: { modelId, version: "0.3", stage: "production", licenceNote: "gate", gitCommit: "3eeec6e0" },
    });
    const ambiguous = await post("/vision/jobs", { type: "detect", videoAssetId: a.run });
    check("two production versions: refused", ambiguous.body.error, "AmbiguousProductionModel");
    await prisma.visionModelVersion.update({ where: { id: second.id }, data: { stage: "archived" } });

    const archived = await post("/vision/jobs", { type: "detect", videoAssetId: a.run, modelVersionId: second.id });
    check("archived version cannot be named", archived.body.error, "ModelVersionArchived");

    await prisma.visionVideoVariant.update({ where: { id: variant.id }, data: { fps: null } });
    const noFps = await post("/vision/jobs", { type: "detect", videoAssetId: a.run, modelVersionId: versionId });
    check("proxy without a frame rate: refused", noFps.body.error, "ProxyWithoutFps");
    await prisma.visionVideoVariant.update({ where: { id: variant.id }, data: { fps: 25 } });

    // Leave exactly one queued detect job for the worker to claim.
    await post(`/vision/jobs/${implicit.body.id}/cancel`, { reason: "gate: keep one queued job" });

    // ── 4. Completion ────────────────────────────────────────────────────
    section("4. A completion is refused at the door unless its provenance holds");

    const provisioned = await post("/vision/workers/provision", { resourceClass: "gpu_24gb", providerId: "mock" });
    check("worker provisioned on the mock provider", provisioned.status, 201);
    fx.workerIds.push(String(provisioned.body.workerId));

    const registered = await call("/vision/worker/register", {
      "x-vision-bootstrap-token": String(provisioned.body.bootstrapToken),
    }, { method: "POST" });
    check("worker registered", registered.status, 201);
    const pod = worker(String(registered.body.workerToken));

    const claimed = await pod.claim(["gpu_24gb"]);
    const claimedId = claimed.body.job?.jobId;
    if (claimedId && claimedId !== jobId) {
      // Someone else's GPU job was queued ahead of ours. Hand it straight back.
      await pod.fail(claimedId, "gate claimed a job that was not its own");
    }
    check("worker claimed the gate's detect job", claimedId, jobId);
    check("claim names the model version", claimed.body.job?.inputs?.modelVersionIds?.[0], versionId);
    check("claim carries the proxy clock", claimed.body.job?.inputs?.params?.proxy?.sourceOffsetMs, 9000);
    const prefix = String(claimed.body.job?.outputPrefix ?? "");
    const artifact = {
      key: `${prefix}detections.json`,
      bucket: "derived",
      bytes: 1024,
      contentType: "application/json",
      role: "detections",
    };
    const summaryFor = (sha: string | null) => ({
      framesSampled: 120,
      sampleFps: 2,
      detections: 300,
      people: 290,
      balls: 10,
      framesWithBall: 9,
      ballVisibilityPct: 7.5,
      modelVersionId: versionId,
      weightsSha256: sha,
      detectorConfig: DETECTOR_CONFIG_BASE,
    });

    const impostor = await pod.complete(jobId, {
      idempotencyKey: `gate-${RUN}-impostor`,
      artifacts: [artifact],
      summary: summaryFor(SHA_FIRST),
      modelVersionIds: [second.id],
    });
    check("completion naming another version refused", impostor.body.error, "ProvenanceMismatch");
    check("…with 403", impostor.status, 403);
    const stillRunning = await api(`/vision/jobs/${jobId}`);
    check("the job did not succeed", stillRunning.body.job?.state, "running");

    const anonymous = await pod.complete(jobId, {
      idempotencyKey: `gate-${RUN}-anonymous`,
      artifacts: [artifact],
      summary: summaryFor(SHA_FIRST),
    });
    check("completion naming no version refused", anonymous.body.error, "ProvenanceMismatch");

    const garbage = await pod.complete(jobId, {
      idempotencyKey: `gate-${RUN}-garbage`,
      artifacts: [artifact],
      summary: summaryFor("not-a-digest"),
      modelVersionIds: [versionId],
    });
    check("a checksum that is not a digest refused", garbage.body.error, "WeightsMismatch");

    const otherConfig = await pod.complete(jobId, {
      idempotencyKey: `gate-${RUN}-other-config`,
      artifacts: [artifact],
      summary: { ...summaryFor(SHA_FIRST), detectorConfig: "builtin/torchvision/fasterrcnn_resnet50_fpn/COCO_V1+ball-tiles/v1" },
      modelVersionIds: [versionId],
    });
    check("a completion from another detector config refused", otherConfig.body.error, "ProvenanceMismatch");

    const accepted = await pod.complete(jobId, {
      idempotencyKey: `gate-${RUN}-ok`,
      artifacts: [artifact],
      summary: summaryFor(SHA_FIRST),
      modelVersionIds: [versionId],
      cost: { gpuSeconds: 12.5, cpuSeconds: 40, wallClockSeconds: 40 },
    });
    check("honest completion accepted", accepted.status, 201);
    check("projection applied", accepted.body.applied?.applied, true);
    check("projection names the model", String(accepted.body.applied?.detail ?? "").includes(versionId), true);

    const pinned = await api(`/vision/models/versions/${versionId}`);
    check("first run pinned the version to its weights", pinned.body.version?.weightsChecksum, SHA_FIRST);
    const events = await api(`/vision/jobs/${jobId}/events`);
    check(
      "the pinning is on the job's record",
      (events.body.events ?? []).some((e: { kind: string }) => e.kind === "weights_checksum_recorded"),
      true
    );

    const retried = await pod.complete(jobId, {
      idempotencyKey: `gate-${RUN}-ok`,
      artifacts: [artifact],
      summary: summaryFor(SHA_FIRST),
      modelVersionIds: [versionId],
    });
    check("a retried completion is recognised, not re-applied", retried.body.alreadyApplied, true);

    // A second job on the same version, from a worker that loaded different bytes.
    const again = await post("/vision/jobs", { type: "detect", videoAssetId: a.run, modelVersionId: versionId });
    const secondJob = String(again.body.id ?? "");
    const claimedAgain = await pod.claim(["gpu_24gb"]);
    if (claimedAgain.body.job?.jobId && claimedAgain.body.job.jobId !== secondJob) {
      await pod.fail(claimedAgain.body.job.jobId, "gate claimed a job that was not its own");
    }
    check("worker claimed the second detect job", claimedAgain.body.job?.jobId, secondJob);
    const secondPrefix = String(claimedAgain.body.job?.outputPrefix ?? "");
    const secondArtifact = { ...artifact, key: `${secondPrefix}detections.json` };

    const differentBytes = await pod.complete(secondJob, {
      idempotencyKey: `gate-${RUN}-bytes`,
      artifacts: [secondArtifact],
      summary: summaryFor(SHA_OTHER),
      modelVersionIds: [versionId],
    });
    check("weights that differ from the pinned ones refused", differentBytes.body.error, "WeightsMismatch");

    const unreported = await pod.complete(secondJob, {
      idempotencyKey: `gate-${RUN}-unreported`,
      artifacts: [secondArtifact],
      summary: summaryFor(null),
      modelVersionIds: [versionId],
    });
    check("an unreported checksum is a visible gap, not a refusal", unreported.status, 201);
    check(
      "…and the projection says so",
      String(unreported.body.applied?.detail ?? "").includes("weights unreported"),
      true
    );

    await post(`/vision/workers/${provisioned.body.workerId}/retire`, {});
  } catch (error) {
    failures += 1;
    console.error("\nGate aborted:", error);
  } finally {
    await cleanup(fx).catch((e) => console.error("cleanup failed:", e));
    await closeGate(prisma);
  }

  console.log(`\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ""}`);
  process.exitCode = failures ? 1 : 0;
}

void main();
