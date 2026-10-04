/**
 * The halves of a match and the minute each starts at.
 *
 * Minutes are the broadcast kind: the second half starts at 45, extra time at 90
 * and 105, and added time runs past the base. The control plane reads the match
 * clock with this table and the review screens show the playhead's minute with
 * it; the screens had their own copy of the numbers (docs/vision/50, appendix D).
 */
export const MATCH_HALVES = [
  { half: 1, baseMinute: 0, name: "1st half" },
  { half: 2, baseMinute: 45, name: "2nd half" },
  { half: 3, baseMinute: 90, name: "1st half of extra time" },
  { half: 4, baseMinute: 105, name: "2nd half of extra time" },
] as const;
export type MatchHalf = (typeof MATCH_HALVES)[number]["half"];
