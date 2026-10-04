import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { BUCKET_IDS, OPEN_ANNOTATION_TASK_STATES, VISION_CONTRACT_VERSION } from "@dtp/vision-contracts";
import { RequirePermissions } from "../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../admin/guards/permissions.guard";
import { PrismaService } from "../prisma/prisma.service";
import {
  COMPUTE_PROVIDER_REGISTRY,
  type ComputeProviderRegistry,
} from "./compute/compute-provider";
import { VISION_CONFIG, type VisionConfig } from "./config/vision.config";
import { OBJECT_STORE, type ObjectStore } from "./storage/object-store";

/**
 * Readiness and configuration for the Vision subsystem.
 *
 * Deliberately says what is configured, never what the credentials are. The
 * bucket names are shown because an operator needs to confirm which environment
 * they are pointed at; keys and secrets are not, and there is a test asserting
 * the response carries no secret-shaped field.
 */
@Controller("vision")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class VisionStatusController {
  constructor(
    @Inject(VISION_CONFIG) private readonly config: VisionConfig,
    @Inject(OBJECT_STORE) private readonly objectStore: ObjectStore,
    @Inject(COMPUTE_PROVIDER_REGISTRY) private readonly compute: ComputeProviderRegistry,
    @Inject(PrismaService) private readonly prisma: PrismaService
  ) {}

  /**
   * What the Vision environment has in it, as the counts the layout's badges and
   * the overview page show. One round trip, each a cheap count.
   */
  @Get("overview")
  @RequirePermissions("vision.read")
  async overview() {
    const staleWorkerBefore = new Date(Date.now() - 10 * 60 * 1000);
    const [partners, sources, assets, assetsReady, jobsQueued, jobsRunning, jobsFailed, workersActive, annotationOpen, candidatesUnreviewed, identitiesUnreviewed, datasets, models, modelsInProduction] = await Promise.all([
      this.prisma.visionSourcePartner.count(),
      this.prisma.visionSourceVideoRecord.count(),
      this.prisma.visionVideoAsset.count(),
      this.prisma.visionVideoAsset.count({ where: { ingestState: "ready" } }),
      this.prisma.visionJob.count({ where: { state: "queued" } }),
      this.prisma.visionJob.count({ where: { state: { in: ["claimed", "running"] } } }),
      this.prisma.visionJob.count({ where: { state: "failed" } }),
      this.prisma.visionWorker.count({ where: { retiredAt: null, lastSeenAt: { gte: staleWorkerBefore } } }),
      // The contract's open states. It counted `open` and `claimed`, which no task ever has, so the tile always read 0.
      this.prisma.visionAnnotationTask.count({ where: { state: { in: [...OPEN_ANNOTATION_TASK_STATES] } } }),
      this.prisma.visionEventCandidate.count({ where: { supersededBy: null, reviewState: "unreviewed" } }),
      this.prisma.visionIdentityAssignment.count({ where: { supersededBy: null, reviewState: "unreviewed" } }),
      this.prisma.visionDatasetVersion.count(),
      this.prisma.visionModel.count(),
      this.prisma.visionModelVersion.count({ where: { stage: "production" } }),
    ]);
    /* The review queue's depth is everything undecided, whoever proposed it; the queue itself leaves the reader's own out. */
    return { enabled: this.config.enabled, partners, sources, assets, assetsReady, jobsQueued, jobsRunning, jobsFailed, workersActive, annotationOpen, candidatesUnreviewed, identitiesUnreviewed, reviewQueue: candidatesUnreviewed + identitiesUnreviewed, datasets, models, modelsInProduction };
  }

  @Get("status")
  @RequirePermissions("vision.read")
  status() {
    return {
      phase: "0",
      enabled: this.config.enabled,
      contractVersion: VISION_CONTRACT_VERSION,
      storage: {
        backend: this.objectStore.backendId,
        buckets: Object.fromEntries(
          BUCKET_IDS.map((id) => [id, this.config.storage.buckets[id] || null])
        ),
        credentialsConfigured: Boolean(
          this.config.storage.accessKeyId && this.config.storage.secretAccessKey
        ),
      },
      upload: this.config.upload,
      playback: this.config.playback,
      jobs: this.config.jobs,
      compute: {
        defaultProvider: this.config.compute.defaultProvider,
        workerImage: this.config.compute.workerImage,
        monthlyBudgetUsdCents: this.config.compute.monthlyBudgetUsdCents,
        providers: this.compute.list().map((p) => p.capabilities()),
      },
      policy: this.config.policy,
    };
  }
}
