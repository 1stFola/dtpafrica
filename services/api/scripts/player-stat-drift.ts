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

/**
 * What a correction may and may not write.
 *
 * The two totals need opposite treatment, and the asymmetry is not fussiness.
 *
 * `SbPlayerCompetitionStats` is derived, so it is simply **set** to what the
 * events say, in both directions. That corrects a surplus as readily as a
 * shortfall, and needs no flag to be safe, because the events are the authority.
 *
 * `Player.careerGoals` is not derived, and the admin's player-merge writes the
 * competition stats without touching it — so the two can legitimately disagree.
 * A **positive** delta is safe to add: those goals were never credited anywhere,
 * to anyone. A **negative** delta is refused: a competition stat above the events
 * does not prove the career total is inflated too, and reducing it could erase the
 * record a player entered about themselves at registration. Those are reported
 * instead, which is also how the cause gets found.
 *
 * Appearances, minutes and clean sheets are never touched. They live on the same
 * row and come from match rosters rather than events, so the row is updated field
 * by field rather than replaced.
 */
export type StatCorrection = {
  playerId: string;
  competitionId: string;
  /** What the derived row becomes. Goals and assists only. */
  setGoals: number;
  setAssists: number;
  /** Added to the career total. Never negative. */
  careerGoals: number;
  careerAssists: number;
};

export type CorrectionPlan = {
  corrections: StatCorrection[];
  /** Career credit not applied because the delta was negative. */
  declined: { playerId: string; competitionId: string; goals: number; assists: number }[];
  totals: { rowsSet: number; careerGoalsAdded: number; careerAssistsAdded: number };
};

export function planCorrection(rows: DriftRow[]): CorrectionPlan {
  const corrections: StatCorrection[] = [];
  const declined: CorrectionPlan["declined"] = [];

  for (const row of rows) {
    corrections.push({
      playerId: row.playerId,
      competitionId: row.competitionId,
      setGoals: row.fromEvents.goals,
      setAssists: row.fromEvents.assists,
      careerGoals: Math.max(0, row.missing.goals),
      careerAssists: Math.max(0, row.missing.assists),
    });
    if (row.missing.goals < 0 || row.missing.assists < 0) {
      declined.push({
        playerId: row.playerId,
        competitionId: row.competitionId,
        goals: Math.min(0, row.missing.goals),
        assists: Math.min(0, row.missing.assists),
      });
    }
  }

  return {
    corrections,
    declined,
    totals: {
      rowsSet: corrections.length,
      careerGoalsAdded: corrections.reduce((n, c) => n + c.careerGoals, 0),
      careerAssistsAdded: corrections.reduce((n, c) => n + c.careerAssists, 0),
    },
  };
}
