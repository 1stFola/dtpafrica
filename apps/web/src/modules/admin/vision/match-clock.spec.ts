import { describe, expect, it } from "vitest";
import { clockAt, describeClock, nextHalfToAnchor } from "./match-clock";

const ANCHORS = [
  { half: 2, sourceMs: 3_000_000, endMs: null },
  { half: 1, sourceMs: 9000, endMs: 9000 + 45 * 60_000 },
];

describe("the match clock in the browser", () => {
  it("agrees with the API: broadcast minutes, added time, the break, the ends", () => {
    expect(clockAt(ANCHORS, 9000 + 12 * 60_000 + 30_000)).toMatchObject({ status: "on", half: 1, display: "12:30" });
    expect(clockAt(ANCHORS, 3_000_000 + 132_000)).toMatchObject({ status: "on", half: 2, minute: 47, second: 12, display: "47:12" });
    expect(clockAt(ANCHORS, 3_000_000 + 46 * 60_000)).toMatchObject({ display: "91:00" });
    expect(clockAt(ANCHORS, 5000)).toMatchObject({ status: "before_kickoff" });
    expect(clockAt(ANCHORS, 2_800_000)).toMatchObject({ status: "between_halves" });
    expect(clockAt([{ half: 1, sourceMs: 0, endMs: 1000 }], 2000)).toMatchObject({ status: "after_play" });
    expect(clockAt([], 1)).toMatchObject({ status: "unanchored", display: "not anchored" });
  });

  it("describes a reading with its half, or the reason there is none", () => {
    expect(describeClock(ANCHORS, 3_000_000 + 132_000)).toBe("47:12 · 2nd half");
    expect(describeClock(ANCHORS, 2_800_000)).toBe("between halves");
    expect(describeClock([], 1)).toBe("not anchored");
  });

  it("offers the next half to anchor", () => {
    expect(nextHalfToAnchor([])).toBe(1);
    expect(nextHalfToAnchor([{ half: 1, sourceMs: 0, endMs: null }])).toBe(2);
    expect(nextHalfToAnchor(ANCHORS)).toBe(3);
    expect(nextHalfToAnchor([1, 2, 3, 4].map((half) => ({ half, sourceMs: half, endMs: null })))).toBe(4);
  });
});
