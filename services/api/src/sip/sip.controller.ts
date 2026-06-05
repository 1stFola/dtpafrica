import { Controller, Inject, Param, Post } from "@nestjs/common";
import { SipRecalculationService } from "./sip-recalculation.service";

@Controller("sip/players")
export class SipController {
  constructor(
    @Inject(SipRecalculationService) private readonly sipRecalc: SipRecalculationService
  ) {}

  @Post(":playerId/recalculate")
  recalculate(@Param("playerId") playerId: string) {
    return this.sipRecalc.recalculatePlayer(playerId);
  }
}
