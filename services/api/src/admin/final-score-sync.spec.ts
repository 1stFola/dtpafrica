/**
 * When the recorder's sheet may set the published score.
 *
 * The numbers here are from the live database: sixteen finished matches carry an unapproved
 * sheet, and three of those have a timeline that was entered through the match-event editor
 * rather than this console, with a sheet that disagrees about the score.
 */
import { describe, expect, it } from "vitest";
import { planFinalScoreSync } from "./final-score-sync";

const plan = (
  sheet: [number, number],
  published: [number, number],
  eventsFromElsewhere = 0
) =>
  planFinalScoreSync({
    sheet: { home: sheet[0], away: sheet[1] },
    published: { home: published[0], away: published[1] },
    eventsFromElsewhere,
  });

describe("planFinalScoreSync", () => {
  it("follows the sheet for a match this console recorded", () => {
    expect(plan([3, 1], [0, 0])).toEqual({ follow: true });
  });

  it("follows the sheet when the whole timeline came from this console", () => {
    /* Re-approving a corrected sheet: every published event is ours, so the sheet is still
       the record and a changed score is the correction. */
    expect(plan([3, 1], [2, 1], 0)).toEqual({ follow: true });
  });

  it("holds the score when the timeline holds events this console did not write", () => {
    expect(plan([2, 1], [3, 1], 6)).toEqual({ follow: false, reason: "timeline-not-ours" });
  });

  it("holds it when the sheet would add a goal, too", () => {
    /* Quieter than losing one and the same contradiction: a scoreline with a goal its own
       timeline cannot account for. */
    expect(plan([4, 1], [3, 1], 6)).toEqual({ follow: false, reason: "timeline-not-ours" });
  });

  it("writes anyway when the two already agree", () => {
    /* The ordinary full-time save. The write is a no-op, so a timeline from elsewhere is no
       reason to treat it as a decision somebody has to make. */
    expect(plan([3, 1], [3, 1], 6)).toEqual({ follow: true });
    expect(plan([0, 0], [0, 0], 2)).toEqual({ follow: true });
  });

  it("is not fooled by a reversed scoreline", () => {
    /* 1-3 is not 3-1. Comparing goal totals rather than sides would call these equal, and
       the match would keep a scoreline with the winner the wrong way round. */
    expect(plan([1, 3], [3, 1], 4)).toEqual({ follow: false, reason: "timeline-not-ours" });
  });
});
