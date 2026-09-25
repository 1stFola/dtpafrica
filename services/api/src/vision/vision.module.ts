import { Module, type Provider } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "../prisma/prisma.module";
import { AdminAuthService } from "../admin/auth/admin-auth.service";
import { adminJwtSecret } from "../admin/auth/admin-auth.util";
import { AdminAuthGuard } from "../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../admin/guards/permissions.guard";
import { VisionAuditService } from "./audit/vision-audit.service";
import {
  COMPUTE_PROVIDER_REGISTRY,
  ComputeProviderRegistry,
  type ComputeProvider,
} from "./compute/compute-provider";
import { LocalComputeProvider } from "./compute/local-compute-provider";
import { MockComputeProvider } from "./compute/mock-compute-provider";
import { VISION_CONFIG, loadVisionConfig, type VisionConfig } from "./config/vision.config";
import { VisionJobsController } from "./jobs/jobs.controller";
import { JOB_QUEUE } from "./jobs/job-queue";
import { PostgresJobQueue } from "./jobs/postgres-job-queue";
import { VisionStageResultsService } from "./jobs/stage-results.service";
import { VisionJobsService } from "./jobs/vision-jobs.service";
import { RightsPolicyService } from "./rights/rights-policy.service";
import { InMemoryObjectStore } from "./storage/in-memory-object-store";
import { OBJECT_STORE, type ObjectStore } from "./storage/object-store";
import { R2ObjectStore } from "./storage/r2-object-store";
import { VisionStatusController } from "./vision-status.controller";
import { VisionWorkerController } from "./worker/worker.controller";
import { VisionWorkerBootstrapGuard, VisionWorkerGuard } from "./worker/vision-worker.guard";
import { WorkerTokenService } from "./worker/worker-token.service";

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
  useFactory: (): ComputeProviderRegistry => {
    const providers: ComputeProvider[] = [new MockComputeProvider(), new LocalComputeProvider()];
    return new ComputeProviderRegistry(providers);
  },
};

@Module({
  imports: [
    PrismaModule,
    // Same secret and lifetime as AdminModule, so one admin session works across both.
    JwtModule.register({ secret: adminJwtSecret(), signOptions: { expiresIn: "7d" } }),
  ],
  controllers: [VisionStatusController, VisionJobsController, VisionWorkerController],
  providers: [
    configProvider,
    objectStoreProvider,
    computeRegistryProvider,
    jobQueueProvider,
    RightsPolicyService,
    VisionAuditService,
    VisionJobsService,
    VisionStageResultsService,
    // Worker auth is a separate stack from admin auth on purpose: a worker token
    // must never reach an admin endpoint, and vice versa.
    WorkerTokenService,
    VisionWorkerGuard,
    VisionWorkerBootstrapGuard,
    // Reuse the existing admin auth stack rather than building a second one.
    AdminAuthService,
    AdminAuthGuard,
    PermissionsGuard,
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
  ],
})
export class VisionModule {}
