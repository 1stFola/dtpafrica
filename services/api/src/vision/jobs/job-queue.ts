import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { VisionJobType, VisionResourceClass } from "@dtp/vision-contracts";

/**
 * The queue port.
 *
 * V1 is Postgres with `SELECT … FOR UPDATE SKIP LOCKED`, because job state has to
 * be transactionally consistent with rights, assets and review decisions — which
 * all live in the same database — and a 2 GB control plane does not need another
 * broker for a handful of concurrent matches.
 *
 * This interface exists so that moving to Redis/BullMQ, when sustained
 * concurrency actually justifies it, is a swap rather than a rewrite. The
 * trigger is measured queue latency, not a hunch. See
 * docs/vision/06-JOBS-AND-COMPUTE.md.
 */

export type EnqueueJob = {
  /**
   * Supplied by the caller when the id is needed before insert — the output
   * prefix is derived from it, so an operator reading an artifact key can find
   * the job that produced it.
   */
  id?: string;
  type: VisionJobType;
  resourceClass: VisionResourceClass;
  priority?: number;
  videoAssetId?: string | null;
  datasetVersionId?: string | null;
  modelVersionId?: string | null;
  inputSpec: Record<string, unknown>;
  outputPrefix: string;
  budgetSeconds: number;
  budgetUsdCents: number;
  maxAttempts?: number;
  createdBy?: string | null;
};

export type ClaimedJob = {
  id: string;
  type: VisionJobType;
  resourceClass: VisionResourceClass;
  attemptNumber: number;
  inputSpec: Record<string, unknown>;
  outputPrefix: string;
  budgetSeconds: number;
  budgetUsdCents: number;
  videoAssetId: string | null;
  datasetVersionId: string | null;
  modelVersionId: string | null;
};

export type ReapResult = {
  /** Jobs whose heartbeat went stale and were returned to the queue. */
  requeued: string[];
  /** Jobs that had no attempts left, or blew their budget. */
  failed: string[];
};

export interface JobQueue {
  enqueue(job: EnqueueJob): Promise<{ id: string }>;

  /**
   * Atomically hand one queued job to a worker.
   *
   * Returns null when nothing matches — the worker then waits and asks again.
   * Never blocks: a long poll on a 2 vCPU box holding a database connection open
   * is a worse trade than a short sleep on the worker.
   */
  /**
   * The next queued job of one of these resource classes, and, when `jobTypes` is
   * given, of one of those types: the stages the claiming worker's contract version
   * can serve. A job of another type stays queued for a worker that can.
   */
  claim(workerId: string, resourceClasses: VisionResourceClass[], jobTypes?: readonly VisionJobType[]): Promise<ClaimedJob | null>;

  heartbeat(jobId: string, workerId: string, progress?: Record<string, unknown>): Promise<void>;

  markRunning(jobId: string, workerId: string): Promise<void>;

  /** Idempotent: a repeat with the same key returns without re-applying. */
  succeed(
    jobId: string,
    workerId: string,
    idempotencyKey: string,
    summary: Record<string, unknown>
  ): Promise<{ alreadyApplied: boolean }>;

  fail(
    jobId: string,
    workerId: string | null,
    error: Record<string, unknown>,
    opts?: { retryable?: boolean }
  ): Promise<{ requeued: boolean }>;

  cancel(jobId: string, reason: string, actorId?: string | null): Promise<void>;

  /** Returns stale-heartbeat and over-budget jobs to the queue or fails them. */
  reap(now?: Date): Promise<ReapResult>;

  depth(): Promise<Record<VisionResourceClass, number>>;
}

export const JOB_QUEUE = Symbol("JOB_QUEUE");

/**
 * The job has moved on: finished, cancelled, or requeued since the caller last looked.
 * A 409 with the refusal shape, so a worker can tell "you lost this job" from a fault
 * and stop work on it, instead of reading a 500 and retrying (docs/vision/50, PR-3).
 */
export class JobNotClaimableError extends ConflictException {
  constructor(jobId: string, state: string) {
    super({
      statusCode: 409,
      error: "JobNotClaimable",
      message: `Job ${jobId} is ${state} and cannot be acted on.`,
      remediation: "Stop work on this job. It is no longer yours to report on.",
      state,
    });
    this.name = "JobNotClaimableError";
  }
}

/** Another worker holds the job, or none does. A 403 with the refusal shape. */
export class JobNotHeldByWorkerError extends ForbiddenException {
  constructor(jobId: string, workerId: string) {
    super({
      statusCode: 403,
      error: "JobNotHeldByWorker",
      message: `Worker ${workerId} does not hold job ${jobId}.`,
      remediation: "Stop work on this job; it was reaped or handed to another worker.",
    });
    this.name = "JobNotHeldByWorkerError";
  }
}
