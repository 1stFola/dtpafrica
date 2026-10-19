import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AdminMatchStatsService } from "./admin-match-stats.service";
import { AUTO_APPROVE_DELAY_MS } from "./sheet-auto-approve";

/**
 * Approves and publishes a recorder's submitted sheet ten minutes after submission,
 * when nothing about it needs a person (`sheet-auto-approve.ts`).
 *
 * A sweep for the same reason as `RecorderIdleService`: the ten minutes run out with no
 * request to hang a check on. The query only narrows the field; the rule is judged in
 * `AdminMatchStatsService.autoApprove` on a fresh read, and the publish is the one an
 * approver's click runs, so the two can never publish differently.
 */
@Injectable()
export class SheetAutoApproveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SheetAutoApproveService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  /** A minute: a sheet publishes between ten and eleven minutes after submission. */
  private static readonly INTERVAL_MS = 60_000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminMatchStatsService) private readonly stats: AdminMatchStatsService
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), SheetAutoApproveService.INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Approve every sheet that is due. Never throws, like the idle sweep, and one sheet
   * failing does not stop the others: each is a separate match somebody is waiting on.
   */
  async sweep(now = new Date()): Promise<{ approved: string[] }> {
    const approved: string[] = [];
    /* A publish takes a few seconds; a slow pass must not overlap the next one and
       approve the same sheet twice. */
    if (this.running) return { approved };
    this.running = true;
    try {
      const due = await this.prisma.sbMatchStatistics.findMany({
        where: {
          status: "submitted",
          eventsStatus: "submitted",
          submittedAt: { lte: new Date(now.getTime() - AUTO_APPROVE_DELAY_MS) },
          idleLockedAt: null,
          idleReleasedAt: null,
          correctionRequestedSection: null,
        },
        select: { matchId: true },
      });

      for (const { matchId } of due) {
        try {
          if (await this.stats.autoApprove(matchId, now)) {
            approved.push(matchId);
            this.logger.log(
              `Approved and published match ${matchId} automatically, ten minutes after submission.`
            );
          }
        } catch (error) {
          this.logger.error(`Auto-approval failed for match ${matchId}: ${String(error)}`);
        }
      }
    } catch (error) {
      this.logger.error(`Auto-approval sweep failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
    return { approved };
  }
}
