/**
 * The judgement in `planNumberedDuplicates`, tested against the names that produced it.
 *
 * Every string here is from the live `db:repair:player-display-names` run that blocked 47
 * records. Invented names would not have caught `No. 27 BAKARE O . AHMED`, whose spacing
 * around the initial's full stop differs from the record it duplicates.
 */
import { describe, expect, it } from "vitest";
import {
  carriesNumberPrefix,
  planNumberedDuplicates,
  type NumberedCandidate,
} from "./numbered-duplicates";

const player = (
  id: string,
  displayName: string,
  teamIds: string[] = ["t1"]
): NumberedCandidate => ({ id, displayName, teamIds });

describe("carriesNumberPrefix", () => {
  it("recognises the forms the live data actually holds", () => {
    expect(carriesNumberPrefix("No. 16 Musa Abdul")).toBe(true);
    expect(carriesNumberPrefix("No. 4 ALFRED ISAAC")).toBe(true);
    expect(carriesNumberPrefix("No. 1 Adeleke Mutiu Opeyemi")).toBe(true);
  });

  it("leaves a name alone when the number is not a prefix", () => {
    expect(carriesNumberPrefix("Musa Abdul")).toBe(false);
    expect(carriesNumberPrefix("Ademola James (19)")).toBe(false);
    expect(carriesNumberPrefix("Vido 99 FC")).toBe(false);
  });

  it("refuses a record that is nothing but a number", () => {
    /* `Jersey No. 35` strips to nothing, and a pair whose name is the empty string would
       match every other empty one. These are placeholders, not people. */
    expect(carriesNumberPrefix("Jersey No. 35")).toBe(false);
  });
});

describe("planNumberedDuplicates", () => {
  it("pairs a numbered record with the plain one on the same team", () => {
    const plan = planNumberedDuplicates([
      player("a", "No. 16 Musa Abdul"),
      player("b", "Musa Abdul"),
    ]);

    expect(plan.mergeable).toHaveLength(1);
    expect(plan.needsAHuman).toHaveLength(0);
    expect(plan.mergeable[0]!.numbered.id).toBe("a");
    expect(plan.mergeable[0]!.plain.id).toBe("b");
    expect(plan.mergeable[0]!.name).toBe("Musa Abdul");
  });

  it("matches across casing, because the number is the difference and not the case", () => {
    const plan = planNumberedDuplicates([
      player("a", "No. 4 ALFRED ISAAC"),
      player("b", "Alfred Isaac"),
    ]);
    expect(plan.mergeable).toHaveLength(1);
  });

  it("matches through punctuation the lookup key ignores", () => {
    /* Live: `No. 27 BAKARE O . AHMED` against `Bakare O Ahmed`. The stray space before the
       full stop is exactly the kind of thing a hand-typed team sheet contains. */
    const plan = planNumberedDuplicates([
      player("a", "No. 27 BAKARE O . AHMED"),
      player("b", "Bakare O Ahmed"),
    ]);
    expect(plan.mergeable).toHaveLength(1);
    expect(plan.mergeable[0]!.plain.displayName).toBe("Bakare O Ahmed");
  });

  it("refuses to merge two records that share no team", () => {
    /* The whole reason this is not a blind fold: names repeat, and `No. 4 Alfred Isaac` at
       one club need not be the `Alfred Isaac` at another. */
    const plan = planNumberedDuplicates([
      player("a", "No. 4 Alfred Isaac", ["lions"]),
      player("b", "Alfred Isaac", ["royal"]),
    ]);

    expect(plan.mergeable).toHaveLength(0);
    expect(plan.needsAHuman).toHaveLength(1);
    expect(plan.needsAHuman[0]!.sharedTeamIds).toEqual([]);
  });

  it("merges on one shared team even when each record has others", () => {
    const plan = planNumberedDuplicates([
      player("a", "No. 9 Cyril Kenechukwu", ["lions", "royal"]),
      player("b", "Cyril Kenechukwu", ["royal", "budu"]),
    ]);
    expect(plan.mergeable).toHaveLength(1);
    expect(plan.mergeable[0]!.sharedTeamIds).toEqual(["royal"]);
  });

  it("leaves a numbered record alone when nothing holds the plain name", () => {
    const plan = planNumberedDuplicates([player("a", "No. 12 Somebody Unknown")]);
    expect(plan.mergeable).toHaveLength(0);
    expect(plan.needsAHuman).toHaveLength(0);
  });

  it("refuses when two records hold the plain name, rather than guessing", () => {
    /* That is a duplicate pair of its own, and `db:merge:duplicate-players` is the tool for
       it. Picking one here would be choosing between two equal claims on the number. */
    const plan = planNumberedDuplicates([
      player("a", "No. 8 Miracle Enojo"),
      player("b", "Miracle Enojo"),
      player("c", "MIRACLE ENOJO"),
    ]);
    expect(plan.mergeable).toHaveLength(0);
    expect(plan.needsAHuman).toHaveLength(0);
  });

  it("folds two shirt numbers into the plain record, never into each other", () => {
    /* A boy who changed shirt mid-season has two numbered records. Both point at the
       unnumbered one, which is the record with a URL somebody may have shared. */
    const plan = planNumberedDuplicates([
      player("a", "No. 9 Ade Bello"),
      player("b", "No. 16 Ade Bello"),
      player("c", "Ade Bello"),
    ]);

    expect(plan.mergeable).toHaveLength(2);
    expect(plan.mergeable.every((p) => p.plain.id === "c")).toBe(true);
  });

  it("never pairs a placeholder with another placeholder", () => {
    /* `Jersey No. 35` and `Jersey No. 12` both strip to nothing. Treating the empty string
       as a name would fold every placeholder in the directory into one record. */
    const plan = planNumberedDuplicates([
      player("a", "Jersey No. 35"),
      player("b", "Jersey No. 12"),
      player("c", "Player 1"),
    ]);
    expect(plan.mergeable).toHaveLength(0);
    expect(plan.needsAHuman).toHaveLength(0);
  });

  it("does not pair a record with itself", () => {
    const plan = planNumberedDuplicates([player("a", "No. 20 Paul Isaac")]);
    expect(plan.mergeable).toHaveLength(0);
  });
});
