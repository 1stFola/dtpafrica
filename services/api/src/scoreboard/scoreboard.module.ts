import { Module } from "@nestjs/common";
import { SipModule } from "../sip/sip.module";
import { CompetitionEngineService } from "./competition-engine.service";
import { PlayerDirectoryService } from "./player-directory.service";
import { ScoreboardController } from "./scoreboard.controller";
import { ScoreboardLifecycleService } from "./scoreboard-lifecycle.service";
import { ScoreboardService } from "./scoreboard.service";
import { LiveAudioCommentaryService } from "./live-audio-commentary.service";

@Module({
  imports: [SipModule],
  controllers: [ScoreboardController],
  providers: [
    ScoreboardService,
    LiveAudioCommentaryService,
    CompetitionEngineService,
    ScoreboardLifecycleService,
    PlayerDirectoryService,
  ],
  exports: [
    ScoreboardService,
    LiveAudioCommentaryService,
    CompetitionEngineService,
    ScoreboardLifecycleService,
    PlayerDirectoryService,
  ],
})
export class ScoreboardModule {}
