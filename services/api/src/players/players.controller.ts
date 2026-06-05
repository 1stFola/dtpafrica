import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { CreatePlayerDto } from "./dto/create-player.dto";
import { PlayersService } from "./players.service";

@Controller("players")
export class PlayersController {
  constructor(@Inject(PlayersService) private readonly players: PlayersService) {}

  @Get()
  list(@Query("limit") limit?: string) {
    return this.players.list(limit ? Number(limit) : 50);
  }

  @Post()
  create(@Body() dto: CreatePlayerDto) {
    return this.players.create(dto);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.players.getById(id);
  }

  @Get(":id/tactical-scores")
  tacticalScores(@Param("id") id: string) {
    return this.players.getTacticalScores(id);
  }

  @Get(":id/position-fit")
  positionFit(@Param("id") id: string) {
    return this.players.getPositionFit(id);
  }

  @Get(":id/tactical-profile")
  tacticalProfile(@Param("id") id: string) {
    return this.players.getTacticalProfile(id);
  }
}
