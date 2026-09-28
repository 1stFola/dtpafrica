import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareStats,
  planCareerTopUp,
  planCorrection,
  projectCareerAfter,
  statKey,
  type StatPair,
} from "./player-stat-drift";

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

describe("topping a career total up to its competition rows", () => {
  const pair = (goals: number, assists = 0) => ({ goals, assists });

  it("credits a survivor whose career total lost the folded record's goals", () => {
    /* The live case. `Nwosu Henry` came out of a merge with five goals in the RAK
       BDFA League chart and zero on his profile: the merge moved the competition
       row and not the career total, then deleted the record holding it. */
    const plan = planCareerTopUp(
      new Map([["p1", pair(0)]]),
      new Map([["p1", pair(5)]])
    );
    expect(plan.topUps).toEqual([{ playerId: "p1", goals: 5, assists: 0 }]);
    expect(plan.totals).toEqual({ goals: 5, assists: 0 });
  });

  it("leaves a career total that sits above its competition rows", () => {
    /* The normal case, not a fault: this is the career a player typed in before
       they ever played a match here. Levelling it down would erase that. */
    const plan = planCareerTopUp(
      new Map([["p1", pair(12)]]),
      new Map([["p1", pair(3)]])
    );
    expect(plan.topUps).toEqual([]);
  });

  it("does nothing when the two already agree", () => {
    expect(planCareerTopUp(new Map([["p1", pair(4, 2)]]), new Map([["p1", pair(4, 2)]])).topUps)
      .toEqual([]);
  });

  it("tops goals up while leaving a healthy assist total alone", () => {
    const plan = planCareerTopUp(
      new Map([["p1", { goals: 0, assists: 9 }]]),
      new Map([["p1", { goals: 3, assists: 2 }]])
    );
    expect(plan.topUps).toEqual([{ playerId: "p1", goals: 3, assists: 0 }]);
  });

  it("credits a player who has no career figure at all yet", () => {
    const plan = planCareerTopUp(new Map(), new Map([["p1", pair(2, 1)]]));
    expect(plan.topUps).toEqual([{ playerId: "p1", goals: 2, assists: 1 }]);
  });
});

describe("the two passes not crediting the same goal twice", () => {
  /* Both passes write `Player.careerGoals`, and they are not independent. The
     competition pass credits the shortfall as it sets each derived row; the top-up
     pass then compares the career total against the events. Run against the figure
     as read from the database, the top-up finds the very shortfall the first pass is
     already fixing, and credits it again. This is the guard against that, and the
     reason `planCareerTopUp` takes a projection rather than the stored figure. */
  const pair = (goals: number, assists = 0) => ({ goals, assists });
  const events = (goals: number, assists = 0) =>
    new Map([[K("p1", "c1"), { goals, assists }]]);

  it("leaves the competition pass's own credit to the competition pass", () => {
    /* `Wasiu Yayah`: nine goals in the events, a career total of zero, no
       competition row. The competition pass takes him to nine. A top-up measured
       against the zero it read would take him to eighteen. */
    const rows = compareStats(events(9), new Map()).rows;
    const plan = planCorrection(rows);
    expect(plan.totals.careerGoalsAdded).toBe(9);

    const career = new Map([["p1", pair(0)]]);
    const projected = projectCareerAfter(career, plan.corrections);
    expect(projected.get("p1")).toEqual({ goals: 9, assists: 0 });
    expect(planCareerTopUp(projected, new Map([["p1", pair(9)]])).topUps).toEqual([]);

    // And the bug this exists to prevent, stated plainly.
    expect(planCareerTopUp(career, new Map([["p1", pair(9)]])).totals.goals).toBe(9);
  });

  it("still finds the merge gap, which the competition pass cannot reach", () => {
    /* `Nwosu Henry` after the merge: events and competition row agree, so the first
       pass has nothing to do and nothing to credit. The gap is the career total
       alone, and only the top-up can see it. */
    const rows = compareStats(events(5), new Map([[K("p1", "c1"), pair(5)]])).rows;
    const plan = planCorrection(rows);
    expect(plan.corrections).toEqual([]);

    const projected = projectCareerAfter(new Map([["p1", pair(0)]]), plan.corrections);
    expect(planCareerTopUp(projected, new Map([["p1", pair(5)]])).topUps).toEqual([
      { playerId: "p1", goals: 5, assists: 0 },
    ]);
  });

  it("adds up a player's credits across several competitions", () => {
    /* The career total is one number over every competition, so the projection has
       to fold the per-competition corrections together. One per row would leave the
       career total short by all but the last. */
    const rows = compareStats(
      new Map([
        [K("p1", "c1"), pair(3)],
        [K("p1", "c2"), pair(2, 1)],
      ]),
      new Map()
    ).rows;
    const projected = projectCareerAfter(new Map([["p1", pair(1)]]), planCorrection(rows).corrections);
    expect(projected.get("p1")).toEqual({ goals: 6, assists: 1 });
  });

  it("projects a player who has no career row yet", () => {
    const rows = compareStats(events(4, 2), new Map()).rows;
    const projected = projectCareerAfter(new Map(), planCorrection(rows).corrections);
    expect(projected.get("p1")).toEqual({ goals: 4, assists: 2 });
  });

  it("adds nothing for a declined correction, so the top-up can still see the gap", () => {
    /* A competition row above the events is never credited to the career total, so
       the projection must not pretend it was. */
    const rows = compareStats(events(1), new Map([[K("p1", "c1"), pair(4)]])).rows;
    const projected = projectCareerAfter(new Map([["p1", pair(0)]]), planCorrection(rows).corrections);
    expect(projected.get("p1")).toEqual({ goals: 0, assists: 0 });
  });

  it("does not mutate the career map it was handed", () => {
    /* The caller reports on the figures it read. A projection that wrote through
       them would change what the report says the profile currently shows. */
    const career = new Map([["p1", pair(2)]]);
    projectCareerAfter(career, planCorrection(compareStats(events(6), new Map()).rows).corrections);
    expect(career.get("p1")).toEqual({ goals: 2, assists: 0 });
  });
});

describe("every caller passes a projection, not the stored figure", () => {
  /* The tests above prove `projectCareerAfter` is needed. They cannot prove anyone
     called it. The failure mode is silent and it is in the callers, not here: hand
     `planCareerTopUp` the career total as read from the database and it double-credits
     every shortfall the competition pass is already fixing, and the only sign is that
     some profiles read high afterwards. So the sources are read. A new caller that
     forgets fails the build rather than the data. */
  const API_ROOT = resolve(__dirname, "..");
  const scripts = [
    "scripts/repair-player-stats.ts",
    "scripts/report-player-stat-drift.ts",
  ];

  it.each(scripts)("%s projects before topping up", (file) => {
    const source = readFileSync(join(API_ROOT, file), "utf8");
    const calls = [...source.matchAll(/planCareerTopUp\(/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      /* The first argument, up to the comma that ends it — balanced, because
         `projectCareerAfter(career, plan.corrections)` has a comma of its own. */
      let depth = 1;
      let i = call.index! + call[0].length;
      let first = "";
      while (i < source.length && depth > 0) {
        const ch = source[i]!;
        if (ch === "(") depth += 1;
        else if (ch === ")") depth -= 1;
        else if (ch === "," && depth === 1) break;
        if (depth > 0) first += ch;
        i += 1;
      }
      expect(first).toContain("projectCareerAfter");
    }
  });
});
