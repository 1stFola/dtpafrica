import { Controller, Get, Inject, Query } from "@nestjs/common";
import { ScoutingService } from "./scouting.service";

@Controller("scouting")
export class ScoutingController {
  constructor(@Inject(ScoutingService) private readonly scouting: ScoutingService) {}

  @Get("meta")
  meta() {
    return this.scouting.meta();
  }

  @Get("tactical-search")
  tacticalSearch(
    @Query("position") position?: string,
    @Query("ageGroup") ageGroup?: string,
    @Query("minGegenpress") minGegenpress?: string,
    @Query("limit") limit?: string
  ) {
    return this.scouting.tacticalSearch({
      position,
      ageGroup,
      minGegenpress: minGegenpress != null ? Number(minGegenpress) : undefined,
      limit: limit != null ? Number(limit) : undefined,
    });
  }

  @Get("philosophy-fit")
  philosophyFit(
    @Query("formation") formation: string,
    @Query("philosophy") philosophy: string,
    @Query("playerId") playerId?: string,
    @Query("slotId") slotId?: string,
    @Query("limit") limit?: string
  ) {
    return this.scouting.philosophyFit({
      formation,
      philosophy,
      playerId,
      slotId,
      limit: limit != null ? Number(limit) : undefined,
    });
  }

  @Get("strong-xi")
  strongXi(
    @Query("formation") formation: string,
    @Query("philosophy") philosophy: string
  ) {
    return this.scouting.strongXi(formation, philosophy);
  }

  @Get("player-comparison")
  playerComparison(@Query("ids") ids: string) {
    return this.scouting.playerComparison(ids);
  }
}
