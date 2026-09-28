import { describe, expect, it } from "vitest";
import { chooseMergeTarget, isSuffixedSlug, type MergeCandidate } from "./merge-target";

/**
 * Which record survives.
 *
 * The merge itself is mechanical — everything moves to the target and the source
 * is deleted — so this choice is the only judgement in it, and the only place a
 * merge can go wrong in a way nobody notices until a profile is missing.
 */

let seq = 0;
function candidate(over: Partial<MergeCandidate> = {}): MergeCandidate {
  seq += 1;
  return {
    id: `p${seq}`,
    displayName: "Jimoh Rasheed",
    slug: `jimoh-rasheed-${seq}`,
    hasProfile: false,
    events: 0,
    createdAt: new Date("2026-07-13T00:00:00.000Z"),
    ...over,
  };
}

describe("recognising a copy by its slug", () => {
  it("knows a suffixed slug from a clean one", () => {
    expect(isSuffixedSlug("jimoh-rasheed-1")).toBe(true);
    expect(isSuffixedSlug("jimoh-rasheed")).toBe(false);
  });

  it("does not mistake a name that genuinely ends in a number", () => {
    // `resolveUniquePlayerSlug` suffixes with a hyphen, so this is somebody's name.
    expect(isSuffixedSlug("ade-bola2")).toBe(false);
  });
});

describe("choosing the survivor", () => {
  it("keeps the record somebody actually filled in", () => {
    const withProfile = candidate({ id: "real", slug: "jimoh-rasheed-1", hasProfile: true });
    const bare = candidate({ id: "bare", slug: "jimoh-rasheed" });
    const choice = chooseMergeTarget([bare, withProfile]);
    expect(choice.target.id).toBe("real");
    expect(choice.why).toContain("profile");
  });

  it("prefers the clean slug over the suffixed copy", () => {
    /* `-1` is what the slug resolver adds when the name is taken, so it marks the
       second record — and the clean one is the URL anybody has ever shared. */
    const original = candidate({ id: "orig", slug: "hope-john" });
    const copy = candidate({ id: "copy", slug: "hope-john-1" });
    expect(chooseMergeTarget([copy, original]).target.id).toBe("orig");
    expect(chooseMergeTarget([copy, original]).why).toContain("/hope-john");
  });

  it("puts a real profile above a clean slug", () => {
    // Someone's photo and academy outrank a tidier URL.
    const suffixedButReal = candidate({ id: "real", slug: "uma-bartholomew-1", hasProfile: true });
    const cleanButEmpty = candidate({ id: "empty", slug: "uma-bartholomew" });
    expect(chooseMergeTarget([cleanButEmpty, suffixedButReal]).target.id).toBe("real");
  });

  it("falls back to whichever carries more history", () => {
    const busy = candidate({ id: "busy", slug: "a-1", events: 7 });
    const quiet = candidate({ id: "quiet", slug: "a-2", events: 0 });
    const choice = chooseMergeTarget([quiet, busy]);
    expect(choice.target.id).toBe("busy");
    expect(choice.why).toContain("7 event(s)");
  });

  it("falls back to the older record", () => {
    const older = candidate({ id: "old", slug: "a-1", createdAt: new Date("2026-06-06") });
    const newer = candidate({ id: "new", slug: "a-2", createdAt: new Date("2026-09-04") });
    expect(chooseMergeTarget([newer, older]).target.id).toBe("old");
  });

  it("is deterministic when the records are indistinguishable", () => {
    /* Row order out of the database is not stable, and a merge that picks a
       different survivor each run is one nobody can check before approving. */
    const two = [candidate({ id: "zzz", slug: "a-1" }), candidate({ id: "aaa", slug: "a-2" })];
    expect(chooseMergeTarget(two).target.id).toBe("aaa");
    expect(chooseMergeTarget([...two].reverse()).target.id).toBe("aaa");
  });

  it("returns every other record as a source, and never the target", () => {
    const three = [
      candidate({ id: "a", slug: "jimoh-rasheed", hasProfile: true }),
      candidate({ id: "b", slug: "jimoh-rasheed-1" }),
      candidate({ id: "c", slug: "jimoh-rasheed-2" }),
    ];
    const choice = chooseMergeTarget(three);
    expect(choice.target.id).toBe("a");
    expect(choice.sources.map((s) => s.id).sort()).toEqual(["b", "c"]);
    expect(choice.sources.map((s) => s.id)).not.toContain(choice.target.id);
  });

  it("ignores the casing of the display name", () => {
    /* `JIMOH RASHEED` and `Jimoh Rasheed` are the same person, and the casing says
       nothing about which record people use. Fixing a name afterwards is one edit;
       merging into the wrong record is not. */
    const shouty = candidate({ id: "shouty", displayName: "JIMOH RASHEED", slug: "jimoh-rasheed" });
    const tidy = candidate({ id: "tidy", displayName: "Jimoh Rasheed", slug: "jimoh-rasheed-1" });
    expect(chooseMergeTarget([tidy, shouty]).target.id).toBe("shouty");
  });
});
