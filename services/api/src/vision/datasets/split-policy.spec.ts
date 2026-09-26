import { describe, expect, it } from "vitest";
import {
  DATASET_GROUPING_LEVELS,
  DEFAULT_SPLIT_POLICY,
  InvalidSplitPolicyError,
  assertPolicy,
  groupKeyFor,
  pickSplit,
  resolvePolicy,
  type SplitPolicy,
} from "./split-policy";

const asset = (over: Partial<Parameters<typeof groupKeyFor>[0]> = {}) => ({
  id: "asset-1",
  duplicateClusterId: null,
  sbMatchId: null,
  competitionId: null,
  ...over,
});

describe("split policy", () => {
  describe("groupKeyFor", () => {
    it("prefers a duplicate cluster over a match", () => {
      // The same fixture re-uploaded at a different quality is two assets and one
      // piece of football. If the cluster lost to the match, the two copies could
      // land on opposite sides of a split.
      const key = groupKeyFor(
        asset({ duplicateClusterId: "cluster-9", sbMatchId: "match-3" }),
        DEFAULT_SPLIT_POLICY
      );
      expect(key).toBe("cluster:cluster-9");
    });

    it("prefers a match over a competition", () => {
      expect(
        groupKeyFor(asset({ sbMatchId: "match-3", competitionId: "comp-1" }), DEFAULT_SPLIT_POLICY)
      ).toBe("match:match-3");
    });

    it("gives an ungrouped asset a group of its own", () => {
      // Not a shared null key: that would force every ungrouped asset into one
      // split and starve the others.
      expect(groupKeyFor(asset({ id: "lonely" }), DEFAULT_SPLIT_POLICY)).toBe("asset:lonely");
    });

    it("honours the policy's ordering rather than a fixed precedence", () => {
      const matchFirst: SplitPolicy = { ...DEFAULT_SPLIT_POLICY, groupBy: ["match"] };
      expect(
        groupKeyFor(asset({ duplicateClusterId: "cluster-9", sbMatchId: "match-3" }), matchFirst)
      ).toBe("match:match-3");
    });
  });

  describe("pickSplit", () => {
    it("is deterministic for the same seed and group", () => {
      // The property the whole dataset version rests on: two machines building
      // "v3" must agree on what v3 is.
      const first = pickSplit("match:abc", DEFAULT_SPLIT_POLICY);
      for (let i = 0; i < 25; i += 1) {
        expect(pickSplit("match:abc", DEFAULT_SPLIT_POLICY)).toBe(first);
      }
    });

    it("changes the assignment when the seed changes", () => {
      const keys = Array.from({ length: 60 }, (_, i) => `match:${i}`);
      const a = keys.map((k) => pickSplit(k, DEFAULT_SPLIT_POLICY));
      const b = keys.map((k) => pickSplit(k, { ...DEFAULT_SPLIT_POLICY, seed: "other" }));
      expect(a).not.toEqual(b);
    });

    it("only ever returns a split named by the policy", () => {
      for (let i = 0; i < 400; i += 1) {
        expect(["train", "val", "test", "gold"]).toContain(
          pickSplit(`match:${i}`, DEFAULT_SPLIT_POLICY)
        );
      }
    });

    it("never assigns a split whose weight is zero", () => {
      // Otherwise a train/val-only policy would silently produce a gold slice that
      // no training run expects and nothing evaluates.
      const noGold: SplitPolicy = { ...DEFAULT_SPLIT_POLICY, gold: 0, train: 80 };
      const seen = new Set(
        Array.from({ length: 500 }, (_, i) => pickSplit(`match:${i}`, noGold))
      );
      expect(seen.has("gold")).toBe(false);
    });

    it("lands roughly on the configured weights over a realistic corpus", () => {
      // Not a distribution guarantee, just a check that the arithmetic is not
      // wildly skewed — a 70/10/10/10 policy producing 95% train would pass every
      // other test here.
      const counts: Record<string, number> = {};
      for (let i = 0; i < 2000; i += 1) {
        const split = pickSplit(`match:${i}`, DEFAULT_SPLIT_POLICY);
        counts[split] = (counts[split] ?? 0) + 1;
      }
      expect(counts.train / 2000).toBeGreaterThan(0.6);
      expect(counts.train / 2000).toBeLessThan(0.8);
      for (const split of ["val", "test", "gold"]) {
        expect(counts[split] / 2000).toBeGreaterThan(0.05);
        expect(counts[split] / 2000).toBeLessThan(0.15);
      }
    });

    it("keeps gold stable when the other weights are re-tuned", () => {
      // gold is carved from the bottom of the hash space, so re-balancing
      // train/val/test must not quietly reassign the permanent holdout.
      const keys = Array.from({ length: 200 }, (_, i) => `match:${i}`);
      const original = { ...DEFAULT_SPLIT_POLICY };
      const retuned: SplitPolicy = { ...DEFAULT_SPLIT_POLICY, train: 60, val: 20 };

      const goldBefore = keys.filter((k) => pickSplit(k, original) === "gold");
      const goldAfter = keys.filter((k) => pickSplit(k, retuned) === "gold");
      // Same total (100), same gold weight, so the gold slice is identical.
      expect(goldAfter).toEqual(goldBefore);
    });
  });

  describe("assertPolicy", () => {
    it("rejects an empty groupBy", () => {
      // Assigning splits per member is the leak this module exists to prevent.
      expect(() => assertPolicy({ ...DEFAULT_SPLIT_POLICY, groupBy: [] })).toThrow(
        InvalidSplitPolicyError
      );
    });

    it("rejects weights that sum to zero", () => {
      expect(() =>
        assertPolicy({ ...DEFAULT_SPLIT_POLICY, train: 0, val: 0, test: 0, gold: 0 })
      ).toThrow(InvalidSplitPolicyError);
    });

    it("rejects a negative weight", () => {
      expect(() => assertPolicy({ ...DEFAULT_SPLIT_POLICY, val: -5 })).toThrow(
        InvalidSplitPolicyError
      );
    });

    it("rejects a blank seed", () => {
      expect(() => assertPolicy({ ...DEFAULT_SPLIT_POLICY, seed: "   " })).toThrow(
        InvalidSplitPolicyError
      );
    });

    it("rejects an unknown grouping level", () => {
      expect(() =>
        assertPolicy({
          ...DEFAULT_SPLIT_POLICY,
          groupBy: ["stadium" as never],
        })
      ).toThrow(InvalidSplitPolicyError);
    });

    it("accepts every grouping level the contract names", () => {
      expect(() =>
        assertPolicy({ ...DEFAULT_SPLIT_POLICY, groupBy: [...DATASET_GROUPING_LEVELS] })
      ).not.toThrow();
    });
  });

  describe("resolvePolicy", () => {
    it("fills from the defaults", () => {
      expect(resolvePolicy({ gold: 20 })).toEqual({ ...DEFAULT_SPLIT_POLICY, gold: 20 });
    });

    it("validates the merged result, not just the override", () => {
      expect(() => resolvePolicy({ groupBy: [] })).toThrow(InvalidSplitPolicyError);
    });

    it("treats null as absent", () => {
      expect(resolvePolicy(null)).toEqual(DEFAULT_SPLIT_POLICY);
    });

    it("ignores keys explicitly set to undefined", () => {
      // This is the shape class-transformer hands a validated DTO: every declared
      // optional property is an OWN key, set to undefined when the caller omitted it.
      // A plain spread therefore overwrote the defaults with undefined, and
      // `POST /vision/datasets` answered 500 for any partial policy — in production,
      // where bodies are transformed, while development looked fine.
      const asTransformed: Partial<SplitPolicy> = {
        train: 60,
        val: 20,
        test: 20,
        gold: 0,
        seed: "from-the-caller",
        groupBy: undefined,
      };

      const policy = resolvePolicy(asTransformed);
      expect(policy.groupBy).toEqual(DEFAULT_SPLIT_POLICY.groupBy);
      expect(policy.seed).toBe("from-the-caller");
      expect(policy.train).toBe(60);
    });

    it("does not throw for a policy whose every optional key is undefined", () => {
      const allUndefined = {
        train: undefined, val: undefined, test: undefined,
        gold: undefined, groupBy: undefined, seed: undefined,
      } as unknown as Partial<SplitPolicy>;
      expect(resolvePolicy(allUndefined)).toEqual(DEFAULT_SPLIT_POLICY);
    });
  });
});
