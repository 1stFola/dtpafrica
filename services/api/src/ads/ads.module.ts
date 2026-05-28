import { Module } from "@nestjs/common";
import { AdsConfigService } from "./ads-config.service";

@Module({
  providers: [AdsConfigService],
  exports: [AdsConfigService],
})
export class AdsModule {}
