import { Controller, Get, Inject, Param, Req, UseGuards } from "@nestjs/common";
import type { AcademyJwtPayload } from "../academy-auth/academy-auth.service";
import { AcademyAuthGuard } from "../academy-auth/guards/academy-auth.guard";
import { AcademyScopeGuard } from "../academy-auth/guards/academy-scope.guard";
import { AcademyDashboardService } from "./academy-dashboard.service";

@Controller("academy")
@UseGuards(AcademyAuthGuard)
export class AcademyDashboardController {
  constructor(
    @Inject(AcademyDashboardService)
    private readonly academyDashboard: AcademyDashboardService
  ) {}

  @Get("dashboard")
  defaultDashboard(@Req() req: { academyAuth: AcademyJwtPayload }) {
    return this.academyDashboard.dashboard(req.academyAuth.slug);
  }

  @Get(":slug/dashboard")
  @UseGuards(AcademyScopeGuard)
  dashboard(@Param("slug") slug: string) {
    return this.academyDashboard.dashboard(slug);
  }

  @Get(":slug/squad")
  @UseGuards(AcademyScopeGuard)
  squad(@Param("slug") slug: string) {
    return this.academyDashboard.squad(slug);
  }

  @Get(":slug/fixtures")
  @UseGuards(AcademyScopeGuard)
  fixtures(@Param("slug") slug: string) {
    return this.academyDashboard.fixtures(slug);
  }

  @Get(":slug/development")
  @UseGuards(AcademyScopeGuard)
  development(@Param("slug") slug: string) {
    return this.academyDashboard.development(slug);
  }

  @Get(":slug/philosophy")
  @UseGuards(AcademyScopeGuard)
  philosophy(@Param("slug") slug: string) {
    return this.academyDashboard.philosophy(slug);
  }

  @Get(":slug/valuation")
  @UseGuards(AcademyScopeGuard)
  valuation(@Param("slug") slug: string) {
    return this.academyDashboard.valuation(slug);
  }

  @Get(":slug/media")
  @UseGuards(AcademyScopeGuard)
  media(@Param("slug") slug: string) {
    return this.academyDashboard.media(slug);
  }
}
