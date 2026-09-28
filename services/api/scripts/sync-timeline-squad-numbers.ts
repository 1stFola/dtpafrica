/**
 * Put the squad's names onto the shirt numbers already in the timeline.
 *
 *   pnpm --filter @dtp/api db:sync:timeline-squad-numbers          # report only
 *   pnpm --filter @dtp/api db:sync:timeline-squad-numbers --apply  # write
 *
 * The recorder console captures a shirt number, and until now three separate places
 * resolved that number against the **matchday** squad alone. Most fixtures have no
 * matchday squad, so the number resolved to nobody: the event was stored with
 * `playerLabel` = `No. 7` and `playerId` = null, the goal reached no profile and no
 * scoring chart, and the timeline showed a number where a person should be. The names
 * were in `SbTeamSquad` the whole time, a table none of the three consulted.
 *
 * The console and both read paths now resolve team squad first, matchday squad second
 * — see `src/scoreboard/squad-number-lookup.ts`. This is the other half: every finished
 * match already recorded, brought up to the same answer.
 *
 * **What it will not do.**
 *
 *   - **It never writes a null over a value.** When a number cannot be resolved the
 *     existing label and link are left exactly as they are. A backfill that blanked
 *     what it could not improve would lose work somebody did by hand.
 *   - **It never resolves an ambiguous number.** Two squad rows sharing number 7 make
 *     the number meaningless, and guessing would attribute a goal by accident and look
 *     deliberate afterwards. Those are reported instead.
 *   - **It never reduces a career total.** Consistent with `planCorrection`: a career
 *     figure mixes what a player entered at registration with the platform's
 *     increments, and nothing here can separate them.
 *
 * **Re-attribution is the part to read carefully.** Where an event already links to a
 * player and the shirt number resolves to a *different* one, this moves the goal. That
 * is usually right — the number is what the recorder entered at pitchside, while an
 * existing link was often inferred from a name by `db:sync:event-player-links` — but it
 * changes who scored, so every one is listed separately in the dry run and counted
 * apart from the rest. Read that list before applying.
 *
 * **Stats are corrected in the same pass**, and by the same rules as
 * `db:repair:player-stats`: competition rows are *set* to what the events say rather
 * than incremented, so a second run cannot inflate anything and a goal moved away from
 * a player reduces their competition total as it should. Scoped to the players this run
 * touched, so it never quietly corrects unrelated drift.
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import {
  applyTimelineNumberFixes,
  planTimelineNumberFixes,
  type TimelineFix,
} from "../src/scoreboard/resolve-timeline-numbers";
import {
  compareStats,
  planCareerTopUp,
  planCorrection,
  projectCareerAfter,
  statKey,
  type StatPair,
} from "./player-stat-drift";

loadApiEnv();

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const SHOWN = 25;

/** Taken from `applyMatchEventToPlayerStats`, not invented here. */
const GOAL_TYPES = ["goal", "goal_penalty"];
const ASSIST_TYPES = ["goal"];



async function main() {
  console.log(
    `Timeline shirt numbers against the squads — ${APPLY ? "APPLYING" : "dry run, pass --apply to write"}\n`
  );

  const matches = await prisma.sbMatch.findMany({
    where: { status: "finished" },
    select: {
      id: true,
      homeTeamId: true,
      awayTeamId: true,
      kickoffAt: true,
      homeTeam: { select: { name: true } },
      awayTeam: { select: { name: true } },
    },
    orderBy: { kickoffAt: "asc" },
  });


  /* The planning and the writing both live in src/scoreboard/resolve-timeline-numbers.ts
     so the squad CSV import runs the same pass the moment a team's numbers arrive. Two
     implementations of this would drift, and the cost of drift is a goal on the wrong
     profile. This script chooses the matches -- every finished fixture -- and the
     import chooses its own. */
  const plan = await planTimelineNumberFixes(prisma as never, matches.map((m) => ({
    id: m.id,
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    label: `${m.homeTeam.name} v ${m.awayTeam.name}`,
  })));
  const planned = plan.fixes;
  const { conflicts, ambiguous, unresolved, noTeam } = plan;
  const eventsSeen = plan.eventsSeen;
  const matchesWithNumbers = plan.matchesWithNumbers;

  const reattributions = planned.filter((p: TimelineFix) => p.reattribution);
  const fills = planned.filter((p: TimelineFix) => !p.reattribution);

  console.log(`  ${matches.length} finished match(es), ${matchesWithNumbers} with numbered events`);
  console.log(`  ${eventsSeen} event(s) carrying a shirt number`);
  console.log(`  ${fills.length} event(s) to gain a name that had none`);
  console.log(`  ${reattributions.length} event(s) whose player would change`);
  console.log(`  ${unresolved.length} number(s) no squad can resolve`);
  console.log(`  ${conflicts.length} number(s) the two squads disagree about`);
  console.log(`  ${ambiguous.length} number(s) worn by two different players\n`);
  console.log(`  ${noTeam.length} numbered event(s) with no team on them
`);

  if (!planned.length) {
    console.log("Every numbered event already names the right player. Nothing to do.");
    reportProblems(unresolved, conflicts, ambiguous);
    return;
  }

  if (fills.length) {
    console.log(`Names to attach (${fills.length})`);
    console.log("-".repeat(78));
    for (const p of fills.slice(0, SHOWN)) {
      console.log(
        `  ${p.matchLabel.slice(0, 40).padEnd(42)} ${String(p.minute).padStart(3)}' ${p.type}`
      );
      console.log(`      No. ${p.number} → ${p.nowLabel}`);
    }
    if (fills.length > SHOWN) console.log(`  … and ${fills.length - SHOWN} more`);
  }

  if (reattributions.length) {
    console.log(`\nPlayer would change (${reattributions.length}) — read this list`);
    console.log("-".repeat(78));
    console.log(
      "  The event already links to a player and the shirt number resolves to a\n" +
        "  different one, so this moves the goal. The number is what the recorder entered\n" +
        "  at pitchside and an existing link was often inferred from a name, so the number\n" +
        "  usually wins — but it changes who scored, and that is worth a look.\n"
    );
    const names = await namesFor([
      ...reattributions.flatMap((p: TimelineFix) => [p.wasPlayerId, p.nowPlayerId]),
    ]);
    for (const p of reattributions.slice(0, SHOWN)) {
      console.log(
        `  ${p.matchLabel.slice(0, 40).padEnd(42)} ${String(p.minute).padStart(3)}' ${p.type}`
      );
      console.log(
        `      No. ${p.number}: ${names.get(p.wasPlayerId ?? "") ?? p.wasLabel ?? "?"}` +
          ` → ${names.get(p.nowPlayerId ?? "") ?? p.nowLabel}`
      );
    }
    if (reattributions.length > SHOWN) {
      console.log(`  … and ${reattributions.length - SHOWN} more`);
    }
  }

  reportProblems(unresolved, conflicts, ambiguous);

  if (!APPLY) {
    console.log("\n" + "-".repeat(78));
    console.log(
      "Nothing was written. Re-run with --apply.\n" +
        "It would then correct the competition and career totals of every player whose\n" +
        "events changed, by the same rules as db:repair:player-stats."
    );
    return;
  }

  /* The write is the module's too, so the CSV import and this script cannot diverge
     on what a fix means. Each event's label and link move in one update: an event
     whose label names one player and whose link points at another is worse than one
     naming nobody, because nothing on the page shows the disagreement. */
  const { written, touched } = await applyTimelineNumberFixes(prisma as never, planned);
  console.log("\n" + "-".repeat(78));
  console.log(`Wrote ${written} event(s), touching ${touched.length} player(s).`);

  const corrected = await correctStatsFor(touched);
  console.log(
    `Set ${corrected.rowsSet} competition row(s) and topped up ${corrected.careerToppedUp} ` +
      `career total(s) (+${corrected.careerGoals} goal(s), +${corrected.careerAssists} assist(s)).`
  );

  /* Re-read rather than trust the writes. A number still unresolved after a run means
     the lookup does not do what its tests say. */
  const after = await prisma.sbMatchEvent.count({
    where: { id: { in: planned.map((p: TimelineFix) => p.eventId) }, playerLabel: { startsWith: "No. " } },
  });
  const stillBare = await prisma.sbMatchEvent.findMany({
    where: { id: { in: planned.map((p: TimelineFix) => p.eventId) } },
    select: { playerLabel: true },
  });
  const bare = stillBare.filter((e) => /^No\.\s*\d+$/.test(e.playerLabel ?? "")).length;
  console.log(`  events written that still read as a bare number: ${bare}`);
  if (bare > 0) {
    console.log("  WARNING: expected zero. Re-run the dry run and look before doing more.");
    process.exitCode = 1;
  }
  void after;
}

async function namesFor(ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return new Map<string, string>();
  const rows = await prisma.player.findMany({
    where: { id: { in: wanted } },
    select: { id: true, displayName: true },
  });
  return new Map(rows.map((r) => [r.id, r.displayName]));
}

/**
 * Bring these players' stored totals back in line with their events.
 *
 * The same rules as `db:repair:player-stats`, reusing the same planner rather than a
 * second copy of them: the competition row is **set** to what the events say, in either
 * direction, so a goal this run moved away from a player reduces their total as it
 * should and a second run cannot inflate anything. The career total only ever goes up.
 *
 * Scoped to the players this run touched. Running the unscoped comparison here would
 * quietly correct unrelated drift under cover of a name fix.
 */
async function correctStatsFor(playerIds: string[]) {
  if (!playerIds.length) {
    return { rowsSet: 0, careerToppedUp: 0, careerGoals: 0, careerAssists: 0 };
  }

  const events = await prisma.sbMatchEvent.findMany({
    where: {
      OR: [
        { type: { in: GOAL_TYPES }, playerId: { in: playerIds } },
        { type: { in: ASSIST_TYPES }, assistPlayerId: { in: playerIds } },
      ],
    },
    select: {
      type: true,
      playerId: true,
      assistPlayerId: true,
      match: { select: { competitionId: true } },
    },
  });

  const bump = (map: Map<string, StatPair>, k: string, field: keyof StatPair) => {
    const row = map.get(k) ?? { goals: 0, assists: 0 };
    row[field] += 1;
    map.set(k, row);
  };
  const fromEvents = new Map<string, StatPair>();
  for (const e of events) {
    const competitionId = e.match?.competitionId;
    if (!competitionId) continue;
    if (GOAL_TYPES.includes(e.type) && e.playerId && playerIds.includes(e.playerId)) {
      bump(fromEvents, statKey(e.playerId, competitionId), "goals");
    }
    if (
      ASSIST_TYPES.includes(e.type) &&
      e.assistPlayerId &&
      playerIds.includes(e.assistPlayerId)
    ) {
      bump(fromEvents, statKey(e.assistPlayerId, competitionId), "assists");
    }
  }

  const storedRows = await prisma.sbPlayerCompetitionStats.findMany({
    where: { playerId: { in: playerIds } },
    select: { id: true, playerId: true, competitionId: true, goals: true, assists: true },
  });
  const rowIds = new Map(storedRows.map((r) => [statKey(r.playerId, r.competitionId), r.id]));
  const stored = new Map<string, StatPair>(
    storedRows.map((r) => [
      statKey(r.playerId, r.competitionId),
      { goals: r.goals, assists: r.assists },
    ])
  );

  const plan = planCorrection(compareStats(fromEvents, stored).rows);
  for (const c of plan.corrections) {
    const id = rowIds.get(statKey(c.playerId, c.competitionId));
    if (id) {
      await prisma.sbPlayerCompetitionStats.update({
        where: { id },
        data: { goals: c.setGoals, assists: c.setAssists },
      });
    } else {
      await prisma.sbPlayerCompetitionStats.create({
        data: {
          playerId: c.playerId,
          competitionId: c.competitionId,
          goals: c.setGoals,
          assists: c.setAssists,
        },
      });
    }
    if (c.careerGoals || c.careerAssists) {
      await prisma.player.update({
        where: { id: c.playerId },
        data: {
          careerGoals: c.careerGoals ? { increment: c.careerGoals } : undefined,
          careerAssists: c.careerAssists ? { increment: c.careerAssists } : undefined,
        },
      });
    }
  }

  /* And the merge-shaped gap, the same way `db:repair:player-stats` closes it: a career
     total below the competition rows beneath it, measured against the figure as it
     stands after the corrections above so the same goal is not credited twice. */
  const careerRows = await prisma.player.findMany({
    where: { id: { in: playerIds } },
    select: { id: true, careerGoals: true, careerAssists: true },
  });
  const career = new Map(
    careerRows.map((r) => [r.id, { goals: r.careerGoals ?? 0, assists: r.careerAssists ?? 0 }])
  );
  const SEP = statKey("", "").slice(0, 1);
  const perPlayer = new Map<string, StatPair>();
  for (const [key, value] of fromEvents) {
    const playerId = key.split(SEP)[0]!;
    const row = perPlayer.get(playerId) ?? { goals: 0, assists: 0 };
    row.goals += value.goals;
    row.assists += value.assists;
    perPlayer.set(playerId, row);
  }
  const topUp = planCareerTopUp(projectCareerAfter(career, plan.corrections), perPlayer);
  for (const t of topUp.topUps) {
    await prisma.player.update({
      where: { id: t.playerId },
      data: {
        careerGoals: t.goals ? { increment: t.goals } : undefined,
        careerAssists: t.assists ? { increment: t.assists } : undefined,
      },
    });
  }

  return {
    rowsSet: plan.totals.rowsSet,
    careerToppedUp: topUp.topUps.length,
    careerGoals: plan.totals.careerGoalsAdded + topUp.totals.goals,
    careerAssists: plan.totals.careerAssistsAdded + topUp.totals.assists,
  };
}

function reportProblems(
  unresolved: { matchLabel: string; number: number; minute: number }[],
  conflicts: { matchLabel: string; number: number; team: string; matchday: string }[],
  ambiguous: { matchLabel: string; number: number; source: string; names: string[] }[]
) {
  if (ambiguous.length) {
    console.log(`\nNumbers two different players wear (${ambiguous.length})`);
    console.log("-".repeat(78));
    console.log(
      "  Resolved to nobody, deliberately. Picking whichever row came back first would\n" +
        "  attribute a goal by accident and look deliberate afterwards. Fix the squad and\n" +
        "  run this again.\n"
    );
    for (const a of ambiguous.slice(0, SHOWN)) {
      console.log(`  ${a.matchLabel.slice(0, 40).padEnd(42)} No. ${a.number} (${a.source} squad)`);
      console.log(`      ${a.names.join(" / ")}`);
    }
    if (ambiguous.length > SHOWN) console.log(`  … and ${ambiguous.length - SHOWN} more`);
  }

  if (conflicts.length) {
    console.log(`\nNumbers the two squads disagree about (${conflicts.length})`);
    console.log("-".repeat(78));
    console.log(
      "  The team squad wins, which is the chosen precedence. Listed because that\n" +
        "  overrules a matchday lineup somebody entered for one fixture — a guest wearing\n" +
        "  the shirt, most likely — and a silent overrule is the indefensible part.\n"
    );
    for (const c of conflicts.slice(0, SHOWN)) {
      console.log(
        `  ${c.matchLabel.slice(0, 40).padEnd(42)} No. ${c.number}: ` +
          `team squad "${c.team}" over matchday "${c.matchday}"`
      );
    }
    if (conflicts.length > SHOWN) console.log(`  … and ${conflicts.length - SHOWN} more`);
  }

  if (unresolved.length) {
    const byNumber = new Map<string, number>();
    for (const u of unresolved) {
      const k = `${u.matchLabel}|${u.number}`;
      byNumber.set(k, (byNumber.get(k) ?? 0) + 1);
    }
    console.log(`\nNumbers no squad can resolve (${unresolved.length} event(s))`);
    console.log("-".repeat(78));
    console.log(
      "  Nobody in either squad wears this number, so the event keeps whatever label it\n" +
        "  already had. Usually a squad that was never loaded for that team. Loading it\n" +
        "  and running this again is what fixes these.\n"
    );
    for (const [k, count] of [...byNumber].slice(0, SHOWN)) {
      const [label, number] = k.split("|");
      console.log(`  ${label!.slice(0, 40).padEnd(42)} No. ${number}  ×${count}`);
    }
    if (byNumber.size > SHOWN) console.log(`  … and ${byNumber.size - SHOWN} more`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
