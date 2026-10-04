import { describe, expect, it } from "vitest";
import { MATCH_HALVES } from "./clock";

describe("the halves of a match", () => {
  it("number from one, in play order, each starting no earlier than the one before", () => {
    expect(MATCH_HALVES.map((h) => h.half)).toEqual([1, 2, 3, 4]);
    expect(MATCH_HALVES.map((h) => h.baseMinute)).toEqual([0, 45, 90, 105]);
    expect(new Set(MATCH_HALVES.map((h) => h.name)).size).toBe(MATCH_HALVES.length);
  });
});
