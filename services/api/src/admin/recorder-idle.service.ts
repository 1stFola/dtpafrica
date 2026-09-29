import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { readClock } from "./admin-match-stats.service";
import {
  assessAutoSubmit,
  assessIdle,
  quietMinutes,
  type IdleCandidate,
} from "./recorder-idle";

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
  private readonly interval = setInterval(() => {
    void this.sweep();
    void this.sweepAutoSubmit();
  }, 60_000);

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
  /**
   * Submit a finished match the recorder never submitted.
   *
   * Five minutes after full time. A recorder who blows the whistle and walks away leaves
   * a complete sheet sitting in `live` for ever: the figures are right, nobody can
   * approve them, and the fixture shows no result. Same reason as the idle sweep for
   * living here rather than in a request -- there is no request to hang it on.
   *
   * The submit itself goes through `AdminMatchStatsService.submit`, so a sheet the clock
   * submits travels the same path, and lands in the same queue, as one a person submits.
   * A second implementation would eventually diverge on validation and produce sheets an
   * approver could not act on.
   */
  async sweepAutoSubmit(now = new Date()): Promise<{ submitted: string[] }> {
    const submitted: string[] = [];
    try {
      const sheets = await this.prisma.sbMatchStatistics.findMany({
        where: { status: "live", fullTimeAt: { not: null }, idleLockedAt: null },
        select: {
          matchId: true,
          status: true,
          clock: true,
          fullTimeAt: true,
          idleLockedAt: true,
          correctionRequestedSection: true,
          match: {
            select: { competition: { select: { formatConfig: true } } },
          },
        },
      });

      for (const sheet of sheets) {
        const clock = readClock(sheet.clock);
        if (!clock) continue;
        const verdict = assessAutoSubmit(
          {
            matchId: sheet.matchId,
            sheetStatus: sheet.status,
            clockPhase: clock.phase,
            fullTimeAt: sheet.fullTimeAt,
            idleLockedAt: sheet.idleLockedAt,
            correctionRequested: Boolean(sheet.correctionRequestedSection),
            isTraining: isTrainingConfig(sheet.match.competition?.formatConfig),
          },
          now
        );
        if (!verdict.submit) continue;

        await this.submitOnBehalf(sheet.matchId, now);
        submitted.push(sheet.matchId);
        this.logger.log(
          `Submitted match ${sheet.matchId} automatically, ` +
            `${Math.floor(verdict.waitedMs / 60_000)} minutes after full time.`
        );
      }
    } catch (error) {
      this.logger.error(`Auto-submit sweep failed: ${String(error)}`);
    }
    return { submitted };
  }

  /**
   * Move the sheet to `submitted` as the clock rather than as a person.
   *
   * Written here rather than calling the service so the audit trail stays honest: the
   * submitted-by columns name nobody, and `autoSubmittedAt` says why they are empty. A
   * sheet showing the last recorder as its submitter would be a small lie in the one
   * record somebody consults when a result is disputed.
   */
  private async submitOnBehalf(matchId: string, now: Date) {
    await this.prisma.sbMatchStatistics.update({
      where: { matchId },
      data: {
        status: "submitted",
        eventsStatus: "submitted",
        submittedAt: now,
        eventsSubmittedAt: now,
        autoSubmittedAt: now,
      },
    });
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
