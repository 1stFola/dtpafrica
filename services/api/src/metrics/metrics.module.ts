import { Module } from "@nestjs/common";
import { SipModule } from "../sip/sip.module";
import { MetricsController } from "./metrics.controller";
import { MetricsService } from "./metrics.service";

@Module({
  imports: [SipModule],
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}
