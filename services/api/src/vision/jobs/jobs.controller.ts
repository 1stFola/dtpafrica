import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { DEFAULT_RESOURCE_CLASS, type VisionResourceClass } from "@dtp/vision-contracts";
import { AdminAuth } from "../../admin/decorators/admin-auth.decorator";
import { RequirePermissions } from "../../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../../admin/guards/permissions.guard";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { VISION_CONFIG, type VisionConfig } from "../config/vision.config";
import {
  COMPUTE_PROVIDER_REGISTRY,
  type ComputeProviderRegistry,
} from "../compute/compute-provider";
import { WorkerTokenService } from "../worker/worker-token.service";
import { jsonSafe } from "../shared/json-safe";
import { VisionJobDispatcher } from "./job-dispatcher.service";
import { CancelJobDto, EnqueueJobDto, ProvisionWorkerDto } from "./dto/enqueue-job.dto";
import { JOB_QUEUE, type JobQueue } from "./job-queue";
import { VisionJobsService } from "./vision-jobs.service";
import { notFound, refusal } from "../shared/refusals";

/**
 * Operator-facing job endpoints.
 *
 * Progress is polled, not streamed: the app already carries one WebSocket for
 * live audio commentary, and a 2 GB control plane does not need a second
 * long-lived connection per open dashboard.
 */
@Controller("vision")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class VisionJobsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VisionJobsService) private readonly jobs: VisionJobsService,
    @Inject(VisionJobDispatcher) private readonly dispatcher: VisionJobDispatcher,
    @Inject(WorkerTokenService) private readonly workerTokens: WorkerTokenService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueue,
    @Inject(COMPUTE_PROVIDER_REGISTRY) private readonly compute: ComputeProviderRegistry,
    @Inject(VISION_CONFIG) private readonly config: VisionConfig
  ) {}

  @Get("jobs")
  @RequirePermissions("vision.read")
  async list(
    @Query("state") state?: string,
    @Query("type") type?: string,
    @Query("videoAssetId") videoAssetId?: string
  ) {
    const rows = await this.prisma.visionJob.findMany({
      where: {
        ...(state ? { state } : {}),
        ...(type ? { type } : {}),
        ...(videoAssetId ? { videoAssetId } : {}),
      },
      orderBy: [{ priority: "desc" }, { queuedAt: "desc" }],
      take: 100,
      select: {
        id: true,
        type: true,
        resourceClass: true,
        state: true,
        priority: true,
        attemptNumber: true,
        maxAttempts: true,
        videoAssetId: true,
        queuedAt: true,
        claimedAt: true,
        startedAt: true,
        heartbeatAt: true,
        finishedAt: true,
        workerId: true,
        error: true,
      },
    });
    return { jobs: rows };
  }

  @Get("jobs/queue-depth")
  @RequirePermissions("vision.read")
  async queueDepth() {
    return { depth: await this.queue.depth() };
  }

  @Get("jobs/dispatcher")
  @RequirePermissions("vision.read")
  dispatcherHealth() {
    return this.dispatcher.health();
  }

  /** Run a reap pass now, instead of waiting for the timer. */
  @Post("jobs/dispatcher/tick")
  @RequirePermissions("vision.jobs.run")
  runDispatcher() {
    return this.dispatcher.tick();
  }

  @Get("jobs/:id")
  @RequirePermissions("vision.read")
  async get(@Param("id") id: string) {
    const job = await this.prisma.visionJob.findUnique({
      where: { id },
      include: { cost: true },
    });
    if (!job) throw notFound("job", id);
    // The cost row carries BigInt byte counters, which JSON.stringify refuses.
    return { job: jsonSafe(job) };
  }

  @Get("jobs/:id/events")
  @RequirePermissions("vision.read")
  async events(@Param("id") id: string) {
    const events = await this.prisma.visionJobEvent.findMany({
      where: { jobId: id },
      orderBy: { createdAt: "asc" },
      take: 500,
    });
    return { events };
  }

  @Post("jobs")
  @RequirePermissions("vision.jobs.run")
  async enqueue(@Body() dto: EnqueueJobDto, @AdminAuth() auth: AdminAuthContext) {
    return this.jobs.enqueueForAsset(dto, auth);
  }

  @Post("jobs/:id/retry")
  @RequirePermissions("vision.jobs.run")
  async retry(@Param("id") id: string, @AdminAuth() auth: AdminAuthContext) {
    await this.jobs.retry(id, auth);
    return { ok: true };
  }

  @Post("jobs/:id/cancel")
  @RequirePermissions("vision.jobs.run")
  async cancel(
    @Param("id") id: string,
    @Body() dto: CancelJobDto,
    @AdminAuth() auth: AdminAuthContext
  ) {
    await this.jobs.cancel(id, dto.reason, auth);
    return { ok: true };
  }

  /** Every worker the control plane has heard from, newest first; retired ones included so a retire can be seen. */
  @Get("workers")
  @RequirePermissions("vision.read")
  async listWorkers() {
    const workers = await this.prisma.visionWorker.findMany({
      orderBy: { firstSeenAt: "desc" },
      take: 50,
      select: { id: true, providerId: true, providerRef: true, resourceClass: true, image: true, firstSeenAt: true, lastSeenAt: true, jobsCompleted: true, retiredAt: true, tokenExpiresAt: true },
    });
    return { workers };
  }

  // Provisioning and retiring a worker are in worker/worker-provision.controller.ts: they
  // take the provision key as well as an admin session.

  @Get("jobs-meta/resource-classes")
  @RequirePermissions("vision.read")
  resourceClasses(): { defaults: Record<string, VisionResourceClass> } {
    return { defaults: DEFAULT_RESOURCE_CLASS };
  }
}
