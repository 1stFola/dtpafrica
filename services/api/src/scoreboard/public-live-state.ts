/**
 * What the public is told about a match that has a recorder's sheet behind it.
 *
 * **The rule, in the words of the people who run these competitions:** no game appears as
 * live, and no live feed opens, until the match recorder presses Kick off. "Approve public
 * live" is not a kickoff — it is the switch that decides whether a feed may be shown at all,
 * and an admin uses it to take one game off the feed, not to start one.
 *
 * What it did instead: approving a match made it read as live immediately. The sheet opens
 * with its clock at `pre_kickoff`, and both the card and the match centre took the sheet's
 * existence as the signal. A fixture kicking off at four o'clock read as LIVE from the
 * moment it was approved, with a 0-0 that nobody was playing for.
 *
 * So the two questions are asked separately, and both must be answered yes:
 *
 *   - has the recorder kicked off?  — `hasKickedOff`, the sheet's own clock
 *   - may this game be shown live?  — `liveFeature.enabled`, the admin's switch
 *
 * The recorder's console is gated by neither. A recorder captures a match whatever the
 * switch says, which is the point: the capture is the record, and the feed is a decision
 * about publishing it.
 */
import type { ClockState } from "../admin/admin-match-stats.service";

/**
 * Whether the match has kicked off.
 *
 * `pre_kickoff` is the phase a sheet is created with and the one the console's own
 * `started` flag tests, so this is the same question the Kick off button answers. A sheet
 * with no clock at all has never been started either — the console writes the clock when
 * the button is pressed.
 *
 * Note that every later phase counts, including `finished`: a match that has ended has
 * certainly kicked off, and the states after kickoff are told apart by `publicLiveState`.
 */
export function hasKickedOff(clock: ClockState | null | undefined): clock is ClockState {
  return !!clock && clock.phase !== "pre_kickoff";
}

export type PublicLiveState = { status: string; minute: number | null };

export type PublicLiveInput = {
  /** `liveFeature.enabled` — the admin's "Approve public live" switch. */
  liveEnabled: boolean;
  /** The sheet's own status: live, submitted, or approved. */
  sheetStatus: string;
  /** The match row's status, which an admin sets by hand. */
  matchStatus: string;
  /**
   * The sheet's clock, or null for a match with no sheet on it at all.
   *
   * Those two are the same answer here: a match nobody is recording has not kicked off as
   * far as this can tell, so it is left to its own row -- which is how an admin marking a
   * match live by hand goes on working.
   */
  clock: ClockState | null;
  /**
   * Whether the idle sweep has locked this recording.
   *
   * It locks a running clock that has gone twenty minutes with no event, which is what a
   * recorder closing their laptop mid-match looks like. The live feed already stopped there;
   * the card did not, so it went on counting the minutes of a game nobody was watching over a
   * score that could no longer change. That is the exact thing the sweep exists to prevent.
   */
  idleLocked: boolean;
  /** The match row's minute, used where the clock cannot say. */
  minute: number | null;
  /** Injected so the minute is testable. */
  now?: number;
};

/**
 * The status and minute to show for a match, or `null` to leave the match row's own.
 *
 * Returning `null` is not "not live" — it is "the sheet has nothing to say", and the
 * caller then shows what the row holds. That matters for a match an admin marked live by
 * hand with no recorder on it: this does not contradict them, it declines to speak.
 */
export function publicLiveState(input: PublicLiveInput): PublicLiveState | null {
  if (!input.liveEnabled) return null;
  /* An approved sheet is history: the final score is on the match row, and reading the
     sheet again would re-announce a finished game as a live one. */
  if (input.sheetStatus === "approved" || input.matchStatus === "finished") return null;

  const clock = input.clock;
  /* The rule this module exists for. Before kickoff there is nothing live to report, and
     that is true however many events the sheet already holds -- a recorder filing a note
     before the whistle is not a game in progress. */
  if (!hasKickedOff(clock)) return null;

  /* Full time and a submitted sheet are read before the idle lock, because they are facts
     about a game that has ended and a lock does not unsay them. The lock only suppresses the
     states that claim a game is still being played. */
  if (input.sheetStatus === "submitted" || clock.phase === "finished") {
    return { status: "finished", minute: input.minute };
  }
  if (input.idleLocked) return null;
  if (clock.phase === "awaiting_second_half") {
    return { status: "halftime", minute: input.minute };
  }

  const halfLength = Math.max(1, clock.halfLength || 45);
  const anchor =
    clock.half === 2 && clock.secondHalfStartedAt
      ? new Date(clock.secondHalfStartedAt).getTime()
      : clock.firstHalfStartedAt
        ? new Date(clock.firstHalfStartedAt).getTime()
        : NaN;
  /* Kicked off with no anchor stamped: live, on the minute the row holds. The phase is the
     recorder's word that the game is running, and a missing timestamp is no reason to
     contradict it. */
  if (!Number.isFinite(anchor)) return { status: "live", minute: input.minute };

  const played = Math.max(0, Math.floor(((input.now ?? Date.now()) - anchor) / 60000)) + 1;
  const minute = clock.half === 2 ? halfLength + played : played;
  return { status: "live", minute };
}

/** The statuses the public reads as a game in progress. */
export const PUBLIC_LIVE_STATUSES = ["live", "halftime"] as const;

/**
 * Whether a match belongs on a public live list.
 *
 * The list used to be a query on the match row alone -- `status IN (live, halftime)` -- a
 * column only the match editor writes. So a game its recorder had kicked off showed LIVE on
 * its own card and was missing from Live Games, because nothing had told the row. Asking the
 * same question the card answers is what keeps the two from disagreeing: a match is on the
 * list when the list would show it as live, and for no other reason.
 *
 * The sheet speaks first and the row speaks when the sheet has nothing to say, which leaves
 * an admin free to mark a fixture live by hand for a game nobody is recording.
 */
export function readsAsLive(state: PublicLiveState | null, matchStatus: string): boolean {
  const status = state?.status ?? matchStatus;
  return (PUBLIC_LIVE_STATUSES as readonly string[]).includes(status);
}