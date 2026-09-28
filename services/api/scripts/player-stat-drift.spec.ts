import { describe, expect, it } from "vitest";
import { compareStats, statKey, type StatPair } from "./player-stat-drift";

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
