import { Body, Controller, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { RequirePermissions } from "../../admin/decorators/require-permissions.decorator";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { COMPUTE_PROVIDER_REGISTRY, type ComputeProviderRegistry } from "../compute/compute-provider";
import { VISION_CONFIG, type VisionConfig } from "../config/vision.config";
import { ProvisionWorkerDto } from "../jobs/dto/enqueue-job.dto";
import { notFound, refusal } from "../shared/refusals";
import { PROVISION_KEY_PROVIDERS } from "./provision-key";
import { WorkerProvisionGuard, type ProvisionRequest } from "./worker-provision.guard";
import { WorkerTokenService } from "./worker-token.service";

type Caller = ProvisionRequest & { adminAuth?: AdminAuthContext };

/**
 * Starting a worker and ending one.
 *
 * An admin with `vision.jobs.run` may do either for any provider. The provision
 * key (`provision-key.ts`) may do either only for a provider that launches
 * nothing: it is what the worker on the box holds, and the worker on the box
 * has no business starting a paid pod or retiring somebody else's worker.
 */
@Controller("vision/workers")
@UseGuards(WorkerProvisionGuard)
export class WorkerProvisionController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkerTokenService) private readonly workerTokens: WorkerTokenService,
    @Inject(COMPUTE_PROVIDER_REGISTRY) private readonly compute: ComputeProviderRegistry,
    @Inject(VISION_CONFIG) private readonly config: VisionConfig
  ) {}

  /**
   * Launch capacity and mint its one-shot bootstrap token.
   *
   * The plaintext token is returned exactly once and never stored — only its
   * hash is. For the `local` provider nothing is actually started: the operator
   * runs the container themselves with this token, which is the same contract a
   * hosted provider gets.
   */
  @Post("provision")
  @RequirePermissions("vision.jobs.run")
  async provisionWorker(@Body() dto: ProvisionWorkerDto, @Req() req: Caller) {
    const providerId = dto.providerId ?? this.config.compute.defaultProvider;
    if (req.provisionKey) this.keyMayActFor(providerId, "provision a worker");
    const provider = this.compute.get(providerId);

    const capabilities = provider.capabilities();
    if (!capabilities.resourceClasses.includes(dto.resourceClass)) {
      throw refusal(404, "ResourceClassNotOffered", `Provider ${providerId} does not offer ${dto.resourceClass}. It offers ${capabilities.resourceClasses.join(", ")}.`, "Ask for a resource class the provider offers, or use another provider.");
    }

    const image = this.config.compute.workerImage;
    const minted = await this.workerTokens.mintBootstrap({
      providerId,
      resourceClass: dto.resourceClass,
      image,
    });

    const launch = await provider.launch({
      image,
      resourceClass: dto.resourceClass,
      // The worker learns a URL, a token and its class. No storage credential,
      // no database connection, no provider SDK configuration.
      env: {
        VISION_WORKER_CALLBACK_URL: "/api/v1/vision/worker",
        VISION_BOOTSTRAP_TOKEN: minted.bootstrapToken,
        VISION_RESOURCE_CLASS: dto.resourceClass,
      },
      maxRuntimeSeconds: this.config.jobs.defaultBudgetSeconds,
      maxCostUsdCents: this.config.jobs.defaultBudgetUsdCents,
      idleShutdownSeconds: 120,
    });

    await this.prisma.visionWorker.update({
      where: { id: minted.workerId },
      data: { providerRef: launch.providerRef },
    });

    return {
      workerId: minted.workerId,
      providerId,
      providerRef: launch.providerRef,
      resourceClass: dto.resourceClass,
      image,
      /** Shown once. Only its hash is stored. */
      bootstrapToken: minted.bootstrapToken,
      bootstrapExpiresAt: minted.expiresAt.toISOString(),
      requestedBy: req.provisionKey ? "provision_key" : (req.adminAuth?.userId ?? req.adminAuth?.method ?? null),
    };
  }

  @Post(":id/retire")
  @RequirePermissions("vision.jobs.run")
  async retireWorker(@Param("id") id: string, @Req() req: Caller) {
    const worker = await this.prisma.visionWorker.findUnique({ where: { id }, select: { id: true, providerId: true } });
    // It was an update on a row that might not exist, which answered 500.
    if (!worker) throw notFound("worker", id);
    if (req.provisionKey) this.keyMayActFor(worker.providerId, "retire this worker");
    await this.workerTokens.retire(id);
    return { ok: true };
  }

  /** The provision key acts only for a provider that launches nothing. */
  private keyMayActFor(providerId: string, what: string): void {
    if (PROVISION_KEY_PROVIDERS.includes(providerId)) return;
    throw refusal(
      403,
      "ProvisionKeyScope",
      `The provision key may not ${what}: it acts only for ${PROVISION_KEY_PROVIDERS.join(", ")}, and this is ${providerId}.`,
      "Sign in as an admin with vision.jobs.run to act for a hosted provider."
    );
  }
}
