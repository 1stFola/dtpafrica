import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { backfillMissingMatchSlugs } from "../scoreboard/match-slug";
import { apiDatabaseUrl } from "./statement-timeout";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // DATABASE_URL with a per-statement ceiling for the API's queries (./statement-timeout).
    const url = apiDatabaseUrl();
    super(url ? { datasourceUrl: url } : {});
  }

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
