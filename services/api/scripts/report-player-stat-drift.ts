/**
 * Goals the events record, that no profile is showing.
 *
 *   pnpm --filter @dtp/api db:report:player-stat-drift
 *
 * **Read-only. There is no `--apply`.** The point of this pass is to find out how
 * far the totals have drifted, and in which direction, before anyone writes a
 * number. A report that finds only shortfalls can be corrected mechanically; one
 * that also finds surpluses cannot, because a surplus means something was counted
 * twice or an event was deleted after being counted, and that wants explaining
 * rather than flattening.
 *
 * Why there is drift at all. `applyMatchEventToPlayerStats` credits a goal only
 * `if (event.playerId)`. An event recorded with nobody attached credits nobody,
 * and nothing revisits it when the link is added later — which is precisely what
 * `db:sync:event-player-links` has been doing, 97 events in its most recent run.
 * Those goals are correctly attributed in `sb_match_events` and invisible on the
 * player's profile, because the profile reads a stored total rather than counting
 * events.
 *
 * See `player-stat-drift.ts` for why the career total and the competition total
 * are different kinds of number, and why only one of them can be reconciled.
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
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

/** Taken from `applyMatchEventToPlayerStats`, not invented here. */
const GOAL_TYPES = ["goal", "goal_penalty"];
const ASSIST_TYPES = ["goal"];

function bump(map: Map<string, StatPair>, k: string, field: keyof StatPair) {
  const row = map.get(k) ?? { goals: 0, assists: 0 };
  row[field] += 1;
  map.set(k, row);
}

async function main() {
  console.log("Goals the events record, that no profile is showing\n");
  console.log("  Read-only. Nothing here changes any number.\n");

  const events = await prisma.sbMatchEvent.findMany({
    where: {
      OR: [
        { type: { in: GOAL_TYPES }, playerId: { not: null } },
        { type: { in: ASSIST_TYPES }, assistPlayerId: { not: null } },
      ],
    },
    select: {
      type: true,
      playerId: true,
      assistPlayerId: true,
      metadata: true,
      match: { select: { competitionId: true } },
    },
  });

  const SEP = statKey("", "").slice(0, 1);
  const fromEvents = new Map<string, StatPair>();
  let applied = 0;
  let unapplied = 0;
  for (const e of events) {
    const competitionId = e.match?.competitionId;
    if (!competitionId) continue;
    if (GOAL_TYPES.includes(e.type) && e.playerId) {
      bump(fromEvents, statKey(e.playerId, competitionId), "goals");
    }
    if (ASSIST_TYPES.includes(e.type) && e.assistPlayerId) {
      bump(fromEvents, statKey(e.assistPlayerId, competitionId), "assists");
    }
    /* Whether the event was ever counted. The flag is set only after a credit is
       written, and the credit is skipped when there is no player — so an event
       linked afterwards still reads false, and can be credited without counting
       it twice. That is the fact a correction would rest on. */
    if ((e.metadata as { statsApplied?: boolean } | null)?.statsApplied) applied += 1;
    else unapplied += 1;
  }

  const storedRows = await prisma.sbPlayerCompetitionStats.findMany({
    select: { playerId: true, competitionId: true, goals: true, assists: true },
  });
  const stored = new Map<string, StatPair>(
    storedRows.map((r) => [statKey(r.playerId, r.competitionId), { goals: r.goals, assists: r.assists }])
  );

  const drift = compareStats(fromEvents, stored);

  console.log(`  ${events.length} scoring events with a player attached`);
  console.log(`  ${storedRows.length} stored player/competition rows\n`);

  console.log("Competition stats — derived, and reconcilable");
  console.log("-".repeat(64));
  console.log(`  ${drift.behind.length} row(s) behind the events`);
  console.log(
    `     ${drift.totals.missingGoals} goal(s) and ${drift.totals.missingAssists} assist(s) ` +
      `uncredited, across ${drift.totals.playersBehind} player(s)`
  );
  console.log(`  ${drift.ahead.length} row(s) ahead of the events`);

  const names = new Map(
    (
      await prisma.player.findMany({
        where: { id: { in: [...new Set(drift.rows.map((r) => r.playerId))] } },
        select: { id: true, displayName: true, careerGoals: true, careerAssists: true },
      })
    ).map((p) => [p.id, p])
  );
  const comps = new Map(
    (
      await prisma.sbCompetition.findMany({
        where: { id: { in: [...new Set(drift.rows.map((r) => r.competitionId))] } },
        select: { id: true, name: true },
      })
    ).map((c) => [c.id, c.name])
  );

  const worst = [...drift.behind].sort(
    (a, b) => b.missing.goals + b.missing.assists - (a.missing.goals + a.missing.assists)
  );
  if (worst.length) {
    console.log("\n  Most affected");
    for (const row of worst.slice(0, 20)) {
      const p = names.get(row.playerId);
      const bits = [
        row.missing.goals > 0 ? `${row.missing.goals} goal(s)` : null,
        row.missing.assists > 0 ? `${row.missing.assists} assist(s)` : null,
      ].filter(Boolean);
      console.log(
        `    ${(p?.displayName ?? row.playerId).padEnd(26)} ${bits.join(", ").padEnd(24)}` +
          `  ${comps.get(row.competitionId) ?? row.competitionId}`
      );
      console.log(
        `      profile shows ${p?.careerGoals ?? "?"} career goal(s); ` +
          `this competition alone has ${row.fromEvents.goals} in the events`
      );
    }
    if (worst.length > 20) console.log(`    … and ${worst.length - 20} more`);
  }

  if (drift.ahead.length) {
    console.log("\nAhead of the events — needs explaining, not correcting");
    console.log("-".repeat(64));
    console.log(
      "  A stored total above what the events support means something was counted\n" +
        "  twice, or an event was deleted after being counted. Correcting these\n" +
        "  downward would hide whichever it is.\n"
    );
    for (const row of drift.ahead.slice(0, 15)) {
      const p = names.get(row.playerId);
      console.log(
        `    ${(p?.displayName ?? row.playerId).padEnd(26)} stored ${row.stored.goals}g/${row.stored.assists}a` +
          `  events ${row.fromEvents.goals}g/${row.fromEvents.assists}a  ${comps.get(row.competitionId) ?? ""}`
      );
    }
  }

  /* Second pass, and a different comparison. A merge moves the competition rows to
     the survivor and cannot move the career total, then deletes the record holding
     it -- so afterwards the events and the competition rows agree while the profile
     is short. The pass above cannot see that, because it only ever compares those
     two.

     `mergePlayerRecords` now closes this as the rows move, so a non-zero figure
     here means a merge that predates that fix -- or a path that does not go through
     it, which would be worth finding. */
  const careerRows = await prisma.player.findMany({
    select: { id: true, careerGoals: true, careerAssists: true },
  });
  const career = new Map(
    careerRows.map((p) => [p.id, { goals: p.careerGoals ?? 0, assists: p.careerAssists ?? 0 }])
  );
  /* Folded from the events rather than the stored rows, so a row that is ahead of
     the events does not raise a career total to match a surplus nobody has
     explained. See the section above for why those are reported, not corrected. */
  const perPlayer = new Map<string, StatPair>();
  for (const [k, v] of fromEvents) {
    const pid = k.split(SEP)[0]!;
    const row = perPlayer.get(pid) ?? { goals: 0, assists: 0 };
    row.goals += v.goals;
    row.assists += v.assists;
    perPlayer.set(pid, row);
  }
  /* Against the career total as it would stand after the correction above, not as
     it reads now. The competition pass credits the career total as it sets each
     row, so measuring against the figure as read would report the same shortfall
     in both sections and make the repair look like it owed twice. */
  const topUp = planCareerTopUp(
    projectCareerAfter(career, planCorrection(drift.rows).corrections),
    perPlayer
  );

  console.log("\nCareer totals behind their own competition rows");
  console.log("-".repeat(64));
  console.log(
    `  ${topUp.topUps.length} player(s) short by ${topUp.totals.goals} goal(s) and ` +
      `${topUp.totals.assists} assist(s)`
  );
  if (topUp.topUps.length) {
    console.log(
      "\n  A merge moves the competition rows and leaves the career total behind, so\n" +
        "  the profile under-reports while every other check reads clean.\n"
    );
    const named = await prisma.player.findMany({
      where: { id: { in: topUp.topUps.slice(0, 20).map((t) => t.playerId) } },
      select: { id: true, displayName: true, careerGoals: true },
    });
    const byId = new Map(named.map((n) => [n.id, n]));
    for (const t of topUp.topUps.slice(0, 20)) {
      const pl = byId.get(t.playerId);
      console.log(
        `    ${(pl?.displayName ?? t.playerId).padEnd(26)} profile shows ${pl?.careerGoals ?? "?"}, ` +
          `competition rows total ${(pl?.careerGoals ?? 0) + t.goals}`
      );
    }
  }

  console.log("\nCareer totals — not reconcilable, and should not be");
  console.log("-".repeat(64));
  console.log(
    "  `Player.careerGoals` mixes the record a player typed in at registration with\n" +
      "  the platform's own increments. Recomputing it from events would erase what\n" +
      "  somebody entered about themselves. What can be said is that the platform's\n" +
      `  share is short by the same ${drift.totals.missingGoals} goal(s) and ` +
      `${drift.totals.missingAssists} assist(s)\n  counted above, so a correction adds that delta rather than overwriting.`
  );

  console.log("\nWhether a correction could double-count");
  console.log("-".repeat(64));
  console.log(`  ${applied} event(s) already marked as counted`);
  console.log(`  ${unapplied} event(s) not marked — creditable without counting twice`);
  if (unapplied === 0 && drift.totals.missingGoals > 0) {
    console.log(
      "\n  WARNING: everything is marked as counted, yet totals are short. The flag\n" +
        "  cannot be trusted as the guard for a correction here."
    );
  }

  console.log("\n" + "-".repeat(64));
  console.log("Nothing was changed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
