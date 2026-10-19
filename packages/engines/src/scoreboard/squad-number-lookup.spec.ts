import { describe, expect, it } from "vitest";
import { buildNumberLookup, samePersonKey, squadNumberLabel, type SquadRow } from "./squad-number-lookup";

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

describe("one person in two spellings, one linked and one not", () => {
  /* The live regression. After squad rows were added from timeline labels, nine numbers
     in one fixture read as "worn by two different players" -- `SAMUEL OSBERT` beside
     `Samuel Osbert`, `Adeyemo Samson` beside `ADEYEMO SAMSON`. Each is one player in two
     spellings, and refusing to resolve their number then queued fifteen events to lose
     the name they already had.

     The cause was comparing `playerId ?? name`: a linked row keyed by uuid and an
     unlinked row keyed by name can never match, whatever the name says. */

  it("resolves a number held by a linked and an unlinked row for one person", () => {
    const lookup = buildNumberLookup({
      teamSquad: [
        row({ number: 11, playerName: "SAMUEL OSBERT", playerId: null }),
        row({ number: 11, playerName: "Samuel Osbert", playerId: "p-osbert" }),
      ],
      matchSquad: [],
    });
    expect(lookup.ambiguous).toEqual([]);
    expect(lookup.find(HOME, 11)?.playerName).toBeTruthy();
  });

  it("prefers the linked row, so the goal reaches a profile", () => {
    /* Both names are equally correct, but only a row with a `playerId` gets the goal
       onto somebody's profile. Taking the first row instead left the event with a
       shouting name and no link -- verified on a real database before this. The linked
       row is also the one the display-name tools tidy, so `Samson Godwin` over
       `SAMSON GODWIN` comes free. */
    const lookup = buildNumberLookup({
      teamSquad: [
        row({ number: 3, playerName: "SAMSON GODWIN", playerId: null }),
        row({ number: 3, playerName: "Samson Godwin", playerId: "p-godwin" }),
      ],
      matchSquad: [],
    });
    expect(lookup.find(HOME, 3)).toMatchObject({
      playerName: "Samson Godwin",
      playerId: "p-godwin",
    });
  });

  it("takes the only row there is when none of them is linked", () => {
    const lookup = buildNumberLookup({
      teamSquad: [
        row({ number: 6, playerName: "ADEYEMO SAMSON", playerId: null }),
        row({ number: 6, playerName: "Adeyemo Samson", playerId: null }),
      ],
      matchSquad: [],
    });
    expect(lookup.find(HOME, 6)?.playerName).toBe("ADEYEMO SAMSON");
    expect(lookup.ambiguous).toEqual([]);
  });

  it("still refuses a number two genuinely different people wear", () => {
    // The protection that matters must survive the fix.
    const lookup = buildNumberLookup({
      teamSquad: [
        row({ number: 7, playerName: "First Seven", playerId: "a" }),
        row({ number: 7, playerName: "Second Seven", playerId: "b" }),
      ],
      matchSquad: [],
    });
    expect(lookup.find(HOME, 7)).toBeUndefined();
    expect(lookup.ambiguous).toHaveLength(1);
  });

  it("ignores punctuation and accents when deciding they are one person", () => {
    const lookup = buildNumberLookup({
      teamSquad: [
        row({ number: 9, playerName: "O'Brien Michael", playerId: null }),
        row({ number: 9, playerName: "OBrien  Michael", playerId: "p-ob" }),
      ],
      matchSquad: [],
    });
    expect(lookup.ambiguous).toEqual([]);
  });
});

describe("samePersonKey", () => {
  it("ignores word order and case", () => {
    expect(samePersonKey("YUSUF OLASUNKANMI")).toBe(samePersonKey("Olasunkanmi Yusuf"));
    expect(samePersonKey("Okwara Godwin")).toBe(samePersonKey("Godwin Okwara"));
  });

  it("does not forgive spelling", () => {
    expect(samePersonKey("Sulainon Taiye")).not.toBe(samePersonKey("Taiye Sulaimon"));
  });

  it("keeps different people apart", () => {
    expect(samePersonKey("Oghidi Kelvin")).not.toBe(samePersonKey("OLANIYI BOLAJI"));
  });
});

describe("a number held under one name typed in two orders", () => {
  /* HIGHKLASS SA's 7 on live, 19 Oct 2026. */
  const lookup = buildNumberLookup({
    teamSquad: [
      { teamId: "hk", number: 7, playerName: "YUSUF OLASUNKANMI", playerId: null },
      { teamId: "hk", number: 7, playerName: "Olasunkanmi Yusuf", playerId: "p7" },
    ],
    matchSquad: [],
  });

  it("is one player, the linked row", () => {
    expect(lookup.find("hk", 7)).toMatchObject({ playerName: "Olasunkanmi Yusuf", playerId: "p7" });
    expect(lookup.ambiguous).toEqual([]);
  });
});

describe("resolve", () => {
  const lookup = buildNumberLookup({
    teamSquad: [
      { teamId: "t", number: 9, playerName: "OLANIYI BOLAJI", playerId: null },
      { teamId: "t", number: 9, playerName: "Oghidi Kelvin", playerId: "p9" },
      { teamId: "t", number: 4, playerName: "Ade Bola", playerId: null },
      { teamId: "t", number: 6, playerName: "Two A", playerId: null },
      { teamId: "t", number: 6, playerName: "Two B", playerId: null },
    ],
    matchSquad: [
      { teamId: "t", number: 6, playerName: "Matchday Six", playerId: null },
      { teamId: "t", number: 8, playerName: "Eight A", playerId: null },
      { teamId: "t", number: 8, playerName: "Eight B", playerId: null },
    ],
  });

  it("names a number one player wears", () => {
    expect(lookup.resolve("t", 4)).toMatchObject({ kind: "named", player: { playerName: "Ade Bola" } });
  });

  it("says who shares a number, one spelling each", () => {
    expect(lookup.resolve("t", 9)).toEqual({ kind: "shared", names: ["OLANIYI BOLAJI", "Oghidi Kelvin"] });
  });

  it("names a number the matchday squad settles when the team squad cannot", () => {
    expect(lookup.resolve("t", 6)).toMatchObject({ kind: "named", player: { playerName: "Matchday Six" } });
  });

  it("reports a number shared only in the matchday squad", () => {
    expect(lookup.resolve("t", 8)).toEqual({ kind: "shared", names: ["Eight A", "Eight B"] });
  });

  it("reports a number nobody wears, and no number at all", () => {
    expect(lookup.resolve("t", 23)).toEqual({ kind: "unknown" });
    expect(lookup.resolve("t", null)).toEqual({ kind: "unknown" });
    expect(lookup.resolve("t", 0)).toEqual({ kind: "unknown" });
  });
});
