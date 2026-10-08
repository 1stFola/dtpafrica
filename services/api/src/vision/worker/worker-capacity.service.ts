import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { VisionAuditService, type VisionAuditActor } from "../audit/vision-audit.service";
import { COMPUTE_PROVIDER_REGISTRY, type ComputeProviderRegistry } from "../compute/compute-provider";
import { WorkerTokenService } from "./worker-token.service";

/** Providers that start nothing: an operator runs the container, or nothing runs at all. */
export const SELF_STARTED_PROVIDERS: readonly string[] = ["local", "mock"];

/**
 * How long a registered hosted worker may hold no job before its pod is stopped. The
 * worker quits after two idle minutes of its own, but a provider restarts a container
 * that exits, so the pod would bill on; this is that idle period with room to spare.
 */
export const HOSTED_IDLE_GRACE_MS = 5 * 60 * 1000;

/**
 * How long a hosted pod may take to register at all. A cold pull of the GPU image is
 * several minutes; a pod that has not registered after this never will (a bad image, a
 * callback it cannot reach) and would otherwise bill until someone noticed.
 */
export const HOSTED_REGISTER_GRACE_MS = 20 * 60 * 1000;

type WorkerRow = { id: string; providerId: string; providerRef: string | null; resourceClass: string; retiredAt: Date | null };
export type StopReason = "operator" | "launch_failed" | "idle" | "never_registered";

/**
 * Ending a worker means ending what it costs. Nothing else in the control plane calls a
 * provider's `terminate`, and the worker cannot stop its own pod, so retiring a hosted
 * worker without this left the pod running and billing.
 */
@Injectable()
export class WorkerCapacityService {
  private readonly log = new Logger(WorkerCapacityService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkerTokenService) private readonly tokens: WorkerTokenService,
    @Inject(COMPUTE_PROVIDER_REGISTRY) private readonly compute: ComputeProviderRegistry,
    @Inject(VisionAuditService) private readonly audit: VisionAuditService
  ) {}

  /**
   * Terminates the worker's pod, if a provider launched one, then retires the worker.
   * Termination comes first: a retired row whose pod still runs is the bill this exists
   * to stop, and a provider's terminate is idempotent, so stopping twice is safe.
   */
  async stop(worker: WorkerRow, reason: StopReason, actor: VisionAuditActor | null): Promise<{ terminated: boolean }> {
    const hosted = !SELF_STARTED_PROVIDERS.includes(worker.providerId) && worker.providerRef !== null;
    if (hosted) await this.compute.get(worker.providerId).terminate(worker.providerRef!);
    await this.tokens.retire(worker.id);
    await this.audit.record(
      {
        action: "worker.retired",
        targetKind: "vision_worker",
        targetId: worker.id,
        data: { providerId: worker.providerId, resourceClass: worker.resourceClass, alreadyRetired: worker.retiredAt !== null, reason, terminated: hosted },
      },
      actor
    );
    return { terminated: hosted };
  }

  /**
   * Stops hosted pods that hold no job and have gone quiet, or never came up. Run from
   * the dispatcher's pass. One worker's failure is logged and the rest still checked.
   */
  async reapIdle(now = new Date()): Promise<string[]> {
    const workers = await this.prisma.visionWorker.findMany({
      where: { retiredAt: null, providerRef: { not: null }, providerId: { notIn: [...SELF_STARTED_PROVIDERS] } },
      select: { id: true, providerId: true, providerRef: true, resourceClass: true, retiredAt: true, tokenKind: true, firstSeenAt: true, lastSeenAt: true },
    });
    const stopped: string[] = [];
    for (const worker of workers) {
      try {
        const busy = await this.prisma.visionJob.count({ where: { workerId: worker.id, state: { in: ["claimed", "running"] } } });
        if (busy) continue;
        let reason: StopReason | null = null;
        if (worker.tokenKind === "bootstrap") {
          if (now.getTime() - worker.firstSeenAt.getTime() > HOSTED_REGISTER_GRACE_MS) reason = "never_registered";
        } else {
          const last = await this.prisma.visionJob.findFirst({ where: { workerId: worker.id }, orderBy: { finishedAt: { sort: "desc", nulls: "last" } }, select: { finishedAt: true, heartbeatAt: true } });
          const activity = Math.max(worker.lastSeenAt.getTime(), last?.finishedAt?.getTime() ?? 0, last?.heartbeatAt?.getTime() ?? 0);
          if (now.getTime() - activity > HOSTED_IDLE_GRACE_MS) reason = "idle";
        }
        if (!reason) continue;
        await this.stop(worker, reason, null);
        stopped.push(worker.id);
        this.log.warn(`stopped hosted worker ${worker.id} (${worker.providerId} ${worker.providerRef}): ${reason}`);
      } catch (error) {
        this.log.error(`could not stop hosted worker ${worker.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return stopped;
  }
}
