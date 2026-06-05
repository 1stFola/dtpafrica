import { Module } from "@nestjs/common";
import { AcademyDashboardController } from "./academy-dashboard.controller";
import { AcademyDashboardService } from "./academy-dashboard.service";

@Module({
  controllers: [AcademyDashboardController],
  providers: [AcademyDashboardService],
})
export class AcademyDashboardModule {}
