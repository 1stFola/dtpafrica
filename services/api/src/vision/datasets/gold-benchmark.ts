/**
 * The Nigeria gold benchmark.
 *
 * One locked, versioned, two-person-reviewed subset that is **never trained on**.
 * Everything the programme later claims about a model is measured against it, so
 * the benchmark's credibility is the whole point — and a benchmark you can quietly
 * edit is not a benchmark.
 *
 * Three rules, each enforced rather than documented:
 *
 *   1. **Two independent reviewers.** A gold member whose labels one person checked
 *      is one person's opinion. Two, and the disagreement between them, is evidence.
 *   2. **Disagreement is measured, not assumed away.** A gold set where the two
 *      reviewers never disagree usually means the second reviewer rubber-stamped
 *      the first, so the number is recorded at freeze and carried on the version.
 *   3. **Gold is never trained on, across versions.** Holding a match out of train
 *      in v1 and putting it in train in v2 silently destroys every measurement ever
 *      taken against v1, and nothing about v2 looks wrong at the time.
 *
 * See docs/vision/10-EVALUATION-AND-GATES.md § The Nigeria gold benchmark.
 */
import type { PrismaClient } from "@prisma/client";

/** Splits whose members are used to fit a model. Gold must never reach these. */
export const TRAINING_SPLITS = ["train", "val"] as const;

export type GoldMemberReview = {
  videoAssetId: string;
  /** Distinct people who recorded a verdict on this asset's annotations. */
  reviewers: string[];
  /** Verdicts recorded, in order, for the disagreement measure. */
  decisions: string[];
  annotationVersions: number;
};

export type GoldReadiness = {
  goldMembers: number;
  /** Members with two or more distinct reviewers — the bar for freezing. */
  doubleReviewed: number;
  /** Members short of that bar, which is what blocks a freeze. */
  shortOfTwo: GoldMemberReview[];
  /**
   * How often the reviewers of a member did not reach the same verdict.
   *
   * Reported as a rate over double-reviewed members. A gold set reporting zero
   * disagreement is not necessarily good news, and is worth a second look at
   * whether the reviews were genuinely independent.
   */
  disagreementRate: number | null;
  disagreedMembers: string[];
  unattributedReviews: number;
};

/**
 * Who reviewed each gold member, and whether they agreed.
 *
 * A review is attached to an annotation version, which belongs to a task, which
 * names the asset — so the chain from a dataset member back to the people who
 * checked its labels runs through the annotation tables rather than the dataset
 * ones.
 */
export async function goldReadiness(
  prisma: PrismaClient,
  datasetVersionId: string
): Promise<GoldReadiness> {
  const goldMembers = await prisma.visionDatasetMember.findMany({
    where: { datasetVersionId, split: "gold" },
    select: { videoAssetId: true },
  });

  /* One read for every gold member rather than one per member: a gold set is
     hundreds of matches, and this runs inside `freeze`. */
  const assetIds = [...new Set(goldMembers.map((m) => m.videoAssetId))];
  const allVersions = assetIds.length
    ? await prisma.visionAnnotationVersion.findMany({
        where: { task: { videoAssetId: { in: assetIds } } },
        select: {
          task: { select: { videoAssetId: true } },
          reviews: { select: { reviewerId: true, decision: true }, orderBy: { createdAt: "asc" } },
        },
      })
    : [];

  const byAsset = new Map<string, (typeof allVersions)[number][]>();
  for (const v of allVersions) {
    const forAsset = byAsset.get(v.task.videoAssetId);
    if (forAsset) forAsset.push(v);
    else byAsset.set(v.task.videoAssetId, [v]);
  }

  const rows: GoldMemberReview[] = [];
  let unattributed = 0;

  for (const member of goldMembers) {
    const versions = byAsset.get(member.videoAssetId) ?? [];

    const reviewers = new Set<string>();
    const decisions: string[] = [];
    for (const version of versions) {
      for (const review of version.reviews) {
        decisions.push(review.decision);
        /* An unattributed verdict cannot count towards "two independent
           reviewers", because there is no way to tell it from the first one.
           They are counted so the reason a member fails is visible. */
        if (review.reviewerId) reviewers.add(review.reviewerId);
        else unattributed += 1;
      }
    }

    rows.push({
      videoAssetId: member.videoAssetId,
      reviewers: [...reviewers],
      decisions,
      annotationVersions: versions.length,
    });
  }

  const doubleReviewed = rows.filter((r) => r.reviewers.length >= 2);
  const disagreed = doubleReviewed.filter((r) => new Set(r.decisions).size > 1);

  return {
    goldMembers: rows.length,
    doubleReviewed: doubleReviewed.length,
    shortOfTwo: rows.filter((r) => r.reviewers.length < 2),
    disagreementRate: doubleReviewed.length
      ? Number((disagreed.length / doubleReviewed.length).toFixed(3))
      : null,
    disagreedMembers: disagreed.map((r) => r.videoAssetId),
    unattributedReviews: unattributed,
  };
}

export type GoldContamination = {
  videoAssetId: string;
  /** The frozen version that holds this asset in gold. */
  heldOutBy: string;
  /** The split it would take in the version being checked. */
  wouldBecome: string;
};

/**
 * Assets this version would train on that a frozen version holds out as gold.
 *
 * This is the failure that cannot be noticed later. Every benchmark number ever
 * published against the frozen version silently becomes a measurement of the
 * model's memory rather than its ability, and the dataset that caused it looks
 * entirely ordinary.
 *
 * Matching is by asset rather than by group: two versions may group differently,
 * and it is the footage itself that a model would memorise.
 */
export async function goldContamination(
  prisma: PrismaClient,
  datasetVersionId: string
): Promise<GoldContamination[]> {
  const candidates = await prisma.visionDatasetMember.findMany({
    where: { datasetVersionId, split: { in: [...TRAINING_SPLITS] } },
    select: { videoAssetId: true, split: true },
  });
  if (!candidates.length) return [];

  const heldOut = await prisma.visionDatasetMember.findMany({
    where: {
      split: "gold",
      videoAssetId: { in: candidates.map((c) => c.videoAssetId) },
      datasetVersionId: { not: datasetVersionId },
      /* Only a frozen version's gold set counts. A draft version is still being
         arranged, and treating its gold as binding would block work on the very
         corpus somebody is in the middle of putting together. */
      datasetVersion: { frozenAt: { not: null } },
    },
    select: { videoAssetId: true, datasetVersion: { select: { label: true } } },
  });

  const bySplit = new Map(candidates.map((c) => [c.videoAssetId, c.split]));
  return heldOut.map((h) => ({
    videoAssetId: h.videoAssetId,
    heldOutBy: h.datasetVersion.label,
    wouldBecome: bySplit.get(h.videoAssetId) ?? "unknown",
  }));
}
