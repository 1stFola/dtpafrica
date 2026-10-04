/**
 * Phase 3 Increment 4 gate — promotion, by two people, and rollback in one move.
 *
 *   pnpm --filter @dtp/api vision:promotioncheck
 *
 * Needs the API on :3000 (`VISION_E2E_API`), whatever `DATABASE_URL` points at
 * (never production), the object store the API is configured with, the worker's
 * Python environment for the evaluator, and the seeded `vision_ml_engineer` and
 * `vision_admin` roles. The gate creates two signed-in people -- a trainer and an
 * approver -- because the control under test is that they are not the same person,
 * and the shared operator key cannot be two people.
 *
 * Three claims are on trial:
 *
 *   1. The operator key can neither request nor approve; a trainer cannot approve;
 *      an approver cannot approve their own request.
 *   2. The gate refuses by name -- no model card, no pinned weights, a regression
 *      against production -- and records its findings on the request.
 *   3. Approval moves a version one stage; promotion to production demotes what
 *      it replaces; rollback restores exactly that, once.
 */
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { VISION_CONTRACT_VERSION, visionKeys } from "@dtp/vision-contracts";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { loadVisionConfig } from "../src/vision/config/vision.config";
import { InMemoryObjectStore } from "../src/vision/storage/in-memory-object-store";
import { R2ObjectStore } from "../src/vision/storage/r2-object-store";
import type { ObjectStore } from "../src/vision/storage/object-store";
import { assertDevDatabase, onInterrupt } from "./gate-harness";

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
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(70)} ${ok ? String(actual) : `expected ${expected}, got ${actual}`}`);
}
function section(t: string) {
  console.log(`\n${t}\n${"-".repeat(t.length)}`);
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
const keyHeaders = () => {
  const key = process.env.ADMIN_API_KEY?.trim();
  if (!key) throw new Error("ADMIN_API_KEY is not set");
  return { "x-admin-api-key": key };
};
const asKey = (path: string, init?: RequestInit) => call(path, keyHeaders(), init);
const postKey = (path: string, body: unknown) => asKey(path, { method: "POST", body: JSON.stringify(body) });
const asUser = (token: string) => (path: string, body?: unknown) =>
  call(path, { Authorization: `Bearer ${token}` }, body === undefined ? undefined : { method: "POST", body: JSON.stringify(body) });

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
  userIds: string[];
  wrote: { bucket: "derived" | "models"; key: string }[];
  tmp: string | null;
};

const GOLD_BOXES = [
  { sourceTimeMs: 1_000, class: "player", x: 0.1, y: 0.1, width: 0.1, height: 0.2 },
  { sourceTimeMs: 1_000, class: "ball", x: 0.5, y: 0.5, width: 0.02, height: 0.03 },
  { sourceTimeMs: 1_960, class: "player", x: 0.3, y: 0.3, width: 0.1, height: 0.2 },
];
/** A detector that finds the frame-26 player and nothing else: player recall .5, mAP .25. */
const DETECTS_HALF = (modelVersionId: string) => ({
  contractVersion: VISION_CONTRACT_VERSION, role: "detections", modelVersionId, proxy: { fps: 25, sourceOffsetMs: 0 },
  frames: [
    { sampleIndex: 1, frameIndex: 25, proxyTimeMs: 1000, sourceTimeMs: 1000, qualityFlags: ["ball_unknown"], detections: [{ class: "player", confidence: 0.9, box: { x: 128, y: 72, width: 128, height: 144 } }] },
    { sampleIndex: 2, frameIndex: 49, proxyTimeMs: 1960, sourceTimeMs: 1960, qualityFlags: ["ball_unknown"], detections: [] },
  ],
});
/** A detector that finds nothing: every metric zero. A regression against the one above. */
const DETECTS_NOTHING = (modelVersionId: string) => ({
  ...DETECTS_HALF(modelVersionId),
  frames: DETECTS_HALF(modelVersionId).frames.map((f) => ({ ...f, detections: [] })),
});

async function seed(): Promise<Fixture> {
  const partner = await prisma.visionSourcePartner.create({ data: { name: `Promotion gate ${RUN}`, contactEmail: "gate@example.test" } });
  const record = await prisma.visionSourceVideoRecord.create({
    data: { partnerId: partner.id, title: `Promotion gate record ${RUN}`, sourceQualityRank: "broadcast", originalAvailable: true, acquisitionStatus: "acquired", acquisitionMethod: "partner_direct_upload" },
  });
  await prisma.visionRightsScope.create({
    data: { partnerId: partner.id, grantLevel: "partner", canAnalyze: true, canTrain: true, canPublishHighlight: false, canShareWithScout: false, grantedAt: new Date() },
  });
  const proxyKey = `proxies/gate-${RUN}-promo/proxy.mp4`;
  const asset = await prisma.visionVideoAsset.create({
    data: {
      sourceVideoRecordId: record.id, corpus: "dtp_owned", objectKey: `originals/gate-${RUN}-promo/source.mp4`, bytes: BigInt(1024), mimeType: "video/mp4",
      checksumSha256: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64), width: 1280, height: 720, durationMs: 120_000, ingestState: "ready",
      variants: { create: { kind: "proxy", objectKey: proxyKey, width: 1280, height: 720, fps: 25, durationMs: 120_000, sourceOffsetMs: 0 } },
    },
  });
  return { partnerId: partner.id, assetId: asset.id, proxyKey, modelIds: [], taskIds: [], datasetIds: [], jobIds: [], workerIds: [], userIds: [], wrote: [], tmp: null };
}

/**
 * A signed-in person with a seeded vision role.
 *
 * The sign-in credential is generated here from random bytes, used once to obtain
 * a token, and never written anywhere but as a bcrypt hash on a user row this gate
 * deletes at cleanup. There is nothing to rotate: it does not exist after the run.
 */
async function person(fx: Fixture, roleSlug: string, label: string): Promise<{ id: string; email: string; token: string }> {
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
  return { id: user.id, email, token: String(login.body.token) };
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
  await prisma.visionAuditLog.deleteMany({ where: { OR: [{ targetId: { in: [...fx.modelIds, ...fx.taskIds, ...fx.datasetIds, ...fx.jobIds] } }, { actorId: { in: fx.userIds } }] } });
  await prisma.adminUser.deleteMany({ where: { id: { in: fx.userIds } } });
  await prisma.visionRightsScope.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourceVideoRecord.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourcePartner.deleteMany({ where: { id: fx.partnerId } });
}

async function main() {
  assertDevDatabase({ api: API });
  const config = loadVisionConfig();
  const store: ObjectStore = config.storage.backend === "r2" ? new R2ObjectStore(config.storage) : new InMemoryObjectStore();

  console.log("Vision promotion — two people, seven checks, one rollback");
  console.log(`  api ${API}`);
  console.log(`  object store ${store.backendId}`);
  console.log(`  run ${RUN}`);
  if (!existsSync(PYTHON)) throw new Error(`No worker Python at ${PYTHON}; set VISION_WORKER_PYTHON`);

  let fx: Fixture | null = null;
  onInterrupt(async () => {
    await cleanup(fx, store);
    await prisma.$disconnect();
  });
  try {
    fx = await seed();
    const trainer = await person(fx, "vision_ml_engineer", "trainer");
    const approver = await person(fx, "vision_admin", "approver");
    const asTrainer = asUser(trainer.token);
    const asApprover = asUser(approver.token);

    // ── 1. Gold, exported; two versions, each benchmarked ─────────────────
    section("1. A gold set, and two versions benchmarked against it");

    const model = await asTrainer("/vision/models", { key: `detector/gate-${RUN}`, task: "detect" });
    check("the trainer registers a model", model.status, 201);
    fx.modelIds.push(String(model.body.id));
    const register = (v: string) =>
      asTrainer(`/vision/models/${model.body.id}/versions`, {
        version: v, gitCommit: "3eeec6e0", configKey: `models/gate-${RUN}/config.json`, workerImage: "dtp-vision-engine:0.1",
        licenceNote: "Gate fixture: torchvision BSD-3-Clause; no DTP data.", weightsChecksum: "1".repeat(64),
      });
    const v1 = String((await register("0.1")).body.id);
    const v2 = String((await register("0.2")).body.id);

    const schema = await postKey("/vision/annotation/schemas", { version: `gate-${RUN}-schema`, definitions: { player: "a player", ball: "the ball" } });
    const task = await postKey("/vision/annotation/tasks", { videoAssetId: fx.assetId, labelSchemaVersionId: String(schema.body.id), samplingStrategy: "low_confidence", startMs: 1_000, endMs: 2_000 });
    fx.taskIds.push(String(task.body.id));
    const submitted = await postKey(`/vision/annotation/tasks/${task.body.id}/submit`, {
      payload: { windowSourceStartMs: 1_000, windowSourceEndMs: 2_000, uncertain: false, notes: null, boxes: GOLD_BOXES }, annotatorId: `gate-ann-${RUN}`,
    });
    for (const who of ["one", "two"]) {
      await prisma.visionReviewDecision.create({ data: { annotationVersionId: String(submitted.body.id), targetKind: "vision_annotation_version", targetId: String(submitted.body.id), decision: "approved", reviewerId: `gate-reviewer-${who}-${RUN}` } });
    }
    const gold = await postKey("/vision/datasets", { label: `gold benchmark ${RUN}`, splitPolicy: { train: 0, val: 0, test: 0, gold: 100, seed: `g-${RUN}` } });
    const goldId = String(gold.body.id);
    fx.datasetIds.push(goldId);
    await postKey(`/vision/datasets/${goldId}/members`, { videoAssetIds: [fx.assetId] });
    await postKey(`/vision/datasets/${goldId}/splits`, {});
    await postKey(`/vision/datasets/${goldId}/freeze`, {});
    await store.putSmallObject("derived", fx.proxyKey, "not really a video", "video/mp4");
    fx.wrote.push({ bucket: "derived", key: fx.proxyKey });
    const exported = await postKey(`/vision/datasets/${goldId}/export`, {});
    check("the gold set exports with its boxes", exported.body.qa?.boxes, 3);
    const goldKey = visionKeys.datasetExport(goldId, "samples.json").key;
    fx.tmp = mkdtempSync(join(tmpdir(), `dtp-promo-${RUN}-`));
    writeFileSync(join(fx.tmp, "samples.json"), (await store.getSmallObject("derived", goldKey))!);

    /** A succeeded detect job with its artifact, then a benchmark run completed by a fake pod with the real evaluator's numbers. */
    const benchmark = async (versionId: string, artifact: Record<string, unknown>, label: string) => {
      const jobId = randomUUID();
      const key = `${visionKeys.inferencePrefix(jobId, 1)}detections.json`;
      await prisma.visionJob.create({
        data: {
          id: jobId, type: "detect", resourceClass: "gpu_24gb", state: "succeeded", videoAssetId: fx!.assetId, modelVersionId: versionId, inputSpec: { videoAssetId: fx!.assetId },
          outputPrefix: visionKeys.inferencePrefix(jobId, 1), budgetSeconds: 600, budgetUsdCents: 100, contractVersion: VISION_CONTRACT_VERSION, finishedAt: new Date(),
          progress: { artifacts: [{ key, bucket: "derived", role: "detections" }], summary: { modelVersionId: versionId } },
        },
      });
      fx!.jobIds.push(jobId);
      await store.putSmallObject("derived", key, JSON.stringify(artifact), "application/json");
      fx!.wrote.push({ bucket: "derived", key });

      const requested = await asTrainer(`/vision/models/versions/${versionId}/benchmark`, { datasetVersionId: goldId });
      check(`benchmark requested for ${label}`, requested.status, 201);
      fx!.jobIds.push(String(requested.body.jobId));

      const provisioned = await postKey("/vision/workers/provision", { resourceClass: "cpu_small", providerId: "mock" });
      fx!.workerIds.push(String(provisioned.body.workerId));
      const registered = await call("/vision/worker/register", { "x-vision-bootstrap-token": String(provisioned.body.bootstrapToken) }, { method: "POST" });
      const workerHeaders = { "x-vision-worker-token": String(registered.body.workerToken) };
      const claimed = await call("/vision/worker/jobs/claim", workerHeaders, { method: "POST", body: JSON.stringify({ resourceClasses: ["cpu_small"], contractVersion: VISION_CONTRACT_VERSION }) });
      const claimedId = claimed.body.job?.jobId;
      if (claimedId !== requested.body.jobId) throw new Error(`claimed ${claimedId}, wanted ${requested.body.jobId}`);

      const det = join(fx!.tmp!, `${label}.json`);
      writeFileSync(det, JSON.stringify(artifact));
      const evaluated = spawnSync(PYTHON, ["-m", "dtp_vision_worker.evaluate", "--gold", join(fx!.tmp!, "samples.json"), "--detections", `${fx!.assetId}=${det}`], { cwd: WORKER_DIR, encoding: "utf8" });
      if (evaluated.status !== 0) throw new Error(`evaluator failed: ${evaluated.stderr}`);
      const report = JSON.parse(evaluated.stdout);
      const prefix = String(claimed.body.job?.outputPrefix);
      const completed = await call(`/vision/worker/jobs/${claimedId}/complete`, workerHeaders, {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: `gate-${RUN}-${label}`,
          artifacts: [{ key: `${prefix}benchmark.json`, bucket: "models", bytes: 1, contentType: "application/json", role: "benchmark" }],
          summary: { benchmarkRunId: requested.body.id, modelVersionId: versionId, datasetVersionId: goldId, ...report },
          modelVersionIds: [],
        }),
      });
      check(`benchmark completed for ${label}`, completed.body.applied?.applied, true);
      await postKey(`/vision/workers/${provisioned.body.workerId}/retire`, {});
      return String(requested.body.id);
    };

    await benchmark(v1, DETECTS_HALF(v1), "v1");
    await benchmark(v2, DETECTS_NOTHING(v2), "v2");
    check("v1 is benchmarked", (await asKey(`/vision/models/versions/${v1}`)).body.version?.stage, "benchmarked");

    // ── 2. Who may ask, who may decide ────────────────────────────────────
    section("2. Two people, and the key that is nobody");

    const keyRequest = await postKey(`/vision/models/versions/${v1}/promotion-request`, {});
    check("the operator key cannot request", keyRequest.body.error, "PromotionNeedsAPerson");
    const keyApprove = await postKey(`/vision/models/versions/${v1}/promote`, {});
    check("the operator key cannot approve", keyApprove.body.error, "PromotionNeedsAPerson");

    const noCard = await asTrainer(`/vision/models/versions/${v1}/promotion-request`, {});
    check("no model card: the gate refuses", noCard.body.error, "PromotionGateFailed");
    check("…naming the check", noCard.body.failures?.[0]?.name, "model_card");
    check("…and the unthresholded run is a warning, not a failure", noCard.body.warnings?.[0]?.name, "benchmark");

    for (const v of [v1, v2]) {
      const card = visionKeys.modelCard(v);
      await store.putSmallObject(card.bucket, card.key, `# ${v}\n\nGate fixture.`, "text/markdown");
      fx.wrote.push({ bucket: "models", key: card.key });
    }

    const requested = await asTrainer(`/vision/models/versions/${v1}/promotion-request`, {});
    check("the trainer requests v1 -> staging", requested.status, 201);
    check("…from benchmarked", requested.body.fromStage, "benchmarked");
    check("…to staging", requested.body.toStage, "staging");
    check("…attributed to the trainer", requested.body.requestedBy, trainer.id);
    check("…with the gate's findings stored", Array.isArray(requested.body.checks?.passed), true);

    const again = await asTrainer(`/vision/models/versions/${v1}/promotion-request`, {});
    check("a second request while one is pending: refused", again.body.error, "PromotionPending");

    const trainerApproves = await asTrainer(`/vision/models/versions/${v1}/promote`, {});
    check("the trainer cannot approve (no vision.models.promote)", trainerApproves.status, 403);

    const approved = await asApprover(`/vision/models/versions/${v1}/promote`, { note: "slices looked fine" });
    check("the approver promotes v1 to staging", approved.body.toStage, "staging");
    check("v1 is staging", (await asKey(`/vision/models/versions/${v1}`)).body.version?.stage, "staging");

    // The approver asks for production; they may not approve their own ask.
    const ownRequest = await asApprover(`/vision/models/versions/${v1}/promotion-request`, {});
    check("the approver (who also holds train) requests staging -> production", ownRequest.body.toStage, "production");
    const selfApprove = await asApprover(`/vision/models/versions/${v1}/promote`, {});
    check("…and cannot approve their own request", selfApprove.body.error, "SelfPromotionRefused");
    const rejected = await asApprover(`/vision/models/promotions/${ownRequest.body.id}/reject`, { reason: "asked by mistake; the trainer should request" });
    check("they can reject it, with a reason", rejected.body.state, "rejected");

    const prodRequest = await asTrainer(`/vision/models/versions/${v1}/promotion-request`, {});
    check("the trainer requests v1 -> production", prodRequest.body.toStage, "production");
    const prod = await asApprover(`/vision/models/versions/${v1}/promote`, {});
    check("v1 is promoted to production", prod.body.toStage, "production");
    check("…replacing nothing", prod.body.replacedVersionIds?.length, 0);

    // ── 3. The regression check, and production replaced ──────────────────
    section("3. A regression is refused; a better version replaces production");

    const regressed = await asTrainer(`/vision/models/versions/${v2}/promotion-request`, {});
    check("v2 found nothing: a regression against v1 is refused", regressed.body.error, "PromotionGateFailed");
    const regression = (regressed.body.failures ?? []).find((f: { name: string }) => f.name === "regression");
    check("…named as a regression", regression?.name, "regression");
    check("…on the headline", String(regression?.detail ?? "").includes("ap:all@all 0.000 vs production 0.250"), true);

    // Re-benchmark v2 with the same detections as v1: no regression now.
    await benchmark(v2, DETECTS_HALF(v2), "v2-again");
    const v2Request = await asTrainer(`/vision/models/versions/${v2}/promotion-request`, {});
    check("with equal numbers v2 may be requested", v2Request.status, 201);
    check("…compared against v1", v2Request.body.checks?.comparedWith, v1);
    await asApprover(`/vision/models/versions/${v2}/promote`, {});
    await asTrainer(`/vision/models/versions/${v2}/promotion-request`, {});
    const takeover = await asApprover(`/vision/models/versions/${v2}/promote`, {});
    check("v2 reaches production", takeover.body.toStage, "production");
    check("…replacing v1", takeover.body.replacedVersionIds?.[0], v1);
    check("v1 is demoted to staging", (await asKey(`/vision/models/versions/${v1}`)).body.version?.stage, "staging");

    // ── 4. Rollback ───────────────────────────────────────────────────────
    section("4. Rollback is one operation");

    const rollback = await asApprover(`/vision/models/versions/${v2}/rollback`, {});
    check("v2 is rolled back", rollback.body.rolledBack, v2);
    check("…restoring v1", rollback.body.restored?.[0], v1);
    check("v1 is production again", (await asKey(`/vision/models/versions/${v1}`)).body.version?.stage, "production");
    check("v2 is staging", (await asKey(`/vision/models/versions/${v2}`)).body.version?.stage, "staging");
    const twice = await asApprover(`/vision/models/versions/${v2}/rollback`, {});
    check("rolling back a staging version: refused", twice.body.error, "NotInProduction");
    const v1Back = await asApprover(`/vision/models/versions/${v1}/rollback`, {});
    check("v1 replaced nothing when first promoted: nothing to roll back to", v1Back.body.error, "NothingToRollBackTo");

    const history = await asKey(`/vision/models/versions/${v2}/promotions`);
    check("v2's history is listed", Array.isArray(history.body.requests) && history.body.requests.length >= 2, true);
    const audit = await prisma.visionAuditLog.findMany({ where: { targetId: v2, action: { in: ["model.promoted", "model.rolled_back"] } }, select: { action: true, actorId: true } });
    check("promotion and rollback are audited to the approver", audit.every((a) => a.actorId === approver.id) && audit.length >= 2, true);

    // ── 5. Two at once, and a rollback target that moved (docs/vision/57) ──
    section("5. Two at once leave one; a rollback restores only what is still where it was left");

    // v1 is production, v2 staging. Two people who may both ask for v2 -> production ask in the same instant.
    const [askA, askB] = await Promise.all([
      asTrainer(`/vision/models/versions/${v2}/promotion-request`, {}),
      asApprover(`/vision/models/versions/${v2}/promotion-request`, {}),
    ]);
    check("two requests at once: one is filed, the other told one is pending", [askA.status, askB.status].sort().join(","), "201,409");
    check("…refused by name", [askA, askB].find((r) => r.status === 409)?.body.error, "PromotionPending");
    check("…and one row is pending, not two", await prisma.visionPromotionRequest.count({ where: { modelVersionId: v2, state: "pending" } }), 1);
    const listed = await asKey(`/vision/models`);
    const listedV2 = (listed.body.models ?? []).flatMap((m: any) => m.versions).find((v: any) => v.id === v2);
    const winner = [askA, askB].find((r) => r.status === 201)!;
    check("the registry list says which version has a request waiting, and for which stage", `${listedV2?.pendingPromotion?.id === winner.body.id}/${listedV2?.pendingPromotion?.toStage}`, "true/production");
    check("…and that the production version has none", (listed.body.models ?? []).flatMap((m: any) => m.versions).find((v: any) => v.id === v1)?.pendingPromotion, null);

    // Start clean: the trainer's request alone, then two approvers decide it in the same instant.
    await asApprover(`/vision/models/promotions/${winner.body.id}/reject`, { reason: "gate fixture: clearing for the next check" });
    const approver2 = await person(fx, "vision_admin", "approver2");
    const asApprover2 = asUser(approver2.token);
    const lone = await asTrainer(`/vision/models/versions/${v2}/promotion-request`, {});
    check("the trainer requests v2 -> production again", `${lone.status}/${lone.body.toStage}`, "201/production");
    const [okA, okB] = await Promise.all([
      asApprover(`/vision/models/versions/${v2}/promote`, {}),
      asApprover2(`/vision/models/versions/${v2}/promote`, {}),
    ]);
    const won = [okA, okB].filter((r) => r.status === 201);
    const lost = [okA, okB].filter((r) => r.status !== 201);
    check("two approvals at once: one promotes", `${won.length}/${won[0]?.body.toStage}`, "1/production");
    check("…the other finds the request decided, or nothing pending", ["PromotionDecided", "NoPendingPromotion"].includes(lost[0]?.body.error), true);
    check("…one audit entry for the promotion, not two", await prisma.visionAuditLog.count({ where: { targetId: v2, action: "model.promoted", data: { path: ["requestId"], equals: lone.body.id } } }), 1);
    const stages = async () => `${(await asKey(`/vision/models/versions/${v1}`)).body.version?.stage}/${(await asKey(`/vision/models/versions/${v2}`)).body.version?.stage}`;
    check("v1 is staging and v2 production: one production version for the task", await stages(), "staging/production");

    // v1 is archived while v2 is in production. Rolling v2 back must not quietly resurrect it.
    await prisma.visionModelVersion.update({ where: { id: v1 }, data: { stage: "archived" } });
    const moved = await asApprover(`/vision/models/versions/${v2}/rollback`, {});
    check("rolling back onto a version archived since: refused by name", `${moved.status}/${moved.body.error}`, "409/RollbackTargetMoved");
    check("…saying which version and where it is now", String(moved.body.message ?? "").includes("is archived"), true);
    check("…and nothing moved", await stages(), "archived/production");
    await prisma.visionModelVersion.update({ where: { id: v1 }, data: { stage: "staging" } });
    const [backA, backB] = await Promise.all([
      asApprover(`/vision/models/versions/${v2}/rollback`, {}),
      asApprover2(`/vision/models/versions/${v2}/rollback`, {}),
    ]);
    check("two rollbacks at once: one restores", [backA.status, backB.status].sort().join(","), "201,409");
    check("…the other is refused, not applied twice", ["AlreadyRolledBack", "NotInProduction", "NothingToRollBackTo"].includes([backA, backB].find((r) => r.status === 409)?.body.error), true);
    check("v1 is production again and v2 staging", await stages(), "production/staging");
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
