import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
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
import { LiveAudioCommentaryService } from "./live-audio-commentary.service";

@Controller("scoreboard")
export class ScoreboardController {
  constructor(
    @Inject(ScoreboardService) private readonly sb: ScoreboardService,
    @Inject(CompetitionEngineService) private readonly competitionEngine: CompetitionEngineService,
    @Inject(LiveAudioCommentaryService) private readonly liveAudio: LiveAudioCommentaryService
  ) {}

  @Get("overview")
  overview() {
    return this.sb.overview();
  }

  @Get("competitions")
  competitions() {
    return this.sb.competitions();
  }

  // Declared before competitions/:slug so "tallies" is not read as a slug.
  @Get("competitions/tallies")
  @Header("Cache-Control", "no-store")
  competitionTallies() {
    return this.sb.competitionTallies();
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

  @Get("competitions/:slug/stat-leaders")
  statLeaders(
    @Param("slug") slug: string,
    @Query("metric") metric = "goals",
    @Query("limit") limit?: string
  ) {
    const valid = ScoreboardService.STAT_LEADER_METRICS as readonly string[];
    if (!valid.includes(metric)) {
      throw new BadRequestException(
        `metric must be one of: ${valid.join(", ")}`
      );
    }
    const parsedLimit =
      limit != null && limit !== "" ? Number.parseInt(limit, 10) : undefined;
    return this.sb.statLeaders(
      slug,
      metric as (typeof ScoreboardService.STAT_LEADER_METRICS)[number],
      Number.isFinite(parsedLimit) && parsedLimit! > 0 ? parsedLimit : 10
    );
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

  @Get("matches/:slugOrId")
  match(@Param("slugOrId") slugOrId: string) {
    return this.sb.matchBySlugOrId(slugOrId, true);
  }

  @Get("matches/:slugOrId/squads")
  matchSquads(@Param("slugOrId") slugOrId: string) {
    return this.sb.matchSquadsBySlugOrId(slugOrId, true);
  }

  @Get("matches/:matchId/live-audio/poll")
  liveAudioPoll(
    @Param("matchId") matchId: string,
    @Query("after") after?: string
  ) {
    const afterSequence = after ? Number.parseInt(after, 10) : 0;
    return this.liveAudio.poll(matchId, Number.isFinite(afterSequence) ? afterSequence : 0);
  }

  @Get("standings/:competitionId")
  standings(@Param("competitionId") competitionId: string) {
    return this.competitionEngine.standings(competitionId, { publicOnly: true });
  }

  @Get("competitions/:competitionId/standings/groups")
  groupStandings(@Param("competitionId") competitionId: string) {
    return this.competitionEngine.standings(competitionId, { publicOnly: true });
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
