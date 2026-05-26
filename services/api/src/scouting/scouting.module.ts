import { Module } from "@nestjs/common";
import { ScoutingController } from "./scouting.controller";
import { ScoutingService } from "./scouting.service";

@Module({
  controllers: [ScoutingController],
  providers: [ScoutingService],
})
export class ScoutingModule {}
