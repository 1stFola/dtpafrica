import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { BUCKET_IDS, VISION_CONTRACT_VERSION } from "@dtp/vision-contracts";
import { RequirePermissions } from "../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../admin/guards/permissions.guard";
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
    @Inject(COMPUTE_PROVIDER_REGISTRY) private readonly compute: ComputeProviderRegistry
  ) {}

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
