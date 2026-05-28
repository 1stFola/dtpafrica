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

  @Get("competitions")
  competitions() {
    return this.sb.competitions();
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
    @Query("competitionId") competitionId?: string
  ) {
    return this.sb.listMatches({ status, competitionId, publicOnly: true });
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
