/**
 * Create the United Football Championship League 2026 on ScoreBoard, on its own.
 *
 *   pnpm --filter @dtp/api db:seed:ufc-league          # report only
 *   pnpm --filter @dtp/api db:seed:ufc-league --apply  # write
 *
 * The league is also part of the full ScoreBoard seed, but that runs every
 * competition's seed, and several of them re-allocate the slugs of their scheduled
 * matches on each run. This runs only the UFC seed, which keeps an existing
 * match's slug, so creating the league moves no other competition's URLs.
 *
 * Safe to run twice: every write is an upsert on a fixed id, and a match that has
 * kicked off or had events recorded is left alone.
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import {
  COMP_SLUG,
  MATCHES,
  TEAMS,
  seedUnitedFootballChampionshipLeague2026,
} from "../prisma/seed-united-football-championship-league-2026";

loadApiEnv();

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function report(label: string) {
  const comp = await prisma.sbCompetition.findUnique({
    where: { slug: COMP_SLUG },
    select: { id: true, name: true, status: true, isPublished: true },
  });
  if (!comp) {
    console.log(`${label}: no competition with slug ${COMP_SLUG}`);
    return null;
  }
  const [teams, matches] = await Promise.all([
    prisma.sbTeam.findMany({ where: { competitionId: comp.id }, select: { slug: true, logoUrl: true } }),
    prisma.sbMatch.findMany({
      where: { competitionId: comp.id },
      select: { id: true, slug: true, status: true, kickoffAt: true, homeTeamId: true, awayTeamId: true },
    }),
  ]);
  console.log(
    `${label}: ${comp.name} (${comp.status}, ${comp.isPublished ? "published" : "hidden"}) — ` +
      `${teams.length} teams, ${matches.length} matches`
  );
  return { comp, teams, matches };
}

/** Read back what is in the database and say what is still wrong. */
function problems(state: NonNullable<Awaited<ReturnType<typeof report>>>): string[] {
  const out: string[] = [];
  const teamSlugs = new Set(state.teams.map((t) => t.slug));
  for (const t of TEAMS) if (!teamSlugs.has(t.slug)) out.push(`missing team ${t.slug}`);
  const byId = new Map(state.matches.map((m) => [m.id, m]));
  for (const m of MATCHES) {
    const row = byId.get(m.id);
    if (!row) out.push(`missing match ${m.match} (${m.homeSlug} v ${m.awaySlug})`);
    else if (row.status === "scheduled" && row.kickoffAt?.getTime() !== new Date(m.kickoffAt).getTime())
      out.push(`match ${m.match} kickoff ${row.kickoffAt?.toISOString()} != ${m.kickoffAt}`);
  }
  const pairs = new Set<string>();
  const played = new Map<string, number>();
  for (const m of state.matches) {
    const pair = [m.homeTeamId, m.awayTeamId].sort().join("|");
    if (pairs.has(pair)) out.push(`pairing played twice: ${m.slug}`);
    pairs.add(pair);
    for (const t of [m.homeTeamId, m.awayTeamId]) played.set(t, (played.get(t) ?? 0) + 1);
  }
  for (const [team, n] of played) if (n !== TEAMS.length - 1) out.push(`team ${team} has ${n} matches`);
  return out;
}

async function main() {
  console.log(
    `United Football Championship League 2026 — ${APPLY ? "APPLYING" : "dry run, pass --apply to write"}\n`
  );
  console.log(`  Source: ${TEAMS.length} teams, ${MATCHES.length} matches`);
  console.log(`  Teams without a crest: ${TEAMS.filter((t) => !t.logoUrl).map((t) => t.name).join(", ") || "none"}\n`);

  const before = await report("Before");
  if (!APPLY) {
    console.log("\nNothing was written. Re-run with --apply.");
    return;
  }

  await seedUnitedFootballChampionshipLeague2026(prisma);

  const after = await report("After");
  const wrong = after ? problems(after) : ["competition was not created"];
  if (before && after) {
    const moved = before.matches.filter((m) => after.matches.find((a) => a.id === m.id)?.slug !== m.slug);
    if (moved.length) wrong.push(`${moved.length} match slug(s) changed on this run`);
  }
  console.log("\n" + "-".repeat(64));
  if (wrong.length) {
    console.log(`${wrong.length} problem(s) after writing:`);
    for (const w of wrong) console.log(`  - ${w}`);
    process.exitCode = 1;
  } else {
    console.log(`Verified: every team and match is in place. /scoreboard/competition/${COMP_SLUG}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
