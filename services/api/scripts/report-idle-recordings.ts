/**
 * Which live recordings the idle sweep would stop.
 *
 *   pnpm --filter @dtp/api db:report:idle-recordings
 *
 * **Read-only. There is no `--apply`** — the sweep does the stopping, once a minute, on
 * its own. This exists to answer one question before that ships: what does it catch on
 * the first pass?
 *
 * The answer matters because a sheet left in `live` with a running clock stays that way
 * for ever. On a local database this found two from thirty-five days ago, still broadcasting
 * as live matches. Every one of those locks at once the first time the sweep runs, and a
 * dashboard panel opening with a month of abandoned recordings in it reads like a fault
 * rather than a backlog. Better to know the number first.
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { readClock } from "../src/admin/admin-match-stats.service";
import { assessIdle, quietMinutes } from "../src/admin/recorder-idle";

loadApiEnv();

const prisma = new PrismaClient();

async function main() {
  console.log("Live recordings the idle sweep would stop\n");
  console.log("  Read-only. The sweep itself runs once a minute inside the API.\n");

  const sheets = await prisma.sbMatchStatistics.findMany({
    where: { status: "live", idleLockedAt: null },
    select: {
      matchId: true,
      status: true,
      clock: true,
      lastEventAt: true,
      recorderName: true,
      match: {
        select: {
          kickoffAt: true,
          homeTeam: { select: { name: true } },
          awayTeam: { select: { name: true } },
          competition: { select: { name: true, formatConfig: true } },
        },
      },
    },
  });

  const now = new Date();
  const wouldLock: { label: string; quiet: number; recorder: string; everFiled: boolean }[] = [];
  let running = 0;

  for (const sheet of sheets) {
    const clock = readClock(sheet.clock);
    if (!clock) continue;
    const halfStartedAt = clock.half === 2 ? clock.secondHalfStartedAt : clock.firstHalfStartedAt;
    const cfg = sheet.match.competition?.formatConfig;
    const verdict = assessIdle(
      {
        matchId: sheet.matchId,
        sheetStatus: sheet.status,
        clockPhase: clock.phase,
        lastEventAt: sheet.lastEventAt,
        halfStartedAt: halfStartedAt ? new Date(halfStartedAt) : null,
        idleLockedAt: null,
        isTraining: Boolean(
          cfg && typeof cfg === "object" && (cfg as Record<string, unknown>).isTraining
        ),
      },
      now
    );
    if (clock.phase === "running" || clock.phase === "added_running") running += 1;
    if (!verdict.idle) continue;
    wouldLock.push({
      label: `${sheet.match.homeTeam.name} v ${sheet.match.awayTeam.name}`,
      quiet: quietMinutes(verdict.quietMs),
      recorder: sheet.recorderName ?? "—",
      everFiled: Boolean(sheet.lastEventAt),
    });
  }

  console.log(`  ${sheets.length} live sheet(s), ${running} with a running clock`);
  console.log(`  ${wouldLock.length} would be stopped on the first sweep\n`);

  if (!wouldLock.length) {
    console.log("Nothing would be stopped.");
    return;
  }

  console.log("Would be stopped");
  console.log("-".repeat(76));
  console.log(
    "  Anything here with a very large quiet time is an old recording nobody closed,\n" +
      "  not a match in progress. Those are the backlog; stopping them is the point.\n"
  );
  for (const row of [...wouldLock].sort((a, b) => b.quiet - a.quiet).slice(0, 40)) {
    const days = row.quiet >= 1440 ? `  (${Math.floor(row.quiet / 1440)}d)` : "";
    console.log(
      `  ${row.label.slice(0, 40).padEnd(42)} quiet ${String(row.quiet).padStart(6)}m${days}` +
        `  ${row.everFiled ? "" : "— nothing ever filed"}`
    );
  }
  if (wouldLock.length > 40) console.log(`  … and ${wouldLock.length - 40} more`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
