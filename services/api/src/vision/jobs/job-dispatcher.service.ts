import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionUploadService } from "../assets/upload.service";
import { VISION_CONFIG, type VisionConfig } from "../config/vision.config";
import { JOB_QUEUE, type JobQueue } from "./job-queue";

/**
 * The dispatcher: the one thing in Vision that runs on its own.
 *
 * Two jobs, both of which exist because the thing that should report a problem is
 * exactly the thing that has gone away:
 *
 *   - **Reap abandoned work.** A worker whose pod was killed never reports a
 *     failure, so its job would sit `running` forever and the match would never
 *     be analysed. Also enforces budgets, because a wedged worker will not notice
 *     it has outgrown its own.
 *   - **Expire stale upload sessions.** An abandoned multipart upload is billed
 *     indefinitely by the object store and appears in no listing.
 *
 * Deliberately a timer inside the API process rather than a separate container:
 * a 2 GB box already running Postgres, the API and nginx does not need another
 * Node process to run two queries a minute. It becomes its own container when it
 * needs independent scaling — see docs/vision/01-ARCHITECTURE.md.
 *
 * **Single-instance assumption.** With more than one API replica, every replica
 * would reap. That is not harmful today — the operations are idempotent and
 * transactional — but it is wasteful, and a leader lock is the right answer before
 * scaling out. Recorded rather than guessed at.
 */
export type DispatcherStats = {
  ticks: number;
  requeued: number;
  failed: number;
  sessionsExpired: number;
  errors: number;
};

@Injectable()
export class VisionJobDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(VisionJobDispatcher.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  /** Counters, so the ops dashboard can show the dispatcher is alive. */
  readonly stats: DispatcherStats = {
    ticks: 0,
    requeued: 0,
    failed: 0,
    sessionsExpired: 0,
    errors: 0,
  };

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(VisionUploadService) private readonly uploads: VisionUploadService,
    @Inject(VISION_CONFIG) private readonly config: VisionConfig
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.log.log("Vision is disabled; dispatcher not started");
      return;
    }

    // Once per heartbeat interval is enough: a job is only reaped after several
    // missed heartbeats, so checking more often finds nothing new.
    const intervalMs = Math.max(10_000, this.config.jobs.heartbeatIntervalSeconds * 1000);
    this.timer = setInterval(() => void this.tick(), intervalMs);
    // Node would keep the process alive for this timer alone, which would stop
    // the API shutting down cleanly.
    this.timer.unref();
    this.log.log(`dispatcher started, every ${Math.round(intervalMs / 1000)}s`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One pass. Public so a test — or an operator endpoint — can run it
   * deterministically instead of waiting for a timer.
   */
  async tick(): Promise<{ requeued: string[]; failed: string[]; sessionsExpired: string[] }> {
    // A slow pass must not overlap the next tick and double-reap.
    if (this.running) {
      return { requeued: [], failed: [], sessionsExpired: [] };
    }
    this.running = true;
    this.stats.ticks += 1;

    const result = { requeued: [] as string[], failed: [] as string[], sessionsExpired: [] as string[] };

    try {
      const reaped = await this.queue.reap();
      result.requeued = reaped.requeued;
      result.failed = reaped.failed;
      this.stats.requeued += reaped.requeued.length;
      this.stats.failed += reaped.failed.length;

      if (reaped.requeued.length || reaped.failed.length) {
        this.log.warn(
          `reaped ${reaped.requeued.length} requeued, ${reaped.failed.length} failed`
        );
      }
    } catch (error) {
      // One failing pass must not stop the timer: the next tick should try again.
      this.stats.errors += 1;
      this.log.error(`reap failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const expired = await this.uploads.expireStale();
      result.sessionsExpired = expired.expired;
      this.stats.sessionsExpired += expired.expired.length;
      if (expired.expired.length) {
        this.log.warn(`expired ${expired.expired.length} stale upload session(s)`);
      }
    } catch (error) {
      this.stats.errors += 1;
      this.log.error(
        `expiring upload sessions failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.running = false;
    }

    return result;
  }

  /** For the ops dashboard: is anything stuck, and is the dispatcher running? */
  async health(): Promise<{
    dispatcherRunning: boolean;
    stats: DispatcherStats;
    oldestQueuedAgeSeconds: number | null;
    staleHeartbeats: number;
  }> {
    const oldest = await this.prisma.visionJob.findFirst({
      where: { state: "queued" },
      orderBy: { queuedAt: "asc" },
      select: { queuedAt: true },
    });

    const staleBefore = new Date(
      Date.now() -
        this.config.jobs.heartbeatIntervalSeconds *
          this.config.jobs.missedHeartbeatsBeforeExpiry *
          1000
    );
    const staleHeartbeats = await this.prisma.visionJob.count({
      where: { state: { in: ["claimed", "running"] }, heartbeatAt: { lt: staleBefore } },
    });

    return {
      dispatcherRunning: this.timer !== null,
      stats: this.stats,
      oldestQueuedAgeSeconds: oldest
        ? Math.floor((Date.now() - oldest.queuedAt.getTime()) / 1000)
        : null,
      staleHeartbeats,
    };
  }
}
