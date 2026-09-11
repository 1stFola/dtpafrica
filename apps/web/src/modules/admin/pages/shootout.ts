import type { RecordedEvent, Side } from "../../../api/adminMatchStats";

/**
 * Penalty shootout rules for the match console. Pure functions, no React, so
 * the kick order can be reasoned about (and checked) on its own.
 *
 * The operator chooses which team takes the first kick. That choice is stored
 * as the `side` of the `penalty_shootout` marker event, so it persists with the
 * match sheet and needs no schema change; every kick after it alternates from
 * there. Sheets recorded before the choice existed carry a marker with side
 * "home", which reproduces the old home-first order exactly.
 */

export const SHOOTOUT_TYPES = new Set(["shootout_goal", "shootout_miss"]);

const otherSide = (side: Side): Side => (side === "home" ? "away" : "home");

/** The team that took (or will take) the first kick, or null if not chosen yet. */
export function shootoutStartingSide(events: RecordedEvent[]): Side | null {
  const marker = events.find((event) => event.type === "penalty_shootout");
  return marker ? marker.side : null;
}

export function shootoutScore(events: RecordedEvent[]): Record<Side, number> {
  return events.reduce(
    (score, event) => {
      if (event.type === "shootout_goal") score[event.side] += 1;
      return score;
    },
    { home: 0, away: 0 }
  );
}

export function shootoutCounts(events: RecordedEvent[]): Record<Side, number> {
  return events.reduce(
    (count, event) => {
      if (SHOOTOUT_TYPES.has(event.type)) count[event.side] += 1;
      return count;
    },
    { home: 0, away: 0 }
  );
}

export function nextShootoutSide(events: RecordedEvent[]): Side {
  const start = shootoutStartingSide(events) ?? "home";
  const kicks = events.filter((event) => SHOOTOUT_TYPES.has(event.type)).length;
  return kicks % 2 === 0 ? start : otherSide(start);
}

/** Re-applies strict alternation from the starting team to every kick. */
export function normalizeShootoutSides(events: RecordedEvent[]): RecordedEvent[] {
  const start = shootoutStartingSide(events) ?? "home";
  let shootoutIndex = 0;
  return events.map((event) => {
    if (!SHOOTOUT_TYPES.has(event.type)) return event;
    const side: Side = shootoutIndex % 2 === 0 ? start : otherSide(start);
    shootoutIndex += 1;
    return event.side === side ? event : { ...event, side };
  });
}

/** 1-based round of the next kick: a round is one kick per team. */
export function shootoutRound(events: RecordedEvent[]): number {
  const start = shootoutStartingSide(events) ?? "home";
  const counts = shootoutCounts(events);
  const next = nextShootoutSide(events);
  return Math.max(counts.home, counts.away) + (next === start ? 1 : 0);
}

export function shootoutIsDecided(events: RecordedEvent[]): boolean {
  const score = shootoutScore(events);
  const count = shootoutCounts(events);
  const homeInitialRemaining = Math.max(0, 5 - count.home);
  const awayInitialRemaining = Math.max(0, 5 - count.away);

  if (count.home <= 5 && count.away <= 5) {
    if (score.home > score.away + awayInitialRemaining) return true;
    if (score.away > score.home + homeInitialRemaining) return true;
  }

  const initialComplete = count.home >= 5 && count.away >= 5;
  const completeSuddenDeathPair = initialComplete && count.home === count.away;
  return completeSuddenDeathPair && score.home !== score.away;
}
