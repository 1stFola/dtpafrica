/**
 * Goals that reached a match's timeline from video evidence, not from the
 * recorder's sheet.
 *
 * Vision promotes a reviewed goal into the match record. Where the recorder
 * logged that goal it only enriches the recorder's row; where the recorder
 * missed it, and a publisher says so, it adds a row of its own, marked
 * `metadata.source = "vision"` (docs/vision/55).
 *
 * The recorder's console sets the scoreline from the sheet's goal events:
 * on approval, at full time, when the live feature is switched on, and back to
 * nil when an approved sheet is sent back. Approval deletes and rewrites only
 * the rows it published, so a goal added from video stays on the timeline
 * through all of them. The scoreline therefore has to count it at each of
 * those four places, or the public match shows a goal its score denies.
 */

export const VIDEO_EVENT_SOURCE = "vision";

/** Event types that count for the side they are logged against. */
const SCORING_TYPES = ["goal", "goal_penalty"];

export type VideoGoals = { home: number; away: number; events: number };

type Db = {
  sbMatchEvent: {
    findMany(args: { where: Record<string, unknown>; select: { type: true; teamId: true } }): Promise<{ type: string; teamId: string | null }[]>;
  };
};

/** How many goals each side has on this match's timeline from video, and how many video rows there are in all. */
export async function videoGoals(db: Db, match: { id: string; homeTeamId: string; awayTeamId: string }): Promise<VideoGoals> {
  const rows = await db.sbMatchEvent.findMany({
    where: { matchId: match.id, metadata: { path: ["source"], equals: VIDEO_EVENT_SOURCE } },
    select: { type: true, teamId: true },
  });
  let home = 0;
  let away = 0;
  for (const row of rows) {
    if (!SCORING_TYPES.includes(row.type)) continue;
    if (row.teamId === match.homeTeamId) home += 1;
    else if (row.teamId === match.awayTeamId) away += 1;
  }
  return { home, away, events: rows.length };
}

/** The sheet's score with the video goals counted on. */
export function withVideoGoals(sheet: { home: number; away: number }, video: { home: number; away: number }): { home: number; away: number } {
  return { home: sheet.home + video.home, away: sheet.away + video.away };
}
