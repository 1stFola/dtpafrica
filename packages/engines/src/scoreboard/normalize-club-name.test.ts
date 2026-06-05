import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeClubName } from "./normalize-club-name";

describe("normalizeClubName", () => {
  const cases: Array<{ input: string; expected: string }> = [
    { input: "FC Bethel", expected: "FC Bethel Sporting" },
    { input: "bethel fc", expected: "FC Bethel Sporting" },
    { input: "BETHEL FC", expected: "FC Bethel Sporting" },
    { input: "  FC   Bethel  ", expected: "FC Bethel Sporting" },
    { input: "FC Bethel!!!", expected: "FC Bethel Sporting" },
    { input: "FC Bethel Sporting", expected: "FC Bethel Sporting" },

    { input: "Ikorodu City", expected: "Ikorodu City FC" },
    { input: "ikorodu city fc", expected: "Ikorodu City FC" },

    { input: "SGFC Athletics", expected: "SGFC Athletics SC" },
    { input: "SGFC Athletic SC", expected: "SGFC Athletics SC" },
    { input: "sgfc athletic", expected: "SGFC Athletics SC" },
    { input: "SGFC Athletics SC", expected: "SGFC Athletics SC" },

    { input: "Klassisch FC", expected: "Klassisch FA" },
    { input: "Klassisc FC", expected: "Klassisch FA" },
    { input: "Klassisc", expected: "Klassisch FA" },
    { input: "klassisch fa", expected: "Klassisch FA" },

    { input: "36 Lions FC", expected: "36 Lions FC" },
    { input: "Broad City FC", expected: "Broad City FC" },
  ];

  for (const { input, expected } of cases) {
    it(`maps ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      assert.equal(normalizeClubName(input), expected);
    });
  }

  it("strips zero-width characters", () => {
    const zw = "\u200B";
    assert.equal(normalizeClubName(`FC${zw} Bethel`), "FC Bethel Sporting");
    assert.equal(normalizeClubName(`Ikorodu${zw} City`), "Ikorodu City FC");
  });

  it("returns empty string for blank input", () => {
    assert.equal(normalizeClubName(""), "");
    assert.equal(normalizeClubName("   "), "");
  });
});
