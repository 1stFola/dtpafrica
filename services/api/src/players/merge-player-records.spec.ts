import { describe, expect, it } from "vitest";
import { mergePlayerRecords, type MergeTx } from "./merge-player-records";

/**
 * What a merge does to the survivor's career total.
 *
 * The merge touches fourteen tables and most of it is row movement that a unit test
 * would only restate. This covers the one part that writes a number somebody reads
 * on a profile page, and that had been silently wrong: the survivor's career total
 * was left below its own competition rows, and the record holding the difference was
 * then deleted.
 *
 * The transaction client is faked rather than mocked against a schema, because what
 * matters is which writes are issued and with what, and a fake makes a merge that
 * grows a fifteenth table fail loudly here rather than quietly pass.
 */

/** What an untouched Prisma model method returns, so only the interesting ones need stating. */
const DEFAULTS: Record<string, unknown> = {
  findMany: [],
  findUnique: null,
  findFirst: null,
  updateMany: { count: 0 },
  update: {},
  delete: {},
  create: {},
  aggregate: { _sum: { goals: 0, assists: 0 } },
};

function model(overrides: Record<string, unknown> = {}) {
  return new Proxy(
    {},
    {
      get(_target, method: string) {
        if (method in overrides) return overrides[method];
        return async () => structuredClone(DEFAULTS[method] ?? null);
      },
    }
  );
}

type Scenario = {
  /** The survivor's career total before the merge, or null if the record is gone. */
  career: { goals: number; assists: number } | null;
  /** What the survivor's competition rows add up to once the source's have moved. */
  rowTotals: { goals: number; assists: number };
};

function fakeTx(scenario: Scenario) {
  const careerWrites: { goals?: unknown; assists?: unknown }[] = [];

  const player = model({
    findUnique: async ({ select }: { select?: Record<string, boolean> }) => {
      /* Two different reads go through here: the identity lookup for source and
         target at the top, and the career total read before the top-up. */
      if (select?.careerGoals) {
        return scenario.career === null
          ? null
          : { careerGoals: scenario.career.goals, careerAssists: scenario.career.assists };
      }
      return { id: "p", displayName: "Player", slug: "player" };
    },
    update: async ({ data }: { data: Record<string, unknown> }) => {
      if ("careerGoals" in data || "careerAssists" in data) {
        careerWrites.push({ goals: data.careerGoals, assists: data.careerAssists });
      }
      return {};
    },
  });

  const sbPlayerCompetitionStats = model({
    aggregate: async () => ({
      _sum: { goals: scenario.rowTotals.goals, assists: scenario.rowTotals.assists },
    }),
  });

  const tx = new Proxy(
    {},
    {
      get(_target, name: string) {
        if (name === "player") return player;
        if (name === "sbPlayerCompetitionStats") return sbPlayerCompetitionStats;
        return model();
      },
    }
  ) as unknown as MergeTx;

  return { tx, careerWrites };
}

const merge = (tx: MergeTx) =>
  mergePlayerRecords(tx, { sourcePlayerId: "source", targetPlayerId: "target" });

describe("the survivor's career total after a merge", () => {
  it("is raised to its competition rows, so the folded goals are not lost", async () => {
    /* The live failure. `NWOSU HENRY` ended a merge with five goals in the RAK BDFA
       League chart and zero on his profile: the rows moved, the career total did not
       follow, and the record holding it was deleted. */
    const { tx, careerWrites } = fakeTx({
      career: { goals: 0, assists: 0 },
      rowTotals: { goals: 5, assists: 0 },
    });
    const outcome = await merge(tx);

    expect(careerWrites).toEqual([{ goals: { increment: 5 }, assists: undefined }]);
    expect(outcome.careerCredited).toEqual({ goals: 5, assists: 0 });
  });

  it("adds only the shortfall, never the whole competition total", async () => {
    // `Ezekwemba Somto`: profile 3, rows 5. Owed 2.
    const { tx, careerWrites } = fakeTx({
      career: { goals: 3, assists: 0 },
      rowTotals: { goals: 5, assists: 0 },
    });
    expect((await merge(tx)).careerCredited.goals).toBe(2);
    expect(careerWrites).toEqual([{ goals: { increment: 2 }, assists: undefined }]);
  });

  it("writes nothing at all when the career total is already ahead", async () => {
    /* A player who scored 40 goals before joining and 3 here. This is the common
       case, and it must not issue a write — a merge that touched every survivor's
       career total would make the audit trail useless. */
    const { tx, careerWrites } = fakeTx({
      career: { goals: 40, assists: 12 },
      rowTotals: { goals: 3, assists: 1 },
    });
    expect((await merge(tx)).careerCredited).toEqual({ goals: 0, assists: 0 });
    expect(careerWrites).toEqual([]);
  });

  it("writes nothing when the two already agree", async () => {
    const { tx, careerWrites } = fakeTx({
      career: { goals: 4, assists: 2 },
      rowTotals: { goals: 4, assists: 2 },
    });
    await merge(tx);
    expect(careerWrites).toEqual([]);
  });

  it("credits goals without disturbing a healthy assist total", async () => {
    /* Only the short field is written. Passing `assists: { increment: 0 }` would be
       harmless today and is the kind of thing that stops being harmless. */
    const { tx, careerWrites } = fakeTx({
      career: { goals: 0, assists: 9 },
      rowTotals: { goals: 3, assists: 2 },
    });
    await merge(tx);
    expect(careerWrites).toEqual([{ goals: { increment: 3 }, assists: undefined }]);
  });

  it("credits assists on their own", async () => {
    const { tx, careerWrites } = fakeTx({
      career: { goals: 9, assists: 0 },
      rowTotals: { goals: 2, assists: 4 },
    });
    await merge(tx);
    expect(careerWrites).toEqual([{ goals: undefined, assists: { increment: 4 } }]);
  });

  it("treats a survivor with no career figure at all as zero", async () => {
    const { tx, careerWrites } = fakeTx({ career: null, rowTotals: { goals: 2, assists: 1 } });
    expect((await merge(tx)).careerCredited).toEqual({ goals: 2, assists: 1 });
    expect(careerWrites).toEqual([
      { goals: { increment: 2 }, assists: { increment: 1 } },
    ]);
  });

  it("reports the credit on the outcome, so a merge is not silent about it", async () => {
    /* The admin endpoint returns this and `db:merge:duplicate-players` prints it.
       A number that changes on a profile should be visible to whoever changed it. */
    const { tx } = fakeTx({ career: { goals: 1, assists: 0 }, rowTotals: { goals: 6, assists: 3 } });
    const outcome = await merge(tx);
    expect(outcome.careerCredited).toEqual({ goals: 5, assists: 3 });
    expect(outcome.ok).toBe(true);
  });
});
