import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AdminAuthGuard } from "./guards/admin-auth.guard";
import { PermissionsGuard } from "./guards/permissions.guard";
import { RequirePermissions } from "./decorators/require-permissions.decorator";
import { AdminMatchStatsService, type SheetSection } from "./admin-match-stats.service";
import { SaveMatchStatsDto, SendBackMatchStatsDto } from "./dto/match-stats.dto";
import type { AdminAuthContext } from "./auth/admin-auth.types";
import { LiveAudioCommentaryService } from "../scoreboard/live-audio-commentary.service";

type AdminRequest = { adminAuth: AdminAuthContext };

/**
 * Live match statistics console.
 *
 * Every mutation re-checks the acting admin's permissions inside the service.
 * The decorators below are the coarse gate; the service enforces the state
 * machine and sheet ownership, so hitting the API directly cannot bypass the
 * recorder/supervisor split.
 */
@Controller("admin/scoreboard/match-stats")
@UseGuards(AdminAuthGuard, PermissionsGuard)
export class AdminMatchStatsController {
  constructor(
    @Inject(AdminMatchStatsService) private readonly stats: AdminMatchStatsService,
    @Inject(LiveAudioCommentaryService) private readonly liveAudio: LiveAudioCommentaryService
  ) {}

  /** Supervisor queue — sheets waiting on a decision. */
  @Get("queue")
  @RequirePermissions("scoreboard.stats.approve")
  queue(@Req() req: AdminRequest) {
    return this.stats.listSubmitted(req.adminAuth);
  }

  /**
   * Fixtures this account may record for, already scoped to their competition.
   * Recorders use this instead of the general fixtures calendar, which needs
   * `scoreboard.read` and would also unlock the internal-only views.
   */
  @Get("fixtures")
  @RequirePermissions("scoreboard.stats.record", "scoreboard.stats.approve")
  fixtures(
    @Req() req: AdminRequest,
    @Query("from") from?: string,
    @Query("to") to?: string
  ) {
    return this.stats.listFixtures(req.adminAuth, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  /** Headline counts for the recorder's landing page. */
  @Get("totals")
  @RequirePermissions("scoreboard.stats.record", "scoreboard.stats.approve")
  totals(@Req() req: AdminRequest) {
    return this.stats.myTotals(req.adminAuth);
  }

  /** Every recording the idle sweep has stopped. Feeds the dashboard and match-stats
   *  panels. Declared above `GET :matchId`, which would otherwise take "idle-locked"
   *  as a match id and answer every request with a missing match. */
  @Get("idle-locked")
  @RequirePermissions("scoreboard.stats.approve")
  listIdleLocked(@Req() req: AdminRequest) {
    return this.stats.listIdleLocked(req.adminAuth);
  }

  /* Practice matches. Declared above the ":matchId" routes so "training" is
     never swallowed as a match id. */
  @Post("training")
  @RequirePermissions("scoreboard.stats.record")
  startTraining(@Req() req: AdminRequest) {
    return this.stats.createTrainingMatch(req.adminAuth);
  }

  @Delete("training/:matchId")
  @RequirePermissions("scoreboard.stats.record")
  deleteTraining(@Param("matchId") matchId: string, @Req() req: AdminRequest) {
    return this.stats.deleteTrainingMatch(matchId, req.adminAuth);
  }

  @Get(":matchId/history")
  @RequirePermissions("scoreboard.stats.record", "scoreboard.stats.approve")
  history(@Param("matchId") matchId: string, @Req() req: AdminRequest) {
    return this.stats.history(matchId, req.adminAuth);
  }

  @Post(":matchId/live-audio/ticket")
  @RequirePermissions("scoreboard.stats.record")
  async createLiveAudioTicket(@Param("matchId") matchId: string, @Req() req: AdminRequest) {
    await this.stats.assertLiveAudioAccess(matchId, req.adminAuth);
    return this.liveAudio.createRecorderTicket(matchId, () => this.stats.assertLiveAudioAccess(matchId, req.adminAuth));
  }

  @Get(":matchId/live-audio/status")
  @RequirePermissions("scoreboard.stats.record", "scoreboard.stats.approve")
  async liveAudioStatus(@Param("matchId") matchId: string, @Req() req: AdminRequest) {
    await this.stats.openSheet(matchId, req.adminAuth);
    return this.liveAudio.status(matchId);
  }

  @Post(":matchId/live-audio/http/start")
  @RequirePermissions("scoreboard.stats.record")
  async startLiveAudioHttp(
    @Param("matchId") matchId: string,
    @Body() body: { ticket?: string; mimeType?: string },
    @Req() req: AdminRequest
  ) {
    await this.stats.assertLiveAudioAccess(matchId, req.adminAuth);
    try {
      return await this.liveAudio.startHttpRecorder(matchId, body.ticket || "", body.mimeType);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Could not start live audio"
      );
    }
  }

  @Post(":matchId/live-audio/http/chunk")
  @RequirePermissions("scoreboard.stats.record")
  async liveAudioHttpChunk(
    @Param("matchId") matchId: string,
    @Body() body: { sessionId?: string; mimeType?: string; data?: string },
    @Req() req: AdminRequest
  ) {
    await this.stats.assertLiveAudioAccess(matchId, req.adminAuth);
    try {
      return this.liveAudio.pushHttpChunk(body.sessionId || "", body.mimeType, body.data, matchId);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Could not send live audio"
      );
    }
  }

  @Post(":matchId/live-audio/http/stop")
  @RequirePermissions("scoreboard.stats.record")
  async liveAudioHttpStop(
    @Param("matchId") matchId: string,
    @Body() body: { sessionId?: string },
    @Req() req: AdminRequest
  ) {
    await this.stats.assertLiveAudioAccess(matchId, req.adminAuth, { allowAfterFullTime: true, allowWhenPublicLiveOff: true });
    return this.liveAudio.stopHttpRecorder(body.sessionId || "", matchId);
  }

  @Get(":matchId")
  @RequirePermissions("scoreboard.stats.record", "scoreboard.stats.approve")
  open(@Param("matchId") matchId: string, @Req() req: AdminRequest) {
    return this.stats.openSheet(matchId, req.adminAuth);
  }

  @Put(":matchId")
  @RequirePermissions("scoreboard.stats.record")
  save(
    @Param("matchId") matchId: string,
    @Body() dto: SaveMatchStatsDto,
    @Req() req: AdminRequest
  ) {
    return this.stats.saveTallies(matchId, dto.tallies, req.adminAuth, {
      events: dto.events,
      removedEventIds: dto.removedEventIds,
      clock: dto.clock,
      kits: dto.kits,
    });
  }

  /* Statistics and the event log are submitted and reviewed as one record:
     the events feed the statistics, so signing off half of it means nothing. */
  @Post(":matchId/submit")
  @RequirePermissions("scoreboard.stats.record")
  submit(@Param("matchId") matchId: string, @Req() req: AdminRequest) {
    return this.stats.submit(matchId, req.adminAuth);
  }

  /** A recorder asking for a locked record back. */
  @Post(":matchId/request-correction")
  @RequirePermissions("scoreboard.stats.record")
  requestCorrection(
    @Param("matchId") matchId: string,
    @Body() dto: SendBackMatchStatsDto,
    @Req() req: AdminRequest
  ) {
    return this.stats.requestCorrection(matchId, dto.note, req.adminAuth);
  }

  /** An admin turning that request down, leaving the record locked. */
  @Post(":matchId/decline-correction")
  @RequirePermissions("scoreboard.stats.approve")
  declineCorrection(
    @Param("matchId") matchId: string,
    @Body() dto: SendBackMatchStatsDto,
    @Req() req: AdminRequest
  ) {
    return this.stats.declineCorrection(matchId, dto.note, req.adminAuth);
  }

  /** Release a stopped recording. The note is required: it is the only record of why. */
  @Post(":matchId/release-idle-lock")
  @RequirePermissions("scoreboard.stats.approve")
  releaseIdleLock(
    @Param("matchId") matchId: string,
    @Body() dto: SendBackMatchStatsDto,
    @Req() req: AdminRequest
  ) {
    return this.stats.releaseIdleLock(matchId, dto.note, req.adminAuth);
  }

  @Post(":matchId/approve")
  @RequirePermissions("scoreboard.stats.approve")
  approve(@Param("matchId") matchId: string, @Req() req: AdminRequest) {
    return this.stats.approve(matchId, req.adminAuth);
  }

  @Post(":matchId/send-back")
  @RequirePermissions("scoreboard.stats.approve")
  sendBack(
    @Param("matchId") matchId: string,
    @Body() dto: SendBackMatchStatsDto,
    @Req() req: AdminRequest
  ) {
    return this.stats.sendBack(matchId, dto.note, req.adminAuth);
  }
}
