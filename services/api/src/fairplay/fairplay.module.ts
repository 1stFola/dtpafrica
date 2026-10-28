import { Module, type Provider } from "@nestjs/common";
import { AdminGuardsModule } from "../admin/admin-guards.module";
import { PrismaModule } from "../prisma/prisma.module";
import { FairPlayBootstrapGuard, FairPlayDeviceGuard } from "./device.guard";
import { FairPlayDevicesService } from "./devices.service";
import { FairPlayEvidenceService } from "./evidence.service";
import { FairPlayAdminController } from "./fairplay-admin.controller";
import { FairPlayAuditService } from "./fairplay-audit.service";
import { FAIRPLAY_CONFIG, loadFairPlayConfig, type FairPlayConfig } from "./fairplay.config";
import { FairPlayDeviceController } from "./fairplay-device.controller";
import { FairPlayReportService } from "./report.service";
import { FairPlaySessionsService } from "./sessions.service";
import { EVIDENCE_STORE, NoEvidenceStore, R2EvidenceStore } from "./storage/evidence-store";
import { FairPlaySyncService } from "./sync.service";

/**
 * FairPlay's cloud side (docs/fairplay/phase-4-cloud.md). It imports neither ScoreBoard,
 * admin nor Vision modules: ScoreBoard rows are read through Prisma, and nothing of
 * Vision's storage, config or keys is reachable from here (ADR-0006, ADR-0007).
 */
const providers: Provider[] = [
  { provide: FAIRPLAY_CONFIG, useFactory: () => loadFairPlayConfig() },
  {
    provide: EVIDENCE_STORE,
    inject: [FAIRPLAY_CONFIG],
    useFactory: (config: FairPlayConfig) => (config.storage.backend === "r2" ? new R2EvidenceStore(config.storage) : new NoEvidenceStore()),
  },
  FairPlayAuditService,
  FairPlayDevicesService,
  FairPlaySessionsService,
  FairPlaySyncService,
  FairPlayEvidenceService,
  FairPlayReportService,
  FairPlayDeviceGuard,
  FairPlayBootstrapGuard,
];

@Module({
  imports: [PrismaModule, AdminGuardsModule],
  controllers: [FairPlayAdminController, FairPlayDeviceController],
  providers,
})
export class FairPlayModule {}
