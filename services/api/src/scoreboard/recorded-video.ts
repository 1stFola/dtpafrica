import { youtubeThumbnail } from "../shared/media-url";

/**
 * The broadcast a match centre offers as "Watch Recorded Video".
 *
 * A live stream linked to the fixture plays on the Live Games page while it is published,
 * and the schedule (`admin/live-stream-schedule.ts`) takes it down at full time. Once it
 * is down it is the recording of the game, and the match centre links to it instead:
 *
 * - A stream that is still published is the live broadcast, not a recording yet.
 * - A stream that went up at some point and is now down is the recording.
 * - A stream that never went up counts only once the match is finished: an admin pasting
 *   the YouTube link of a game already played, which the schedule will not publish. One
 *   added ahead of an upcoming game stays out, since there is nothing recorded behind it.
 *
 * When a fixture has more than one, the one that went up last wins, then the newest.
 */

export type RecordedVideoCandidate = {
  id: string;
  title: string;
  youtubeUrl: string;
  isPublished: boolean;
  publishedAt: Date | null;
  createdAt: Date;
};

export type RecordedVideo = {
  id: string;
  title: string;
  youtubeUrl: string;
  thumbnailUrl: string | null;
};

export function pickRecordedVideo(
  streams: readonly RecordedVideoCandidate[],
  matchStatus: string
): RecordedVideo | null {
  const finished = matchStatus === "finished";
  const recordings = streams.filter(
    (stream) =>
      !stream.isPublished && stream.youtubeUrl.trim() && (stream.publishedAt || finished)
  );
  if (!recordings.length) return null;

  const when = (date: Date | null) => date?.getTime() ?? -Infinity;
  const [best] = [...recordings].sort(
    (a, b) =>
      when(b.publishedAt) - when(a.publishedAt) || b.createdAt.getTime() - a.createdAt.getTime()
  );
  const youtubeUrl = best.youtubeUrl.trim();
  return {
    id: best.id,
    title: best.title,
    youtubeUrl,
    thumbnailUrl: youtubeThumbnail(youtubeUrl),
  };
}
