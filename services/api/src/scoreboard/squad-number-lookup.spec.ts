import { describe, expect, it } from "vitest";
import { buildNumberLookup, squadNumberLabel, type SquadRow } from "./squad-number-lookup";

/**
 * Resolving a shirt number to a person.
 *
 * The failure that matters is not a number left unresolved — the timeline shows `No. 7`
 * and somebody notices. It is a number resolved to the *wrong* person, because that
 * puts a goal on a profile where nothing looks wrong. Most of these tests are about
 * refusing to guess.
 */

const HOME = "team-home";
const AWAY = "team-away";

function row(over: Partial<SquadRow> = {}): SquadRow {
  return { teamId: HOME, number: 7, playerName: "Ogundeji Elijah", playerId: "p1", ...over };
}

describe("resolving a number from the squads", () => {
  it("finds the player in the team squad", () => {
    /* The whole point. Live had the names here and every call site looked only at the
       matchday squad, so the number resolved to nothing. */
    const lookup = buildNumberLookup({ teamSquad: [row()], matchSquad: [] });
    expect(lookup.find(HOME, 7)?.playerName).toBe("Ogundeji Elijah");
  });

  it("falls back to the matchday squad when the team squad has no such number", () => {
    const lookup = buildNumberLookup({
      teamSquad: [row({ number: 9 })],
      matchSquad: [row({ number: 7, playerName: "Guest Striker", playerId: "p9" })],
    });
    expect(lookup.find(HOME, 7)?.playerName).toBe("Guest Striker");
  });

  it("keeps the two teams apart", () => {
    /* Both sides have a number 7 and they are different people. Keying on the number
       alone would put an away goal on a home player. */
    const lookup = buildNumberLookup({
      teamSquad: [
        row({ teamId: HOME, playerName: "Home Seven", playerId: "h7" }),
        row({ teamId: AWAY, playerName: "Away Seven", playerId: "a7" }),
      ],
      matchSquad: [],
    });
    expect(lookup.find(HOME, 7)?.playerName).toBe("Home Seven");
    expect(lookup.find(AWAY, 7)?.playerName).toBe("Away Seven");
  });

  it("resolves a squad row that has no player record, for the name alone", () => {
    /* An unlinked squad row still knows who wore 7. The label gets the name and
       `playerId` stays null, so the timeline reads correctly even though no goal can be
       credited yet — `db:sync:event-player-links` is what links it later. */
    const lookup = buildNumberLookup({
      teamSquad: [row({ playerId: null, playerName: "Ismaila Philip" })],
      matchSquad: [],
    });
    expect(lookup.find(HOME, 7)).toMatchObject({ playerName: "Ismaila Philip", playerId: null });
  });

  it("returns nothing for a number nobody wears", () => {
    expect(buildNumberLookup({ teamSquad: [row()], matchSquad: [] }).find(HOME, 23)).toBeUndefined();
  });

  it("returns nothing for a missing or nonsense number", () => {
    const lookup = buildNumberLookup({ teamSquad: [row()], matchSquad: [] });
    expect(lookup.find(HOME, null)).toBeUndefined();
    expect(lookup.find(HOME, undefined)).toBeUndefined();
    expect(lookup.find(HOME, 0)).toBeUndefined();
    expect(lookup.find(HOME, -7)).toBeUndefined();
  });

  it("ignores squad rows carrying no number", () => {
    const lookup = buildNumberLookup({
      teamSquad: [row({ number: null }), row({ number: 7 })],
      matchSquad: [],
    });
    expect(lookup.find(HOME, 7)?.playerId).toBe("p1");
  });
});

describe("the team squad taking precedence", () => {
  it("prefers the team squad when both squads name somebody", () => {
    // The stated choice. The other order is defensible; this is the one asked for.
    const lookup = buildNumberLookup({
      teamSquad: [row({ playerName: "Standing Seven", playerId: "s7" })],
      matchSquad: [row({ playerName: "Matchday Seven", playerId: "m7" })],
    });
    expect(lookup.find(HOME, 7)?.playerName).toBe("Standing Seven");
  });

  it("records the disagreement rather than swallowing it", () => {
    /* Because precedence overrules a per-match lineup, the cases where that mattered
       have to be findable afterwards. A silent overrule is the part that would be
       indefensible. */
    const lookup = buildNumberLookup({
      teamSquad: [row({ playerName: "Standing Seven", playerId: "s7" })],
      matchSquad: [row({ playerName: "Matchday Seven", playerId: "m7" })],
    });
    expect(lookup.conflicts).toEqual([
      { teamId: HOME, number: 7, fromTeamSquad: "Standing Seven", fromMatchSquad: "Matchday Seven" },
    ]);
  });

  it("reports no conflict when both squads mean the same person", () => {
    const lookup = buildNumberLookup({
      teamSquad: [row()],
      matchSquad: [row()],
    });
    expect(lookup.conflicts).toEqual([]);
  });

  it("compares by player record when both have one, not by spelling", () => {
    /* `NWOSU HENRY` and `Nwosu Henry` are one person under two spellings, which is
       exactly what today's directory is full of. Comparing text would report a
       conflict that does not exist. */
    const lookup = buildNumberLookup({
      teamSquad: [row({ playerName: "NWOSU HENRY", playerId: "same" })],
      matchSquad: [row({ playerName: "Nwosu Henry", playerId: "same" })],
    });
    expect(lookup.conflicts).toEqual([]);
  });

  it("compares by name when a record is missing, ignoring case and padding", () => {
    const lookup = buildNumberLookup({
      teamSquad: [row({ playerName: "Nwosu Henry", playerId: null })],
      matchSquad: [row({ playerName: "  NWOSU HENRY ", playerId: null })],
    });
    expect(lookup.conflicts).toEqual([]);
  });
});

describe("a number two players wear", () => {
  it("resolves to nobody and says so", () => {
    /* Picking whichever row came back first would attribute a goal by accident and
       look deliberate afterwards. */
    const lookup = buildNumberLookup({
      teamSquad: [
        row({ playerName: "First Seven", playerId: "a" }),
        row({ playerName: "Second Seven", playerId: "b" }),
      ],
      matchSquad: [],
    });
    expect(lookup.find(HOME, 7)).toBeUndefined();
    expect(lookup.ambiguous).toEqual([
      { teamId: HOME, number: 7, source: "team", names: ["First Seven", "Second Seven"] },
    ]);
  });

  it("falls through to the matchday squad, which may be unambiguous", () => {
    /* A name from either source beats `No. 7`, so an ambiguity in the preferred source
       is a reason to try the other one rather than to give up. */
    const lookup = buildNumberLookup({
      teamSquad: [
        row({ playerName: "First Seven", playerId: "a" }),
        row({ playerName: "Second Seven", playerId: "b" }),
      ],
      matchSquad: [row({ playerName: "Played Seven", playerId: "c" })],
    });
    expect(lookup.find(HOME, 7)?.playerName).toBe("Played Seven");
  });

  it("resolves the number when both rows are the same person", () => {
    /* A squad holding one player twice under two spellings is a duplicate to fold, not
       an ambiguous number, and the recorder should not be blocked by it. */
    const lookup = buildNumberLookup({
      teamSquad: [
        row({ playerName: "Nwosu Henry", playerId: "same" }),
        row({ playerName: "NWOSU HENRY", playerId: "same" }),
      ],
      matchSquad: [],
    });
    expect(lookup.find(HOME, 7)?.playerId).toBe("same");
    expect(lookup.ambiguous).toEqual([]);
  });

  it("treats two unlinked rows with the same name as one person", () => {
    const lookup = buildNumberLookup({
      teamSquad: [
        row({ playerName: "Ismaila Philip", playerId: null }),
        row({ playerName: "ismaila philip", playerId: null }),
      ],
      matchSquad: [],
    });
    expect(lookup.ambiguous).toEqual([]);
    expect(lookup.find(HOME, 7)?.playerName).toBe("Ismaila Philip");
  });

  it("reports an ambiguity in the matchday squad too", () => {
    const lookup = buildNumberLookup({
      teamSquad: [],
      matchSquad: [
        row({ playerName: "One", playerId: "a" }),
        row({ playerName: "Two", playerId: "b" }),
      ],
    });
    expect(lookup.find(HOME, 7)).toBeUndefined();
    expect(lookup.ambiguous[0]).toMatchObject({ source: "matchday", number: 7 });
  });
});

describe("the timeline label", () => {
  it("reads number and name together", () => {
    expect(squadNumberLabel({ playerName: "Ogundeji Elijah" }, 7)).toBe("No. 7 Ogundeji Elijah");
  });

  it("falls back to the number when nobody resolved", () => {
    /* Honest rather than blank: it says what was known, which is a number. The front
       end hides it from a scoring chart. */
    expect(squadNumberLabel(undefined, 7)).toBe("No. 7");
  });

  it("gives the name alone when there is no number", () => {
    expect(squadNumberLabel({ playerName: "Wasiu Yayah" }, null)).toBe("Wasiu Yayah");
  });

  it("gives nothing when there is neither", () => {
    expect(squadNumberLabel(undefined, null)).toBeNull();
  });
});
