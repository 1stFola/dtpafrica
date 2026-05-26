import { Module } from "@nestjs/common";
import { AdminAcademiesService } from "./admin-academies.service";
import { AdminBlogService } from "./admin-blog.service";
import { AdminCalibrationService } from "./admin-calibration.service";
import { AdminContentService } from "./admin-content.service";
import { AdminController } from "./admin.controller";
import { AdminInboxService } from "./admin-inbox.service";
import { AdminPlayersService } from "./admin-players.service";

@Module({
  controllers: [AdminController],
  providers: [
    AdminPlayersService,
    AdminInboxService,
    AdminAcademiesService,
    AdminBlogService,
    AdminContentService,
    AdminCalibrationService,
  ],
})
export class AdminModule {}
