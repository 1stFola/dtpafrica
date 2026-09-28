import { describe, expect, it } from "vitest";
import { compareStats, planCorrection, statKey, type StatPair } from "./player-stat-drift";

const pair = (goals: number, assists = 0): StatPair => ({ goals, assists });
const K = (p: string, c: string) => statKey(p, c);

describe("comparing events against the stored totals", () => {
  it("says nothing about a player whose totals already match", () => {
    const r = compareStats(
      new Map([[K("p1", "c1"), pair(3, 1)]]),
      new Map([[K("p1", "c1"), pair(3, 1)]])
    );
    expect(r.rows).toEqual([]);
    expect(r.totals.missingGoals).toBe(0);
  });

  it("finds a player with events and no stats row at all", () => {
    /* The commonest shape here: the goal was recorded before the player was
       linked, so nobody was credited and no row was ever created. A join from the
       stats table would miss these entirely, which is why both sides are walked. */
    const r = compareStats(new Map([[K("p1", "c1"), pair(7, 2)]]), new Map());
    expect(r.behind).toHaveLength(1);
    expect(r.behind[0]?.missing).toEqual({ goals: 7, assists: 2 });
    expect(r.totals).toEqual({ missingGoals: 7, missingAssists: 2, playersBehind: 1 });
  });

  it("finds a stats row that is behind", () => {
    const r = compareStats(
      new Map([[K("p1", "c1"), pair(5)]]),
      new Map([[K("p1", "c1"), pair(3)]])
    );
    expect(r.behind[0]?.missing.goals).toBe(2);
  });

  it("separates a total that is ahead of the events, and never counts it as missing", () => {
    /* Ahead means an event was deleted after being counted, or something counted
       twice. Either needs a human, and flattening it would hide the cause. */
    const r = compareStats(
      new Map([[K("p1", "c1"), pair(1)]]),
      new Map([[K("p1", "c1"), pair(4)]])
    );
    expect(r.behind).toEqual([]);
    expect(r.ahead).toHaveLength(1);
    expect(r.ahead[0]?.missing.goals).toBe(-3);
    expect(r.totals.missingGoals).toBe(0);
  });

  it("keeps a player's competitions apart", () => {
    // A goal in one competition must never pay off a shortfall in another.
    const r = compareStats(
      new Map([
        [K("p1", "c1"), pair(2)],
        [K("p1", "c2"), pair(0)],
      ]),
      new Map([
        [K("p1", "c1"), pair(0)],
        [K("p1", "c2"), pair(2)],
      ])
    );
    expect(r.behind).toHaveLength(1);
    expect(r.ahead).toHaveLength(1);
    expect(r.totals.missingGoals).toBe(2);
  });

  it("counts a player once however many competitions they are short in", () => {
    const r = compareStats(
      new Map([
        [K("p1", "c1"), pair(1)],
        [K("p1", "c2"), pair(1)],
      ]),
      new Map()
    );
    expect(r.totals).toEqual({ missingGoals: 2, missingAssists: 0, playersBehind: 1 });
  });

  it("reports a row that is behind on goals and ahead on assists as both", () => {
    // Nothing says the two have to drift the same way.
    const r = compareStats(
      new Map([[K("p1", "c1"), { goals: 3, assists: 0 }]]),
      new Map([[K("p1", "c1"), { goals: 1, assists: 2 }]])
    );
    expect(r.behind).toHaveLength(1);
    expect(r.ahead).toHaveLength(1);
    expect(r.totals.missingGoals).toBe(2);
    // The assist surplus is not netted off against the goal shortfall.
    expect(r.totals.missingAssists).toBe(0);
  });

  it("does not confuse two players whose ids share a prefix", () => {
    const r = compareStats(
      new Map([
        [K("p1", "c1"), pair(1)],
        [K("p10", "c1"), pair(1)],
      ]),
      new Map()
    );
    expect(r.totals.playersBehind).toBe(2);
  });
});

describe("planning a correction", () => {
  const drift = (fromEvents: [number, number], stored: [number, number]) =>
    compareStats(
      new Map([[K("p1", "c1"), { goals: fromEvents[0], assists: fromEvents[1] }]]),
      new Map([[K("p1", "c1"), { goals: stored[0], assists: stored[1] }]])
    ).rows;

  it("sets the derived row to whatever the events say", () => {
    const plan = planCorrection(drift([5, 2], [3, 1]));
    expect(plan.corrections[0]).toMatchObject({ setGoals: 5, setAssists: 2 });
  });

  it("corrects a surplus downward, because the events are the authority", () => {
    const plan = planCorrection(drift([1, 0], [4, 0]));
    expect(plan.corrections[0]?.setGoals).toBe(1);
  });

  it("adds a shortfall to the career total", () => {
    const plan = planCorrection(drift([5, 2], [3, 1]));
    expect(plan.corrections[0]).toMatchObject({ careerGoals: 2, careerAssists: 1 });
    expect(plan.totals).toEqual({ rowsSet: 1, careerGoalsAdded: 2, careerAssistsAdded: 1 });
  });

  it("refuses to take a career total down, and says so", () => {
    /* A competition stat above the events does not prove the career total is
       inflated: the admin's player-merge writes one without the other. Reducing it
       could erase what a player entered about themselves at registration. */
    const plan = planCorrection(drift([1, 0], [4, 0]));
    expect(plan.corrections[0]?.careerGoals).toBe(0);
    expect(plan.declined).toEqual([
      { playerId: "p1", competitionId: "c1", goals: -3, assists: 0 },
    ]);
    expect(plan.totals.careerGoalsAdded).toBe(0);
  });

  it("credits the shortfall and declines the surplus on the same row", () => {
    // Nothing says goals and assists have to drift the same way.
    const plan = planCorrection(drift([3, 0], [1, 2]));
    expect(plan.corrections[0]).toMatchObject({
      setGoals: 3,
      setAssists: 0,
      careerGoals: 2,
      careerAssists: 0,
    });
    expect(plan.declined[0]?.assists).toBe(-2);
  });

  it("plans nothing for a row that already agrees", () => {
    expect(planCorrection(drift([2, 1], [2, 1])).corrections).toEqual([]);
  });
});
