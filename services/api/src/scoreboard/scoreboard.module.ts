import { Module } from "@nestjs/common";
import { SipModule } from "../sip/sip.module";
import { ScoreboardController } from "./scoreboard.controller";
import { ScoreboardService } from "./scoreboard.service";

@Module({
  imports: [SipModule],
  controllers: [ScoreboardController],
  providers: [ScoreboardService],
})
export class ScoreboardModule {}
