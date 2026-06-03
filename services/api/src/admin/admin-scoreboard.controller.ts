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
import { AdminApiKeyGuard } from "./guards/admin-api-key.guard";
import {
  AdminScoreboardService,
  type MatchdayRosterPayload,
} from "./admin-scoreboard.service";
import { CreateAdminHighlightDto } from "./dto/create-admin-highlight.dto";
import { CreateLandingHighlightDto } from "./dto/create-landing-highlight.dto";
import { PublishHighlightDto } from "./dto/publish-highlight.dto";
import { UpdateAdminHighlightDto } from "./dto/update-admin-highlight.dto";
import { CreateMatchEventDto } from "../scoreboard/dto/create-event.dto";
import {
  CreateCompetitionFromTemplateDto,
  isCompetitionFormat,
} from "./dto/create-competition-from-template.dto";
import { PatchSpotterOpsDto } from "./dto/patch-spotter-ops.dto";

@Controller("admin/scoreboard")
@UseGuards(AdminApiKeyGuard)
export class AdminScoreboardController {
  constructor(
    @Inject(AdminScoreboardService) private readonly sb: AdminScoreboardService
  ) {}

  @Get("stats")
  stats() {
    return this.sb.stats();
  }

  @Get("templates")
  listTemplates() {
    return this.sb.listCompetitionTemplates();
  }

  @Get("templates/:format/preview")
  previewTemplate(@Param("format") format: string) {
    if (!isCompetitionFormat(format)) {
      throw new BadRequestException("Unknown competition format");
    }
    return this.sb.previewCompetitionTemplate(format);
  }

  @Post("competitions/from-template")
  createFromTemplate(@Body() dto: CreateCompetitionFromTemplateDto) {
    if (!isCompetitionFormat(dto.formatType)) {
      throw new BadRequestException("Unknown competition format");
    }
    return this.sb.createCompetitionFromTemplate(dto);
  }

  @Get("competitions/:competitionId/standings/groups")
  groupStandings(@Param("competitionId") competitionId: string) {
    return this.sb.groupStandings(competitionId);
  }

  @Get("competitions/picker")
  competitionPicker() {
    return this.sb.listCompetitionPicker();
  }

  @Get("competitions")
  competitions(
    @Query("status") status?: string,
    @Query("type") type?: string,
    @Query("q") q?: string
  ) {
    return this.sb.listCompetitions({ status, type, q });
  }

  @Get("teams")
  teams(@Query("q") q?: string, @Query("competitionId") competitionId?: string) {
    return this.sb.listTeams({ q, competitionId });
  }

  @Get("players")
  players(@Query("q") q?: string) {
    return this.sb.listScoreboardPlayers(q);
  }

  @Get("matches")
  matches(@Query("competitionId") competitionId?: string) {
    return this.sb.listMatches(competitionId);
  }

  @Get("seed/competitions/export")
  async exportCompetitions() {
    return { csv: await this.sb.exportCompetitionsCsv() };
  }

  @Get("seed/teams/export")
  async exportTeams(@Query("competitionId") competitionId?: string) {
    return { csv: await this.sb.exportTeamsCsv(competitionId) };
  }

  @Post("seed/competitions/import")
  importCompetitions(@Body() body: { csv: string }) {
    return this.sb.importCompetitionsCsv(body.csv);
  }

  @Post("seed/teams/import")
  importTeams(@Body() body: { csv: string; competitionId: string }) {
    return this.sb.importTeamsCsv(body.csv, body.competitionId);
  }

  @Get("matches/:matchId/roster")
  getRoster(@Param("matchId") matchId: string, @Query("teamId") teamId: string) {
    return this.sb.getMatchRoster(matchId, teamId);
  }

  @Put("matches/:matchId/roster")
  saveRoster(
    @Param("matchId") matchId: string,
    @Body() body: MatchdayRosterPayload
  ) {
    return this.sb.saveMatchRoster(matchId, body);
  }

  @Get("matches/:matchId/spotter")
  spotterState(@Param("matchId") matchId: string) {
    return this.sb.getSpotterOps(matchId);
  }

  @Patch("matches/:matchId/spotter")
  patchSpotter(@Param("matchId") matchId: string, @Body() dto: PatchSpotterOpsDto) {
    return this.sb.patchSpotterOps(matchId, dto);
  }

  @Post("highlights")
  createHighlight(@Body() dto: CreateAdminHighlightDto) {
    return this.sb.createHighlight(dto);
  }

  @Get("highlights")
  listHighlights() {
    return this.sb.listAdminHighlights();
  }

  @Post("highlights/landing")
  createLandingHighlight(@Body() dto: CreateLandingHighlightDto) {
    return this.sb.createLandingHighlight(dto);
  }

  @Patch("highlights/:id")
  updateHighlight(@Param("id") id: string, @Body() dto: UpdateAdminHighlightDto) {
    return this.sb.updateHighlight(id, dto);
  }

  /** PUT alias for clients expecting RESTful update verb. */
  @Put("highlights/:id")
  updateHighlightPut(@Param("id") id: string, @Body() dto: UpdateAdminHighlightDto) {
    return this.sb.updateHighlight(id, dto);
  }

  @Patch("highlights/:id/publish")
  publishHighlight(@Param("id") id: string, @Body() dto: PublishHighlightDto) {
    return this.sb.setHighlightPublished(id, dto.isPublished);
  }

  @Delete("highlights/:id")
  deleteHighlight(@Param("id") id: string) {
    return this.sb.deleteHighlight(id);
  }

  @Get("competitions/:competitionId/squad/export")
  exportSquad(
    @Param("competitionId") competitionId: string,
    @Query("format") format?: "json" | "csv"
  ) {
    return this.sb.exportCompetitionSquad(competitionId, format ?? "json");
  }

  @Post("teams/:teamId/squad/import")
  importSquad(@Param("teamId") teamId: string, @Body() body: { csv: string }) {
    return this.sb.importSquadCsv(teamId, body.csv);
  }

  @Get("matches/:matchId/events")
  listEvents(@Param("matchId") matchId: string) {
    return this.sb.listMatchEvents(matchId);
  }

  @Post("matches/:matchId/events")
  createEvent(@Param("matchId") matchId: string, @Body() dto: CreateMatchEventDto) {
    return this.sb.addMatchEvent(matchId, dto);
  }

  @Delete("matches/:matchId/events/:eventId")
  deleteEvent(
    @Param("matchId") matchId: string,
    @Param("eventId") eventId: string
  ) {
    return this.sb.deleteMatchEvent(matchId, eventId);
  }
}
