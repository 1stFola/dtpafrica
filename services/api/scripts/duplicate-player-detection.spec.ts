import { describe, expect, it } from "vitest";
import { groupProbableDuplicates, reorderKey } from "./duplicate-player-detection";

/**
 * What counts as the same person.
 *
 * The report this feeds is read-only, so a false positive costs attention rather
 * than data. But attention is the whole point of the report, and the tests that
 * matter most are therefore the ones that keep two different people apart.
 */

const p = (id: string, displayName: string) => ({ id, displayName });

describe("reducing a name to its words", () => {
  it("makes word order irrelevant", () => {
    // The pattern every one of the twenty-two real cases took.
    expect(reorderKey("Clems Henry")).toBe(reorderKey("Henry Clems"));
    expect(reorderKey("Adebayo Taylor")).toBe(reorderKey("Taylor Adebayo"));
  });

  it("ignores punctuation, case and doubled spaces", () => {
    expect(reorderKey("Collins. Kadiri")).toBe(reorderKey("collins  kadiri"));
  });

  it("ignores accents, so one keyboard does not create a second person", () => {
    expect(reorderKey("Chidubẹm Okoli")).toBe(reorderKey("Okoli Chidubem"));
  });

  it("keeps a three-part name distinct from a two-part one", () => {
    expect(reorderKey("Sunday Udeme Dapo")).not.toBe(reorderKey("Sunday Udeme"));
  });

  it("returns nothing for a name that is only punctuation", () => {
    // Otherwise every such row would group together and say nothing about any.
    expect(reorderKey("...")).toBe("");
    expect(reorderKey("   ")).toBe("");
  });
});

describe("grouping", () => {
  it("groups a name with its reverse", () => {
    const groups = groupProbableDuplicates([
      p("a", "Clems Henry"),
      p("b", "Henry Clems"),
      p("c", "Somebody Else"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.members.map((m) => m.id).sort()).toEqual(["a", "b"]);
  });

  it("groups three orderings of a three-part name", () => {
    const groups = groupProbableDuplicates([
      p("a", "Sabitu Shamsu Sunday"),
      p("b", "Sunday Sabitu Shamsu"),
      p("c", "Shamsu Sunday Sabitu"),
    ]);
    expect(groups[0]?.members).toHaveLength(3);
  });

  it("leaves a person who appears once alone", () => {
    expect(groupProbableDuplicates([p("a", "Clems Henry")])).toEqual([]);
  });

  it("does not group two different people who share a surname", () => {
    /* The reason fuzzy spelling distance is not used. These are plausibly
       brothers, and merging them would credit one child's goals to another. */
    const groups = groupProbableDuplicates([
      p("a", "Emeka Okoli"),
      p("b", "Chidi Okoli"),
    ]);
    expect(groups).toEqual([]);
  });

  it("does not group names that differ by one letter", () => {
    // `Micheal` and `Michael` stay apart, on purpose.
    expect(groupProbableDuplicates([p("a", "Micheal Imoh"), p("b", "Michael Imoh")])).toEqual([]);
  });

  it("does not group a two-part name with a three-part one that contains it", () => {
    expect(
      groupProbableDuplicates([p("a", "Ola Raji"), p("b", "Ola Raji Emmanuel")])
    ).toEqual([]);
  });

  it("counts one id listed twice as one person, not a duplicate", () => {
    // A join can return the same player once per squad they belong to.
    const groups = groupProbableDuplicates([p("a", "Clems Henry"), p("a", "Henry Clems")]);
    expect(groups).toEqual([]);
  });

  it("ignores rows whose name normalises to nothing", () => {
    expect(groupProbableDuplicates([p("a", "..."), p("b", "???")])).toEqual([]);
  });

  it("says when the spellings differ, and when they only reorder", () => {
    const [reordered] = groupProbableDuplicates([
      p("a", "Clems Henry"),
      p("b", "Henry Clems"),
    ]);
    expect(reordered?.differentSpellings).toBe(true);

    // Same string twice under different ids: two records, one spelling.
    const [identical] = groupProbableDuplicates([
      p("a", "Clems Henry"),
      p("b", "Clems Henry"),
    ]);
    expect(identical?.differentSpellings).toBe(false);
  });
});
