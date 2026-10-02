import { ALL_SLICE, type BenchmarkMetric } from "@dtp/vision-contracts";

/**
 * Identity metrics, scored from rows.
 *
 * The machine's contribution to identity today is a side per track, so what can
 * be measured is team accuracy and -- the metric docs/vision/10 says is easy to
 * skip and shouldn't be -- unknown precision: when the kit clustering said it
 * could not tell, how often was the side it was nearest to wrong? A version that
 * gains accuracy by guessing where it used to abstain shows it here, and nowhere
 * else.
 *
 * Truth is what two people accepted: an identity assignment names a roster slot,
 * the slot is on a team, and that team is the track's side. Tracks with no
 * accepted identity, or with accepted identities on both teams (a split across a
 * substitution, say), carry no truth and are not scored. Goalkeepers and referees
 * are never clustered and are out of scope.
 *
 * Every metric is reported on `all` and on a slice per kit colour, because two
 * kits both mostly white is the stated risk and the number for them must be its
 * own.
 */

export type TeamEvidence = {
  trackId: string;
  /** kit_cluster | kit_outlier | not_clustered, as the row says. */
  method: string;
  /** The team a person said the kit's side is, when the kit named a side. */
  machineTeamId: string | null;
  /** The team of the side the kit was nearest to, named or not. */
  nearestTeamId: string | null;
  /** The kit colour the row was described by, for the slice. */
  kit: string | null;
  /** The team of the player two people accepted, or null when there is no truth. */
  truthTeamId: string | null;
};

export type TeamScore = {
  metrics: BenchmarkMetric[];
  tracks: number;
  sided: number;
  correct: number;
  abstained: number;
  abstainedRightly: number;
  outOfScope: number;
  withoutTruth: number;
};

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
}

export function scoreTeams(rows: readonly TeamEvidence[]): TeamScore {
  const inScope = rows.filter((r) => r.method !== "not_clustered");
  const outOfScope = rows.length - inScope.length;
  const withTruth = inScope.filter((r) => r.truthTeamId !== null);
  const withoutTruth = inScope.length - withTruth.length;

  const slices = [ALL_SLICE, ...new Set(withTruth.map((r) => r.kit).filter((k): k is string => !!k).map((k) => `kit:${k}`))];
  const metrics: BenchmarkMetric[] = [];
  let totals = { sided: 0, correct: 0, abstained: 0, abstainedRightly: 0 };

  for (const slice of slices) {
    const here = slice === ALL_SLICE ? withTruth : withTruth.filter((r) => `kit:${r.kit}` === slice);
    const sided = here.filter((r) => r.machineTeamId !== null);
    const correct = sided.filter((r) => r.machineTeamId === r.truthTeamId);
    // An abstention with a nearest side can be judged; an outlier has none and cannot.
    const abstained = here.filter((r) => r.machineTeamId === null && r.nearestTeamId !== null);
    const abstainedRightly = abstained.filter((r) => r.nearestTeamId !== r.truthTeamId);
    if (slice === ALL_SLICE) totals = { sided: sided.length, correct: correct.length, abstained: abstained.length, abstainedRightly: abstainedRightly.length };

    metrics.push(
      { metric: "tracks:all", slice, value: here.length, support: here.length },
      { metric: "team_coverage:all", slice, value: ratio(sided.length, here.length), support: here.length },
      { metric: "team_accuracy:all", slice, value: ratio(correct.length, sided.length), support: sided.length },
      { metric: "unknown_precision:all", slice, value: ratio(abstainedRightly.length, abstained.length), support: abstained.length }
    );
  }

  return { metrics, tracks: withTruth.length, outOfScope, withoutTruth, ...totals };
}
