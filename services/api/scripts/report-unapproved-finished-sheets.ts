/**
 * Finished matches whose stat sheet was never submitted or approved.
 *
 *   pnpm --filter @dtp/api db:report:unapproved-finished-sheets
 *
 * **Read-only. There is no `--apply`**, deliberately: approval is a human decision with a
 * permission behind it (`scoreboard.stats.approve`), and publishing sixteen matches on a
 * script's say-so would put figures on the public site that nobody reviewed.
 *
 * On live this found sixteen, from 21 August to 24 September. They are invisible on the
 * ScoreBoard — a finished match shows its stored score and no live state, whatever its
 * sheet says — so nothing is broken in public. What approval would add is the published
 * match timeline (`sb_match_events` rows) and the Statistics tab, both of which an
 * unapproved sheet withholds.
 *
 * The new auto-submit will not retire this backlog. Its sweep requires `fullTimeAt`, a
 * column that only starts being written now, so it fixes the flow from here on and leaves
 * these exactly where they are.
 *
 * The question this answers is whether there is anything in them worth publishing. A
 * console opened and abandoned with no events and no tallies is not a backlog item; it is
 * litter. One with forty events and a full set of tallies is a match that was recorded
 * properly and never sent for approval, and those are worth somebody's time.
 *
 * **And now a second question: what happens on the next save.** Public live approval used
 * to default off, and the full-time score sync sits behind it, so for these sheets nothing
 * was ever carried across. It defaults on, so the next time one of them is saved at full
 * time the sheet's goals become the match score. `planFinalScoreSync` holds that where the
 * published timeline holds events this console did not write -- three of the live sixteen --
 * and this report says which, so a held match is visible before somebody wonders why its
 * score never moved.
 *
 * The second section is the set the old query could not see: a sheet whose clock reads full
 * time while its match is still down as scheduled or live. That combination exists only
 * because the sync was switched off, and the next save is what ends it.
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import {
  effectiveTallies,
  normaliseTallies,
  readClock,
  readEvents,
  scoreFromEvents,
  totalsFor,
} from "../src/admin/admin-match-stats.service";
import { planFinalScoreSync } from "../src/admin/final-score-sync";

loadApiEnv();

const prisma = new PrismaClient();

/** Stats published into `SbMatch.stats` carry this marker when a sheet was approved. */
function hasPublishedStats(stats: unknown): boolean {
  return Boolean(
    stats && typeof stats === "object" && "manualStatsMeta" in (stats as Record<string, unknown>)
  );
}

/**
 * How many stat lines the published Statistics tab would carry.
 *
 * Deliberately `effectiveTallies`, the function approval itself publishes through, so this
 * counts what would actually appear: recorded tallies plus the lines the events imply. The
 * raw tallies alone would under-report a sheet whose recorder filed events and left the
 * tally buttons alone — and that sheet is exactly the kind worth approving.
 */
function filledStatLines(tallies: unknown, events: ReturnType<typeof readEvents>): number {
  const totals = totalsFor(effectiveTallies(normaliseTallies(tallies), events));
  return Object.values(totals).filter(
    (pair) => (pair?.home ?? 0) > 0 || (pair?.away ?? 0) > 0
  ).length;
}

async function main() {
  console.log("Finished matches whose sheet was never approved\n");
  console.log("  Read-only. Approval is a human decision and stays one.\n");

  /* `sheetStatus` is approved only when both tracks are, so a sheet with one track short of
     it is unapproved -- the old test read the statistics column alone and would have passed
     over a sheet whose event log was still open. */
  const unapproved = {
    OR: [{ status: { not: "approved" } }, { eventsStatus: { not: "approved" } }],
  };
  const select = {
    matchId: true,
    status: true,
    eventsStatus: true,
    tallies: true,
    events: true,
    clock: true,
    recorderName: true,
    updatedAt: true,
    match: {
      select: {
        status: true,
        kickoffAt: true,
        homeScore: true,
        awayScore: true,
        stats: true,
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
        competition: { select: { name: true } },
      },
    },
  } as const;

  const [sheets, others] = await Promise.all([
    prisma.sbMatchStatistics.findMany({
      where: { ...unapproved, match: { status: "finished" } },
      select,
    }),
    /* Everything else unapproved, filtered to full time below. The clock is JSON, so the
       phase cannot be a query -- and `fullTimeAt` cannot stand in for it, because it only
       started being written recently and these sheets are older than that. */
    prisma.sbMatchStatistics.findMany({
      where: { ...unapproved, match: { status: { not: "finished" } } },
      select,
    }),
  ]);
  const atFullTime = others.filter((sheet) => readClock(sheet.clock)?.phase === "finished");

  if (!sheets.length && !atFullTime.length) {
    console.log("None. Every finished match has an approved sheet.");
    return;
  }

  /* Two counts rather than one, because where a published event came from decides whether
     approving is an update or a collision.

     Approval deletes only the events this console published -- its `deleteMany` is scoped to
     `metadata.source = "match_recorder"` -- and recreates them from the sheet. Events entered
     through the match-event editor survive it. But the score is set from the sheet's goal
     events alone, so approving a thin sheet over a match recorded elsewhere leaves the
     scoreline and the timeline contradicting each other. */
  const matchIds = [...sheets, ...atFullTime].map((s) => s.matchId);
  const [allCounts, recorderCounts] = await Promise.all([
    prisma.sbMatchEvent.groupBy({
      by: ["matchId"],
      where: { matchId: { in: matchIds } },
      _count: { _all: true },
    }),
    prisma.sbMatchEvent.groupBy({
      by: ["matchId"],
      where: {
        matchId: { in: matchIds },
        metadata: { path: ["source"], equals: "match_recorder" },
      },
      _count: { _all: true },
    }),
  ]);
  const published = new Map(allCounts.map((row) => [row.matchId, row._count._all]));
  const fromRecorder = new Map(recorderCounts.map((row) => [row.matchId, row._count._all]));

  const describe = (sheet: (typeof sheets)[number]) => {
    const events = readEvents(sheet.events);
    const score = scoreFromEvents(events);
    const stored = { home: sheet.match.homeScore, away: sheet.match.awayScore };
    const fromElsewhere =
      (published.get(sheet.matchId) ?? 0) - (fromRecorder.get(sheet.matchId) ?? 0);
    return {
      label: `${sheet.match.homeTeam.name} v ${sheet.match.awayTeam.name}`,
      competition: sheet.match.competition?.name ?? "—",
      kickoff: sheet.match.kickoffAt,
      recorder: sheet.recorderName ?? "—",
      status: sheet.status,
      eventsStatus: sheet.eventsStatus ?? "—",
      events: events.length,
      statLines: filledStatLines(sheet.tallies, events),
      publishedEvents: published.get(sheet.matchId) ?? 0,
      publishedFromRecorder: fromRecorder.get(sheet.matchId) ?? 0,
      matchStatus: sheet.match.status,
      publishedElsewhere: fromElsewhere,
      publishedStats: hasPublishedStats(sheet.match.stats),
      /* What the next save of this sheet would do to the published score, decided by the
         same function the server decides with. */
      syncPlan: planFinalScoreSync({
        sheet: score,
        published: stored,
        eventsFromElsewhere: fromElsewhere,
      }),
      /* A sheet whose events disagree with the stored score is the one case where
         approving would change what the public already sees. */
      scoreAgrees: score.home === stored.home && score.away === stored.away,
      /* Goals the public would lose. Negative means approving would raise the score, which
         is still a change worth reading but is not a loss. */
      goalsRemoved: stored.home + stored.away - (score.home + score.away),
      score: `${score.home}-${score.away}`,
      stored: `${stored.home}-${stored.away}`,
      touched: sheet.updatedAt,
    };
  };

  const rows = sheets.map(describe);

  const worthPublishing = rows.filter((r) => r.events > 0 || r.statLines > 0);
  const empty = rows.filter((r) => r.events === 0 && r.statLines === 0);

  console.log(`  ${rows.length} finished match(es) with an unapproved sheet`);
  console.log(`  ${worthPublishing.length} hold something: events filed, or stat lines with numbers in`);
  console.log(`  ${empty.length} are empty — a console opened and never used\n`);

  if (worthPublishing.length) {
    console.log("Worth a look");
    console.log("-".repeat(100));
    console.log(
      "  events    = filed in the sheet\n" +
        "  stats     = stat lines the Statistics tab would show — recorded tallies plus the\n" +
        "              lines the events imply, exactly as approval would publish them\n" +
        "  published = sb_match_events rows, which is what the public timeline reads\n"
    );
    for (const r of [...worthPublishing].sort((a, b) => b.events - a.events)) {
      const when = r.kickoff ? r.kickoff.toISOString().slice(0, 10) : "no kickoff";
      const flags = [
        r.publishedStats ? "" : "no stats tab",
        r.publishedEvents === 0 ? "no public timeline" : "",
        r.scoreAgrees ? "" : `score differs: sheet ${r.score} vs match ${r.stored}`,
      ]
        .filter(Boolean)
        .join(", ");

      /* The warnings, spelled out rather than left to be inferred from two columns. On live,
         three of the four rows carried one, and the read is not obvious: "published 6" beside
         "events 2" looks like a detail until you know approving takes the score down with it. */
      const warnings: string[] = [];
      if (r.publishedElsewhere > 0 && !r.scoreAgrees) {
        warnings.push(
          `APPROVING WOULD CONTRADICT THE TIMELINE: ${r.publishedElsewhere} event(s) here came ` +
            "from the match-event editor, not this console, and approval leaves them in place " +
            `— but it sets the score from this sheet alone (${r.stored} to ${r.score}).`
        );
      }
      if (r.goalsRemoved > 0) {
        warnings.push(
          `APPROVING WOULD REMOVE ${r.goalsRemoved} GOAL(S) the public can see today ` +
            `(${r.stored} to ${r.score}).`
        );
      }
      if (r.publishedFromRecorder > r.events) {
        warnings.push(
          `This console published ${r.publishedFromRecorder} event(s) before and the sheet now ` +
            `holds ${r.events} — it looks sent back for correction and left unfinished.`
        );
      }
      if (!r.scoreAgrees) {
        warnings.push(
          r.syncPlan.follow
            ? `THE NEXT SAVE OF THIS SHEET MOVES THE SCORE to ${r.score} on its own, without ` +
              "approval — the full-time sync follows the sheet where the whole timeline " +
              "came from this console. Approve it, or correct the sheet, before anybody " +
              "reopens it."
            : `THE FULL-TIME SYNC IS HELD on this one: the sheet says ${r.score}, the match ` +
              `publishes ${r.stored}, and ${r.publishedElsewhere} timeline event(s) here were ` +
              "not published by this console. Nothing will move the score until a human " +
              "settles it."
        );
      }
      console.log(
        `  ${when}  ${r.label.slice(0, 38).padEnd(40)}` +
          `  events ${String(r.events).padStart(3)}  stats ${String(r.statLines).padStart(2)}` +
          `  published ${String(r.publishedEvents).padStart(3)}`
      );
      console.log(`      ${r.status}/${r.eventsStatus}  recorder ${r.recorder}${flags ? `  — ${flags}` : ""}`);
      for (const warning of warnings) console.log(`      !! ${warning}`);
      if (!warnings.length && r.publishedEvents === 0) {
        console.log("      OK to approve: nothing published yet and the score agrees.");
      }
    }
    console.log("");
  }

  if (empty.length) {
    console.log("Empty sheets");
    console.log("-".repeat(100));
    console.log("  Nothing recorded. Approving these would publish nothing.\n");
    for (const r of empty) {
      const when = r.kickoff ? r.kickoff.toISOString().slice(0, 10) : "no kickoff";
      console.log(`  ${when}  ${r.label.slice(0, 38).padEnd(40)}  recorder ${r.recorder}`);
    }
    console.log("");
  }

  if (atFullTime.length) {
    const pending = atFullTime.map(describe);
    console.log("Sheets at full time whose match is not finished yet");
    console.log("-".repeat(100));
    console.log(
      "  The clock on these reads full time and the match is still down as scheduled or\n" +
        "  live. That pairing exists only because the full-time sync sat behind public live\n" +
        "  approval and approval defaulted off. It defaults on now, so the next save of each\n" +
        "  sheet marks its match finished — and takes the score with it, unless held.\n"
    );
    for (const r of pending) {
      const when = r.kickoff ? r.kickoff.toISOString().slice(0, 10) : "no kickoff";
      console.log(
        `  ${when}  ${r.label.slice(0, 38).padEnd(40)}  match ${r.matchStatus.padEnd(10)}` +
          `  sheet ${r.score}  match ${r.stored}  events ${String(r.events).padStart(3)}`
      );
      if (r.scoreAgrees) {
        console.log("      The scores already agree. The next save only marks it finished.");
      } else if (r.syncPlan.follow) {
        console.log(`      The next save publishes ${r.score} in place of ${r.stored}.`);
      } else {
        console.log(
          `      !! HELD: ${r.publishedElsewhere} timeline event(s) here were not published by ` +
            `this console, so ${r.stored} stays until a human settles it.`
        );
      }
    }
    console.log("");
  }

  console.log("What to do with this");
  console.log("-".repeat(100));
  console.log(
    "  A row marked OK was recorded and never sent: approving publishes its timeline and\n" +
      "  Statistics tab and changes no score. Do those through the console at\n" +
      "  /admin/match-stats/<matchId>, with the usual approve permission.\n\n" +
      "  A row marked !! needs reading first, and is not a cleanup. Approval makes the match\n" +
      "  score follow this sheet's goal events, so a sheet thinner than what is already\n" +
      "  published takes the public score down with it. And where the timeline came from the\n" +
      "  match-event editor rather than this console, approval leaves those events in place\n" +
      "  while moving the score — so the scoreline and the timeline would then disagree.\n\n" +
      "  Empty sheets are litter and can be left alone; nothing reads them.\n\n" +
      "  A row marked HELD needs no hurry — the score it publishes today is the one it keeps,\n" +
      "  and the sync will not touch it. It is still a disagreement on the record: the sheet\n" +
      "  and the timeline say different things about the same game, and only somebody who was\n" +
      "  there can say which is right. Settle it by approving the sheet (the timeline and the\n" +
      "  score then both come from it) or by correcting the sheet to match what was published."
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
