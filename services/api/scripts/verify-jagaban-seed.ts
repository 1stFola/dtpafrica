/**
 * Verify Jagaban Cup 2026 seed counts. Run: tsx scripts/verify-jagaban-seed.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const comp = await prisma.sbCompetition.findUnique({
    where: { slug: "jagaban-cup-2026" },
    include: {
      teams: { orderBy: { groupKey: "asc" } },
      stages: { orderBy: { sortOrder: "asc" } },
      matches: {
        orderBy: [{ matchday: "asc" }, { kickoffAt: "asc" }],
        include: { _count: { select: { events: true } }, homeTeam: true, awayTeam: true },
      },
    },
  });

  if (!comp) {
    console.error("Competition jagaban-cup-2026 not found. Run: pnpm db:seed");
    process.exit(1);
  }

  const events = await prisma.sbMatchEvent.count({
    where: { match: { competitionId: comp.id } },
  });

  const finished = comp.matches.filter((m) => m.status === "finished").length;

  console.log(JSON.stringify({
    slug: comp.slug,
    formatType: comp.formatType,
    teams: comp.teams.length,
    stages: comp.stages.length,
    matches: comp.matches.length,
    finished,
    events,
    groups: {
      A: comp.teams.filter((t) => t.groupKey === "A").map((t) => t.name),
      B: comp.teams.filter((t) => t.groupKey === "B").map((t) => t.name),
    },
    matchList: comp.matches.map((m) => ({
      round: m.roundLabel,
      score: `${m.homeTeam.shortName ?? m.homeTeam.name} ${m.homeScore}-${m.awayScore} ${m.awayTeam.shortName ?? m.awayTeam.name}`,
      events: m._count.events,
      hasNarrative: !!(m.stats as { narrative?: string } | null)?.narrative,
    })),
  }, null, 2));

  const ok = comp.matches.length === 14 && finished === 14 && events >= 30;
  if (!ok) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
