import { Controller, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { RequirePermissions } from "../admin/decorators/require-permissions.decorator";
import { AdminAuthGuard } from "../admin/guards/admin-auth.guard";
import { PermissionsGuard } from "../admin/guards/permissions.guard";
import { SipRecalculationService } from "./sip-recalculation.service";

@Controller("sip/players")
export class SipController {
  constructor(
    @Inject(SipRecalculationService) private readonly sipRecalc: SipRecalculationService
  ) {}

  @Post(":playerId/recalculate")
  @UseGuards(AdminAuthGuard, PermissionsGuard)
  @RequirePermissions("players.calibrate")
  recalculate(@Param("playerId") playerId: string) {
    return this.sipRecalc.recalculatePlayer(playerId);
  }
}
