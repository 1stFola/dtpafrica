import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { backfillMissingMatchSlugs } from "../scoreboard/match-slug";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();

    const missing = await this.sbMatch.count({ where: { slug: null } });
    if (missing > 0) {
      const updated = await backfillMissingMatchSlugs(this);
      if (updated > 0) {
        console.log(`[sb_match] backfilled ${updated} match slug(s)`);
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
