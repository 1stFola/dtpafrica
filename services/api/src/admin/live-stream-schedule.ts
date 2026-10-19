/**
 * When a live stream linked to a fixture goes up on the Live Games page, and when it
 * comes down.
 *
 * The window opens ten minutes before kickoff and closes ten minutes after full time.
 * The sweep in `live-stream-schedule.service.ts` acts on the two edges only, so an admin
 * who takes a stream down early, or puts one back up after the game, is not overruled:
 *
 * - **Publish** a stream that is down, once the window is open, unless it was already
 *   up at some point since the window opened. A stream the admin unpublished mid-game
 *   has a `publishedAt` inside the window and stays down.
 * - **Unpublish** a stream that is up, once the window has closed, if it went up before
 *   the close. A stream the admin republished after the game (a replay) went up after
 *   the close and stays up.
 *
 * Takes `now` as an argument, like `recorder-idle.ts`, so the rule is tested without a
 * clock.
 */

/** The window opens this long before kickoff. */
export const PUBLISH_LEAD_MS = 10 * 60_000;

/** The window closes this long after full time. */
export const UNPUBLISH_TAIL_MS = 10 * 60_000;

/**
 * When nothing says the game is over, the window closes this long after kickoff.
 *
 * Many fixtures are never recorded, so their status stays `scheduled` for good, and a
 * stream that waited on full time would stay up for ever. Four hours covers ninety
 * minutes, half-time, stoppage and a kickoff that started an hour late.
 */
export const NO_RESULT_CEILING_MS = 4 * 60 * 60_000;

/** Statuses that mean the game will not be (or is no longer being) played today. */
const OVER_STATUSES = new Set(["finished", "postponed", "cancelled"]);

export type LiveStreamScheduleCandidate = {
  isPublished: boolean;
  publishedAt: Date | null;
  match: {
    status: string;
    kickoffAt: Date | null;
    /** Stands in for the moment a match was marked finished when no sheet records it. */
    updatedAt: Date;
    /** The recorder's full-time whistle, from the match statistics sheet. */
    fullTimeAt: Date | null;
  } | null;
};

export type LiveStreamWindow = {
  opensAt: Date;
  closesAt: Date;
  /** `full_time` once the game is known to be over; `ceiling` while the close is a guess. */
  closesBy: "full_time" | "ceiling";
};

export type LiveStreamVerdict = {
  action: "publish" | "unpublish" | null;
  window: LiveStreamWindow | null;
};

/** The publish window for a fixture, or null when there is no kickoff to hang it on. */
export function liveStreamWindow(
  match: LiveStreamScheduleCandidate["match"]
): LiveStreamWindow | null {
  if (!match?.kickoffAt) return null;
  const kickoff = match.kickoffAt.getTime();
  const ceiling = kickoff + NO_RESULT_CEILING_MS;

  let closesAt = ceiling;
  let closesBy: LiveStreamWindow["closesBy"] = "ceiling";
  if (match.fullTimeAt) {
    closesAt = match.fullTimeAt.getTime() + UNPUBLISH_TAIL_MS;
    closesBy = "full_time";
  } else if (OVER_STATUSES.has(match.status)) {
    /* No whistle on record, so the last write to the match is the best guess at when it
       ended. Capped, because a correction made days later also moves `updatedAt`. */
    closesAt = Math.min(match.updatedAt.getTime(), ceiling) + UNPUBLISH_TAIL_MS;
    closesBy = "full_time";
  }

  return {
    opensAt: new Date(kickoff - PUBLISH_LEAD_MS),
    closesAt: new Date(closesAt),
    closesBy,
  };
}

export function assessLiveStream(
  stream: LiveStreamScheduleCandidate,
  now: Date
): LiveStreamVerdict {
  const window = liveStreamWindow(stream.match);
  if (!window) return { action: null, window };

  const t = now.getTime();
  const opens = window.opensAt.getTime();
  const closes = window.closesAt.getTime();
  const publishedAt = stream.publishedAt?.getTime() ?? null;

  if (t >= closes) {
    /* A stream with no `publishedAt` cannot have been put up after the close. */
    const upBeforeClose = publishedAt === null || publishedAt < closes;
    return { action: stream.isPublished && upBeforeClose ? "unpublish" : null, window };
  }

  if (t >= opens) {
    const upSinceOpen = publishedAt !== null && publishedAt >= opens;
    return { action: !stream.isPublished && !upSinceOpen ? "publish" : null, window };
  }

  return { action: null, window };
}
