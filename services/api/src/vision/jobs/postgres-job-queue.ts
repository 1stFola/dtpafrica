import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ACTIVE_JOB_STATES,
  VISION_CONTRACT_VERSION,
  VISION_RESOURCE_CLASSES,
  type VisionJobType,
  type VisionResourceClass,
} from "@dtp/vision-contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { VISION_CONFIG, type VisionConfig } from "../config/vision.config";
import { estimateUsdCents } from "../compute/resource-rates";
import {
  JobNotClaimableError,
  JobNotHeldByWorkerError,
  type ClaimedJob,
  type EnqueueJob,
  type JobQueue,
  type ReapResult,
} from "./job-queue";

type JobRow = {
  id: string;
  type: string;
  resource_class: string;
  attempt_number: number;
  input_spec: unknown;
  output_prefix: string;
  budget_seconds: number;
  budget_usd_cents: number;
  video_asset_id: string | null;
  dataset_version_id: string | null;
  model_version_id: string | null;
};

@Injectable()
export class PostgresJobQueue implements JobQueue {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VISION_CONFIG) private readonly config: VisionConfig
  ) {}

  async enqueue(job: EnqueueJob) {
    const created = await this.prisma.visionJob.create({
      data: {
        ...(job.id ? { id: job.id } : {}),
        type: job.type,
        resourceClass: job.resourceClass,
        state: "queued",
        priority: job.priority ?? 0,
        videoAssetId: job.videoAssetId ?? null,
        datasetVersionId: job.datasetVersionId ?? null,
        modelVersionId: job.modelVersionId ?? null,
        inputSpec: job.inputSpec as never,
        outputPrefix: job.outputPrefix,
        maxAttempts: job.maxAttempts ?? 3,
        budgetSeconds: job.budgetSeconds,
        budgetUsdCents: job.budgetUsdCents,
        contractVersion: VISION_CONTRACT_VERSION,
        createdBy: job.createdBy ?? null,
      },
      select: { id: true },
    });

    await this.event(created.id, "queued", { type: job.type, resourceClass: job.resourceClass });
    return created;
  }

  /**
   * `FOR UPDATE SKIP LOCKED` is what makes this safe with several workers polling
   * at once: each transaction takes a row lock on a different candidate instead
   * of queueing behind the same one.
   *
   * Ordered by priority then age, so a hand-raised job jumps the queue but two
   * jobs of equal priority stay first-in-first-out.
   */
  async claim(workerId: string, resourceClasses: VisionResourceClass[]): Promise<ClaimedJob | null> {
    if (!resourceClasses.length) return null;

    const rows = await this.prisma.$queryRaw<JobRow[]>`
      UPDATE vision_jobs SET
        state = 'claimed',
        claimed_at = now(),
        heartbeat_at = now(),
        worker_id = ${workerId}
      WHERE id = (
        SELECT id FROM vision_jobs
        WHERE state = 'queued'
          AND resource_class = ANY(${resourceClasses}::text[])
        ORDER BY priority DESC, queued_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, type, resource_class, attempt_number, input_spec, output_prefix,
                budget_seconds, budget_usd_cents, video_asset_id, dataset_version_id,
                model_version_id
    `;

    const row = rows[0];
    if (!row) return null;

    await this.event(row.id, "claimed", { workerId });

    return {
      id: row.id,
      type: row.type as VisionJobType,
      resourceClass: row.resource_class as VisionResourceClass,
      attemptNumber: row.attempt_number,
      inputSpec: (row.input_spec ?? {}) as Record<string, unknown>,
      outputPrefix: row.output_prefix,
      budgetSeconds: row.budget_seconds,
      budgetUsdCents: row.budget_usd_cents,
      videoAssetId: row.video_asset_id,
      datasetVersionId: row.dataset_version_id,
      modelVersionId: row.model_version_id,
    };
  }

  async markRunning(jobId: string, workerId: string) {
    await this.assertHeld(jobId, workerId);
    await this.prisma.visionJob.update({
      where: { id: jobId },
      data: { state: "running", startedAt: new Date(), heartbeatAt: new Date() },
    });
    await this.event(jobId, "running", { workerId });
  }

  async heartbeat(jobId: string, workerId: string, progress?: Record<string, unknown>) {
    await this.assertHeld(jobId, workerId);
    await this.prisma.visionJob.update({
      where: { id: jobId },
      data: {
        heartbeatAt: new Date(),
        ...(progress ? { progress: progress as never } : {}),
      },
    });
  }

  async succeed(
    jobId: string,
    workerId: string,
    idempotencyKey: string,
    summary: Record<string, unknown>
  ) {
    const job = await this.prisma.visionJob.findUnique({
      where: { id: jobId },
      select: { state: true, workerId: true, idempotencyKey: true },
    });
    if (!job) throw new JobNotClaimableError(jobId, "missing");

    // Retry-safe: a worker that completed, lost its network and retried must not
    // double-apply. The stored key is the proof it already landed.
    if (job.state === "succeeded" && job.idempotencyKey === idempotencyKey) {
      return { alreadyApplied: true };
    }
    if (!ACTIVE_JOB_STATES.includes(job.state as never)) {
      throw new JobNotClaimableError(jobId, job.state);
    }
    if (job.workerId !== workerId) throw new JobNotHeldByWorkerError(jobId, workerId);

    await this.prisma.visionJob.update({
      where: { id: jobId },
      data: {
        state: "succeeded",
        finishedAt: new Date(),
        idempotencyKey,
        progress: summary as never,
        // Prisma wants DbNull rather than null to clear a nullable Json column.
        error: Prisma.DbNull,
      },
    });
    await this.event(jobId, "succeeded", summary);
    return { alreadyApplied: false };
  }

  async fail(
    jobId: string,
    workerId: string | null,
    error: Record<string, unknown>,
    opts: { retryable?: boolean } = {}
  ) {
    const job = await this.prisma.visionJob.findUnique({
      where: { id: jobId },
      select: { state: true, workerId: true, attemptNumber: true, maxAttempts: true },
    });
    if (!job) throw new JobNotClaimableError(jobId, "missing");
    if (workerId !== null && job.workerId !== workerId) {
      throw new JobNotHeldByWorkerError(jobId, workerId);
    }

    const retryable = opts.retryable !== false;
    const attemptsLeft = job.attemptNumber < job.maxAttempts;
    const requeue = retryable && attemptsLeft;

    await this.prisma.visionJob.update({
      where: { id: jobId },
      data: requeue
        ? {
            // A retry is a new attempt, and writes to a new output prefix, so
            // nothing from the failed attempt is overwritten.
            state: "queued",
            attemptNumber: { increment: 1 },
            workerId: null,
            claimedAt: null,
            startedAt: null,
            heartbeatAt: null,
            error: error as never,
          }
        : { state: "failed", finishedAt: new Date(), workerId: null, error: error as never },
    });

    await this.event(jobId, requeue ? "requeued" : "failed", error);
    return { requeued: requeue };
  }

  async cancel(jobId: string, reason: string, actorId?: string | null) {
    const job = await this.prisma.visionJob.findUnique({
      where: { id: jobId },
      select: { state: true },
    });
    if (!job) throw new JobNotClaimableError(jobId, "missing");
    if (["succeeded", "failed", "cancelled"].includes(job.state)) {
      throw new JobNotClaimableError(jobId, job.state);
    }

    await this.prisma.visionJob.update({
      where: { id: jobId },
      data: {
        state: "cancelled",
        finishedAt: new Date(),
        workerId: null,
        error: { kind: "cancelled_by_operator", reason } as never,
      },
    });
    await this.event(jobId, "cancelled", { reason, actorId: actorId ?? null });
  }

  /**
   * Returns abandoned work to the queue.
   *
   * Two independent reasons a job stops being viable: its worker went away
   * (stale heartbeat), or it is still running but has outgrown its budget. Both
   * have to be caught by the control plane, because a wedged worker will not
   * report either.
   */
  async reap(now = new Date()): Promise<ReapResult> {
    const { heartbeatIntervalSeconds, missedHeartbeatsBeforeExpiry } = this.config.jobs;
    const staleBefore = new Date(
      now.getTime() - heartbeatIntervalSeconds * missedHeartbeatsBeforeExpiry * 1000
    );

    const candidates = await this.prisma.visionJob.findMany({
      where: { state: { in: ["claimed", "running"] } },
      select: {
        id: true,
        heartbeatAt: true,
        claimedAt: true,
        resourceClass: true,
        budgetSeconds: true,
        budgetUsdCents: true,
      },
    });

    const result: ReapResult = { requeued: [], failed: [] };

    for (const job of candidates) {
      const lastBeat = job.heartbeatAt ?? job.claimedAt;
      const elapsedSeconds = job.claimedAt
        ? Math.floor((now.getTime() - job.claimedAt.getTime()) / 1000)
        : 0;

      const overTime = elapsedSeconds > job.budgetSeconds;
      const overCost =
        estimateUsdCents(job.resourceClass as VisionResourceClass, elapsedSeconds) >
        job.budgetUsdCents;

      if (overTime || overCost) {
        // A budget breach is terminal, not retryable: running it again would
        // breach the same budget.
        const outcome = await this.fail(
          job.id,
          null,
          {
            kind: "budget_exceeded",
            elapsedSeconds,
            budgetSeconds: job.budgetSeconds,
            budgetUsdCents: job.budgetUsdCents,
            overTime,
            overCost,
          },
          { retryable: false }
        );
        (outcome.requeued ? result.requeued : result.failed).push(job.id);
        continue;
      }

      if (lastBeat && lastBeat < staleBefore) {
        const outcome = await this.fail(job.id, null, {
          kind: "heartbeat_lost",
          lastHeartbeatAt: lastBeat.toISOString(),
          staleAfterSeconds: heartbeatIntervalSeconds * missedHeartbeatsBeforeExpiry,
        });
        (outcome.requeued ? result.requeued : result.failed).push(job.id);
      }
    }

    return result;
  }

  async depth(): Promise<Record<VisionResourceClass, number>> {
    const grouped = await this.prisma.visionJob.groupBy({
      by: ["resourceClass"],
      where: { state: "queued" },
      _count: { _all: true },
    });

    const depth = Object.fromEntries(
      VISION_RESOURCE_CLASSES.map((c) => [c, 0])
    ) as Record<VisionResourceClass, number>;

    for (const row of grouped) {
      const key = row.resourceClass as VisionResourceClass;
      if (key in depth) depth[key] = row._count._all;
    }
    return depth;
  }

  private async assertHeld(jobId: string, workerId: string) {
    const job = await this.prisma.visionJob.findUnique({
      where: { id: jobId },
      select: { state: true, workerId: true },
    });
    if (!job) throw new JobNotClaimableError(jobId, "missing");
    if (!ACTIVE_JOB_STATES.includes(job.state as never)) {
      throw new JobNotClaimableError(jobId, job.state);
    }
    if (job.workerId !== workerId) throw new JobNotHeldByWorkerError(jobId, workerId);
  }

  private async event(jobId: string, kind: string, data?: Record<string, unknown>) {
    await this.prisma.visionJobEvent.create({
      data: { jobId, kind, data: (data ?? undefined) as never },
    });
  }
}
