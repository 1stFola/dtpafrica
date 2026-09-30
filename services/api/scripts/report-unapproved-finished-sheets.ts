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
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import {
  effectiveTallies,
  normaliseTallies,
  readEvents,
  scoreFromEvents,
  totalsFor,
} from "../src/admin/admin-match-stats.service";

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

  const sheets = await prisma.sbMatchStatistics.findMany({
    where: { status: { not: "approved" }, match: { status: "finished" } },
    select: {
      matchId: true,
      status: true,
      eventsStatus: true,
      tallies: true,
      events: true,
      recorderName: true,
      updatedAt: true,
      match: {
        select: {
          kickoffAt: true,
          homeScore: true,
          awayScore: true,
          stats: true,
          homeTeam: { select: { name: true } },
          awayTeam: { select: { name: true } },
          competition: { select: { name: true } },
        },
      },
    },
  });

  if (!sheets.length) {
    console.log("None. Every finished match has an approved sheet.");
    return;
  }

  // One query rather than one per sheet: the published timeline is the other half of what
  // approval writes, and a match with event rows already has one from somewhere else.
  const publishedCounts = await prisma.sbMatchEvent.groupBy({
    by: ["matchId"],
    where: { matchId: { in: sheets.map((s) => s.matchId) } },
    _count: { _all: true },
  });
  const published = new Map(publishedCounts.map((row) => [row.matchId, row._count._all]));

  const rows = sheets.map((sheet) => {
    const events = readEvents(sheet.events);
    const score = scoreFromEvents(events);
    const stored = { home: sheet.match.homeScore, away: sheet.match.awayScore };
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
      publishedStats: hasPublishedStats(sheet.match.stats),
      /* A sheet whose events disagree with the stored score is the one case where
         approving would change what the public already sees. */
      scoreAgrees: score.home === stored.home && score.away === stored.away,
      score: `${score.home}-${score.away}`,
      stored: `${stored.home}-${stored.away}`,
      touched: sheet.updatedAt,
    };
  });

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
      console.log(
        `  ${when}  ${r.label.slice(0, 38).padEnd(40)}` +
          `  events ${String(r.events).padStart(3)}  stats ${String(r.statLines).padStart(2)}` +
          `  published ${String(r.publishedEvents).padStart(3)}`
      );
      console.log(`      ${r.status}/${r.eventsStatus}  recorder ${r.recorder}${flags ? `  — ${flags}` : ""}`);
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

  console.log("What to do with this");
  console.log("-".repeat(100));
  console.log(
    "  Sheets under 'Worth a look' were recorded and never sent. Approving one publishes\n" +
      "  its timeline and Statistics tab, through the console at\n" +
      "  /admin/match-stats/<matchId>, with the usual approve permission.\n\n" +
      "  Anything flagged 'score differs' should be read before approving: approval makes\n" +
      "  the match score follow the sheet's goal events, so the public score would change.\n\n" +
      "  Empty sheets are litter and can be left alone; nothing reads them."
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
