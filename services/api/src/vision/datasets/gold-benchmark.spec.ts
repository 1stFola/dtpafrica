import { describe, expect, it, vi } from "vitest";
import { goldContamination, goldReadiness } from "./gold-benchmark";

/**
 * The gold benchmark's two guarantees.
 *
 * Both failures they prevent are silent. A gold set one review short still looks
 * like a benchmark, and a model trained on a previous version's held-out footage
 * still produces a number — just not one that means anything.
 */

function prismaWith(members: { videoAssetId: string; split: string }[], annotations: Record<string, { reviewerId: string | null; decision: string }[][]>) {
  return {
    visionDatasetMember: {
      findMany: vi.fn(({ where }: never) => {
        const w = where as Record<string, unknown>;
        const split = w.split as string | { in: string[] };
        const wanted = typeof split === "string" ? [split] : split.in;
        return Promise.resolve(members.filter((m) => wanted.includes(m.split)));
      }),
    },
    visionAnnotationVersion: {
      findMany: vi.fn(({ where }: never) => {
        const w = where as never as { task: { videoAssetId: { in: string[] } } };
        return Promise.resolve(
          w.task.videoAssetId.in.flatMap((assetId) =>
            (annotations[assetId] ?? []).map((reviews) => ({
              task: { videoAssetId: assetId },
              reviews,
            }))
          )
        );
      }),
    },
  } as never;
}

describe("two independent reviewers", () => {
  it("passes a member two different people reviewed", async () => {
    const p = prismaWith([{ videoAssetId: "a1", split: "gold" }], {
      a1: [[{ reviewerId: "r1", decision: "approved" }, { reviewerId: "r2", decision: "approved" }]],
    });
    const r = await goldReadiness(p, "dv1");
    expect(r.doubleReviewed).toBe(1);
    expect(r.shortOfTwo).toHaveLength(0);
  });

  it("refuses a member the same person reviewed twice", async () => {
    // Reviewing your own work twice is one opinion recorded twice.
    const p = prismaWith([{ videoAssetId: "a1", split: "gold" }], {
      a1: [[{ reviewerId: "r1", decision: "approved" }, { reviewerId: "r1", decision: "approved" }]],
    });
    const r = await goldReadiness(p, "dv1");
    expect(r.shortOfTwo.map((m) => m.videoAssetId)).toEqual(["a1"]);
  });

  it("does not count an unattributed verdict towards two", async () => {
    /* An api-key review carries no user id, so it cannot be told apart from the
       first reviewer. Counting it would let one person clear the bar alone. */
    const p = prismaWith([{ videoAssetId: "a1", split: "gold" }], {
      a1: [[{ reviewerId: "r1", decision: "approved" }, { reviewerId: null, decision: "approved" }]],
    });
    const r = await goldReadiness(p, "dv1");
    expect(r.shortOfTwo).toHaveLength(1);
    expect(r.unattributedReviews).toBe(1);
  });

  it("refuses a gold member nobody reviewed", async () => {
    const p = prismaWith([{ videoAssetId: "a1", split: "gold" }], { a1: [[]] });
    const r = await goldReadiness(p, "dv1");
    expect(r.shortOfTwo).toHaveLength(1);
  });

  it("ignores members outside the gold split", async () => {
    const p = prismaWith(
      [{ videoAssetId: "a1", split: "gold" }, { videoAssetId: "t1", split: "train" }],
      { a1: [[{ reviewerId: "r1", decision: "approved" }, { reviewerId: "r2", decision: "approved" }]] }
    );
    const r = await goldReadiness(p, "dv1");
    expect(r.goldMembers).toBe(1);
  });
});

describe("disagreement", () => {
  it("measures it rather than assuming it away", async () => {
    const p = prismaWith(
      [{ videoAssetId: "a1", split: "gold" }, { videoAssetId: "a2", split: "gold" }],
      {
        a1: [[{ reviewerId: "r1", decision: "approved" }, { reviewerId: "r2", decision: "rejected" }]],
        a2: [[{ reviewerId: "r1", decision: "approved" }, { reviewerId: "r2", decision: "approved" }]],
      }
    );
    const r = await goldReadiness(p, "dv1");
    expect(r.disagreementRate).toBe(0.5);
    expect(r.disagreedMembers).toEqual(["a1"]);
  });

  it("reports null, not zero, when nothing is double-reviewed", async () => {
    // Zero disagreement and no evidence are different claims.
    const p = prismaWith([{ videoAssetId: "a1", split: "gold" }], {
      a1: [[{ reviewerId: "r1", decision: "approved" }]],
    });
    const r = await goldReadiness(p, "dv1");
    expect(r.disagreementRate).toBeNull();
  });
});

describe("gold is never trained on", () => {
  function contaminationPrisma(mine: { videoAssetId: string; split: string }[], frozenGold: { videoAssetId: string; label: string }[]) {
    return {
      visionEventGoldSet: { findMany: vi.fn().mockResolvedValue([]) },
      visionDatasetMember: {
        findMany: vi.fn(({ where }: never) => {
          const w = where as Record<string, unknown>;
          if ((w.split as { in?: string[] })?.in) return Promise.resolve(mine);
          // The held-out lookup; assert it only considers frozen versions.
          expect((w.datasetVersion as Record<string, unknown>).frozenAt).toEqual({ not: null });
          return Promise.resolve(
            frozenGold.map((g) => ({ videoAssetId: g.videoAssetId, datasetVersion: { label: g.label } }))
          );
        }),
      },
    } as never;
  }

  it("catches footage a frozen version holds out", async () => {
    const p = contaminationPrisma([{ videoAssetId: "a1", split: "train" }], [{ videoAssetId: "a1", label: "gold-v1" }]);
    const hits = await goldContamination(p, "dv2");
    expect(hits).toEqual([{ videoAssetId: "a1", heldOutBy: "gold-v1", wouldBecome: "train" }]);
  });

  it("catches it in val as well as train", async () => {
    // Validation steers training. Tuning against held-out footage is the same leak.
    const p = contaminationPrisma([{ videoAssetId: "a1", split: "val" }], [{ videoAssetId: "a1", label: "gold-v1" }]);
    expect((await goldContamination(p, "dv2"))[0]?.wouldBecome).toBe("val");
  });

  it("says nothing when this version trains on nothing", async () => {
    const p = contaminationPrisma([], []);
    expect(await goldContamination(p, "dv2")).toEqual([]);
  });
  it("holds out an unfinished event reference, checksum copies and other footage of the same match", async () => {
    const p = {
      visionDatasetMember: { findMany: vi.fn().mockResolvedValueOnce([
        { videoAssetId: "direct", split: "train", checksumSha256: "same", sbMatchId: "match-1" },
        { videoAssetId: "copy", split: "val", checksumSha256: "same", sbMatchId: null },
        { videoAssetId: "other-camera", split: "train", checksumSha256: "different", sbMatchId: "match-1" },
      ]).mockResolvedValueOnce([]) },
      visionEventGoldSet: { findMany: vi.fn().mockResolvedValue([{ videoAssetId: "direct", label: "collecting-v1", sourceChecksum: "same", videoAsset: { sbMatchId: "match-1" } }]) },
    };
    const result = await goldContamination(p as never, "training-draft");
    expect(result.map((row) => row.videoAssetId)).toEqual(["direct", "copy", "other-camera"]);
    expect(result.every((row) => row.heldOutBy === "event-gold:collecting-v1")).toBe(true);
    expect(p.visionEventGoldSet.findMany.mock.calls[0]?.[0]).not.toHaveProperty("where.frozenAt");
  });
});
