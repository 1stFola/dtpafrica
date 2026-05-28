import { Module } from "@nestjs/common";
import { AdsModule } from "../ads/ads.module";
import { MvceModule } from "../mvce/mvce.module";
import { SipModule } from "../sip/sip.module";
import { HomeController } from "./home.controller";
import { HomeService } from "./home.service";
import { PlayerProfileIntelligenceService } from "./player-profile-intelligence.service";

@Module({
  imports: [AdsModule, SipModule, MvceModule],
  controllers: [HomeController],
  providers: [HomeService, PlayerProfileIntelligenceService],
})
export class HomeModule {}
