import { Module, type Provider } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "../prisma/prisma.module";
import { AdminAuthService } from "../admin/auth/admin-auth.service";
import { adminJwtSecret } from "../admin/auth/admin-auth.util";
import { AdminAuthGuard } from "../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../admin/guards/permissions.guard";
import { VisionAuditController } from "./audit/audit.controller";
import { VisionAuditService } from "./audit/vision-audit.service";
import { VisionAnnotationController } from "./annotation/annotation.controller";
import { VisionAnnotationService } from "./annotation/annotation.service";
import { VisionDatasetsController } from "./datasets/datasets.controller";
import { VisionDatasetsService } from "./datasets/datasets.service";
import { COMPUTE_PROVIDER_REGISTRY, type ComputeProviderRegistry } from "./compute/compute-provider";
import { buildComputeProviderRegistry } from "./compute/provider-registry.factory";
import { VISION_CONFIG, loadVisionConfig, type VisionConfig } from "./config/vision.config";
import { VisionUploadService } from "./assets/upload.service";
import { VisionUploadsController } from "./assets/uploads.controller";
import { PartnerUploadGuard } from "./assets/partner-upload.guard";
import { VisionPartnerUploadsController } from "./assets/partner-uploads.controller";
import { VisionSourcesController } from "./sources/sources.controller";
import { VisionSourcesService } from "./sources/sources.service";
import { VisionJobDispatcher } from "./jobs/job-dispatcher.service";
import { VisionJobsController } from "./jobs/jobs.controller";
import { VisionTracksController } from "./jobs/tracks.controller";
import { VisionIdentityController } from "./identity/identity.controller";
import { VisionIdentityService } from "./identity/identity.service";
import { VisionCalibrationController } from "./calibration/calibration.controller";
import { VisionCalibrationService } from "./calibration/calibration.service";
import { VisionAssetsController } from "./assets/assets.controller";
import { ScoreboardModule } from "../scoreboard/scoreboard.module";
import { VisionEventsController } from "./events/events.controller";
import { VisionEventsService } from "./events/events.service";
import { VisionEventImportsService } from "./events/event-imports.service";
import { VisionEventGoldController } from "./event-gold/event-gold.controller";
import { VisionEventGoldService } from "./event-gold/event-gold.service";
import { VisionPossessionController } from "./possession/possession.controller";
import { VisionPossessionService } from "./possession/possession.service";
import { VisionClockController } from "./clock/clock.controller";
import { VisionClockService } from "./clock/clock.service";
import { JOB_QUEUE } from "./jobs/job-queue";
import { PostgresJobQueue } from "./jobs/postgres-job-queue";
import { VisionStageResultsService } from "./jobs/stage-results.service";
import { VisionJobsService } from "./jobs/vision-jobs.service";
import { VisionBenchmarksService } from "./models/benchmarks.service";
import { VisionTrainingService } from "./models/training.service";
import { VisionModelsController } from "./models/models.controller";
import { VisionModelsService } from "./models/models.service";
import { VisionPromotionsService } from "./models/promotions.service";
import { RightsPolicyService } from "./rights/rights-policy.service";
import { InMemoryObjectStore } from "./storage/in-memory-object-store";
import { OBJECT_STORE, type ObjectStore } from "./storage/object-store";
import { R2ObjectStore } from "./storage/r2-object-store";
import { VisionStatusController } from "./vision-status.controller";
import { VisionWorkerController } from "./worker/worker.controller";
import { VisionWorkerBootstrapGuard, VisionWorkerGuard } from "./worker/vision-worker.guard";
import { WorkerProvisionController } from "./worker/worker-provision.controller";
import { WorkerProvisionGuard } from "./worker/worker-provision.guard";
import { WorkerTokenService } from "./worker/worker-token.service";
import { WorkerCapacityService } from "./worker/worker-capacity.service";

/**
 * Vision Engine control plane — Phase 0.
 *
 * Off unless VISION_ENABLED is set, so deploying this to the existing box
 * changes nothing until someone turns it on. Config is validated at boot, so a
 * malformed setting fails startup loudly rather than at the first upload.
 *
 * Design: docs/vision/.
 */

const configProvider: Provider = {
  provide: VISION_CONFIG,
  useFactory: (): VisionConfig => loadVisionConfig(),
};

const objectStoreProvider: Provider = {
  provide: OBJECT_STORE,
  inject: [VISION_CONFIG],
  useFactory: (config: VisionConfig): ObjectStore =>
    config.storage.backend === "r2"
      ? new R2ObjectStore(config.storage)
      : new InMemoryObjectStore(),
};

/**
 * Providers registered here, chosen by config at call time.
 *
 * Phase 0 ships the mock and local providers. The two hosted providers arrive in
 * Phase 1, and the second one exists specifically to prove the abstraction
 * holds — an abstraction with one implementation is a guess. Which providers
 * those are is a deployment decision, named in docs/vision/06-JOBS-AND-COMPUTE.md
 * rather than here: vendor names belong in adapters and configuration, and
 * vision-boundaries.spec.ts asserts they stay there.
 */
/** Postgres in V1, behind the JobQueue port so Redis is a swap not a rewrite. */
const jobQueueProvider: Provider = {
  provide: JOB_QUEUE,
  useClass: PostgresJobQueue,
};

const computeRegistryProvider: Provider = {
  provide: COMPUTE_PROVIDER_REGISTRY,
  // Which providers exist is decided beside the adapters, not here: the
  // composition root has no business knowing a vendor's name.
  useFactory: (): ComputeProviderRegistry => buildComputeProviderRegistry(),
};

@Module({
  imports: [
    PrismaModule,
    // Promotion adds a goal through ScoreBoard's own lifecycle: the scorer's totals and the table.
    ScoreboardModule,
    // Same secret and lifetime as AdminModule, so one admin session works across both.
    JwtModule.registerAsync({
      useFactory: () => ({ secret: adminJwtSecret(), signOptions: { expiresIn: "7d" } }),
    }),
  ],
  controllers: [
    VisionStatusController,
    VisionJobsController,
    VisionWorkerController,
    WorkerProvisionController,
    VisionAuditController,
    VisionUploadsController,
    VisionPartnerUploadsController,
    VisionSourcesController,
    VisionDatasetsController,
    VisionAnnotationController,
    VisionModelsController,
    VisionTracksController,
    VisionIdentityController,
    VisionCalibrationController,
    VisionClockController,
    VisionEventsController,
    VisionEventGoldController,
    VisionPossessionController,
    VisionAssetsController,
  ],
  providers: [
    configProvider,
    objectStoreProvider,
    computeRegistryProvider,
    jobQueueProvider,
    RightsPolicyService,
    VisionAuditService,
    VisionJobsService,
    VisionStageResultsService,
    VisionUploadService,
    VisionJobDispatcher,
    VisionSourcesService,
    VisionDatasetsService,
    VisionAnnotationService,
    VisionModelsService,
    VisionBenchmarksService,
    VisionTrainingService,
    VisionPromotionsService,
    VisionIdentityService,
    VisionCalibrationService,
    VisionClockService,
    VisionEventsService,
    VisionEventImportsService,
    VisionEventGoldService,
    VisionPossessionService,
    // A third auth stack, unrelated to admin sessions and worker tokens.
    PartnerUploadGuard,
    // Worker auth is a separate stack from admin auth on purpose: a worker token
    // must never reach an admin endpoint, and vice versa.
    WorkerTokenService,
    WorkerCapacityService,
    VisionWorkerGuard,
    VisionWorkerBootstrapGuard,
    // Reuse the existing admin auth stack rather than building a second one.
    AdminAuthService,
    AdminAuthGuard,
    PermissionsGuard,
    // An admin with vision.jobs.run, or the provision-only key the box's worker holds.
    WorkerProvisionGuard,
  ],
  exports: [
    VISION_CONFIG,
    OBJECT_STORE,
    COMPUTE_PROVIDER_REGISTRY,
    JOB_QUEUE,
    RightsPolicyService,
    VisionAuditService,
    VisionJobsService,
    VisionStageResultsService,
    VisionUploadService,
    VisionJobDispatcher,
    VisionSourcesService,
    VisionDatasetsService,
    VisionAnnotationService,
    VisionModelsService,
    VisionBenchmarksService,
    VisionPromotionsService,
  ],
})
export class VisionModule {}
