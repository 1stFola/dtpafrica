/**
 * Put back the match slugs the ScoreBoard seeds pushed onto a numbered suffix.
 *
 *   pnpm --filter @dtp/api db:repair:match-slug-drift          # report only
 *   pnpm --filter @dtp/api db:repair:match-slug-drift --apply  # write
 *
 * Until createSeedMatchSlugAllocator, every seed allocated a match's slug against
 * all the slugs in the table, its own included, so each full seed moved a
 * still-scheduled match from "<home>-vs-<away>" to "<home>-vs-<away>-2" and the
 * next one moved it back. The seeds now keep whatever slug a match has, which
 * stops the movement but leaves the matches that happened to be on "-2" there.
 *
 * This moves a match to the earliest slug its pairing can take, when that slug is
 * free. Only matches that have not started are touched — scheduled, with no events
 * recorded, the same rule the seeds use. A match that has kicked off has been on
 * its current URL since before it started, and that is the URL people shared.
 *
 * A match whose slug does not belong to its current pairing (the training cup
 * names its slugs differently, or the teams were changed after the slug was given)
 * is left alone: there is no earlier slot to compare it with.
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { matchSlugCandidates, readMatchLeg } from "../src/scoreboard/match-slug";

loadApiEnv();

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

type Move = { id: string; competition: string; from: string; to: string };

async function plan(): Promise<{ moves: Move[]; startedOnSuffix: number }> {
  const all = await prisma.sbMatch.findMany({ select: { slug: true } });
  const used = new Set(all.map((r) => r.slug).filter((s): s is string => s != null));

  const matches = await prisma.sbMatch.findMany({
    where: { slug: { not: null } },
    select: {
      id: true,
      slug: true,
      status: true,
      meta: true,
      homeTeam: { select: { slug: true } },
      awayTeam: { select: { slug: true } },
      competition: { select: { name: true } },
      _count: { select: { events: true } },
    },
    orderBy: [{ kickoffAt: "asc" }, { createdAt: "asc" }],
  });

  const moves: Move[] = [];
  let startedOnSuffix = 0;
  for (const m of matches) {
    const slug = m.slug as string;
    const candidates = matchSlugCandidates(m.homeTeam.slug, m.awayTeam.slug, readMatchLeg(m.meta));
    const at = candidates.indexOf(slug);
    if (at <= 0) continue;
    if (m.status !== "scheduled" || m._count.events > 0) {
      startedOnSuffix += 1;
      continue;
    }
    const to = candidates.slice(0, at).find((c) => !used.has(c));
    if (!to) continue;
    /* Claimed as we go, so two matches of one pairing cannot both be given it. */
    used.delete(slug);
    used.add(to);
    moves.push({ id: m.id, competition: m.competition.name, from: slug, to });
  }
  return { moves, startedOnSuffix };
}

async function main() {
  console.log(`Match slug drift — ${APPLY ? "APPLYING" : "dry run, pass --apply to write"}\n`);

  const { moves, startedOnSuffix } = await plan();
  const byCompetition = new Map<string, number>();
  for (const m of moves) byCompetition.set(m.competition, (byCompetition.get(m.competition) ?? 0) + 1);

  console.log(`  ${moves.length} scheduled match(es) can move back to an earlier slug`);
  for (const [name, n] of [...byCompetition].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${name.slice(0, 48).padEnd(50)} ${String(n).padStart(4)}`);
  }
  console.log(
    `  ${startedOnSuffix} match(es) that have started are on a suffixed slug and are left alone\n`
  );

  if (!moves.length) {
    console.log("No scheduled match is on a later slug than it needs. Nothing to do.");
    return;
  }

  console.log("Slugs to move");
  console.log("-".repeat(64));
  for (const m of moves.slice(0, 40)) console.log(`  ${m.from}\n    -> ${m.to}`);
  if (moves.length > 40) console.log(`  … and ${moves.length - 40} more`);

  if (!APPLY) {
    console.log("\n" + "-".repeat(64));
    console.log("Nothing was written. Re-run with --apply.");
    return;
  }

  /* One transaction: slugs are unique, and a half-applied run would leave the
     next dry run planning against a different table. */
  await prisma.$transaction(
    moves.map((m) => prisma.sbMatch.update({ where: { id: m.id }, data: { slug: m.to } }))
  );

  const wrong: string[] = [];
  const after = await prisma.sbMatch.findMany({
    where: { id: { in: moves.map((m) => m.id) } },
    select: { id: true, slug: true },
  });
  const slugById = new Map(after.map((r) => [r.id, r.slug]));
  for (const m of moves) {
    if (slugById.get(m.id) !== m.to) wrong.push(`${m.from}: now ${slugById.get(m.id)}, expected ${m.to}`);
  }
  const again = await plan();

  console.log("\n" + "-".repeat(64));
  console.log(`Moved ${moves.length - wrong.length} of ${moves.length} slug(s).`);
  if (wrong.length || again.moves.length) {
    for (const w of wrong) console.log(`  - ${w}`);
    if (again.moves.length) console.log(`  - a fresh plan still finds ${again.moves.length} move(s)`);
    process.exitCode = 1;
  } else {
    console.log("Verified: a fresh plan finds nothing left to move.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
