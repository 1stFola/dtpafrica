import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AdminApiKeyGuard } from "../admin/guards/admin-api-key.guard";
import { CreateMatchEventDto } from "./dto/create-event.dto";
import { UpdateMatchDto } from "./dto/update-match.dto";
import { CompetitionEngineService } from "./competition-engine.service";
import { ScoreboardService } from "./scoreboard.service";

@Controller("scoreboard")
export class ScoreboardController {
  constructor(
    @Inject(ScoreboardService) private readonly sb: ScoreboardService,
    @Inject(CompetitionEngineService) private readonly competitionEngine: CompetitionEngineService
  ) {}

  @Get("overview")
  overview() {
    return this.sb.overview();
  }

  @Get("competitions")
  competitions() {
    return this.sb.competitions();
  }

  @Get("competitions/:competitionId/hub")
  competitionHub(@Param("competitionId") competitionId: string) {
    return this.sb.competitionHub(competitionId);
  }

  @Get("stats")
  stats() {
    return this.sb.stats();
  }

  @Get("teams")
  teams() {
    return this.sb.teams();
  }

  @Get("players/:slugOrId/profile")
  playerProfile(
    @Param("slugOrId") slugOrId: string,
    @Query("club") club?: string,
    @Query("competition") competition?: string,
    @Query("role") role?: string
  ) {
    return this.sb.playerProfile(slugOrId, { club, competition, role });
  }

  @Get("competitions/:slug")
  competition(@Param("slug") slug: string) {
    return this.sb.competitionBySlug(slug);
  }

  @Get("teams/:id")
  team(@Param("id") id: string) {
    return this.sb.teamById(id);
  }

  @Get("search")
  search(@Query("q") query = "") {
    return this.sb.search(query);
  }

  @Get("matches")
  matches(
    @Query("status") status?: string,
    @Query("competitionId") competitionId?: string,
    @Query("limit") limit?: string
  ) {
    const parsedLimit =
      limit != null && limit !== "" ? Number.parseInt(limit, 10) : undefined;
    return this.sb.listMatches({
      status,
      competitionId,
      limit: Number.isFinite(parsedLimit) && parsedLimit! > 0 ? parsedLimit : undefined,
      publicOnly: true,
    });
  }

  @Get("matches/:id")
  match(@Param("id") id: string) {
    return this.sb.matchById(id, true);
  }

  @Get("standings/:competitionId")
  standings(@Param("competitionId") competitionId: string) {
    return this.sb.standings(competitionId);
  }

  @Get("competitions/:competitionId/standings/groups")
  groupStandings(@Param("competitionId") competitionId: string) {
    return this.competitionEngine.groupStandings(competitionId);
  }

  @Get("highlights")
  highlights(@Query("competitionId") competitionId?: string) {
    return this.sb.highlights(competitionId);
  }

  @Get("supervisor/live")
  @UseGuards(AdminApiKeyGuard)
  supervisorLive() {
    return this.sb.supervisorFeed();
  }

  @Post("matches/:id/events")
  @UseGuards(AdminApiKeyGuard)
  addEvent(@Param("id") id: string, @Body() dto: CreateMatchEventDto) {
    return this.sb.addEvent(id, dto);
  }

  @Post("matches/:id/ingest-sip")
  @UseGuards(AdminApiKeyGuard)
  ingestSipMetrics(@Param("id") id: string) {
    return this.sb.ingestSipMetricsFromMatch(id);
  }

  @Patch("matches/:id")
  @UseGuards(AdminApiKeyGuard)
  updateMatch(@Param("id") id: string, @Body() dto: UpdateMatchDto) {
    return this.sb.updateMatch(id, dto);
  }

  @Get("operator/matches/:id")
  @UseGuards(AdminApiKeyGuard)
  operatorMatch(@Param("id") id: string) {
    return this.sb.matchById(id, false);
  }
}
