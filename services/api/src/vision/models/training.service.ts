import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import {
  DETECTION_CLASSES,
  DETECTOR_CONFIG_BASE,
  TRAIN_ARTIFACT_ROLES,
  TRAIN_DEFAULTS,
  TRAIN_LIMITS,
  TRAIN_VERSION,
  TRAINED_DETECTOR_CONFIG,
  type TrainHyperparameters,
  type TrainJobParams,
  type TrainMember,
  visionKeys,
} from "@dtp/vision-contracts";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionAuditService } from "../audit/vision-audit.service";
import { estimateUsdCents, parseRateOverrides } from "../compute/resource-rates";
import { VISION_CONFIG, type VisionConfig } from "../config/vision.config";
import { VisionJobsService } from "../jobs/vision-jobs.service";
import { RightsPolicyService } from "../rights/rights-policy.service";
import { notFound, refusal } from "../shared/refusals";
import { OBJECT_STORE, type ObjectStore } from "../storage/object-store";
import { VisionModelsService } from "./models.service";

/** samples.json is read whole to pin it; past this it is not a training export this pipeline makes. */
const MAX_EXPORT_BYTES = 64 * 1024 * 1024;
/** The GPUs a run may ask for: the 4090 class is the cheaper one per frame (docs/vision/101). */
const TRAIN_RESOURCE_CLASSES = ["gpu_24gb", "gpu_48gb"] as const;
type TrainResourceClass = (typeof TRAIN_RESOURCE_CLASSES)[number];

/** The events that end an attempt; `claimed` starts one. */
const ATTEMPT_ENDS = new Set(["requeued", "failed", "succeeded", "cancelled"]);
const OPEN_STATES = new Set(["queued", "claimed", "running"]);

type ExportSample = { filepath?: unknown; tags?: unknown; provenance?: { video_asset_id?: unknown }; annotations?: { detections?: unknown[] } | null };

/**
 * Fine-tuning runs (docs/vision/98 step 4, /102).
 *
 * A run is a person's decision with a price on it: the budget is not defaulted, it is
 * given with every request (doc 12: training has its own cap, approved per run). The
 * dataset has to be one a model may be registered against at all -- frozen, no revoked
 * members, no gold contamination -- and every member it trains on must still carry a
 * training right now, not only when it was frozen.
 *
 * The run's output is weights and metrics, not a model version. A person turns a run
 * into a candidate version, naming the commit and the licence position; the registry's
 * own rules then apply exactly as they do to a version registered by hand.
 *
 * Runs also share a monthly cap (`VISION_MONTHLY_TRAINING_BUDGET_USD_CENTS`). A run's
 * own budget is checked per attempt, and a job gets up to three, so the month counts
 * what every attempt actually ran rather than the budgets approved.
 */
@Injectable()
export class VisionTrainingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VisionAuditService) private readonly audit: VisionAuditService,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(VisionJobsService) private readonly jobs: VisionJobsService,
    @Inject(RightsPolicyService) private readonly rights: RightsPolicyService,
    @Inject(VisionModelsService) private readonly models: VisionModelsService,
    @Inject(VISION_CONFIG) private readonly config: VisionConfig
  ) {}

  private readonly rateOverrides = parseRateOverrides(process.env);

  /**
   * This calendar month's (UTC) training spend against the cap.
   *
   * A finished run counts the time of every attempt, from each `claimed` event to the
   * event that ended it, at the configured rate. A run still queued or running counts
   * its finished attempts plus its whole budget, which the current or next attempt may
   * still use.
   */
  async monthToDate(now = new Date()) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const runs = await this.prisma.visionJob.findMany({
      where: { type: "train", queuedAt: { gte: monthStart } },
      select: { id: true, state: true, resourceClass: true, budgetUsdCents: true },
    });
    const events = runs.length
      ? await this.prisma.visionJobEvent.findMany({
          where: { jobId: { in: runs.map((r) => r.id) }, kind: { in: ["claimed", ...ATTEMPT_ENDS] } },
          select: { jobId: true, kind: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        })
      : [];
    let spentUsdCents = 0;
    let reservedUsdCents = 0;
    for (const run of runs) {
      let closedSeconds = 0;
      let openSince: Date | null = null;
      for (const e of events) {
        if (e.jobId !== run.id) continue;
        if (e.kind === "claimed") openSince = e.createdAt;
        else if (openSince) { closedSeconds += (e.createdAt.getTime() - openSince.getTime()) / 1000; openSince = null; }
      }
      const resourceClass = run.resourceClass as TrainResourceClass;
      if (OPEN_STATES.has(run.state)) {
        spentUsdCents += estimateUsdCents(resourceClass, closedSeconds, this.rateOverrides);
        reservedUsdCents += run.budgetUsdCents;
      } else {
        // A run that ended without its closing event still ran until now, as far as the log shows.
        const openSeconds = openSince ? (now.getTime() - openSince.getTime()) / 1000 : 0;
        spentUsdCents += estimateUsdCents(resourceClass, closedSeconds + openSeconds, this.rateOverrides);
      }
    }
    const capUsdCents = this.config.compute.monthlyTrainingBudgetUsdCents;
    return { month: monthStart.toISOString().slice(0, 7), capUsdCents, spentUsdCents, reservedUsdCents,
      remainingUsdCents: Math.max(0, capUsdCents - spentUsdCents - reservedUsdCents), runs: runs.length };
  }

  async request(
    dto: { datasetVersionId: string; budgetUsdCents: number; resourceClass?: string; hyperparameters?: Partial<TrainHyperparameters> },
    actor?: AdminAuthContext
  ) {
    if (!Number.isSafeInteger(dto.budgetUsdCents) || dto.budgetUsdCents < 1 || dto.budgetUsdCents > 2000) {
      throw refusal(400, "TrainingBudgetRequired", "A training run needs its own budget in US cents, from 1 to 2000, given with the request.", "Approve a budget for this run and send it as budgetUsdCents.");
    }
    const resourceClass = (dto.resourceClass ?? "gpu_24gb") as TrainResourceClass;
    if (!TRAIN_RESOURCE_CLASSES.includes(resourceClass)) {
      throw refusal(400, "TrainingResourceClassInvalid", `Training runs on ${TRAIN_RESOURCE_CLASSES.join(" or ")}.`, "Leave resourceClass out for gpu_24gb.");
    }
    const hyperparameters = this.hyperparameters(dto.hyperparameters);

    await this.models.assertDatasetCanBackAModel(dto.datasetVersionId);
    const members = await this.prisma.visionDatasetMember.findMany({
      where: { datasetVersionId: dto.datasetVersionId, split: { in: ["train", "val"] } },
      select: { videoAssetId: true, split: true },
    });
    if (!members.some((m) => m.split === "train") || !members.some((m) => m.split === "val")) {
      throw refusal(409, "TrainingSplitsEmpty", "A run needs members in both the train and the val split: one to learn from, one to score.", "Build a dataset version with both splits.");
    }
    const decisions = await this.rights.canTrainMany(members.map((m) => m.videoAssetId));
    const denied = [...decisions.entries()].filter(([, d]) => !d.allowed).map(([id]) => id);
    if (denied.length) {
      throw new ForbiddenException({ statusCode: 403, error: "TrainingRightsDenied", message: `${denied.length} member(s) may not be trained on today.`, members: denied.slice(0, 20),
        remediation: "Build a new dataset version without them." });
    }

    const exportRef = visionKeys.datasetExport(dto.datasetVersionId, "samples.json");
    const body = await this.store.getSmallObject(exportRef.bucket, exportRef.key, MAX_EXPORT_BYTES);
    if (!body) {
      throw refusal(409, "DatasetNotExported", "This dataset version has no export to train from.", `POST /vision/datasets/${dto.datasetVersionId}/export, then ask again.`);
    }
    const checksum = createHash("sha256").update(body).digest("hex");
    const samples = (JSON.parse(body.toString("utf8")) as { samples?: ExportSample[] }).samples ?? [];
    const byAsset = new Map(samples.map((s) => [String(s.provenance?.video_asset_id ?? ""), s]));
    const listed: TrainMember[] = [];
    const missing: string[] = [];
    let labelled = { train: 0, val: 0 };
    for (const m of members) {
      const sample = byAsset.get(m.videoAssetId);
      if (!sample || typeof sample.filepath !== "string") { missing.push(m.videoAssetId); continue; }
      const split = m.split as TrainMember["split"];
      listed.push({ videoAssetId: m.videoAssetId, split, proxyKey: sample.filepath });
      if (sample.annotations?.detections?.length) labelled = { ...labelled, [split]: labelled[split] + sample.annotations.detections.length };
    }
    if (missing.length) {
      throw refusal(409, "ExportStale", `${missing.length} member(s) are not in the export: it predates the current membership.`, `Export the dataset again (POST /vision/datasets/${dto.datasetVersionId}/export).`);
    }
    if (!labelled.train || !labelled.val) {
      throw refusal(409, "TrainingLabelsEmpty", `The export has ${labelled.train} approved label window(s) in train and ${labelled.val} in val; a run needs both.`, "Approve labelling work on footage in both splits, then export again.");
    }

    // Last, so the month is read as close to booking the run as it can be.
    const month = await this.monthToDate();
    if (dto.budgetUsdCents > month.remainingUsdCents) {
      throw refusal(409, "TrainingMonthlyCapReached",
        `This run's budget of ${usd(dto.budgetUsdCents)} would pass this month's training cap of ${usd(month.capUsdCents)}: ${usd(month.spentUsdCents)} spent and ${usd(month.reservedUsdCents)} held by runs still queued or running, so ${usd(month.remainingUsdCents)} is left.`,
        "Ask for a smaller budget, wait for next month, or raise VISION_MONTHLY_TRAINING_BUDGET_USD_CENTS.", { month });
    }

    const params: TrainJobParams = {
      version: TRAIN_VERSION,
      base: { configKey: DETECTOR_CONFIG_BASE },
      classes: DETECTION_CLASSES,
      export: { key: exportRef.key, checksum },
      members: listed,
      hyperparameters,
      readKeys: [{ bucket: "derived", key: exportRef.key }, ...listed.map((m) => ({ bucket: "derived" as const, key: m.proxyKey }))],
    };
    const job = await this.jobs.enqueueDetached(
      { type: "train", datasetVersionId: dto.datasetVersionId, params: params as unknown as Record<string, unknown>, resourceClass,
        budgetUsdCents: dto.budgetUsdCents, budgetSeconds: 6 * 3600 },
      actor
    );
    await this.audit.record(
      { action: "model.training.requested", targetKind: "vision_job", targetId: job.id,
        data: { datasetVersionId: dto.datasetVersionId, budgetUsdCents: dto.budgetUsdCents, resourceClass, hyperparameters, exportChecksum: checksum,
          members: { train: listed.filter((m) => m.split === "train").length, val: listed.filter((m) => m.split === "val").length }, labelWindows: labelled } },
      actor
    );
    return { jobId: job.id, datasetVersionId: dto.datasetVersionId, resourceClass, budgetUsdCents: dto.budgetUsdCents, hyperparameters, exportChecksum: checksum, labelWindows: labelled };
  }

  /**
   * A candidate version from a succeeded run: the weights, their checksum, the dataset
   * and the config come from the run; the commit and the licence position from a person.
   */
  async registerFromRun(
    modelId: string,
    dto: { jobId: string; version: string; gitCommit: string; licenceNote: string },
    actor?: AdminAuthContext
  ) {
    const model = await this.prisma.visionModel.findUnique({ where: { id: modelId }, select: { id: true, key: true, task: true } });
    if (!model) throw notFound("model", modelId);
    if (model.task !== "detect") {
      throw refusal(400, "ModelTaskUnsupported", `${model.key} is a ${model.task} model; a training run produces a detector.`, "Register the run under a detect model.");
    }
    const job = await this.prisma.visionJob.findUnique({ where: { id: dto.jobId }, select: { id: true, type: true, state: true, datasetVersionId: true, progress: true } });
    if (!job || job.type !== "train") throw notFound("training run", dto.jobId);
    if (job.state !== "succeeded") {
      throw new ConflictException({ statusCode: 409, error: "TrainingRunNotSucceeded", message: `This run is ${job.state}.`, remediation: "Register a run that succeeded." });
    }
    const progress = job.progress as { summary?: Record<string, unknown>; artifacts?: { role?: string; bucket?: string; key?: string }[]; workerImage?: unknown } | null;
    const summary = progress?.summary ?? {};
    const weights = progress?.artifacts?.find((a) => a.role === TRAIN_ARTIFACT_ROLES.weights && a.bucket === "models");
    const sha = summary.weightsSha256;
    const image = typeof progress?.workerImage === "string" ? progress.workerImage : null;
    if (!weights?.key || typeof sha !== "string" || !/^[a-f0-9]{64}$/i.test(sha) || summary.configKey !== TRAINED_DETECTOR_CONFIG || !job.datasetVersionId || !image) {
      throw new BadRequestException({ statusCode: 400, error: "TrainingRunIncomplete", message: "This run did not record its weights, checksum, config, dataset or image.",
        remediation: "Register a run from a worker of contract 1.23 or later." });
    }
    return this.models.registerVersion(
      model.id,
      { version: dto.version, gitCommit: dto.gitCommit, configKey: TRAINED_DETECTOR_CONFIG, workerImage: image, licenceNote: dto.licenceNote,
        datasetVersionId: job.datasetVersionId, weightsKey: weights.key, weightsChecksum: sha },
      actor
    );
  }

  private hyperparameters(raw?: Partial<TrainHyperparameters>): TrainHyperparameters {
    const merged = { ...TRAIN_DEFAULTS, ...(raw ?? {}) };
    for (const [name, [low, high]] of Object.entries(TRAIN_LIMITS) as [keyof typeof TRAIN_LIMITS, readonly [number, number]][]) {
      const value = merged[name];
      const whole = name !== "learningRate";
      if (typeof value !== "number" || !Number.isFinite(value) || value < low || value > high || (whole && !Number.isInteger(value))) {
        throw refusal(400, "TrainingHyperparametersInvalid", `${name} must be ${whole ? "a whole number" : "a number"} from ${low} to ${high}.`, "Leave it out for the default.");
      }
    }
    if (!Number.isSafeInteger(merged.seed)) throw refusal(400, "TrainingHyperparametersInvalid", "seed must be an integer.", "Leave it out for the default.");
    return merged;
  }
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
