/**
 * Put the goals the events record onto the profiles that should show them.
 *
 *   pnpm --filter @dtp/api db:repair:player-stats          # report only
 *   pnpm --filter @dtp/api db:repair:player-stats --apply  # write
 *
 * On live, 435 goals and 27 assists across 285 players are correctly recorded in
 * `sb_match_events` and invisible everywhere a person looks. `Wasiu Yayah` has nine
 * goals in JOEMARK and a profile that reads zero. See
 * `db:report:player-stat-drift`, which is the read-only half of this and should be
 * run first.
 *
 * The cause: `applyMatchEventToPlayerStats` credits a goal only `if
 * (event.playerId)`, once, as the event is recorded. Every event that
 * `db:sync:event-player-links` later attached was recorded with nobody on it, so
 * nobody was credited, and nothing revisits it.
 *
 * **The two totals are corrected differently, and that asymmetry is the whole
 * design** — see `planCorrection` in `player-stat-drift.ts`. The derived
 * competition row is set to what the events say, in either direction. The career
 * total only ever goes up.
 *
 * What it deliberately does not touch:
 *
 *   - **appearances, minutes, clean sheets**, which share the row but come from
 *     match rosters at kickoff rather than events. The row is updated field by
 *     field, never replaced, and no row is deleted.
 *   - **any career total that would go down.** Those are listed instead.
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
const APPLY = process.argv.includes("--apply");

/** Taken from `applyMatchEventToPlayerStats`, not invented here. */
const GOAL_TYPES = ["goal", "goal_penalty"];
const ASSIST_TYPES = ["goal"];

function bump(map: Map<string, StatPair>, k: string, field: keyof StatPair) {
  const row = map.get(k) ?? { goals: 0, assists: 0 };
  row[field] += 1;
  map.set(k, row);
}

async function main() {
  console.log(
    `Player stats against the events — ${APPLY ? "APPLYING" : "dry run, pass --apply to write"}\n`
  );

  const events = await prisma.sbMatchEvent.findMany({
    where: {
      OR: [
        { type: { in: GOAL_TYPES }, playerId: { not: null } },
        { type: { in: ASSIST_TYPES }, assistPlayerId: { not: null } },
      ],
    },
    select: {
      id: true,
      type: true,
      playerId: true,
      assistPlayerId: true,
      metadata: true,
      match: { select: { competitionId: true } },
    },
  });

  const SEP = statKey("", "").slice(0, 1);
  const fromEvents = new Map<string, StatPair>();
  const unmarked: { id: string; metadata: unknown }[] = [];
  for (const e of events) {
    const competitionId = e.match?.competitionId;
    if (!competitionId) continue;
    if (GOAL_TYPES.includes(e.type) && e.playerId) {
      bump(fromEvents, statKey(e.playerId, competitionId), "goals");
    }
    if (ASSIST_TYPES.includes(e.type) && e.assistPlayerId) {
      bump(fromEvents, statKey(e.assistPlayerId, competitionId), "assists");
    }
    if (!(e.metadata as { statsApplied?: boolean } | null)?.statsApplied) {
      unmarked.push({ id: e.id, metadata: e.metadata });
    }
  }

  const storedRows = await prisma.sbPlayerCompetitionStats.findMany({
    select: { id: true, playerId: true, competitionId: true, goals: true, assists: true },
  });
  const rowIds = new Map(storedRows.map((r) => [statKey(r.playerId, r.competitionId), r.id]));
  const stored = new Map<string, StatPair>(
    storedRows.map((r) => [statKey(r.playerId, r.competitionId), { goals: r.goals, assists: r.assists }])
  );

  const drift = compareStats(fromEvents, stored);
  const plan = planCorrection(drift.rows);

  /* A second shortfall, of a different shape, and the reason it is computed here
     rather than further down. Merging two records for one person moves the
     competition rows to the survivor and deliberately not the career totals, then
     deletes the record holding them. Afterwards the events and the competition
     rows agree exactly -- so `plan` above is empty -- while the survivor's profile
     is short. `Nwosu Henry` came out of the live merge with five goals in the RAK
     BDFA League chart and zero on his profile. Computed after the early return
     below, this would never run in the one case that needs it. */
  const careerRows = await prisma.player.findMany({
    select: { id: true, careerGoals: true, careerAssists: true },
  });
  const career = new Map(
    careerRows.map((r) => [r.id, { goals: r.careerGoals ?? 0, assists: r.careerAssists ?? 0 }])
  );
  /* Folded from the events rather than from the stored rows, and the difference
     only shows on a row `planCorrection` declined. There, the stored row sits above
     what the events support, and levelling the career total up to it would copy a
     surplus nobody has explained into a second place. Measuring from the events
     credits slightly less than the chart shows, which is the safe direction. */
  const perPlayer = new Map<string, StatPair>();
  for (const [key, value] of fromEvents) {
    const playerId = key.split(SEP)[0]!;
    const row = perPlayer.get(playerId) ?? { goals: 0, assists: 0 };
    row.goals += value.goals;
    row.assists += value.assists;
    perPlayer.set(playerId, row);
  }
  /* Against the career total as it will stand after the pass above, not as it
     reads now — otherwise both passes credit the same goal. */
  const topUp = planCareerTopUp(projectCareerAfter(career, plan.corrections), perPlayer);

  console.log(`  ${events.length} scoring events with a player attached`);
  console.log(`  ${plan.totals.rowsSet} competition row(s) to ${APPLY ? "set" : "be set"}`);
  console.log(
    `  ${plan.totals.careerGoalsAdded} goal(s) and ${plan.totals.careerAssistsAdded} assist(s) ` +
      `to add to career totals`
  );
  console.log(`  ${plan.declined.length} row(s) whose career total is left alone`);
  console.log(
    `  ${topUp.topUps.length} career total(s) behind their own competition rows ` +
      `(${topUp.totals.goals} goal(s), ${topUp.totals.assists} assist(s) to add)\n`
  );

  if (!plan.corrections.length && !topUp.topUps.length) {
    console.log("Every total already matches the events. Nothing to do.");
    return;
  }

  const names = new Map(
    (
      await prisma.player.findMany({
        where: { id: { in: [...new Set(plan.corrections.map((c) => c.playerId))] } },
        select: { id: true, displayName: true, careerGoals: true },
      })
    ).map((p) => [p.id, p])
  );
  const comps = new Map(
    (
      await prisma.sbCompetition.findMany({
        where: { id: { in: [...new Set(plan.corrections.map((c) => c.competitionId))] } },
        select: { id: true, name: true },
      })
    ).map((c) => [c.id, c.name])
  );

  const credited = [...plan.corrections]
    .filter((c) => c.careerGoals || c.careerAssists)
    .sort((a, b) => b.careerGoals + b.careerAssists - (a.careerGoals + a.careerAssists));

  /* Skipped entirely when empty, rather than printed as a heading over nothing. A
     merge gap produces no competition correction at all, so this section having no
     rows is the normal shape of that run, not a sign anything went wrong. */
  if (credited.length) {
    console.log(`Career totals ${APPLY ? "credited" : "to credit"} (${credited.length})`);
    console.log("-".repeat(64));
    for (const c of credited.slice(0, 25)) {
      const p = names.get(c.playerId);
      const bits = [
        c.careerGoals ? `+${c.careerGoals} goal(s)` : null,
        c.careerAssists ? `+${c.careerAssists} assist(s)` : null,
      ].filter(Boolean);
      console.log(
        `  ${(p?.displayName ?? c.playerId).padEnd(26)} ${bits.join(", ").padEnd(22)}` +
          `  ${comps.get(c.competitionId) ?? ""}`
      );
    }
    if (credited.length > 25) console.log(`  … and ${credited.length - 25} more`);
  }

  if (plan.declined.length) {
    console.log(`\nCareer totals left alone (${plan.declined.length})`);
    console.log("-".repeat(64));
    console.log(
      "  The competition row is above what the events support, so it is corrected\n" +
        "  down. The career total is not: the admin's player-merge writes one without\n" +
        "  the other, so a surplus here does not prove the career figure is inflated,\n" +
        "  and reducing it could erase what a player entered at registration.\n"
    );
    for (const d of plan.declined.slice(0, 20)) {
      const p = names.get(d.playerId);
      const bits = [d.goals ? `${d.goals} goal(s)` : null, d.assists ? `${d.assists} assist(s)` : null]
        .filter(Boolean)
        .join(", ");
      console.log(
        `  ${(p?.displayName ?? d.playerId).padEnd(26)} ${bits.padEnd(22)}  ${comps.get(d.competitionId) ?? ""}`
      );
    }
    if (plan.declined.length > 20) console.log(`  … and ${plan.declined.length - 20} more`);
  }

  if (topUp.topUps.length) {
    console.log(`\nCareer totals behind their own competition rows (${topUp.topUps.length})`);
    console.log("-".repeat(64));
    console.log(
      "  A merge moves the competition rows to the survivor and leaves the career\n" +
        "  total on the record it deletes, so the profile under-reports while every\n" +
        "  other check reads clean. These go up by the shortfall, never down." + "\n"
    );
    const shortNames = new Map(
      (
        await prisma.player.findMany({
          where: { id: { in: topUp.topUps.slice(0, 25).map((t) => t.playerId) } },
          select: { id: true, displayName: true, careerGoals: true, careerAssists: true },
        })
      ).map((r) => [r.id, r])
    );
    for (const t of topUp.topUps.slice(0, 25)) {
      const pl = shortNames.get(t.playerId);
      const bits = [t.goals ? `+${t.goals} goal(s)` : null, t.assists ? `+${t.assists} assist(s)` : null]
        .filter(Boolean)
        .join(", ");
      console.log(
        `  ${(pl?.displayName ?? t.playerId).padEnd(26)} ${bits.padEnd(22)}` +
          `  profile has ${pl?.careerGoals ?? "?"} goal(s), ${pl?.careerAssists ?? "?"} assist(s)`
      );
    }
    if (topUp.topUps.length > 25) console.log(`  … and ${topUp.topUps.length - 25} more`);
  }

  if (!APPLY) {
    console.log("\n" + "-".repeat(64));
    console.log(
      `Nothing was written. Re-run with --apply.\n` +
        `It would also mark ${unmarked.length} event(s) as counted, so a later edit\n` +
        `through the admin cannot credit them a second time.`
    );
    return;
  }

  /* Field by field, and never a delete: appearances, minutes and clean sheets live
     on this row, come from match rosters rather than events, and are none of this
     script's business. */
  let rowsWritten = 0;
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
    rowsWritten += 1;

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

  /* Every event that contributed is now counted, so the flag should say so. Left
     unmarked, an admin editing one of these later would credit it a second time. */
  let marked = 0;
  for (const e of unmarked) {
    await prisma.sbMatchEvent.update({
      where: { id: e.id },
      data: {
        metadata: {
          ...((e.metadata ?? {}) as Record<string, unknown>),
          statsApplied: true,
          statsAppliedAt: new Date().toISOString(),
        } as never,
      },
    });
    marked += 1;
  }

  /* Only ever upward, for the same reason `planCorrection` declines to reduce a
     career total: the figure mixes what a player entered at registration with the
     platform's own increments, and nothing here can tell the two apart. */
  let toppedUp = 0;
  for (const t of topUp.topUps) {
    await prisma.player.update({
      where: { id: t.playerId },
      data: {
        careerGoals: t.goals ? { increment: t.goals } : undefined,
        careerAssists: t.assists ? { increment: t.assists } : undefined,
      },
    });
    toppedUp += 1;
  }

  const after = compareStats(
    fromEvents,
    new Map(
      (
        await prisma.sbPlayerCompetitionStats.findMany({
          select: { playerId: true, competitionId: true, goals: true, assists: true },
        })
      ).map((r) => [statKey(r.playerId, r.competitionId), { goals: r.goals, assists: r.assists }])
    )
  );

  console.log("\n" + "-".repeat(64));
  console.log(
    `Wrote ${rowsWritten} competition row(s), credited ` +
      `${plan.totals.careerGoalsAdded} goal(s) and ${plan.totals.careerAssistsAdded} assist(s) ` +
      `to career totals, and marked ${marked} event(s) as counted.`
  );
  if (toppedUp) {
    console.log(
      `  topped up ${toppedUp} career total(s) that had fallen behind their own ` +
        `competition rows: +${topUp.totals.goals} goal(s), +${topUp.totals.assists} assist(s)`
    );
  }
  console.log(`  competition rows still disagreeing with the events: ${after.rows.length}`);
  if (after.rows.length) {
    console.log("  WARNING: expected zero. Re-run the report and look before doing more.");
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
