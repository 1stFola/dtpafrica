import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AcademyAuthModule } from "../academy-auth/academy-auth.module";
import { AdsModule } from "../ads/ads.module";
import { ScoreboardModule } from "../scoreboard/scoreboard.module";
import { SipModule } from "../sip/sip.module";
import { SupportModule } from "../support/support.module";
import { AcademyChangeRequestsService } from "../academy-dashboard/academy-change-requests.service";
import { AdminAcademiesService } from "./admin-academies.service";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthService } from "./auth/admin-auth.service";
import { adminJwtSecret } from "./auth/admin-auth.util";
import { AdminBlogService } from "./admin-blog.service";
import { AdminCalibrationService } from "./admin-calibration.service";
import { AdminContentService } from "./admin-content.service";
import { AdminController } from "./admin.controller";
import { AdminInboxService } from "./admin-inbox.service";
import { AdminPlayersService } from "./admin-players.service";
import { AdminRbacController } from "./admin-rbac.controller";
import { AdminRbacService } from "./admin-rbac.service";
import { AdminMatchStatsController } from "./admin-match-stats.controller";
import { AdminMatchStatsService } from "./admin-match-stats.service";
import { RecorderIdleService } from "./recorder-idle.service";
import { AdminScoreboardController } from "./admin-scoreboard.controller";
import { AdminScoreboardService } from "./admin-scoreboard.service";
import { AdminSeedService } from "./admin-seed.service";
import { AdminSupportController } from "./admin-support.controller";
import { AdminAuthGuard } from "./guards/admin-auth.guard";
import { PermissionsGuard } from "./guards/permissions.guard";

@Module({
  imports: [
    AcademyAuthModule,
    AdsModule,
    ScoreboardModule,
    SipModule,
    SupportModule,
    JwtModule.registerAsync({
      useFactory: () => ({ secret: adminJwtSecret(), signOptions: { expiresIn: "7d" } }),
    }),
  ],
  controllers: [
    AdminController,
    AdminScoreboardController,
    AdminMatchStatsController,
    AdminSupportController,
    AdminRbacController,
    AdminAuthController,
  ],
  providers: [
    AdminPlayersService,
    AdminInboxService,
    AdminAcademiesService,
    AdminBlogService,
    AdminContentService,
    AdminCalibrationService,
    AdminScoreboardService,
    AdminMatchStatsService,
    RecorderIdleService,
    AdminSeedService,
    AdminAuthService,
    AdminRbacService,
    AcademyChangeRequestsService,
    AdminAuthGuard,
    PermissionsGuard,
  ],
})
export class AdminModule {}
