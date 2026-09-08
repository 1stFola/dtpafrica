import {
  ConflictException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { runDatabaseSeed } from "../seed/run-seed";
import {
  getSeedRunStatus,
  markSeedRunFinished,
  markSeedRunStarted,
  type SeedRunStatus,
} from "../seed/seed-status.store";

@Injectable()
export class AdminSeedService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  getStatus(): SeedRunStatus {
    return getSeedRunStatus();
  }

  run(): SeedRunStatus {
    const current = getSeedRunStatus();
    if (current.running) {
      throw new ConflictException("Database seed is already running");
    }

    markSeedRunStarted();
    void runDatabaseSeed(this.prisma)
      .then((result) => markSeedRunFinished(result))
      .catch((err) => {
        markSeedRunFinished({
          ok: false,
          mode: "incremental",
          durationMs: 0,
          seedPlayerId: "",
          counts: {
            players: 0,
            academies: 0,
            competitions: 0,
            blogPosts: 0,
            legacyPlayers: 0,
            legacyAcademies: 0,
            legacyAcademyLinks: 0,
            staticContentKeys: 0,
          },
          legacySampleSlugs: [],
          errors: [
            {
              phase: "seed",
              message: err instanceof Error ? err.message : String(err),
            },
          ],
          completedAt: new Date().toISOString(),
        });
      });

    return getSeedRunStatus();
  }
}
