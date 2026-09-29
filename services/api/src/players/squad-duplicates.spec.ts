import { describe, expect, it } from "vitest";
import { planSquadDuplicates, type SquadMemberRow } from "./squad-duplicates";

/**
 * One person listed twice in the same squad.
 *
 * The pairs here are from the live squad listing: `Abubakar Abdullah` on FC ENEGWEA beside
 * `Abdullah Abubakar` on FC NIEKETIEN, `Adebayor Taylor` beside `Taylor Adebayo` on
 * FC IPAYE, `Clems Henry` beside `Henry Clems`. The risk this file guards is the opposite
 * of a missed duplicate: merging two people who merely share words.
 */

const HOME = "team-home";
const AWAY = "team-away";
let seq = 0;

function row(over: Partial<SquadMemberRow> = {}): SquadMemberRow {
  seq += 1;
  return {
    rowId: `row-${seq}`,
    teamId: HOME,
    playerId: `p-${seq}`,
    name: "Abubakar Abdullah",
    matchSquadCount: 0,
    hasProfile: false,
    slug: `slug-${seq}`,
    createdAt: new Date("2026-07-13T00:00:00.000Z"),
    ...over,
  };
}

describe("finding one person twice in a squad", () => {
  it("groups a name with its reverse", () => {
    const found = planSquadDuplicates([
      row({ name: "Abubakar Abdullah" }),
      row({ name: "Abdullah Abubakar" }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.names.sort()).toEqual(["Abdullah Abubakar", "Abubakar Abdullah"]);
    expect(found[0]?.playerIds).toHaveLength(2);
  });

  it("groups the same name written in different case", () => {
    const found = planSquadDuplicates([
      row({ name: "Nwosu Henry" }),
      row({ name: "NWOSU HENRY" }),
    ]);
    expect(found).toHaveLength(1);
  });

  it("ignores punctuation and extra spacing", () => {
    const found = planSquadDuplicates([
      row({ name: "Collins. Kadiri" }),
      row({ name: "Kadiri  Collins" }),
    ]);
    expect(found).toHaveLength(1);
  });

  it("groups three spellings of one person at once", () => {
    const found = planSquadDuplicates([
      row({ name: "Taylor Adebayo" }),
      row({ name: "Adebayo Taylor" }),
      row({ name: "ADEBAYO TAYLOR" }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.rows).toHaveLength(3);
    expect(found[0]?.redundantRowIds).toHaveLength(2);
  });

  it("finds a pair even when only one row is linked to a record", () => {
    /* The commonest live shape: a squad row added from a timeline label sitting beside
       one an import linked. There is one player, so nothing merges — but the squad still
       lists him twice. */
    const found = planSquadDuplicates([
      row({ name: "Samuel Osbert", playerId: "p-real" }),
      row({ name: "OSBERT SAMUEL", playerId: null }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.playerIds).toEqual(["p-real"]);
  });

  it("finds a pair when neither row is linked", () => {
    const found = planSquadDuplicates([
      row({ name: "Ismaila Philip", playerId: null }),
      row({ name: "Philip Ismaila", playerId: null }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.playerIds).toEqual([]);
  });
});

describe("what it must refuse to group", () => {
  it("never groups across two teams", () => {
    /* The whole basis for acting on a reversed pair is that they share one team sheet.
       `Clems Henry` on one team and `Henry Clems` on another are two people until
       something other than their names says otherwise. */
    const found = planSquadDuplicates([
      row({ teamId: HOME, name: "Clems Henry" }),
      row({ teamId: AWAY, name: "Henry Clems" }),
    ]);
    expect(found).toEqual([]);
  });

  it("leaves a lone player alone however their name is written", () => {
    expect(planSquadDuplicates([row({ name: "Wasiu Yayah" })])).toEqual([]);
  });

  it("does not group two people who merely share a surname", () => {
    const found = planSquadDuplicates([
      row({ name: "Ibrahim Musa" }),
      row({ name: "Ibrahim Yusuf" }),
    ]);
    expect(found).toEqual([]);
  });

  it("does not group a subset of the words", () => {
    /* `Oleh Emmanuel` and `Oleh Emmanuel Chiagbanwe` are both on the live directory and
       may well be one person -- but deciding that needs a human, because the same rule
       would fold `Ibrahim Musa` into `Ibrahim Musa Adewale`. */
    const found = planSquadDuplicates([
      row({ name: "Oleh Emmanuel" }),
      row({ name: "Oleh Emmanuel Chiagbanwe" }),
    ]);
    expect(found).toEqual([]);
  });

  it("does not group on a one-letter difference", () => {
    // `Abubakar Abdullah` and `Abubakar Abdullahi` are both live, and may be two boys.
    const found = planSquadDuplicates([
      row({ name: "Abubakar Abdullah" }),
      row({ name: "Abubakar Abdullahi" }),
    ]);
    expect(found).toEqual([]);
  });

  it("ignores a row with no name to compare", () => {
    expect(planSquadDuplicates([row({ name: "   " }), row({ name: "Real Name" })])).toEqual([]);
  });
});

describe("which row survives", () => {
  it("keeps the row carrying match-squad entries", () => {
    /* Those are lineups somebody filed. Keeping that row means none of them need
       re-pointing. */
    const found = planSquadDuplicates([
      row({ rowId: "bare", name: "Eric Boma", matchSquadCount: 0 }),
      row({ rowId: "used", name: "Boma Eric", matchSquadCount: 4 }),
    ]);
    expect(found[0]?.rows[0]?.rowId).toBe("used");
    expect(found[0]?.redundantRowIds).toEqual(["bare"]);
  });

  it("prefers a linked row over an unlinked one", () => {
    const found = planSquadDuplicates([
      row({ rowId: "loose", name: "Jordan Ojo", playerId: null }),
      row({ rowId: "linked", name: "Ojo Jordan", playerId: "p-ojo" }),
    ]);
    expect(found[0]?.rows[0]?.rowId).toBe("linked");
  });

  it("falls back to the older row", () => {
    const found = planSquadDuplicates([
      row({ rowId: "new", name: "Alo Deji", createdAt: new Date("2026-09-01") }),
      row({ rowId: "old", name: "Deji Alo", createdAt: new Date("2026-06-01") }),
    ]);
    expect(found[0]?.rows[0]?.rowId).toBe("old");
  });

  it("is deterministic when the rows are indistinguishable", () => {
    /* Row order out of the database is not stable, and a destructive tool that picks a
       different survivor each run is one nobody can check before approving. */
    const rows = [
      row({ rowId: "zzz", name: "Uche Emeribe", playerId: "a" }),
      row({ rowId: "aaa", name: "Emeribe Uche", playerId: "b" }),
    ];
    expect(planSquadDuplicates(rows)[0]?.rows[0]?.rowId).toBe("aaa");
    expect(planSquadDuplicates([...rows].reverse())[0]?.rows[0]?.rowId).toBe("aaa");
  });
});
