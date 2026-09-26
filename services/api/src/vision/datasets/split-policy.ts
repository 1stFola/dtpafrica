import { createHash } from "node:crypto";

/**
 * Split policy: pure, dependency-free, and deliberately not inside the service.
 *
 * Kept separate so the split arithmetic can be tested without a database or a Nest
 * container, and so the DTO can validate against the same closed lists the runtime
 * uses rather than a second copy that drifts.
 *
 * See docs/vision/09-ML-PIPELINE.md.
 */

export const DATASET_SPLITS = ["train", "val", "test", "gold"] as const;
export type DatasetSplit = (typeof DATASET_SPLITS)[number];

/** Grouping levels, broadest first. Order in a policy's `groupBy` is significant. */
export const DATASET_GROUPING_LEVELS = ["duplicateCluster", "match", "competition"] as const;
export type DatasetGroupingLevel = (typeof DATASET_GROUPING_LEVELS)[number];

export type SplitPolicy = {
  train: number;
  val: number;
  test: number;
  /**
   * Held out permanently and never trained on. Carved from the same hash space as
   * the rest, so it is a stable slice of the corpus rather than a sample of
   * whatever happened to be added last.
   */
  gold: number;
  groupBy: DatasetGroupingLevel[];
  seed: string;
};

export const DEFAULT_SPLIT_POLICY: SplitPolicy = {
  train: 70,
  val: 10,
  test: 10,
  gold: 10,
  groupBy: ["duplicateCluster", "match", "competition"],
  seed: "dtp-vision-v1",
};

export class InvalidSplitPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSplitPolicyError";
  }
}

export function assertPolicy(policy: SplitPolicy): void {
  const weights = {
    train: policy.train,
    val: policy.val,
    test: policy.test,
    gold: policy.gold,
  };
  for (const [name, weight] of Object.entries(weights)) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new InvalidSplitPolicyError(`Split weight "${name}" must be zero or more`);
    }
  }
  if (policy.train + policy.val + policy.test + policy.gold <= 0) {
    throw new InvalidSplitPolicyError("Split weights must sum to more than zero");
  }
  if (!policy.groupBy.length) {
    throw new InvalidSplitPolicyError(
      "groupBy must name at least one grouping: assigning splits per member leaks adjacent frames"
    );
  }
  for (const level of policy.groupBy) {
    if (!DATASET_GROUPING_LEVELS.includes(level)) {
      throw new InvalidSplitPolicyError(`Unknown grouping level "${level}"`);
    }
  }
  if (!policy.seed.trim()) {
    throw new InvalidSplitPolicyError("A seed is required: splits must be reproducible");
  }
}

/**
 * The group an asset belongs to, broadest grouping first.
 *
 * A duplicate cluster beats a match, because the same fixture re-uploaded at a
 * different quality is two assets and one piece of football — and if those two land
 * on opposite sides of a split, the benchmark is measuring memorisation.
 *
 * Falling back to the asset's own id means an ungrouped asset is its own group,
 * rather than every ungrouped asset silently sharing one null key and being forced
 * into a single split.
 */
export function groupKeyFor(
  asset: {
    id: string;
    duplicateClusterId: string | null;
    sbMatchId: string | null;
    competitionId: string | null;
  },
  policy: SplitPolicy
): string {
  for (const level of policy.groupBy) {
    if (level === "duplicateCluster" && asset.duplicateClusterId) {
      return `cluster:${asset.duplicateClusterId}`;
    }
    if (level === "match" && asset.sbMatchId) return `match:${asset.sbMatchId}`;
    if (level === "competition" && asset.competitionId) {
      return `competition:${asset.competitionId}`;
    }
  }
  return `asset:${asset.id}`;
}

/**
 * The split for a group — deterministic, from a hash of `(seed, groupKey)`.
 *
 * A random shuffle would make a dataset version unreproducible, which defeats the
 * point of versioning it: two machines building "v3" would disagree about what v3
 * is. Same corpus and policy, same answer, anywhere.
 */
export function pickSplit(groupKey: string, policy: SplitPolicy): DatasetSplit {
  const digest = createHash("sha256").update(`${policy.seed}:${groupKey}`).digest();
  const total = policy.train + policy.val + policy.test + policy.gold;
  // 32 bits keeps the arithmetic inside a safe integer and is ample for the
  // corpus sizes involved.
  const bucket = digest.readUInt32BE(0) % total;

  // gold first, so extending the corpus never reassigns what is already held out.
  if (bucket < policy.gold) return "gold";
  if (bucket < policy.gold + policy.test) return "test";
  if (bucket < policy.gold + policy.test + policy.val) return "val";
  return "train";
}

/**
 * Fills a partial policy from the defaults and validates the result.
 *
 * Keys whose value is `undefined` are dropped before merging. A plain spread looks
 * equivalent and is not: `class-transformer` gives a validated DTO its declared
 * optional properties as own keys set to `undefined`, so spreading the instance
 * overwrote every default the caller did not mention. The symptom was a 500 from
 * `POST /vision/datasets` for any request that sent a partial policy — live in
 * production, and invisible in development until the dev server started validating
 * and transforming bodies the way production always had.
 */
export function resolvePolicy(partial: Partial<SplitPolicy> | null | undefined): SplitPolicy {
  const supplied = Object.fromEntries(
    Object.entries(partial ?? {}).filter(([, value]) => value !== undefined)
  ) as Partial<SplitPolicy>;

  const policy: SplitPolicy = { ...DEFAULT_SPLIT_POLICY, ...supplied };
  assertPolicy(policy);
  return policy;
}
