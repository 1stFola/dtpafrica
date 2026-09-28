/**
 * What the events say a player did, against what the stored totals claim.
 *
 * Two different numbers get called "goals" in this codebase, and they are not the
 * same kind of thing. Keeping them apart is the whole point of this module.
 *
 *   - **`SbPlayerCompetitionStats.goals`** is *derived*. It is only ever written by
 *     `flushPlayerDeltas`, one increment per event as the event is recorded. It
 *     should equal the events, and where it does not, the difference is a fault.
 *   - **`Player.careerGoals`** is *not* derived. A player types their career record
 *     in at registration (`home.service.register`), and the platform increments it
 *     on top. It cannot be recomputed from events without erasing the history
 *     somebody entered about themselves.
 *
 * So the platform's contribution is reconcilable and the baseline is not, and the
 * safe correction is a **delta**: whatever the events say is missing from the
 * derived table is missing from the career total by the same amount, and adding it
 * leaves the self-reported part alone.
 *
 * Why anything is missing at all: `applyMatchEventToPlayerStats` credits a goal
 * only `if (event.playerId)`. An event recorded with no player attached credits
 * nobody, and nothing revisits it when the link is added later — which is exactly
 * what `db:sync:event-player-links` has been doing.
 *
 * The counting rules are taken from that same function rather than invented here,
 * because a report that counts differently from the app is noise:
 *
 *   - a **goal** is `goal` or `goal_penalty`, credited to `playerId`
 *   - an **assist** is `goal` only — never `goal_penalty` — credited to
 *     `assistPlayerId`
 *
 * Appearances, minutes and clean sheets are deliberately not reconciled. They come
 * from match rosters at kickoff rather than from events, they are claimed once per
 * match, and guessing at them from event rows would produce confident nonsense.
 */

export type StatPair = { goals: number; assists: number };

export type DriftRow = {
  playerId: string;
  competitionId: string;
  fromEvents: StatPair;
  stored: StatPair;
  /** Positive means the stored total is behind the events. */
  missing: StatPair;
};

export type DriftReport = {
  rows: DriftRow[];
  /** Rows where the stored total is short. The correctable case. */
  behind: DriftRow[];
  /**
   * Rows where the stored total is ahead of the events.
   *
   * Never corrected automatically. It means either an event was deleted after
   * being counted, or something counted twice, and those need looking at rather
   * than flattening.
   */
  ahead: DriftRow[];
  totals: { missingGoals: number; missingAssists: number; playersBehind: number };
};

const key = (playerId: string, competitionId: string) => `${playerId}\u0000${competitionId}`;

export function compareStats(
  fromEvents: Map<string, StatPair>,
  stored: Map<string, StatPair>
): DriftReport {
  const rows: DriftRow[] = [];
  /* Both directions are walked, because a player can have events and no stats row
     at all — which is the commonest shape here, and the one a join from the stats
     table would miss entirely. */
  for (const k of new Set([...fromEvents.keys(), ...stored.keys()])) {
    const [playerId, competitionId] = k.split("\u0000") as [string, string];
    const events = fromEvents.get(k) ?? { goals: 0, assists: 0 };
    const held = stored.get(k) ?? { goals: 0, assists: 0 };
    if (events.goals === held.goals && events.assists === held.assists) continue;
    rows.push({
      playerId,
      competitionId,
      fromEvents: events,
      stored: held,
      missing: { goals: events.goals - held.goals, assists: events.assists - held.assists },
    });
  }

  const behind = rows.filter((r) => r.missing.goals > 0 || r.missing.assists > 0);
  const ahead = rows.filter((r) => r.missing.goals < 0 || r.missing.assists < 0);

  return {
    rows,
    behind,
    ahead,
    totals: {
      missingGoals: behind.reduce((n, r) => n + Math.max(0, r.missing.goals), 0),
      missingAssists: behind.reduce((n, r) => n + Math.max(0, r.missing.assists), 0),
      playersBehind: new Set(behind.map((r) => r.playerId)).size,
    },
  };
}

export const statKey = key;
