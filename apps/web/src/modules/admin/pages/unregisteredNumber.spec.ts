import { describe, expect, it } from "vitest";
import { buildNumberLookup } from "@dtp/engines/squad-number-lookup";
import { findUnregistered, parseJersey } from "./unregisteredNumber";

const match = {
  homeTeam: { id: "h", name: "Home FC" },
  awayTeam: { id: "a", name: "Away FC" },
  teamSquad: [
    { teamId: "h", jerseyNumber: 7, playerName: "Ade Bola", playerId: "p7" },
    { teamId: "h", jerseyNumber: 9, playerName: "Kelvin Oghidi", playerId: null },
    { teamId: "h", jerseyNumber: 9, playerName: "Samson Adeyemo", playerId: null },
  ],
  squadPlayers: [{ teamId: "h", jerseyNumber: 12, playerName: "Guest One", playerId: null }],
};

const lookup = buildNumberLookup({
  teamSquad: match.teamSquad.map((p) => ({ ...p, number: p.jerseyNumber })),
  matchSquad: match.squadPlayers.map((p) => ({ ...p, number: p.jerseyNumber })),
});

describe("parseJersey", () => {
  it("takes a whole number from 1 to 99", () => {
    expect(parseJersey("7")).toBe(7);
    expect(parseJersey(" 99 ")).toBe(99);
  });

  it("refuses what a number input lets through", () => {
    for (const typed of ["", " ", "0", "-3", "7.5", "100", "150", "abc"]) {
      expect(parseJersey(typed)).toBeNull();
    }
  });
});

describe("findUnregistered", () => {
  it("passes a number either squad names", () => {
    expect(findUnregistered(lookup, match, [{ side: "home", number: 7 }])).toEqual([]);
    expect(findUnregistered(lookup, match, [{ side: "home", number: 12 }])).toEqual([]);
  });

  it("passes a shared number, which is registered and labelled as shared", () => {
    expect(findUnregistered(lookup, match, [{ side: "home", number: 9 }])).toEqual([]);
  });

  it("flags a number nobody wears, once, and skips blanks", () => {
    expect(
      findUnregistered(lookup, match, [
        { side: "home", number: 23 },
        { side: "home", number: 23 },
        { side: "home", number: null },
      ])
    ).toEqual([{ side: "home", number: 23, teamName: "Home FC", squadEmpty: false }]);
  });

  it("says when the team has no numbered players at all", () => {
    expect(findUnregistered(lookup, match, [{ side: "away", number: 7 }])).toEqual([
      { side: "away", number: 7, teamName: "Away FC", squadEmpty: true },
    ]);
  });
});
