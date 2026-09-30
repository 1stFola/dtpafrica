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
  teamIds: string[] = ["t1"],
  eventTeamIds: string[] = []
): NumberedCandidate => ({ id, displayName, teamIds, eventTeamIds });

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

  it("refuses to merge two records that share no team, by squad or by events", () => {
    /* The whole reason this is not a blind fold: names repeat, and `No. 4 Alfred Isaac` at
       one club need not be the `Alfred Isaac` at another. */
    const plan = planNumberedDuplicates([
      player("a", "No. 4 Alfred Isaac", ["lions"], ["lions"]),
      player("b", "Alfred Isaac", ["royal"], ["royal"]),
    ]);

    expect(plan.mergeable).toHaveLength(0);
    expect(plan.needsAHuman).toHaveLength(1);
    expect(plan.needsAHuman[0]!.evidence).toBe("none");
  });

  it("accepts events as evidence when the numbered record has no squad row", () => {
    /* The live shape: seven of the nine pairs refused by the first version had the numbered
       record carrying MORE events than the one being kept — a record created from a timeline
       label that nobody put on a team sheet. Having no squad row is not evidence of being a
       different person. */
    const plan = planNumberedDuplicates([
      player("a", "No. 8 CHIBUEZE NZUBE", [], ["dynamic"]),
      player("b", "Chibueze Nzube", ["dynamic"], ["dynamic"]),
    ]);

    expect(plan.mergeable).toHaveLength(1);
    expect(plan.mergeable[0]!.evidence).toBe("events");
    expect(plan.mergeable[0]!.sharedEventTeamIds).toEqual(["dynamic"]);
  });

  it("prefers squad evidence when both kinds are present", () => {
    const plan = planNumberedDuplicates([
      player("a", "No. 16 Musa Abdul", ["super"], ["super"]),
      player("b", "Musa Abdul", ["super"], ["super"]),
    ]);
    expect(plan.mergeable[0]!.evidence).toBe("squad");
  });

  it("matches a numbered record's events against the plain record's squad", () => {
    /* The plain record may be the one with no events: a boy on the team sheet whose goals
       were all filed against the numbered spelling. */
    const plan = planNumberedDuplicates([
      player("a", "No. 1 ANDREW FELIX", [], ["highklass"]),
      player("b", "Andrew Felix", ["highklass"], []),
    ]);
    expect(plan.mergeable).toHaveLength(1);
    expect(plan.mergeable[0]!.evidence).toBe("events");
  });

  it("does not invent evidence from a record that has played nowhere", () => {
    const plan = planNumberedDuplicates([
      player("a", "No. 12 Somebody Known", [], []),
      player("b", "Somebody Known", [], []),
    ]);
    expect(plan.mergeable).toHaveLength(0);
    expect(plan.needsAHuman).toHaveLength(1);
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
