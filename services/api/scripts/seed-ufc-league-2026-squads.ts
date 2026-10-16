/**
 * Put the registered squads of the United Football Championship League 2026 on
 * ScoreBoard, on their own.
 *
 *   pnpm --filter @dtp/api db:seed:ufc-squads          # report only
 *   pnpm --filter @dtp/api db:seed:ufc-squads --apply  # write
 *
 * The squads are also part of the full ScoreBoard seed, which the admin
 * Database page runs. This writes only the UFC squad rows and reads them back,
 * so it can be run on live without touching any other league's data.
 *
 * Safe to run twice: a player is resolved before being created, a squad row is
 * created only when the team has no row for that player, and the second run
 * reports every row as already in place.
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { COMP_SLUG, TEAMS } from "../prisma/seed-united-football-championship-league-2026";
import {
  ROSTERS,
  rosterProblems,
  seedUnitedFootballChampionshipLeague2026Squads,
} from "../prisma/seed-united-football-championship-league-2026-squads";

loadApiEnv();

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function report(label: string) {
  const comp = await prisma.sbCompetition.findUnique({
    where: { slug: COMP_SLUG },
    select: { id: true, name: true },
  });
  if (!comp) {
    console.log(`${label}: no competition with slug ${COMP_SLUG}`);
    return null;
  }
  const teams = await prisma.sbTeam.findMany({
    where: { competitionId: comp.id },
    orderBy: { name: "asc" },
    select: {
      slug: true,
      name: true,
      squad: { select: { playerId: true, displayName: true } },
    },
  });
  console.log(`${label}: ${comp.name} — ${teams.length} teams`);
  for (const t of teams) {
    const unlinked = t.squad.filter((s) => !s.playerId).length;
    console.log(
      `  ${t.name.padEnd(36)} ${String(t.squad.length).padStart(3)} in squad` +
        (unlinked ? `, ${unlinked} without a player link` : "")
    );
  }
  return { comp, teams };
}

/** Read back what is in the database and say what is still wrong. */
function problems(state: NonNullable<Awaited<ReturnType<typeof report>>>, heldBack: string[]): string[] {
  const out: string[] = [];
  const bySlug = new Map(state.teams.map((t) => [t.slug, t]));
  for (const roster of ROSTERS) {
    const team = bySlug.get(roster.teamSlug);
    if (!team) {
      out.push(`missing team ${roster.teamSlug}`);
      continue;
    }
    const names = new Set(team.squad.map((s) => s.displayName.toLowerCase()));
    for (const row of roster.players) {
      const held = heldBack.some((h) => h.startsWith(`${row.name} (${team.name}`));
      if (!held && !names.has(row.name.toLowerCase())) {
        out.push(`${team.name}: ${row.name} is not in the squad`);
      }
    }
    const unlinked = team.squad.filter((s) => !s.playerId).length;
    if (unlinked) out.push(`${team.name}: ${unlinked} squad row(s) have no player link`);
  }
  return out;
}

async function main() {
  console.log(
    `United Football Championship League 2026 squads — ${APPLY ? "APPLYING" : "dry run, pass --apply to write"}\n`
  );
  const listed = ROSTERS.reduce((n, r) => n + r.players.length, 0);
  const missing = TEAMS.filter((t) => !ROSTERS.some((r) => r.teamSlug === t.slug)).map((t) => t.name);
  console.log(`  Source: ${listed} registered players across ${ROSTERS.length} clubs`);
  console.log(`  Clubs with no registration: ${missing.join(", ") || "none"}`);
  const dataProblems = rosterProblems();
  if (dataProblems.length) {
    console.log(`  Roster data problems:\n    - ${dataProblems.join("\n    - ")}`);
    process.exitCode = 1;
    return;
  }
  console.log();

  await report("Before");
  if (!APPLY) {
    console.log("\nNothing was written. Re-run with --apply.");
    return;
  }

  console.log();
  const result = await seedUnitedFootballChampionshipLeague2026Squads(prisma);
  console.log();
  const after = await report("After");
  const wrong = after ? problems(after, result.heldBack) : ["competition was not found"];
  console.log("\n" + "-".repeat(64));
  if (wrong.length) {
    console.log(`${wrong.length} problem(s) after writing:`);
    for (const w of wrong) console.log(`  - ${w}`);
    process.exitCode = 1;
  } else {
    console.log(
      `Verified: every registered player is in a squad` +
        (result.heldBack.length ? ` except the ${result.heldBack.length} held back above` : "") +
        `. /scoreboard/competition/${COMP_SLUG}`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
