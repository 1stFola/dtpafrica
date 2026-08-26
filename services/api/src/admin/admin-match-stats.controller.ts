import {
  BadRequestException,
  Body,
  Controller,
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

type AdminRequest = { adminAuth: AdminAuthContext };

/** Reject an unknown section rather than silently defaulting to statistics. */
function readSection(value: string): SheetSection {
  if (value === "stats" || value === "events") return value;
  throw new BadRequestException("Unknown sheet section");
}

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
    @Inject(AdminMatchStatsService) private readonly stats: AdminMatchStatsService
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

  @Get(":matchId/history")
  @RequirePermissions("scoreboard.stats.record", "scoreboard.stats.approve")
  history(@Param("matchId") matchId: string, @Req() req: AdminRequest) {
    return this.stats.history(matchId, req.adminAuth);
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
      clock: dto.clock,
      kits: dto.kits,
    });
  }

  /** Statistics and the event log are reviewed independently. */
  @Post(":matchId/:section/submit")
  @RequirePermissions("scoreboard.stats.record")
  submit(
    @Param("matchId") matchId: string,
    @Param("section") section: string,
    @Req() req: AdminRequest
  ) {
    return this.stats.submit(matchId, readSection(section), req.adminAuth);
  }

  /** A recorder asking for a locked record back. */
  @Post(":matchId/:section/request-correction")
  @RequirePermissions("scoreboard.stats.record")
  requestCorrection(
    @Param("matchId") matchId: string,
    @Param("section") section: string,
    @Body() dto: SendBackMatchStatsDto,
    @Req() req: AdminRequest
  ) {
    return this.stats.requestCorrection(matchId, readSection(section), dto.note, req.adminAuth);
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

  @Post(":matchId/:section/approve")
  @RequirePermissions("scoreboard.stats.approve")
  approve(
    @Param("matchId") matchId: string,
    @Param("section") section: string,
    @Req() req: AdminRequest
  ) {
    return this.stats.approve(matchId, readSection(section), req.adminAuth);
  }

  @Post(":matchId/:section/send-back")
  @RequirePermissions("scoreboard.stats.approve")
  sendBack(
    @Param("matchId") matchId: string,
    @Param("section") section: string,
    @Body() dto: SendBackMatchStatsDto,
    @Req() req: AdminRequest
  ) {
    return this.stats.sendBack(matchId, readSection(section), dto.note, req.adminAuth);
  }
}
