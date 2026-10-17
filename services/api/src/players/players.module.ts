import { Module } from "@nestjs/common";
import { AdminGuardsModule } from "../admin/admin-guards.module";
import { PlayersController } from "./players.controller";
import { PlayersService } from "./players.service";

@Module({
  imports: [AdminGuardsModule],
  controllers: [PlayersController],
  providers: [PlayersService],
  exports: [PlayersService],
})
export class PlayersModule {}
