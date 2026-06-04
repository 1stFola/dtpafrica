import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { BenchmarksModule } from "./benchmarks/benchmarks.module";
import { MetricsModule } from "./metrics/metrics.module";
import { PlayersModule } from "./players/players.module";
import { PrismaModule } from "./prisma/prisma.module";
import { AdminModule } from "./admin/admin.module";
import { HomeModule } from "./home/home.module";
import { MvceModule } from "./mvce/mvce.module";
import { ScoreboardModule } from "./scoreboard/scoreboard.module";
import { ScoutingModule } from "./scouting/scouting.module";
import { SipModule } from "./sip/sip.module";
import { AcademyAuthModule } from "./academy-auth/academy-auth.module";
import { AcademyDashboardModule } from "./academy-dashboard/academy-dashboard.module";

@Module({
  controllers: [HealthController],
  imports: [
    PrismaModule,
    PlayersModule,
    MetricsModule,
    SipModule,
    ScoutingModule,
    HomeModule,
    AdminModule,
    ScoreboardModule,
    MvceModule,
    BenchmarksModule,
    AcademyAuthModule,
    AcademyDashboardModule,
  ],
})
export class AppModule {}
