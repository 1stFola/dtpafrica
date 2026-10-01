/**
 * Whether a match's published score may be set from its recorder's sheet at full time.
 *
 * At full time the sheet's goal events become the match score. That is right for a match
 * this console recorded: the sheet IS the record of the game, and a score nobody copied
 * across is a score left stale -- which is how recorded games went on reading 0-0 after
 * they had finished.
 *
 * It is wrong for a match whose timeline came from somewhere else. Approval only ever
 * deletes and rewrites the events this console published (`metadata.source =
 * "match_recorder"`); events entered through the match-event editor survive it. So a sheet
 * thinner than the published timeline would move the scoreline while leaving those events
 * in place, and the match would show a score its own timeline contradicts. On live there
 * are sixteen finished matches with an unapproved sheet and three of them are exactly
 * this: a timeline entered by hand, and a sheet that disagrees with it.
 *
 * The rule, then: the sheet may set the score unless it disagrees with a timeline it does
 * not own. Either direction counts. Taking a goal away is the louder failure, but adding
 * one to a timeline that cannot show where it came from leaves the same contradiction, and
 * neither is a machine's decision to make.
 *
 * Held is not refused. The match is still marked finished -- full time is a fact about the
 * clock and is not in dispute -- and the score stays as published until a human settles it,
 * by approving the sheet through the console or by correcting the timeline. Which matches
 * are waiting is what `db:report:unapproved-finished-sheets` prints.
 */
export type Score = { home: number; away: number };

export type FinalScoreSyncPlan =
  /** Write the sheet's score. */
  | { follow: true }
  /** Mark the match finished and leave its score alone. */
  | { follow: false; reason: "timeline-not-ours" };

export function planFinalScoreSync(input: {
  /** The score the sheet's goal events imply. */
  sheet: Score;
  /** The score the match row publishes today. */
  published: Score;
  /** Published timeline events this console did not write. */
  eventsFromElsewhere: number;
}): FinalScoreSyncPlan {
  const agrees =
    input.sheet.home === input.published.home && input.sheet.away === input.published.away;
  /* Agreement makes the question moot, and it is the ordinary case: the write is a no-op and
     there is nothing for anybody to settle. */
  if (agrees) return { follow: true };
  if (input.eventsFromElsewhere > 0) return { follow: false, reason: "timeline-not-ours" };
  return { follow: true };
}
