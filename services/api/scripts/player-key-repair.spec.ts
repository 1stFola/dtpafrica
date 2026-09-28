import { describe, expect, it } from "vitest";
import { parkingKey, planKeyRepair, type KeyRow } from "./player-key-repair";

/**
 * Which keys can be put right.
 *
 * The rewriting is trivial; the part worth testing is refusing to rewrite when the
 * result would land on a key another row already owns, because that is a unique
 * constraint violation in the middle of a repair on live data.
 */

const row = (id: string, displayName: string, normalizedName: string | null): KeyRow => ({
  id,
  displayName,
  normalizedName,
});

describe("what needs fixing", () => {
  it("leaves a row whose key already matches its name", () => {
    const plan = planKeyRepair([row("a", "Segun Adebisi", "segun adebisi")]);
    expect(plan.correct).toHaveLength(1);
    expect(plan.fixable).toHaveLength(0);
  });

  it("fixes a key stored with the original capitals", () => {
    // The commonest case: the raw display name went into the dedupe column.
    const plan = planKeyRepair([row("a", "ADEBISI SEGUN", "ADEBISI SEGUN")]);
    expect(plan.fixable).toEqual([
      { row: expect.objectContaining({ id: "a" }), from: "ADEBISI SEGUN", to: "adebisi segun" },
    ]);
  });

  it("fixes a null key", () => {
    /* Worse than a wrong key: a unique index permits any number of nulls, so these
       rows can duplicate without limit. */
    const plan = planKeyRepair([row("a", "JIMOH RASHEED", null)]);
    expect(plan.fixable[0]?.to).toBe("jimoh rasheed");
    expect(plan.fixable[0]?.from).toBeNull();
  });

  it("fixes punctuation and doubled spaces", () => {
    const plan = planKeyRepair([row("a", "Daniel  Matthew", "Daniel  Matthew")]);
    expect(plan.fixable[0]?.to).toBe("daniel matthew");
  });
});

describe("what must be left alone", () => {
  it("refuses when two rows want the same key", () => {
    /* Writing it to both violates the unique index, and choosing which record is
       the real person is a merge decision, not a repair. */
    const plan = planKeyRepair([
      row("a", "JIMOH RASHEED", "JIMOH RASHEED"),
      row("b", "Jimoh Rasheed", "jimoh rasheed"),
    ]);
    expect(plan.fixable).toHaveLength(0);
    expect(plan.blocked).toHaveLength(1);
    expect(plan.blocked[0]?.key).toBe("jimoh rasheed");
    expect(plan.blocked[0]?.rows.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("reports all three when a name is held by three rows", () => {
    const plan = planKeyRepair([
      row("a", "JIMOH RASHEED", "JIMOH RASHEED"),
      row("b", "Jimoh Rasheed", "jimoh rasheed"),
      row("c", "jimoh rasheed", null),
    ]);
    expect(plan.blocked[0]?.rows).toHaveLength(3);
  });

  it("skips a name that normalises to nothing", () => {
    const plan = planKeyRepair([row("a", "...", null)]);
    expect(plan.unkeyable).toHaveLength(1);
    expect(plan.fixable).toHaveLength(0);
  });
});

describe("word order is not this repair's business", () => {
  it("repairs both records of a reversed pair, and merges neither", () => {
    /* `Segun Adebisi` and `ADEBISI SEGUN` normalise to *different* keys, so both
       are repaired and both survive. Fixing keys stops new duplicates appearing;
       it does not remove the ones already there. */
    const plan = planKeyRepair([
      row("a", "Segun Adebisi", "segun adebisi"),
      row("b", "ADEBISI SEGUN", "ADEBISI SEGUN"),
    ]);
    expect(plan.blocked).toHaveLength(0);
    expect(plan.fixable.map((f) => f.to)).toEqual(["adebisi segun"]);
    expect(plan.correct.map((r) => r.id)).toEqual(["a"]);
  });
});

describe("the two-pass rewrite", () => {
  it("parks rows on a value nothing real can collide with", () => {
    /* Row A holds B's key and B holds A's. Written one at a time, whichever goes
       first hits the unique index — and which goes first depends on iteration
       order, so it would fail unpredictably. */
    const plan = planKeyRepair([
      row("a", "Ade Bola", "zed zed"),
      row("b", "Zed Zed", "ade bola"),
    ]);
    expect(plan.fixable).toHaveLength(2);

    const parked = plan.fixable.map((f) => parkingKey(f.row.id));
    expect(new Set(parked).size).toBe(2);
    /* Punctuation rather than a NUL byte, which Postgres rejects in a text
       column. playerLookupKey strips everything that is not a letter, number
       or space, so a colon is something it can never produce. */
    for (const p of parked) expect(p).toContain(":");
    for (const p of parked) expect(p).not.toContain("\u0000");
    for (const f of plan.fixable) expect(parked).not.toContain(f.to);
  });
});
