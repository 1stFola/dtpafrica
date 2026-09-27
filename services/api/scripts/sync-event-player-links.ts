/**
 * Link goal and assist labels to the player rows behind them.
 *
 *   pnpm --filter @dtp/api db:sync:event-player-links          # report only
 *   pnpm --filter @dtp/api db:sync:event-player-links --apply  # write
 *
 * The matching itself already existed, but only ever ran inside the full scoreboard
 * seed. That is the wrong shape for the problem, because the two things come apart in
 * time: labels get corrected later — by hand, or by a repair script — and the links
 * are only ever attempted *before* that. The JOEMARK fixtures showed it exactly. A
 * goal recorded as a bare `Daniel` matched nobody, the seed moved on, and when the
 * label was later corrected to `Onyedigbo Daniel` there was nothing left to re-run
 * short of re-seeding the whole competition.
 *
 * **What an unlinked label costs.** The goal still shows on the fixture, so it looks
 * fine. It just never reaches the scorer's profile or the stat leaders — the player
 * has a goal the product does not know about. Nothing surfaces that on its own, which
 * is why this reports the failures rather than only counting the successes.
 *
 * Safe to run repeatedly: a link is only ever *added*, never replaced, so a
 * correction somebody made by hand survives this.
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import {
  syncScoreboardEventPlayerLinks,
  type UnresolvedLink,
} from "../prisma/sync-scoreboard-event-player-links";

loadApiEnv();

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
/** How many unresolved labels to list per team before summarising the rest. */
const PER_TEAM = 8;

/** Group the failures the way somebody would act on them: by competition, then team. */
function byCompetitionAndTeam(rows: UnresolvedLink[]) {
  const out = new Map<string, Map<string, UnresolvedLink[]>>();
  for (const row of rows) {
    const comp = row.competition ?? "(no competition)";
    const team = row.team ?? "(no team)";
    const teams = out.get(comp) ?? new Map<string, UnresolvedLink[]>();
    out.set(comp, teams);
    teams.set(team, [...(teams.get(team) ?? []), row]);
  }
  return out;
}

async function main() {
  console.log(
    `ScoreBoard event player links — ${APPLY ? "APPLYING" : "dry run, pass --apply to write"}\n`
  );

  const result = await syncScoreboardEventPlayerLinks(prisma, { dryRun: !APPLY });

  console.log(`  ${APPLY ? "linked" : "would link"}   ${result.updated} event(s)`);
  console.log(`  unresolved  ${result.unresolved.length} label(s)`);

  if (!result.unresolved.length) {
    console.log("\nEvery label with a player behind it is linked.");
    return;
  }

  /* Split by reason, because the two need different actions. A missing squad row is
     somebody's data-entry job; an ambiguous name cannot be settled by more data, and
     guessing would attribute a goal to the wrong person. */
  const missing = result.unresolved.filter((r) => r.reason === "no_match");
  const ambiguous = result.unresolved.filter((r) => r.reason === "ambiguous");

  if (missing.length) {
    console.log(
      `\nNo matching player (${missing.length}) — the squad has no row for this name`
    );
    console.log("-".repeat(64));
    for (const [comp, teams] of byCompetitionAndTeam(missing)) {
      console.log(`  ${comp}`);
      for (const [team, rows] of teams) {
        console.log(`    ${team}  (${rows.length})`);
        /* Capped per team: a competition whose events carry jersey numbers instead of
           names produces hundreds of these, and burying the three that are somebody's
           data-entry job under them defeats the point of reporting at all. */
        for (const r of rows.slice(0, PER_TEAM)) {
          const min = r.minute === null ? "" : `  ${r.minute}'`;
          console.log(`      ${r.label}${r.field === "assist" ? "  (assist)" : ""}${min}`);
        }
        if (rows.length > PER_TEAM) console.log(`      … and ${rows.length - PER_TEAM} more`);
      }
    }
  }

  if (ambiguous.length) {
    console.log(
      `\nAmbiguous (${ambiguous.length}) — more than one player answers to this name`
    );
    console.log("-".repeat(64));
    for (const [comp, teams] of byCompetitionAndTeam(ambiguous)) {
      console.log(`  ${comp}`);
      for (const [team, rows] of teams) {
        for (const r of rows) {
          console.log(`    ${team}: ${r.label}  (${r.candidates} candidates)`);
        }
      }
    }
    console.log(
      "\n  Left unlinked on purpose. Attributing one of these to the wrong player is\n" +
        "  worse than leaving the goal unattributed, so the label needs disambiguating\n" +
        "  at the source — a fuller name on the event, or distinct squad entries."
    );
  }

  if (!APPLY) console.log("\nNothing was written. Re-run with --apply.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
