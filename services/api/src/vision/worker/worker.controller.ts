import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  OUTPUT_BUCKET_BY_JOB_TYPE,
  VISION_CONTRACT_VERSION,
  isKeyUnderPrefix,
  type VisionJobSpec,
  type VisionJobType,
} from "@dtp/vision-contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { VISION_CONFIG, type VisionConfig } from "../config/vision.config";
import { JOB_QUEUE, type JobQueue } from "../jobs/job-queue";
import { VisionStageResultsService } from "../jobs/stage-results.service";
import { VisionModelsService } from "../models/models.service";
import { RightsPolicyService } from "../rights/rights-policy.service";
import { VisionAuditService } from "../audit/vision-audit.service";
import { OBJECT_STORE, type ObjectStore } from "../storage/object-store";
import { CompleteJobDto } from "./dto/complete-job.dto";
import { ClaimJobDto } from "./dto/claim-job.dto";
import { FailJobDto } from "./dto/fail-job.dto";
import { HeartbeatDto } from "./dto/heartbeat.dto";
import { InputUrlDto } from "./dto/input-url.dto";
import { PresignDto } from "./dto/presign.dto";
import { VisionWorkerBootstrapGuard, VisionWorkerGuard, type WorkerRequest } from "./vision-worker.guard";
import { WorkerTokenService } from "./worker-token.service";

/**
 * The worker-facing API.
 *
 * Workers pull; the control plane never pushes. A worker holds no storage
 * credential and no database connection — it asks for a presigned URL per output
 * object, and the control plane decides where that object may land.
 *
 * See docs/vision/06-JOBS-AND-COMPUTE.md and docs/vision/07-API-CONTRACTS.md.
 */
/** Stages whose terminal failure means the asset cannot be analysed at all. */
const INGEST_STAGES = ["probe", "fingerprint", "transcode"];

@Controller("vision/worker")
export class VisionWorkerController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkerTokenService) private readonly tokens: WorkerTokenService,
    @Inject(VisionStageResultsService) private readonly stageResults: VisionStageResultsService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(OBJECT_STORE) private readonly objectStore: ObjectStore,
    @Inject(VISION_CONFIG) private readonly config: VisionConfig,
    @Inject(VisionModelsService) private readonly models: VisionModelsService,
    @Inject(RightsPolicyService) private readonly rights: RightsPolicyService,
    @Inject(VisionAuditService) private readonly audit: VisionAuditService
  ) {}

  @Post("register")
  @UseGuards(VisionWorkerBootstrapGuard)
  async register(@Req() req: WorkerRequest) {
    const bootstrap = String(req.headers["x-vision-bootstrap-token"]).trim();
    const { identity, workerToken, expiresAt } = await this.tokens.register(bootstrap);

    return {
      workerId: identity.workerId,
      workerToken,
      expiresAt: expiresAt.toISOString(),
      resourceClasses: identity.resourceClasses,
      contractVersion: VISION_CONTRACT_VERSION,
      heartbeatIntervalSeconds: this.config.jobs.heartbeatIntervalSeconds,
      pollIntervalMs: Math.max(2000, this.config.jobs.heartbeatIntervalSeconds * 200),
    };
  }

  /**
   * Hand over one job, or 204 when there is nothing to do.
   *
   * A worker may only ask for classes it was registered for — otherwise a CPU
   * worker could claim GPU work and sit on it.
   */
  @Post("jobs/claim")
  @UseGuards(VisionWorkerGuard)
  async claim(@Req() req: WorkerRequest, @Body() dto: ClaimJobDto) {
    const auth = this.auth(req);

    const requested = dto.resourceClasses?.length ? dto.resourceClasses : auth.resourceClasses;
    const allowed = requested.filter((c) => auth.resourceClasses.includes(c));
    if (!allowed.length) {
      throw new ForbiddenException(
        `This worker is registered for ${auth.resourceClasses.join(", ")} and may not claim ${requested.join(", ")}`
      );
    }

    if (dto.contractVersion && dto.contractVersion !== VISION_CONTRACT_VERSION) {
      throw new BadRequestException(
        `Contract mismatch: worker speaks ${dto.contractVersion}, control plane speaks ${VISION_CONTRACT_VERSION}`
      );
    }

    const job = await this.queue.claim(auth.workerId, allowed);
    if (!job) return { job: null };

    // Rights were checked at enqueue, and a grant can be withdrawn while the job waits.
    // docs/vision/03 §Revocation, step 1: no new work on footage whose consent is gone.
    // The job fails for good, and the worker is told there is nothing for it this time.
    if (job.videoAssetId) {
      const decision = await this.rights.canAnalyze({ videoAssetId: job.videoAssetId });
      if (!decision.allowed) {
        await this.queue.fail(
          job.id,
          auth.workerId,
          { kind: "rights_revoked", reason: decision.reason, detail: decision.detail },
          { retryable: false }
        );
        return { job: null };
      }
    }

    await this.queue.markRunning(job.id, auth.workerId);

    const spec: VisionJobSpec = {
      contractVersion: VISION_CONTRACT_VERSION,
      jobId: job.id,
      type: job.type,
      resourceClass: job.resourceClass,
      attemptNumber: job.attemptNumber,
      inputs: {
        videoAssetId: job.videoAssetId ?? undefined,
        datasetVersionId: job.datasetVersionId ?? undefined,
        modelVersionIds: job.modelVersionId ? [job.modelVersionId] : undefined,
        readKeys: declaredKeys(job.inputSpec),
        params: job.inputSpec,
      },
      outputPrefix: job.outputPrefix,
      budget: {
        maxRuntimeSeconds: job.budgetSeconds,
        maxCostUsdCents: job.budgetUsdCents,
      },
      callbackBaseUrl: "/api/v1/vision/worker",
      heartbeatIntervalSeconds: this.config.jobs.heartbeatIntervalSeconds,
    };

    return { job: spec };
  }

  @Post("jobs/:id/heartbeat")
  @HttpCode(204)
  @UseGuards(VisionWorkerGuard)
  async heartbeat(
    @Req() req: WorkerRequest,
    @Param("id") jobId: string,
    @Body() dto: HeartbeatDto
  ) {
    const auth = this.auth(req);
    await this.queue.heartbeat(jobId, auth.workerId, dto.progress);
  }

  /**
   * Issue a write URL for one output object.
   *
   * This is the whole reason a worker needs no storage credential. The key is
   * validated against the job's own output prefix, so a compromised or buggy
   * worker cannot write outside its attempt — and in particular cannot reach the
   * master bucket, which holds irreplaceable source media.
   */
  @Post("jobs/:id/presign")
  @UseGuards(VisionWorkerGuard)
  async presign(@Req() req: WorkerRequest, @Param("id") jobId: string, @Body() dto: PresignDto) {
    const auth = this.auth(req);

    const job = await this.prisma.visionJob.findUnique({
      where: { id: jobId },
      select: { type: true, state: true, workerId: true, outputPrefix: true, attemptNumber: true },
    });
    if (!job) throw new NotFoundException(`Unknown job ${jobId}`);
    if (job.workerId !== auth.workerId) {
      throw new ForbiddenException("This worker does not hold that job");
    }
    if (!["claimed", "running"].includes(job.state)) {
      throw new ForbiddenException(`Job is ${job.state}; it may no longer write output`);
    }

    if (!isKeyUnderPrefix(dto.key, job.outputPrefix)) {
      throw new ForbiddenException(
        `Key must sit under this job's output prefix ${job.outputPrefix}`
      );
    }

    const bucket = OUTPUT_BUCKET_BY_JOB_TYPE[job.type as VisionJobType];
    if (!bucket) throw new BadRequestException(`No output bucket for job type ${job.type}`);

    const url = await this.objectStore.presignPut(
      bucket,
      dto.key,
      this.config.upload.partUrlTtlSeconds,
      { contentType: dto.contentType }
    );

    return { url, bucket, key: dto.key, expiresInSeconds: this.config.upload.partUrlTtlSeconds };
  }

  /**
   * Issue a read URL for one of the job's declared inputs.
   *
   * The worker asks for a ROLE, not a key. The control plane resolves it from the
   * job's own asset, so a worker cannot read an arbitrary object any more than it
   * can write one — asking for "source" gets you this job's source and nothing
   * else.
   */
  @Post("jobs/:id/input-url")
  @UseGuards(VisionWorkerGuard)
  async inputUrl(@Req() req: WorkerRequest, @Param("id") jobId: string, @Body() dto: InputUrlDto) {
    const auth = this.auth(req);

    const job = await this.prisma.visionJob.findUnique({
      where: { id: jobId },
      select: { type: true, state: true, workerId: true, videoAssetId: true, inputSpec: true },
    });
    if (!job) throw new NotFoundException(`Unknown job ${jobId}`);
    if (job.workerId !== auth.workerId) {
      throw new ForbiddenException("This worker does not hold that job");
    }
    if (!["claimed", "running"].includes(job.state)) {
      throw new ForbiddenException(`Job is ${job.state}; it may no longer read inputs`);
    }

    // A declared key: one the job listed when it was queued, and nothing else. The
    // list is on the job row, written by the control plane, never by the request.
    if (dto.role === "declared") {
      if (!dto.key) throw new BadRequestException("The declared role needs a key");
      const allowed = declaredKeys(job.inputSpec as Record<string, unknown>) ?? [];
      const match = allowed.find((k) => k.key === dto.key);
      if (!match) {
        throw new ForbiddenException(
          `Key ${dto.key} is not among the ${allowed.length} object(s) this job declared it may read`
        );
      }
      const url = await this.objectStore.presignGet(match.bucket, match.key, this.config.playback.urlTtlSeconds);
      return {
        url,
        bucket: match.bucket,
        key: match.key,
        role: dto.role,
        expiresInSeconds: this.config.playback.urlTtlSeconds,
      };
    }

    if (!job.videoAssetId) {
      throw new BadRequestException("This job has no video asset to read");
    }

    const asset = await this.prisma.visionVideoAsset.findUnique({
      where: { id: job.videoAssetId },
      select: { id: true, objectKey: true, mimeType: true },
    });
    if (!asset) throw new NotFoundException("The job's video asset no longer exists");

    // Roles resolve to keys here, from the asset's rows. Never from the request.
    //
    // The proxy is wherever transcode actually wrote it: under that job's own output
    // prefix, recorded as the asset's newest proxy variant. This used to hand out the
    // fixed `visionKeys.proxy(asset.id)`, a key nothing writes, so detect, cuts and
    // identify were given a URL to an object that does not exist (docs/vision/50, C2).
    let ref: { bucket: "master" | "derived"; key: string };
    if (dto.role === "source") {
      // The master is irreplaceable source media. Only the stages that make the proxy
      // from it read it, and every read is on the audit trail (docs/vision/50, PR-4).
      if (!INGEST_STAGES.includes(job.type)) {
        throw new ForbiddenException(
          `A ${job.type} job reads the proxy, not the master; only ${INGEST_STAGES.join(", ")} may read the source`
        );
      }
      const decision = await this.rights.canAnalyze({ videoAssetId: asset.id });
      if (!decision.allowed) {
        throw new ForbiddenException({
          statusCode: 403,
          error: "RightsDenied",
          message: decision.detail,
          reason: decision.reason,
          remediation: decision.remediation,
        });
      }
      ref = { bucket: "master", key: asset.objectKey };
      await this.audit.record({
        action: "media.raw.read",
        targetKind: "vision_video_asset",
        targetId: asset.id,
        reason: `${job.type} job ${jobId}, attempt read by worker ${auth.workerId}`,
        data: { jobId, workerId: auth.workerId, jobType: job.type },
      });
    } else {
      const proxy = await this.prisma.visionVideoVariant.findFirst({
        where: { videoAssetId: asset.id, kind: "proxy" },
        orderBy: { createdAt: "desc" },
        select: { objectKey: true },
      });
      if (!proxy) {
        throw new ConflictException({
          statusCode: 409,
          error: "ProxyNotTranscoded",
          message: "This job's video asset has no proxy yet.",
          remediation: "Run the transcode stage for the asset first, then retry this job.",
        });
      }
      ref = { bucket: "derived", key: proxy.objectKey };
    }

    const url = await this.objectStore.presignGet(
      ref.bucket,
      ref.key,
      this.config.playback.urlTtlSeconds
    );

    return {
      url,
      bucket: ref.bucket,
      key: ref.key,
      role: dto.role,
      expiresInSeconds: this.config.playback.urlTtlSeconds,
    };
  }

  @Post("jobs/:id/complete")
  @UseGuards(VisionWorkerGuard)
  async complete(
    @Req() req: WorkerRequest,
    @Param("id") jobId: string,
    @Body() dto: CompleteJobDto
  ) {
    const auth = this.auth(req);

    const job = await this.prisma.visionJob.findUnique({
      where: { id: jobId },
      select: {
        outputPrefix: true,
        type: true,
        videoAssetId: true,
        modelVersionId: true,
        datasetVersionId: true,
        inputSpec: true,
      },
    });
    if (!job) throw new NotFoundException(`Unknown job ${jobId}`);

    // Re-validate every artifact path. A worker reporting an artifact it was
    // never allowed to write is either broken or lying; either way the control
    // plane must not record the claim.
    const stray = (dto.artifacts ?? []).find((a) => !isKeyUnderPrefix(a.key, job.outputPrefix));
    if (stray) {
      throw new ForbiddenException(
        `Artifact ${stray.key} is outside this job's output prefix ${job.outputPrefix}`
      );
    }
    // The bucket too. Presign only ever wrote to this job type's output bucket, and the
    // projections downstream select artifacts by bucket, so a reported bucket that
    // differs is a claim about an object this worker could not have written.
    const expectedBucket = OUTPUT_BUCKET_BY_JOB_TYPE[job.type as VisionJobType];
    const misfiled = (dto.artifacts ?? []).find((a) => a.bucket !== expectedBucket);
    if (misfiled) {
      throw new ForbiddenException(
        `Artifact ${misfiled.key} names bucket ${misfiled.bucket}; ${job.type} writes only to ${expectedBucket}`
      );
    }

    // Same category as a stray artifact, checked at the same door: a completion that
    // names a different model version than the job was dispatched with, or weights
    // that differ from the ones the version is pinned to, is refused before the job
    // can succeed. The worker then fails the job, and a stage that cannot attribute
    // its own output does not get to count as done.
    const provenance = await this.models.verifyCompletion(
      { id: jobId, type: job.type as VisionJobType, modelVersionId: job.modelVersionId },
      { modelVersionIds: dto.modelVersionIds ?? [], summary: dto.summary ?? {} }
    );
    if (!provenance.ok) {
      throw new ForbiddenException({
        statusCode: 403,
        error: provenance.error,
        message: provenance.message,
        detail: provenance.detail,
      });
    }

    const outcome = await this.queue.succeed(jobId, auth.workerId, dto.idempotencyKey, {
      artifacts: dto.artifacts ?? [],
      summary: dto.summary ?? {},
      workerImage: dto.workerImage ?? null,
      modelVersionIds: dto.modelVersionIds ?? [],
    });

    // Only on the first application: a retried completion must not re-cluster an
    // asset or duplicate its variants.
    let applied: { applied: boolean; detail: string } | null = null;
    if (!outcome.alreadyApplied) {
      if (dto.cost) await this.recordCost(jobId, dto);

      // The first run of a version pins it to the weights that actually ran. Done
      // after the job has succeeded, so a refused completion records nothing.
      if (provenance.weights.outcome === "recorded" && provenance.modelVersionId) {
        const pinned = await this.models.recordWeightsChecksum(
          provenance.modelVersionId,
          provenance.weights.sha256
        );
        await this.prisma.visionJobEvent.create({
          data: {
            jobId,
            kind: pinned ? "weights_checksum_recorded" : "weights_checksum_already_pinned",
            message: `model version ${provenance.modelVersionId} ${
              pinned ? "pinned to" : "was already pinned when this run reported"
            } sha256 ${provenance.weights.sha256}`,
            data: { modelVersionId: provenance.modelVersionId, sha256: provenance.weights.sha256 } as never,
          },
        });
      }

      applied = await this.stageResults.apply(
        job.type as VisionJobType,
        job.videoAssetId,
        {
          artifacts: (dto.artifacts ?? []).map((a) => ({
            key: a.key,
            bucket: a.bucket,
            bytes: a.bytes,
            contentType: a.contentType,
            role: a.role,
          })),
          summary: dto.summary ?? {},
        },
        {
          jobId,
          modelVersionId: job.modelVersionId,
          datasetVersionId: job.datasetVersionId,
          inputSpec: (job.inputSpec ?? {}) as Record<string, unknown>,
        }
      );
    }

    return { ok: true, alreadyApplied: outcome.alreadyApplied, applied };
  }

  @Post("jobs/:id/fail")
  @UseGuards(VisionWorkerGuard)
  async fail(@Req() req: WorkerRequest, @Param("id") jobId: string, @Body() dto: FailJobDto) {
    const auth = this.auth(req);
    const job = await this.prisma.visionJob.findUnique({
      where: { id: jobId },
      select: { type: true, videoAssetId: true, inputSpec: true },
    });

    const outcome = await this.queue.fail(
      jobId,
      auth.workerId,
      { kind: "worker_reported", reason: dto.reason, detail: dto.detail ?? null },
      { retryable: dto.retryable !== false }
    );

    // Only once the job is genuinely finished — a requeued attempt may still
    // succeed, and marking the asset failed in between would be misleading.
    if (!outcome.requeued && job?.videoAssetId && INGEST_STAGES.includes(job.type)) {
      await this.stageResults.markIngestFailed(
        job.videoAssetId,
        `${job.type} failed: ${dto.reason}`
      );
    }
    if (!outcome.requeued && job?.type === "benchmark") {
      await this.stageResults.markBenchmarkFailed(
        (job.inputSpec ?? null) as Record<string, unknown> | null,
        `benchmark failed: ${dto.reason}${dto.detail ? ` -- ${dto.detail.slice(0, 500)}` : ""}`
      );
    }

    return { ok: true, requeued: outcome.requeued };
  }

  private auth(req: WorkerRequest) {
    if (!req.workerAuth) throw new ForbiddenException("Worker identity missing");
    return req.workerAuth;
  }

  private async recordCost(jobId: string, dto: CompleteJobDto) {
    const cost = dto.cost;
    if (!cost) return;

    // `estimatedUsdCents` is left to the dispatcher, which knows the provider's
    // configured rate. The worker reports what it consumed, not what it cost.
    await this.prisma.visionJobCost.upsert({
      where: { jobId },
      create: {
        jobId,
        gpuSeconds: cost.gpuSeconds ?? 0,
        cpuSeconds: cost.cpuSeconds ?? 0,
        wallClockSeconds: cost.wallClockSeconds ?? 0,
        bytesRead: BigInt(cost.bytesRead ?? 0),
        bytesWritten: BigInt(cost.bytesWritten ?? 0),
        classAOperations: cost.classAOperations ?? 0,
        classBOperations: cost.classBOperations ?? 0,
        thirdPartyApiCostCents: cost.thirdPartyApiCostUsdCents ?? 0,
      },
      update: {},
    });
  }
}

/** The objects a job declared it may read, as the control plane wrote them. */
function declaredKeys(
  inputSpec: Record<string, unknown> | null | undefined
): { bucket: "derived" | "models"; key: string }[] | undefined {
  const raw = inputSpec?.readKeys;
  if (!Array.isArray(raw)) return undefined;
  const keys: { bucket: "derived" | "models"; key: string }[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { bucket, key } = entry as { bucket?: unknown; key?: unknown };
    if ((bucket === "derived" || bucket === "models") && typeof key === "string" && key) {
      keys.push({ bucket, key });
    }
  }
  return keys;
}
