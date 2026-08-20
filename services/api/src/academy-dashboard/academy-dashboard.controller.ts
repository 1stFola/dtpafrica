import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { AcademyJwtPayload } from "../academy-auth/academy-auth.service";
import { AcademyAuthGuard } from "../academy-auth/guards/academy-auth.guard";
import { AcademyScopeGuard } from "../academy-auth/guards/academy-scope.guard";
import { AcademyChangeRequestsService } from "./academy-change-requests.service";
import { AcademyDashboardService } from "./academy-dashboard.service";
import {
  AcademyPlayerChangeRequestDto,
  AcademyProfileChangeRequestDto,
} from "./dto/academy-change-request.dto";

@Controller("academy")
@UseGuards(AcademyAuthGuard)
export class AcademyDashboardController {
  constructor(
    @Inject(AcademyDashboardService)
    private readonly academyDashboard: AcademyDashboardService,
    @Inject(AcademyChangeRequestsService)
    private readonly changeRequests: AcademyChangeRequestsService
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

  @Post(":slug/change-requests/academy-profile")
  @UseGuards(AcademyScopeGuard)
  submitAcademyProfileChange(
    @Param("slug") slug: string,
    @Body() dto: AcademyProfileChangeRequestDto
  ) {
    return this.changeRequests.submitAcademyProfile(slug, dto);
  }

  @Post(":slug/change-requests/players/:playerId")
  @UseGuards(AcademyScopeGuard)
  submitPlayerProfileChange(
    @Param("slug") slug: string,
    @Param("playerId") playerId: string,
    @Body() dto: AcademyPlayerChangeRequestDto
  ) {
    return this.changeRequests.submitPlayerProfile(slug, playerId, dto);
  }
}
