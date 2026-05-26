import { Module } from "@nestjs/common";
import { SipController } from "./sip.controller";
import { SipRecalculationService } from "./sip-recalculation.service";

@Module({
  controllers: [SipController],
  providers: [SipRecalculationService],
  exports: [SipRecalculationService],
})
export class SipModule {}
