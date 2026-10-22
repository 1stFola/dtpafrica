import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { assessLiveStream } from "./live-stream-schedule";

/**
 * Puts a fixture's live stream up five minutes before kickoff and takes it down at full
 * time.
 *
 * A sweep for the same reason as `RecorderIdleService`: kickoff arrives without a request
 * to hang a check on. The rule lives in `live-stream-schedule.ts`; this file is the timer,
 * the query and the write.
 */
@Injectable()
export class LiveStreamScheduleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveStreamScheduleService.name);
  private timer: NodeJS.Timeout | null = null;

  /**
   * Thirty seconds, so a stream goes up between five minutes and four and a half before
   * kickoff, and comes down within thirty seconds of full time. The query reads a table
   * of a few dozen admin-made rows.
   */
  private static readonly INTERVAL_MS = 30_000;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), LiveStreamScheduleService.INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Publish and unpublish whatever the schedule says is due.
   *
   * Never throws, like the idle sweep: the next pass is thirty seconds away, and a thrown
   * error would take the timer down with it.
   */
  async sweep(now = new Date()): Promise<{ published: string[]; unpublished: string[] }> {
    const published: string[] = [];
    const unpublished: string[] = [];
    try {
      const streams = await this.prisma.sbLiveStream.findMany({
        where: { match: { kickoffAt: { not: null } } },
        select: {
          id: true,
          title: true,
          isPublished: true,
          publishedAt: true,
          match: {
            select: {
              status: true,
              kickoffAt: true,
              updatedAt: true,
              statisticsSheet: { select: { fullTimeAt: true } },
            },
          },
        },
      });

      for (const stream of streams) {
        const { action } = assessLiveStream(
          {
            isPublished: stream.isPublished,
            publishedAt: stream.publishedAt,
            match: stream.match && {
              status: stream.match.status,
              kickoffAt: stream.match.kickoffAt,
              updatedAt: stream.match.updatedAt,
              fullTimeAt: stream.match.statisticsSheet?.fullTimeAt ?? null,
            },
          },
          now
        );
        if (!action) continue;

        /* Guarded on the state just read, so an admin who flips the switch between the
           read and this write keeps what they chose. */
        if (action === "publish") {
          const { count } = await this.prisma.sbLiveStream.updateMany({
            where: { id: stream.id, isPublished: false },
            data: { isPublished: true, publishedAt: now },
          });
          if (count) {
            published.push(stream.id);
            this.logger.log(`Published live stream "${stream.title}" (${stream.id}) for kickoff.`);
          }
        } else {
          const { count } = await this.prisma.sbLiveStream.updateMany({
            where: { id: stream.id, isPublished: true },
            data: { isPublished: false },
          });
          if (count) {
            unpublished.push(stream.id);
            this.logger.log(
              `Unpublished live stream "${stream.title}" (${stream.id}) after full time.`
            );
          }
        }
      }
    } catch (error) {
      this.logger.error(`Live stream schedule sweep failed: ${String(error)}`);
    }
    return { published, unpublished };
  }
}
