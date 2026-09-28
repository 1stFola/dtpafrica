import { describe, expect, it } from "vitest";
import { careerShortfall } from "./career-shortfall";

/**
 * The rule a merge and the repair both depend on.
 *
 * Small enough to look obvious, and the direction is the whole point: this may only
 * ever raise a career total. Getting the sign wrong here would quietly delete the
 * career a player entered about themselves at registration, on every merge, with no
 * error and nothing in the logs.
 */
describe("how far a career total has fallen behind", () => {
  it("measures the gap when the profile is short", () => {
    /* `NWOSU HENRY` after the live merge: five goals in the chart, none on the
       profile, because the record holding them was deleted. */
    expect(careerShortfall({ goals: 0, assists: 0 }, { goals: 5, assists: 0 })).toEqual({
      goals: 5,
      assists: 0,
    });
  });

  it("measures a partial gap, not the whole competition total", () => {
    // `Ezekwemba Somto`: profile 3, rows 5. Owed 2, not 5.
    expect(careerShortfall({ goals: 3, assists: 1 }, { goals: 5, assists: 4 })).toEqual({
      goals: 2,
      assists: 3,
    });
  });

  it("returns zero for a career total above its competition rows", () => {
    /* The normal case, and not a fault: a player who scored 40 goals before joining
       and 3 here. Levelling this down would erase what they told us. */
    expect(careerShortfall({ goals: 40, assists: 12 }, { goals: 3, assists: 1 })).toEqual({
      goals: 0,
      assists: 0,
    });
  });

  it("never returns a negative number, so no caller has to remember to clamp", () => {
    const gap = careerShortfall({ goals: 9, assists: 9 }, { goals: 1, assists: 0 });
    expect(gap.goals).toBeGreaterThanOrEqual(0);
    expect(gap.assists).toBeGreaterThanOrEqual(0);
  });

  it("returns zero when the two already agree", () => {
    expect(careerShortfall({ goals: 4, assists: 2 }, { goals: 4, assists: 2 })).toEqual({
      goals: 0,
      assists: 0,
    });
  });

  it("treats goals and assists independently", () => {
    /* Nothing says they drift together. A profile can be short on goals while its
       assist figure is the healthy self-reported one. */
    expect(careerShortfall({ goals: 0, assists: 9 }, { goals: 3, assists: 2 })).toEqual({
      goals: 3,
      assists: 0,
    });
  });
});
