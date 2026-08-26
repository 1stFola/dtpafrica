/**
 * The competition that holds friendly matches.
 *
 * A one-off friendly has no league behind it, but every fixture in the system
 * hangs off a competition. Rather than making that relation optional — which
 * would ripple through standings, fixtures, stats and the public pages — all
 * friendlies live in a single competition of their own. The ScoreBoard then
 * lists them like any other card, and no league table is affected by a result
 * that should not count toward one.
 */
export const FRIENDLY_COMPETITION_SLUG = "friendly-matches";
export const FRIENDLY_FORMAT_TYPE = "FRIENDLY";
export const FRIENDLY_COMPETITION_NAME = "Friendly Matches";

/**
 * Formats that never produce a league table.
 *
 * `SINGLE_FRIENDLY_MATCH` predates this and is a template for a competition
 * that *is* one friendly; the bucket above holds many. Neither has a table
 * worth showing, so both are treated the same when standings are asked for.
 */
export const NO_TABLE_FORMAT_TYPES: ReadonlySet<string> = new Set([
  FRIENDLY_FORMAT_TYPE,
  "SINGLE_FRIENDLY_MATCH",
]);

/** A competition is the friendlies bucket if its format says so. */
export function isFriendlyCompetition(
  competition: { formatType?: string | null } | null | undefined
): boolean {
  return competition?.formatType === FRIENDLY_FORMAT_TYPE;
}
