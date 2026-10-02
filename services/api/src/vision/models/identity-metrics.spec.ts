import { describe, expect, it } from "vitest";
import { scoreTeams, type TeamEvidence } from "./identity-metrics";

/**
 * Team accuracy and unknown precision, by hand.
 *
 * Six tracks: two sided rightly, one sided wrongly, one abstention whose nearest
 * side was right (the abstention was not needed), one whose nearest side was
 * wrong (the abstention avoided a mistake), and a goalkeeper, out of scope.
 */
const HOME = "home";
const AWAY = "away";

const row = (over: Partial<TeamEvidence>): TeamEvidence => ({
  trackId: "t", method: "kit_cluster", machineTeamId: HOME, nearestTeamId: HOME, kit: "red", truthTeamId: HOME, ...over,
});

const byHand: TeamEvidence[] = [
  row({ trackId: "t1" }),
  row({ trackId: "t2", machineTeamId: AWAY, nearestTeamId: AWAY, kit: "blue", truthTeamId: AWAY }),
  row({ trackId: "t3", machineTeamId: HOME, nearestTeamId: HOME, truthTeamId: AWAY }),
  row({ trackId: "t4", machineTeamId: null, nearestTeamId: HOME, truthTeamId: HOME }),
  row({ trackId: "t5", machineTeamId: null, nearestTeamId: AWAY, kit: "blue", truthTeamId: HOME }),
  row({ trackId: "t6", method: "not_clustered", machineTeamId: null, nearestTeamId: null, kit: null, truthTeamId: HOME }),
];

const value = (score: ReturnType<typeof scoreTeams>, metric: string, slice = "all") =>
  score.metrics.find((m) => m.metric === metric && m.slice === slice);

describe("team accuracy and unknown precision", () => {
  it("scores the six tracks as worked out by hand", () => {
    const score = scoreTeams(byHand);
    expect(score).toMatchObject({ tracks: 5, sided: 3, correct: 2, abstained: 2, abstainedRightly: 1, outOfScope: 1, withoutTruth: 0 });
    expect(value(score, "tracks:all")).toEqual({ metric: "tracks:all", slice: "all", value: 5, support: 5 });
    expect(value(score, "team_coverage:all")).toEqual({ metric: "team_coverage:all", slice: "all", value: 0.6, support: 5 });
    expect(value(score, "team_accuracy:all")).toEqual({ metric: "team_accuracy:all", slice: "all", value: 0.6667, support: 3 });
    expect(value(score, "unknown_precision:all")).toEqual({ metric: "unknown_precision:all", slice: "all", value: 0.5, support: 2 });
  });

  it("reports every metric per kit colour as well, so two white kits get their own number", () => {
    const score = scoreTeams(byHand);
    expect(new Set(score.metrics.map((m) => m.slice))).toEqual(new Set(["all", "kit:red", "kit:blue"]));
    // Red: t1 right, t3 wrong, t4 abstained with the nearest right.
    expect(value(score, "team_accuracy:all", "kit:red")).toMatchObject({ value: 0.5, support: 2 });
    expect(value(score, "team_coverage:all", "kit:red")).toMatchObject({ value: 0.6667, support: 3 });
    expect(value(score, "unknown_precision:all", "kit:red")).toMatchObject({ value: 0, support: 1 });
    // Blue: t2 right, t5 abstained with the nearest wrong.
    expect(value(score, "team_accuracy:all", "kit:blue")).toMatchObject({ value: 1, support: 1 });
    expect(value(score, "unknown_precision:all", "kit:blue")).toMatchObject({ value: 1, support: 1 });
  });

  it("has no value, not zero, where there is nothing to measure", () => {
    const score = scoreTeams([row({ machineTeamId: null, nearestTeamId: HOME })]);
    expect(value(score, "team_accuracy:all")).toMatchObject({ value: null, support: 0 });
    expect(value(score, "team_coverage:all")).toMatchObject({ value: 0, support: 1 });
    const empty = scoreTeams([]);
    expect(value(empty, "tracks:all")).toMatchObject({ value: 0, support: 0 });
    expect(value(empty, "unknown_precision:all")).toMatchObject({ value: null, support: 0 });
  });

  it("leaves out tracks nobody has named, and goalkeepers, without counting them against the model", () => {
    const score = scoreTeams([row({ truthTeamId: null }), row({ method: "not_clustered", truthTeamId: HOME }), row({})]);
    expect(score).toMatchObject({ tracks: 1, withoutTruth: 1, outOfScope: 1, sided: 1, correct: 1 });
    expect(value(score, "team_accuracy:all")).toMatchObject({ value: 1, support: 1 });
    // Coverage is over tracks with truth: the unnamed track is not uncovered, it is unmeasured.
    expect(value(score, "team_coverage:all")).toMatchObject({ value: 1, support: 1 });
  });

  it("cannot judge an outlier's abstention, which has no nearest side", () => {
    const score = scoreTeams([row({ method: "kit_outlier", machineTeamId: null, nearestTeamId: null, kit: null })]);
    expect(score).toMatchObject({ tracks: 1, sided: 0, abstained: 0 });
    expect(value(score, "team_coverage:all")).toMatchObject({ value: 0, support: 1 });
    expect(value(score, "unknown_precision:all")).toMatchObject({ value: null, support: 0 });
  });

  it("rounds to four places", () => {
    const rows = [row({}), row({}), row({ truthTeamId: AWAY })];
    expect(value(scoreTeams(rows), "team_accuracy:all")?.value).toBe(0.6667);
  });
});
