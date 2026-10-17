import { Module } from "@nestjs/common";
import { AdminGuardsModule } from "../admin/admin-guards.module";
import { SipModule } from "../sip/sip.module";
import { MetricsController } from "./metrics.controller";
import { MetricsService } from "./metrics.service";

@Module({
  imports: [AdminGuardsModule, SipModule],
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}
