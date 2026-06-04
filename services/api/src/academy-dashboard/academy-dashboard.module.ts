import { Module } from "@nestjs/common";
import { AcademyAuthModule } from "../academy-auth/academy-auth.module";
import { AcademyDashboardController } from "./academy-dashboard.controller";
import { AcademyDashboardService } from "./academy-dashboard.service";

@Module({
  imports: [AcademyAuthModule],
  controllers: [AcademyDashboardController],
  providers: [AcademyDashboardService],
})
export class AcademyDashboardModule {}
