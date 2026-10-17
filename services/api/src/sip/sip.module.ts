import { Module } from "@nestjs/common";
import { AdminGuardsModule } from "../admin/admin-guards.module";
import { SipController } from "./sip.controller";
import { SipRecalculationService } from "./sip-recalculation.service";

@Module({
  imports: [AdminGuardsModule],
  controllers: [SipController],
  providers: [SipRecalculationService],
  exports: [SipRecalculationService],
})
export class SipModule {}
