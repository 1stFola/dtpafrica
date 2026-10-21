/**
 * When a submitted match sheet may approve and publish itself.
 *
 * Ten minutes after the recorder submits, if nobody has approved or sent it back, the
 * clock approves it -- but only a sheet nobody needs to look at:
 *
 * 1. **Every shirt number names a player.** A number that resolves to nobody publishes
 *    as `No. 7` on the timeline and reaches no profile. That is a squad to fix before
 *    publishing, not after, so it waits for a person. Resolved with the same lookup
 *    `approve` publishes with (`squad-number-lookup.ts`), so "named here" means "named
 *    on the public timeline".
 * 2. **The recorder submitted it.** Not the clock at full time (`autoSubmittedAt`), not
 *    somebody else on their behalf, and not a recording the idle sweep ever stopped --
 *    even one an admin later released. Each of those is a sheet where the person who
 *    watched the match did not say "this is complete".
 *
 * Also held back: a sheet with a correction request pending, a finished match reopened
 * for corrections (a published result changing after the fact is what the full-time lock
 * exists to make somebody sign off), and practice matches, which the idle and
 * auto-submit sweeps leave alone too.
 *
 * Takes `now` as an argument, like `recorder-idle.ts`, so the rule is tested without
 * waiting ten minutes.
 */

export const AUTO_APPROVE_DELAY_MS = 10 * 60_000;

/** The parts of a recorded event the number check reads. */
export type NumberedEvent = {
  type: string;
  minute: number;
  side: "home" | "away";
  playerNumber: number | null;
  secondaryPlayerNumber: number | null;
};

/** A shirt number on the sheet that names nobody. */
export type DanglingNumber = {
  side: "home" | "away";
  number: number;
  /**
   * Who holds the number when more than one player does, which is why it names nobody;
   * empty when nobody in the squad wears it. The fix differs: a missing player is added,
   * a shared number is taken off all but one.
   */
  sharedBy: string[];
  /** Where it was first used, so the console can point at it. */
  eventType: string;
  minute: number;
};

/**
 * Every shirt number the events use that resolves to no named player, once per side
 * and number.
 *
 * `resolve` is the publish lookup's `resolve`. Zero and negative numbers are not shirt
 * numbers (the lookup ignores them too), so they cannot dangle.
 */
export function danglingNumbers(
  events: NumberedEvent[],
  resolve: (
    side: "home" | "away",
    number: number
  ) =>
    | { kind: "named"; player: { playerName: string } }
    | { kind: "shared"; names: string[] }
    | { kind: "unknown" }
): DanglingNumber[] {
  const seen = new Set<string>();
  const out: DanglingNumber[] = [];
  for (const event of events) {
    for (const number of [event.playerNumber, event.secondaryPlayerNumber]) {
      if (number == null || number <= 0) continue;
      const key = `${event.side}:${number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const found = resolve(event.side, number);
      if (found.kind === "named" && found.player.playerName.trim()) continue;
      out.push({
        side: event.side,
        number,
        sharedBy: found.kind === "shared" ? found.names : [],
        eventType: event.type,
        minute: event.minute,
      });
    }
  }
  return out;
}

export type AutoApproveCandidate = {
  sheetStatus: "live" | "submitted" | "approved";
  submittedAt: Date | null;
  submittedById: string | null;
  recorderId: string | null;
  autoSubmittedAt: Date | null;
  idleLockedAt: Date | null;
  idleReleasedAt: Date | null;
  correctionRequested: boolean;
  /** Reopened after full time; the clock is in its `correction` phase. */
  correcting: boolean;
  isTraining: boolean;
  dangling: DanglingNumber[];
};

/** Why a sheet will not approve itself. Empty means it will, at `dueAt`. */
export type AutoApproveBlock =
  | "not_submitted"
  | "training"
  | "submitted_by_clock"
  | "not_submitted_by_recorder"
  | "idle_locked"
  | "correction_requested"
  | "correcting"
  | "dangling_numbers";

export type AutoApproveVerdict = {
  /** True when every condition holds and the ten minutes are up. */
  approve: boolean;
  /** When it will approve itself, if nothing blocks it. */
  dueAt: Date | null;
  blocks: AutoApproveBlock[];
};

/**
 * The submission was the clock's, not a person's.
 *
 * The auto-submit stamps `submittedAt` and `autoSubmittedAt` together and leaves the
 * submitted-by columns as they were, so `submittedById` can name whoever submitted an
 * earlier round. Comparing the two timestamps tells which submission is the current one.
 */
function submittedByClock(sheet: AutoApproveCandidate): boolean {
  if (!sheet.autoSubmittedAt) return false;
  if (!sheet.submittedAt) return true;
  return sheet.autoSubmittedAt.getTime() >= sheet.submittedAt.getTime();
}

export function assessAutoApprove(sheet: AutoApproveCandidate, now: Date): AutoApproveVerdict {
  if (sheet.sheetStatus !== "submitted" || !sheet.submittedAt) {
    return { approve: false, dueAt: null, blocks: ["not_submitted"] };
  }

  const blocks: AutoApproveBlock[] = [];
  if (sheet.isTraining) blocks.push("training");
  if (submittedByClock(sheet)) {
    blocks.push("submitted_by_clock");
  } else if (!sheet.submittedById || sheet.submittedById !== sheet.recorderId) {
    blocks.push("not_submitted_by_recorder");
  }
  if (sheet.idleLockedAt || sheet.idleReleasedAt) blocks.push("idle_locked");
  if (sheet.correctionRequested) blocks.push("correction_requested");
  if (sheet.correcting) blocks.push("correcting");
  if (sheet.dangling.length) blocks.push("dangling_numbers");

  const dueAt = new Date(sheet.submittedAt.getTime() + AUTO_APPROVE_DELAY_MS);
  return {
    approve: blocks.length === 0 && now.getTime() >= dueAt.getTime(),
    dueAt,
    blocks,
  };
}
