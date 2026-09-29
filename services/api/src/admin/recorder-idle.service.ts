import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { readClock } from "./admin-match-stats.service";
import { assessIdle, quietMinutes, type IdleCandidate } from "./recorder-idle";

/**
 * Stops a live recording that has been left running.
 *
 * **Why this is a sweep and not a check on the way in.** Every other guard in the console
 * runs when somebody asks for something. This one exists for the case where nobody asks:
 * the recorder closed their laptop at half-time and the ScoreBoard is still showing a
 * match as live, minutes ticking, score frozen. No request arrives to hang a check on, so
 * something has to look on its own.
 *
 * The rule lives in `recorder-idle.ts` and takes `now` as an argument, so the judgement is
 * tested without waiting twenty minutes. This file is only the part that cannot be: the
 * timer, the query and the write.
 *
 * Follows `LiveAudioCommentaryService`: a plain `setInterval` cleared on module destroy,
 * rather than adding a scheduler dependency for one job.
 */
@Injectable()
export class RecorderIdleService implements OnModuleDestroy {
  private readonly logger = new Logger(RecorderIdleService.name);

  /**
   * A minute.
   *
   * The limit it enforces is twenty, so the sweep decides how *late* a lock can be rather
   * than whether it happens. A minute keeps the broadcast wrong for at most a minute
   * longer, at the cost of one indexed query.
   */
  private readonly interval = setInterval(() => void this.sweep(), 60_000);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  onModuleDestroy() {
    clearInterval(this.interval);
  }

  /**
   * Lock every live sheet that has gone quiet, and say so in the log.
   *
   * Never throws. A sweep that died on one malformed sheet would stop looking at all the
   * others, and the failure would be silent — the symptom being a broadcast that carries
   * on rather than an error anybody sees.
   */
  async sweep(now = new Date()): Promise<{ locked: string[] }> {
    const locked: string[] = [];
    try {
      /* Only live sheets that are not already locked, which the index covers. A finished
         or approved sheet cannot go idle, and re-locking one already locked would
         overwrite the timestamp the dashboard reads. */
      const sheets = await this.prisma.sbMatchStatistics.findMany({
        where: { status: "live", idleLockedAt: null },
        select: {
          matchId: true,
          status: true,
          clock: true,
          lastEventAt: true,
          match: {
            select: {
              status: true,
              competition: { select: { formatConfig: true } },
            },
          },
        },
      });

      for (const sheet of sheets) {
        const clock = readClock(sheet.clock);
        if (!clock) continue;

        const halfStartedAt =
          clock.half === 2 ? clock.secondHalfStartedAt : clock.firstHalfStartedAt;
        const candidate: IdleCandidate = {
          matchId: sheet.matchId,
          sheetStatus: sheet.status,
          clockPhase: clock.phase,
          lastEventAt: sheet.lastEventAt,
          halfStartedAt: halfStartedAt ? new Date(halfStartedAt) : null,
          idleLockedAt: null,
          isTraining: isTrainingConfig(sheet.match.competition?.formatConfig),
        };

        const verdict = assessIdle(candidate, now);
        if (!verdict.idle) continue;

        await this.prisma.sbMatchStatistics.update({
          where: { matchId: sheet.matchId },
          data: { idleLockedAt: now, idleLockedSinceAt: verdict.since },
        });
        locked.push(sheet.matchId);
        this.logger.warn(
          `Stopped live recording for match ${sheet.matchId}: ` +
            `${quietMinutes(verdict.quietMs)} minutes with no event filed.`
        );
      }
    } catch (error) {
      /* Logged and swallowed. The next sweep is a minute away and will see the same
         sheets; a thrown error here would take the timer down with it. */
      this.logger.error(`Idle sweep failed: ${String(error)}`);
    }
    return { locked };
  }
}

/** A competition flagged as the recorder training sandbox. Mirrors the console's own check. */
function isTrainingConfig(formatConfig: unknown): boolean {
  return Boolean(
    formatConfig &&
      typeof formatConfig === "object" &&
      (formatConfig as Record<string, unknown>).isTraining
  );
}
