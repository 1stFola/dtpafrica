import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import {
  DEFAULT_RESOURCE_CLASS,
  JOB_TYPE_PREREQUISITES,
  visionKeys,
  type VisionJobType,
  type VisionResourceClass,
} from "@dtp/vision-contracts";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionAuditService } from "../audit/vision-audit.service";
import { VISION_CONFIG, type VisionConfig } from "../config/vision.config";
import { VisionModelsService } from "../models/models.service";
import { RightsPolicyService } from "../rights/rights-policy.service";
import { JOB_QUEUE, type JobQueue } from "./job-queue";

/**
 * Job orchestration.
 *
 * Owns the two things the queue deliberately does not: whether a job is *allowed*
 * to run, and whether its inputs exist yet.
 */
@Injectable()
export class VisionJobsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RightsPolicyService) private readonly rights: RightsPolicyService,
    @Inject(VisionAuditService) private readonly audit: VisionAuditService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(VISION_CONFIG) private readonly config: VisionConfig,
    @Inject(VisionModelsService) private readonly models: VisionModelsService
  ) {}

  /**
   * Queue a job against a video asset.
   *
   * Three gates, in this order, because the cheapest refusal should come first
   * and the rights check must never be skippable:
   *
   *   1. the asset exists and is linked to a fixture
   *   2. `canAnalyze` is granted right now
   *   3. every prerequisite stage has already succeeded
   *
   * Then two resolutions, so the worker receives what it cannot work out alone:
   * the one model version a model-bound job must run, and the proxy's clock for any
   * stage that reads the proxy. Both are written into the job here, at enqueue,
   * because a worker sees a presigned URL and a job id -- it cannot ask which model
   * the operator meant, or what a trimmed proxy's source offset is.
   */
  async enqueueForAsset(
    params: {
      type: VisionJobType;
      videoAssetId: string;
      resourceClass?: VisionResourceClass;
      priority?: number;
      params?: Record<string, unknown>;
      budgetSeconds?: number;
      budgetUsdCents?: number;
      /** For a model-bound job type. Omitted, the production version for the task is used. */
      modelVersionId?: string;
    },
    actor?: AdminAuthContext
  ): Promise<{ id: string }> {
    const asset = await this.prisma.visionVideoAsset.findUnique({
      where: { id: params.videoAssetId },
      select: { id: true, sbMatchId: true, ingestState: true },
    });
    if (!asset) throw new BadRequestException(`Unknown video asset ${params.videoAssetId}`);

    // Inference against footage nobody has linked to a fixture produces evidence
    // that cannot be attributed to anything.
    const needsMatch = params.type !== "probe" && params.type !== "fingerprint";
    if (needsMatch && !asset.sbMatchId) {
      throw new BadRequestException(
        `Asset ${asset.id} is not linked to a match yet. Link it before queueing ${params.type}.`
      );
    }

    const decision = await this.rights.canAnalyze({ videoAssetId: asset.id });
    if (!decision.allowed) {
      throw new ForbiddenException({
        statusCode: 403,
        error: "RightsDenied",
        message: `Analysis rights are not granted for this source.`,
        reason: decision.reason,
        assetId: asset.id,
        remediation: decision.remediation,
      });
    }

    await this.assertPrerequisitesMet(params.type, asset.id);

    const model = await this.models.resolveForJob(params.type, params.modelVersionId);
    const proxy = JOB_TYPE_PREREQUISITES[params.type].includes("transcode")
      ? await this.proxyClock(asset.id)
      : null;

    const resourceClass = params.resourceClass ?? DEFAULT_RESOURCE_CLASS[params.type];

    // The id is generated here so the output prefix can be derived from it in the
    // same insert: an artifact key then names the job that produced it, with no
    // second write to correct.
    const id = randomUUID();
    const created = await this.queue.enqueue({
      id,
      type: params.type,
      resourceClass,
      priority: params.priority,
      videoAssetId: asset.id,
      modelVersionId: model?.id ?? null,
      // The clock is spread last so a caller's `params.proxy` cannot forge it.
      inputSpec: { videoAssetId: asset.id, ...(params.params ?? {}), ...(proxy ? { proxy } : {}) },
      // Attempt 1 by construction; a retry writes to its own attempt prefix.
      outputPrefix: visionKeys.inferencePrefix(id, 1),
      budgetSeconds: params.budgetSeconds ?? this.config.jobs.defaultBudgetSeconds,
      budgetUsdCents: params.budgetUsdCents ?? this.config.jobs.defaultBudgetUsdCents,
      createdBy: actor?.userId ?? null,
    });

    await this.audit.record(
      {
        action: "job.queued",
        targetKind: "vision_job",
        targetId: created.id,
        data: {
          type: params.type,
          resourceClass,
          videoAssetId: asset.id,
          modelVersionId: model?.id ?? null,
        },
      },
      actor
    );

    return created;
  }

  /**
   * The proxy's constant frame rate and source offset, from the variant row.
   *
   * Refused rather than defaulted when the proxy records no frame rate: a guessed
   * rate produces frame indices that look precise and are wrong, which is the same
   * refusal the dataset export makes (`proxy_without_fps`).
   */
  private async proxyClock(videoAssetId: string): Promise<{ fps: number; sourceOffsetMs: number }> {
    const proxy = await this.prisma.visionVideoVariant.findFirst({
      where: { videoAssetId, kind: "proxy" },
      orderBy: { createdAt: "desc" },
      select: { fps: true, sourceOffsetMs: true },
    });
    if (!proxy) {
      throw new ConflictException({
        statusCode: 409,
        error: "ProxyMissing",
        message: "transcode succeeded for this asset but no proxy variant is recorded.",
        remediation: "Re-run transcode so the variant row is written.",
      });
    }
    if (proxy.fps === null || !(proxy.fps > 0)) {
      throw new ConflictException({
        statusCode: 409,
        error: "ProxyWithoutFps",
        message: "The proxy records no frame rate, so no stage can map its frames to time.",
        remediation: "Re-run transcode; the worker reports the proxy's frame rate.",
      });
    }
    return { fps: proxy.fps, sourceOffsetMs: proxy.sourceOffsetMs };
  }

  /**
   * Queue a job that has no asset: a benchmark, later a training run.
   *
   * No rights check here, deliberately. Rights are per asset, and the asset-level
   * decisions were taken when the detect jobs this consumes were queued and when
   * the dataset was frozen; the caller (`VisionBenchmarksService`) re-checks the
   * dataset's revocation flag. What this does guard is the contract: the type must
   * be one that exists, and the model version, when given, must be real.
   */
  async enqueueDetached(
    params: {
      type: VisionJobType;
      datasetVersionId: string;
      modelVersionId?: string | null;
      params: Record<string, unknown>;
      priority?: number;
      budgetSeconds?: number;
      budgetUsdCents?: number;
    },
    actor?: AdminAuthContext
  ): Promise<{ id: string }> {
    if (JOB_TYPE_PREREQUISITES[params.type].length) {
      throw new BadRequestException(
        `${params.type} depends on other stages for an asset; queue it with POST /vision/jobs instead.`
      );
    }
    const id = randomUUID();
    const created = await this.queue.enqueue({
      id,
      type: params.type,
      resourceClass: DEFAULT_RESOURCE_CLASS[params.type],
      priority: params.priority,
      videoAssetId: null,
      datasetVersionId: params.datasetVersionId,
      modelVersionId: params.modelVersionId ?? null,
      inputSpec: params.params,
      outputPrefix: visionKeys.inferencePrefix(id, 1),
      budgetSeconds: params.budgetSeconds ?? this.config.jobs.defaultBudgetSeconds,
      budgetUsdCents: params.budgetUsdCents ?? this.config.jobs.defaultBudgetUsdCents,
      createdBy: actor?.userId ?? null,
    });
    await this.audit.record(
      {
        action: "job.queued",
        targetKind: "vision_job",
        targetId: created.id,
        data: {
          type: params.type,
          resourceClass: DEFAULT_RESOURCE_CLASS[params.type],
          datasetVersionId: params.datasetVersionId,
          modelVersionId: params.modelVersionId ?? null,
        },
      },
      actor
    );
    return created;
  }

  async retry(jobId: string, actor?: AdminAuthContext) {
    const job = await this.prisma.visionJob.findUnique({
      where: { id: jobId },
      select: { state: true, attemptNumber: true, maxAttempts: true },
    });
    if (!job) throw new BadRequestException(`Unknown job ${jobId}`);
    if (!["failed", "cancelled", "expired"].includes(job.state)) {
      throw new BadRequestException(`Job is ${job.state}; only a finished job can be retried.`);
    }

    await this.prisma.visionJob.update({
      where: { id: jobId },
      data: {
        state: "queued",
        attemptNumber: { increment: 1 },
        workerId: null,
        claimedAt: null,
        startedAt: null,
        heartbeatAt: null,
        finishedAt: null,
        // A retry gets its own prefix, so the failed attempt's artifacts survive
        // for debugging rather than being overwritten.
        outputPrefix: visionKeys.inferencePrefix(jobId, job.attemptNumber + 1),
      },
    });
    await this.prisma.visionJobEvent.create({
      data: { jobId, kind: "retried", data: { by: actor?.userId ?? null } as never },
    });
  }

  async cancel(jobId: string, reason: string, actor?: AdminAuthContext) {
    await this.queue.cancel(jobId, reason, actor?.userId ?? null);
    await this.audit.record(
      { action: "job.cancelled", targetKind: "vision_job", targetId: jobId, data: { reason } },
      actor
    );
  }

  /**
   * Refuses to queue a stage whose inputs do not exist yet.
   *
   * Without this, a `track` job would claim, fail to find detections, and burn an
   * attempt — or worse, a GPU minute.
   */
  private async assertPrerequisitesMet(type: VisionJobType, videoAssetId: string) {
    const required = JOB_TYPE_PREREQUISITES[type];
    if (!required.length) return;

    const satisfied = await this.prisma.visionJob.findMany({
      where: { videoAssetId, type: { in: [...required] }, state: "succeeded" },
      select: { type: true },
    });
    const done = new Set(satisfied.map((j) => j.type));
    const missing = required.filter((r) => !done.has(r));

    if (missing.length) {
      throw new BadRequestException(
        `${type} needs ${missing.join(" and ")} to have succeeded for this asset first.`
      );
    }
  }
}
