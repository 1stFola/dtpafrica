import { Controller, Get, Inject, Param } from "@nestjs/common";
import { AcademyDashboardService } from "./academy-dashboard.service";

@Controller("academy")
export class AcademyDashboardController {
  constructor(
    @Inject(AcademyDashboardService)
    private readonly academyDashboard: AcademyDashboardService
  ) {}

  @Get("dashboard")
  defaultDashboard() {
    return this.academyDashboard.dashboard();
  }

  @Get(":slug/dashboard")
  dashboard(@Param("slug") slug: string) {
    return this.academyDashboard.dashboard(slug);
  }

  @Get(":slug/squad")
  squad(@Param("slug") slug: string) {
    return this.academyDashboard.squad(slug);
  }

  @Get(":slug/fixtures")
  fixtures(@Param("slug") slug: string) {
    return this.academyDashboard.fixtures(slug);
  }

  @Get(":slug/development")
  development(@Param("slug") slug: string) {
    return this.academyDashboard.development(slug);
  }

  @Get(":slug/philosophy")
  philosophy(@Param("slug") slug: string) {
    return this.academyDashboard.philosophy(slug);
  }

  @Get(":slug/valuation")
  valuation(@Param("slug") slug: string) {
    return this.academyDashboard.valuation(slug);
  }

  @Get(":slug/media")
  media(@Param("slug") slug: string) {
    return this.academyDashboard.media(slug);
  }
}
