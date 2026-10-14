/**
 * Seeds upsert matches on fixed ids, and a re-run must not move a match's URL.
 *
 * They used to allocate against every slug in the table, which includes the match's
 * own, so a scheduled match swapped between "<base>" and "<base>-2" on every full
 * seed. The fake below holds the table the way the database does, and each test
 * runs the "seed" more than once, because the bug only showed on the second run.
 */
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { createSeedMatchSlugAllocator, matchSlugCandidates, type MatchSlugLeg } from "./match-slug";

type Row = { id: string; slug: string | null };

function fakePrisma(rows: Row[]) {
  return {
    rows,
    sbMatch: {
      findMany: async (args: { where?: { slug?: unknown; id?: { in: string[] } } }) => {
        const ids = args.where?.id?.in;
        if (ids) return rows.filter((r) => ids.includes(r.id));
        return rows.filter((r) => r.slug != null);
      },
    },
  };
}

type Fixture = { id: string; home: string; away: string; leg?: MatchSlugLeg };

/** One seed run: allocate every fixture's slug, then write it back as the upsert would. */
async function seedRun(db: ReturnType<typeof fakePrisma>, fixtures: Fixture[]) {
  const slugFor = await createSeedMatchSlugAllocator(
    db as unknown as PrismaClient,
    fixtures.map((f) => f.id)
  );
  const out: Record<string, string> = {};
  for (const f of fixtures) {
    const slug = slugFor(f.id, f.home, f.away, f.leg);
    out[f.id] = slug;
    const row = db.rows.find((r) => r.id === f.id);
    if (row) row.slug = slug;
    else db.rows.push({ id: f.id, slug });
  }
  return out;
}

describe("createSeedMatchSlugAllocator", () => {
  it("gives a new match the base slug, and the same slug on every later run", async () => {
    const db = fakePrisma([]);
    const fixtures = [{ id: "m1", home: "alpha-fc", away: "beta-fc" }];
    const first = await seedRun(db, fixtures);
    const second = await seedRun(db, fixtures);
    const third = await seedRun(db, fixtures);
    expect(first.m1).toBe("alpha-fc-vs-beta-fc");
    expect(second.m1).toBe("alpha-fc-vs-beta-fc");
    expect(third.m1).toBe("alpha-fc-vs-beta-fc");
  });

  it("keeps a slug that had already drifted to -2, rather than moving it again", async () => {
    const db = fakePrisma([{ id: "m1", slug: "alpha-fc-vs-beta-fc-2" }]);
    const fixtures = [{ id: "m1", home: "alpha-fc", away: "beta-fc" }];
    expect((await seedRun(db, fixtures)).m1).toBe("alpha-fc-vs-beta-fc-2");
    expect((await seedRun(db, fixtures)).m1).toBe("alpha-fc-vs-beta-fc-2");
  });

  it("does not take a slug another competition's match already holds", async () => {
    const db = fakePrisma([{ id: "other", slug: "alpha-fc-vs-beta-fc" }]);
    const fixtures = [{ id: "m1", home: "alpha-fc", away: "beta-fc" }];
    expect((await seedRun(db, fixtures)).m1).toBe("alpha-fc-vs-beta-fc-2");
    expect((await seedRun(db, fixtures)).m1).toBe("alpha-fc-vs-beta-fc-2");
  });

  it("keeps two meetings of the same pairing apart across runs", async () => {
    const db = fakePrisma([]);
    const fixtures = [
      { id: "group", home: "alpha-fc", away: "beta-fc" },
      { id: "final", home: "alpha-fc", away: "beta-fc" },
    ];
    const first = await seedRun(db, fixtures);
    const second = await seedRun(db, fixtures);
    expect(first).toEqual({ group: "alpha-fc-vs-beta-fc", final: "alpha-fc-vs-beta-fc-2" });
    expect(second).toEqual(first);
  });

  it("keeps a second leg on its leg-2 slug", async () => {
    const db = fakePrisma([]);
    const fixtures: Fixture[] = [
      { id: "leg1", home: "alpha-fc", away: "beta-fc", leg: "first_leg" },
      { id: "leg2", home: "alpha-fc", away: "beta-fc", leg: "second_leg" },
    ];
    const first = await seedRun(db, fixtures);
    expect(first.leg2).toBe("alpha-fc-vs-beta-fc-leg-2");
    expect(await seedRun(db, fixtures)).toEqual(first);
  });

  it("gives a match whose teams changed a slug that names the new teams", async () => {
    const db = fakePrisma([{ id: "m1", slug: "alpha-fc-vs-beta-fc" }]);
    const out = await seedRun(db, [{ id: "m1", home: "alpha-fc", away: "gamma-fc" }]);
    expect(out.m1).toBe("alpha-fc-vs-gamma-fc");
  });

  it("returns the same slug when asked twice for one match in a run", async () => {
    const db = fakePrisma([]);
    const slugFor = await createSeedMatchSlugAllocator(db as unknown as PrismaClient, ["m1"]);
    expect(slugFor("m1", "alpha-fc", "beta-fc")).toBe("alpha-fc-vs-beta-fc");
    expect(slugFor("m1", "alpha-fc", "beta-fc")).toBe("alpha-fc-vs-beta-fc");
  });
});

describe("matchSlugCandidates", () => {
  it("tries leg-2 before the numbered suffixes for a second leg only", () => {
    expect(matchSlugCandidates("a", "b", "second_leg").slice(0, 3)).toEqual([
      "a-vs-b",
      "a-vs-b-leg-2",
      "a-vs-b-2",
    ]);
    expect(matchSlugCandidates("a", "b").slice(0, 2)).toEqual(["a-vs-b", "a-vs-b-2"]);
  });
});
