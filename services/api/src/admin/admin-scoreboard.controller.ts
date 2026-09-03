import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AdminAuthGuard } from "./guards/admin-auth.guard";
import { PermissionsGuard } from "./guards/permissions.guard";
import { RequirePermissions } from "./decorators/require-permissions.decorator";
import {
  AdminScoreboardService,
  type MatchdayRosterPayload,
} from "./admin-scoreboard.service";
import { CreateAdminHighlightDto } from "./dto/create-admin-highlight.dto";
import { CreateLandingHighlightDto } from "./dto/create-landing-highlight.dto";
import { PublishHighlightDto } from "./dto/publish-highlight.dto";
import { UpdateAdminHighlightDto } from "./dto/update-admin-highlight.dto";
import { CreateMatchEventDto } from "../scoreboard/dto/create-event.dto";
import { UpdateMatchDto } from "../scoreboard/dto/update-match.dto";
import {
  CreateCompetitionFromTemplateDto,
  isCompetitionFormat,
} from "./dto/create-competition-from-template.dto";
import { PatchSpotterOpsDto } from "./dto/patch-spotter-ops.dto";
import { CreateAdminMatchDto } from "./dto/create-admin-match.dto";
import { CreateFriendlyMatchDto } from "./dto/create-friendly-match.dto";
import { PatchMatchGamedayDto } from "./dto/patch-match-gameday.dto";
import { PatchMatchScoreDto } from "./dto/patch-match-score.dto";
import { UpsertAdminTeamDto } from "./dto/upsert-admin-team.dto";
import { UpdateAdminCompetitionDto } from "./dto/update-admin-competition.dto";
import { UpsertScoreboardSquadRowDto } from "./dto/upsert-scoreboard-squad-row.dto";
import { UpdateMatchStatsDto } from "./dto/update-match-stats.dto";

@Controller("admin/scoreboard")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminScoreboardController {
  constructor(
    @Inject(AdminScoreboardService) private readonly sb: AdminScoreboardService
  ) {}

  @Get("stats")
  @RequirePermissions("scoreboard.read")
  stats() {
    return this.sb.stats();
  }

  @Get("templates")
  @RequirePermissions("scoreboard.read")
  listTemplates() {
    return this.sb.listCompetitionTemplates();
  }

  @Get("templates/:format/preview")
  @RequirePermissions("scoreboard.read")
  previewTemplate(@Param("format") format: string) {
    if (!isCompetitionFormat(format)) {
      throw new BadRequestException("Unknown competition format");
    }
    return this.sb.previewCompetitionTemplate(format);
  }

  @Post("competitions/from-template")
  @RequirePermissions("scoreboard.records.manage")
  createFromTemplate(@Body() dto: CreateCompetitionFromTemplateDto) {
    if (!isCompetitionFormat(dto.formatType)) {
      throw new BadRequestException("Unknown competition format");
    }
    return this.sb.createCompetitionFromTemplate(dto);
  }

  @Get("competitions/:competitionId/standings/groups")
  @RequirePermissions("scoreboard.read")
  groupStandings(@Param("competitionId") competitionId: string) {
    return this.sb.groupStandings(competitionId);
  }

  @Get("competitions/picker")
  @RequirePermissions("scoreboard.read")
  competitionPicker() {
    return this.sb.listCompetitionPicker();
  }

  @Get("competitions")
  @RequirePermissions("scoreboard.read")
  competitions(
    @Query("status") status?: string,
    @Query("type") type?: string,
    @Query("q") q?: string
  ) {
    return this.sb.listCompetitions({ status, type, q });
  }

  @Patch("competitions/:competitionId")
  @RequirePermissions("scoreboard.records.manage")
  updateCompetition(
    @Param("competitionId") competitionId: string,
    @Body() dto: UpdateAdminCompetitionDto
  ) {
    return this.sb.updateCompetition(competitionId, dto);
  }

  @Delete("competitions/:competitionId")
  @RequirePermissions("scoreboard.records.manage")
  deleteCompetition(@Param("competitionId") competitionId: string) {
    return this.sb.deleteCompetition(competitionId);
  }

  @Get("teams")
  @RequirePermissions("scoreboard.read")
  teams(@Query("q") q?: string, @Query("competitionId") competitionId?: string) {
    return this.sb.listTeams({ q, competitionId });
  }

  @Get("teams/:teamId")
  @RequirePermissions("scoreboard.read")
  getTeam(@Param("teamId") teamId: string) {
    return this.sb.getTeam(teamId);
  }

  @Post("teams")
  @RequirePermissions("scoreboard.records.manage")
  createTeam(@Body() dto: UpsertAdminTeamDto) {
    return this.sb.createTeam(dto);
  }

  @Patch("teams/:teamId")
  @RequirePermissions("scoreboard.records.manage")
  updateTeam(@Param("teamId") teamId: string, @Body() dto: UpsertAdminTeamDto) {
    return this.sb.updateTeam(teamId, dto);
  }

  @Put("teams/:teamId")
  @RequirePermissions("scoreboard.records.manage")
  replaceTeam(@Param("teamId") teamId: string, @Body() dto: UpsertAdminTeamDto) {
    return this.sb.updateTeam(teamId, dto);
  }

  @Delete("teams/:teamId")
  @RequirePermissions("scoreboard.records.manage")
  deleteTeam(@Param("teamId") teamId: string) {
    return this.sb.deleteTeam(teamId);
  }

  @Get("players")
  @RequirePermissions("scoreboard.read")
  players(@Query("q") q?: string) {
    return this.sb.listScoreboardPlayers(q);
  }

  @Post("players/merge")
  @RequirePermissions("scoreboard.records.manage")
  mergePlayers(
    @Body()
    body: {
      sourcePlayerId?: string;
      targetPlayerId?: string;
      sourceSquadId?: string;
      targetSquadId?: string;
      removeSource?: boolean;
    }
  ) {
    return this.sb.mergeScoreboardPlayers(body);
  }

  @Patch("squad/:squadId")
  @RequirePermissions("scoreboard.records.manage")
  updateSquadRow(
    @Param("squadId") squadId: string,
    @Body() dto: UpsertScoreboardSquadRowDto
  ) {
    return this.sb.updateSquadRow(squadId, dto);
  }

  @Delete("squad/:squadId")
  @RequirePermissions("scoreboard.records.manage")
  deleteSquadRow(@Param("squadId") squadId: string) {
    return this.sb.deleteSquadRow(squadId);
  }

  @Post("squads")
  @RequirePermissions("scoreboard.records.manage")
  createSquad(@Body() dto: UpsertScoreboardSquadRowDto) {
    return this.sb.createSquadRow(dto);
  }

  @Get("squads")
  @RequirePermissions("scoreboard.read")
  listSquads(
    @Query("q") q?: string,
    @Query("teamId") teamId?: string,
    @Query("competitionId") competitionId?: string,
    @Query("position") position?: string,
    @Query("shirtNumber") shirtNumber?: number,
  ) {
    return this.sb.listSquads({ q, teamId, competitionId, position, shirtNumber });
  }

  @Delete("squads")
  @RequirePermissions("scoreboard.records.manage")
  deleteSquads(@Body() body: { squadIds: string[] }) {
    return this.sb.bulkDeleteSquads(body.squadIds);
  }

  @Get("matches")
  @RequirePermissions("scoreboard.read")
  matches(@Query("competitionId") competitionId?: string) {
    return this.sb.listMatches(competitionId);
  }

  /**
   * Published fixtures inside a kickoff window, across every competition.
   * Backs the admin fixtures calendar; `from`/`to` are ISO timestamps.
   */
  @Get("fixtures-calendar")
  @RequirePermissions("scoreboard.fixtures.read", "scoreboard.read")
  fixturesCalendar(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("competitionId") competitionId?: string,
    @Query("status") status?: string
  ) {
    const parseBound = (value?: string) => {
      if (!value) return undefined;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    };
    return this.sb.fixturesCalendar({
      from: parseBound(from),
      to: parseBound(to),
      competitionId: competitionId || undefined,
      status: status || undefined,
    });
  }

  @Get("supervisor/live")
  @RequirePermissions("scoreboard.read")
  supervisorLive() {
    return this.sb.supervisorLive();
  }

  /* Declared before "matches" so the literal path is not read as a match id. */
  @Post("matches/friendly")
  @RequirePermissions("scoreboard.matches.write")
  createFriendlyMatch(@Body() dto: CreateFriendlyMatchDto) {
    return this.sb.createFriendlyMatch(dto);
  }

  @Post("matches")
  @RequirePermissions("scoreboard.matches.write")
  createMatch(@Body() dto: CreateAdminMatchDto) {
    return this.sb.createMatch(dto);
  }

  @Get("seed/competitions/export")
  @RequirePermissions("scoreboard.records.manage")
  async exportCompetitions() {
    return { csv: await this.sb.exportCompetitionsCsv() };
  }

  @Get("seed/teams/export")
  @RequirePermissions("scoreboard.records.manage")
  async exportTeams(@Query("competitionId") competitionId?: string) {
    return { csv: await this.sb.exportTeamsCsv(competitionId) };
  }

  @Post("seed/competitions/import")
  @RequirePermissions("scoreboard.records.manage")
  importCompetitions(@Body() body: { csv: string }) {
    return this.sb.importCompetitionsCsv(body.csv);
  }

  @Post("seed/teams/import")
  @RequirePermissions("scoreboard.records.manage")
  importTeams(@Body() body: { csv: string; competitionId: string }) {
    return this.sb.importTeamsCsv(body.csv, body.competitionId);
  }

  @Get("matches/:matchId/roster")
  @RequirePermissions("scoreboard.read")
  getRoster(@Param("matchId") matchId: string, @Query("teamId") teamId: string) {
    return this.sb.getMatchRoster(matchId, teamId);
  }

  @Patch("matches/:matchId/gameday")
  @RequirePermissions("scoreboard.matches.write")
  patchMatchGameday(
    @Param("matchId") matchId: string,
    @Body() dto: PatchMatchGamedayDto
  ) {
    return this.sb.patchMatchGameday(matchId, dto);
  }

  @Patch("matches/:matchId/score")
  @RequirePermissions("scoreboard.matches.write")
  patchMatchScore(
    @Param("matchId") matchId: string,
    @Body() dto: PatchMatchScoreDto
  ) {
    return this.sb.patchMatchScore(matchId, dto);
  }

  @Patch("matches/:matchId/stats")
  @RequirePermissions("scoreboard.matches.write")
  updateMatchStats(
    @Param("matchId") matchId: string,
    @Body() dto: Record<string, unknown>
  ) {
    return this.sb.updateMatchStats(matchId, dto as UpdateMatchStatsDto);
  }

  @Post("matches/stats/import")
  @RequirePermissions("scoreboard.matches.write")
  importMatchStats(@Body() body: { csv: string }) {
    if (!body.csv?.trim()) {
      throw new BadRequestException("csv body field is required");
    }
    return this.sb.importMatchStatsCsv(body.csv);
  }

  @Patch("matches/:matchId")
  @RequirePermissions("scoreboard.matches.write")
  updateMatch(@Param("matchId") matchId: string, @Body() dto: UpdateMatchDto) {
    return this.sb.updateMatch(matchId, dto);
  }

  @Patch("matches/:matchId/live-feature")
  @RequirePermissions("scoreboard.matches.write")
  setMatchLiveFeature(
    @Param("matchId") matchId: string,
    @Body() body: { enabled?: unknown; audioEnabled?: unknown }
  ) {
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
      throw new BadRequestException("enabled must be a boolean when provided");
    }
    if (body.audioEnabled !== undefined && typeof body.audioEnabled !== "boolean") {
      throw new BadRequestException("audioEnabled must be a boolean when provided");
    }
    if (body.enabled === undefined && body.audioEnabled === undefined) {
      throw new BadRequestException("enabled or audioEnabled is required");
    }
    return this.sb.setMatchLiveFeature(matchId, {
      enabled: body.enabled,
      audioEnabled: body.audioEnabled,
    });
  }

  @Delete("matches/:matchId")
  @RequirePermissions("scoreboard.matches.write")
  deleteMatch(@Param("matchId") matchId: string) {
    return this.sb.deleteMatch(matchId);
  }

  @Post("matches/:matchId/ingest-sip")
  @RequirePermissions("scoreboard.matches.write")
  ingestSipMetrics(@Param("matchId") matchId: string) {
    return this.sb.ingestSipMetrics(matchId);
  }

  @Put("matches/:matchId/roster")
  @RequirePermissions("scoreboard.matches.write")
  saveRoster(
    @Param("matchId") matchId: string,
    @Body() body: MatchdayRosterPayload
  ) {
    return this.sb.saveMatchRoster(matchId, body);
  }

  @Post("matches/:matchId/squads/upload")
  @RequirePermissions("scoreboard.matches.write")
  uploadMatchSquads(
    @Param("matchId") matchId: string,
    @Body() body: { teamId: string; csv: string }
  ) {
    if (!body.teamId?.trim()) {
      throw new BadRequestException("teamId body field is required");
    }
    if (!body.csv?.trim()) {
      throw new BadRequestException("csv body field is required");
    }
    return this.sb.uploadMatchSquadCsv(matchId, body.teamId, body.csv);
  }

  @Get("matches/:matchId/spotter")
  @RequirePermissions("scoreboard.read")
  spotterState(@Param("matchId") matchId: string) {
    return this.sb.getSpotterOps(matchId);
  }

  @Patch("matches/:matchId/spotter")
  @RequirePermissions("scoreboard.matches.write")
  patchSpotter(@Param("matchId") matchId: string, @Body() dto: PatchSpotterOpsDto) {
    return this.sb.patchSpotterOps(matchId, dto);
  }

  @Post("highlights")
  @RequirePermissions("scoreboard.highlights.write")
  createHighlight(@Body() dto: CreateAdminHighlightDto) {
    return this.sb.createHighlight(dto);
  }

  @Get("highlights")
  @RequirePermissions("scoreboard.read")
  listHighlights() {
    return this.sb.listAdminHighlights();
  }

  @Post("highlights/landing")
  @RequirePermissions("scoreboard.highlights.write")
  createLandingHighlight(@Body() dto: CreateLandingHighlightDto) {
    return this.sb.createLandingHighlight(dto);
  }

  @Patch("highlights/:id")
  @RequirePermissions("scoreboard.highlights.write")
  updateHighlight(@Param("id") id: string, @Body() dto: UpdateAdminHighlightDto) {
    return this.sb.updateHighlight(id, dto);
  }

  @Put("highlights/:id")
  @RequirePermissions("scoreboard.highlights.write")
  updateHighlightPut(@Param("id") id: string, @Body() dto: UpdateAdminHighlightDto) {
    return this.sb.updateHighlight(id, dto);
  }

  @Patch("highlights/:id/publish")
  @RequirePermissions("scoreboard.highlights.write")
  publishHighlight(@Param("id") id: string, @Body() dto: PublishHighlightDto) {
    return this.sb.setHighlightPublished(id, dto.isPublished);
  }

  @Delete("highlights/:id")
  @RequirePermissions("scoreboard.highlights.write")
  deleteHighlight(@Param("id") id: string) {
    return this.sb.deleteHighlight(id);
  }

  @Get("competitions/:competitionId/squad/export")
  @RequirePermissions("scoreboard.records.manage")
  exportSquad(
    @Param("competitionId") competitionId: string,
    @Query("format") format?: "json" | "csv"
  ) {
    return this.sb.exportCompetitionSquad(competitionId, format ?? "json");
  }

  @Post("teams/:teamId/squad/import")
  @RequirePermissions("scoreboard.records.manage")
  importSquad(@Param("teamId") teamId: string, @Body() body: { csv: string }) {
    return this.sb.importSquadCsv(teamId, body.csv);
  }

  @Get("matches/:matchId/events")
  @RequirePermissions("scoreboard.read")
  listEvents(@Param("matchId") matchId: string) {
    return this.sb.listMatchEvents(matchId);
  }

  @Post("matches/:matchId/events")
  @RequirePermissions("scoreboard.matches.write")
  createEvent(@Param("matchId") matchId: string, @Body() dto: CreateMatchEventDto) {
    return this.sb.addMatchEvent(matchId, dto);
  }

  @Delete("matches/:matchId/events/:eventId")
  @RequirePermissions("scoreboard.matches.write")
  deleteEvent(
    @Param("matchId") matchId: string,
    @Param("eventId") eventId: string
  ) {
    return this.sb.deleteMatchEvent(matchId, eventId);
  }

  @Post("matches/:matchId/csv-ingest")
  @RequirePermissions("scoreboard.matches.write")
  ingestMatchCsv(
    @Param("matchId") matchId: string,
    @Body() body: { csv: string; replace?: boolean; matchComment?: string }
  ) {
    if (!body.csv?.trim()) {
      throw new BadRequestException("csv body field is required");
    }
    return this.sb.ingestMatchTimelineCsv(
      matchId,
      body.csv,
      body.replace,
      body.matchComment
    );
  }

  @Post("matches/:matchId/short-events-csv")
  @RequirePermissions("scoreboard.matches.write")
  ingestShortMatchEventsCsv(
    @Param("matchId") matchId: string,
    @Body() body: { csv: string }
  ) {
    if (!body.csv?.trim()) {
      throw new BadRequestException("csv body field is required");
    }
    return this.sb.ingestShortMatchEventsCsv(matchId, body.csv);
  }
}
