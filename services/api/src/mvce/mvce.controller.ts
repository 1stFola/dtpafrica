import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AdminApiKeyGuard } from "../admin/guards/admin-api-key.guard";
import { GenerateValuationDto } from "./dto/generate-valuation.dto";
import { MvceService } from "./mvce.service";

@Controller("mvce")
export class MvceController {
  constructor(@Inject(MvceService) private readonly mvce: MvceService) {}

  @Get("players")
  listValuedPlayers() {
    return this.mvce.listPlayersWithValuations();
  }

  @Post("valuation/generate")
  @UseGuards(AdminApiKeyGuard)
  generate(@Body() dto: GenerateValuationDto) {
    return this.mvce.generate(dto);
  }

  @Get("valuation/report/:playerId")
  report(@Param("playerId") playerId: string) {
    return this.mvce.report(playerId);
  }

  @Get("valuation/compare")
  compare(@Query("ids") ids: string) {
    return this.mvce.compare(ids);
  }
}
