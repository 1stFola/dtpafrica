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

/**
 * The career total against the competition rows beneath it.
 *
 * A second, different comparison from the one above, and it exists because merging
 * two duplicate records creates a gap the first one cannot see.
 *
 * `mergePlayerRecords` adds the folded record's competition stats to the survivor
 * and deliberately leaves career totals alone — they mix what a player entered at
 * registration with the platform's increments, and adding one record's to
 * another's would double the self-reported part. Then the source row is deleted,
 * and its career goals go with it. Afterwards the events and the competition rows
 * agree perfectly, so `compareStats` reports nothing, while the survivor's profile
 * is short. On live, `Nwosu Henry` came out of the merge with five goals in the RAK
 * BDFA League chart and zero on his profile.
 *
 * `career` must be the figure *after* `planCorrection` has been applied — see
 * `projectCareerAfter`. Pass the figure as read from the database and every
 * shortfall the competition pass is already fixing is found again here, and
 * credited twice.
 *
 * Only a **shortfall** is actionable. A career total *above* the competition rows
 * is the normal, expected case — it is the career a player typed in before they
 * ever played a match here — so it is left alone and not even reported as a
 * problem.
 */
/**
 * The career total as it will stand once `planCorrection` has been applied.
 *
 * Both passes credit the career total, and without this they credit the same goal
 * twice. `planCorrection` adds the competition shortfall to the career figure as it
 * sets the derived row; comparing the career figure *as read* against the events
 * would then find the very same shortfall a second time. `Wasiu Yayah` had nine
 * goals in the events and a career total of zero: the competition pass takes him to
 * nine, and a top-up measured against the pre-correction zero would take him to
 * eighteen.
 *
 * So the top-up is measured against the projection, and what it finds is only what
 * the competition pass cannot reach — which is the merge gap, and nothing else.
 */
export function projectCareerAfter(
  career: Map<string, StatPair>,
  corrections: StatCorrection[]
): Map<string, StatPair> {
  const projected = new Map<string, StatPair>();
  for (const [playerId, held] of career) projected.set(playerId, { ...held });
  for (const c of corrections) {
    const held = projected.get(c.playerId) ?? { goals: 0, assists: 0 };
    projected.set(c.playerId, {
      goals: held.goals + c.careerGoals,
      assists: held.assists + c.careerAssists,
    });
  }
  return projected;
}
export type CareerTopUp = { playerId: string; goals: number; assists: number };

export function planCareerTopUp(
  career: Map<string, StatPair>,
  fromCompetitions: Map<string, StatPair>
): { topUps: CareerTopUp[]; totals: { goals: number; assists: number } } {
  const topUps: CareerTopUp[] = [];
  for (const [playerId, competitions] of fromCompetitions) {
    const held = career.get(playerId) ?? { goals: 0, assists: 0 };
    const goals = Math.max(0, competitions.goals - held.goals);
    const assists = Math.max(0, competitions.assists - held.assists);
    if (goals || assists) topUps.push({ playerId, goals, assists });
  }
  return {
    topUps,
    totals: {
      goals: topUps.reduce((n, t) => n + t.goals, 0),
      assists: topUps.reduce((n, t) => n + t.assists, 0),
    },
  };
}
