import { Module } from "@nestjs/common";
import { AcademyAuthModule } from "../academy-auth/academy-auth.module";
import { AdsModule } from "../ads/ads.module";
import { ScoreboardModule } from "../scoreboard/scoreboard.module";
import { AdminAcademiesService } from "./admin-academies.service";
import { AdminBlogService } from "./admin-blog.service";
import { AdminCalibrationService } from "./admin-calibration.service";
import { AdminContentService } from "./admin-content.service";
import { AdminController } from "./admin.controller";
import { AdminInboxService } from "./admin-inbox.service";
import { AdminPlayersService } from "./admin-players.service";
import { AdminScoreboardController } from "./admin-scoreboard.controller";
import { AdminScoreboardService } from "./admin-scoreboard.service";
import { AdminSeedService } from "./admin-seed.service";

@Module({
  imports: [AcademyAuthModule, AdsModule, ScoreboardModule],
  controllers: [AdminController, AdminScoreboardController],
  providers: [
    AdminPlayersService,
    AdminInboxService,
    AdminAcademiesService,
    AdminBlogService,
    AdminContentService,
    AdminCalibrationService,
    AdminScoreboardService,
    AdminSeedService,
  ],
})
export class AdminModule {}
