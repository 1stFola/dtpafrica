/**
 * Remove the rows the Vision gates left behind, and nothing else.
 *
 *   pnpm --filter @dtp/api db:purge:gate-litter          # report only
 *   pnpm --filter @dtp/api db:purge:gate-litter --apply  # delete
 *
 * `vision:datasetcheck` cleaned up by deleting dataset versions whose label began
 * with `gate-`, but its gold and export sections name theirs after what they test —
 * `gold benchmark <run>`, `trains on gold <run>` — so those were never matched. Six
 * runs left twelve empty dataset versions and seven label schema versions in the
 * database. The gate's own cleanup is fixed; this clears what accumulated before it
 * was.
 *
 * **The whole risk here is deleting something real**, so the rules are narrow:
 *
 *   - Every name is matched against an **anchored** pattern ending in the gate's
 *     8-hex run id, from [gate-litter-patterns](./gate-litter-patterns.ts), which is
 *     tested — those patterns are the only thing standing between this script and
 *     real data. `contains` is safe inside a gate, which knows its own run id, and
 *     unsafe here: a human-named `gold benchmark for Lagos 2027` must never match.
 *   - A dataset version with **any member** is reported and skipped. An empty
 *     version is a shell; one with members has footage attached, and that is not
 *     something a cleanup script gets to judge.
 *   - A label schema version still referenced by an annotation task or a dataset
 *     version is reported and skipped.
 *   - Dry run by default, and the dry run prints every row it would touch.
 *
 * A run that *aborted* leaves more than empty shells: the dataset gate died once
 * partway through its own cleanup, and its whole fixture — a partner, two source
 * records, a rights scope, eleven assets, a proxy variant, two annotation tasks and
 * their submissions — is still there. That is cleared too, under the same rules, and
 * only for a partner carrying both the gate's placeholder contact address and a
 * run-id name.
 *
 * `VisionDatasetMember` is `Restrict` rather than cascade, so the database itself
 * refuses to delete an asset a dataset still holds. That is the backstop behind the
 * check this script makes anyway.
 *
 * Objects in storage are left alone. The gate now removes its own, and the keys it
 * wrote before that fix are under `datasets/<id>/` for versions that are about to
 * stop existing — regenerable derived data, not footage. Deleting them needs the
 * bucket credentials, which this script deliberately does not ask for.
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import {
  GATE_PARTNER,
  REVIEWER_IDS,
  SCHEMA_VERSIONS,
  VERSION_LABELS,
  isGateName,
  prefixesOf,
} from "./gate-litter-patterns";

loadApiEnv();

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

let deleted = 0;
let skipped = 0;

function report(what: string, rows: string[], why?: string) {
  if (!rows.length) return;
  console.log(`  ${APPLY ? "deleting" : "would delete"} ${rows.length} ${what}${why ?? ""}`);
  for (const r of rows.slice(0, 40)) console.log(`      ${r}`);
  if (rows.length > 40) console.log(`      … and ${rows.length - 40} more`);
}

function keep(what: string, rows: string[], why: string) {
  if (!rows.length) return;
  skipped += rows.length;
  console.log(`  KEEPING ${rows.length} ${what} — ${why}`);
  for (const r of rows.slice(0, 40)) console.log(`      ${r}`);
}

async function purgeDatasetVersions(): Promise<Set<string>> {
  console.log("\nDataset versions");
  console.log("----------------");

  const candidates = [];
  for (const prefix of prefixesOf(VERSION_LABELS)) {
    candidates.push(
      ...(await prisma.visionDatasetVersion.findMany({
        where: { label: { startsWith: prefix } },
        select: { id: true, label: true, frozenAt: true, _count: { select: { members: true } } },
      }))
    );
  }

  const matched = candidates.filter((v) => isGateName(v.label, VERSION_LABELS));
  const unmatched = candidates.filter((v) => !isGateName(v.label, VERSION_LABELS));
  keep(
    "versions sharing a gate prefix",
    unmatched.map((v) => v.label),
    "the name does not end in a gate run id, so it is somebody's"
  );

  /* A version with members has footage attached. Whether that is litter is not a
     judgement this script is entitled to make. */
  const withMembers = matched.filter((v) => v._count.members > 0);
  keep(
    "gate-named versions",
    withMembers.map((v) => `${v.label}  (${v._count.members} members)`),
    "they still have members"
  );

  const empty = matched.filter((v) => v._count.members === 0);
  report(
    "empty dataset versions",
    empty.map((v) => `${v.label}${v.frozenAt ? "  frozen" : ""}`)
  );

  const doomed = new Set(empty.map((v) => v.id));
  if (!APPLY || !empty.length) return doomed;

  const ids = empty.map((v) => v.id);
  /* The audit entries go with them: they describe versions that are about to stop
     existing, and a log pointing at nothing answers no question anyone asks. */
  const audits = await prisma.visionAuditLog.deleteMany({
    where: { targetKind: "vision_dataset_version", targetId: { in: ids } },
  });
  if (audits.count) console.log(`      (and ${audits.count} audit entries for them)`);
  const done = await prisma.visionDatasetVersion.deleteMany({ where: { id: { in: ids } } });
  deleted += done.count;
  return doomed;
}

/**
 * A whole fixture from a run that never finished cleaning up.
 *
 * Assets go last of the things that point at them, because only some relations
 * cascade: variants, camera segments, active-learning items and annotation tasks do,
 * while jobs, upload sessions and deletion requests do not, and dataset membership is
 * `Restrict` on purpose.
 */
async function purgeFixtures(): Promise<Set<string>> {
  console.log("\nFixtures from runs that never finished");
  console.log("-------------------------------------");

  /** Assets on the way out, so a dry run can reason about what that frees. */
  const doomed = new Set<string>();

  const candidates = await prisma.visionSourcePartner.findMany({
    where: { contactEmail: GATE_PARTNER.contactEmail },
    select: { id: true, name: true },
  });
  const matched = candidates.filter((c) => GATE_PARTNER.pattern.test(c.name));
  keep(
    "partners at the gate's placeholder address",
    candidates.filter((c) => !matched.includes(c)).map((c) => c.name),
    "the name does not end in a gate run id"
  );
  if (!matched.length) {
    console.log("  nothing left behind");
    return doomed;
  }

  for (const partner of matched) {
    const assets = await prisma.visionVideoAsset.findMany({
      where: { sourceVideoRecord: { partnerId: partner.id } },
      select: { id: true, objectKey: true, _count: { select: { datasetMembers: true } } },
    });

    /* An asset a dataset still holds is not litter, whatever its name. The database
       would refuse the delete anyway; failing here says why instead of throwing. */
    const held = assets.filter((asset) => asset._count.datasetMembers > 0);
    if (held.length) {
      keep(
        `assets under ${partner.name}`,
        held.map((asset) => `${asset.objectKey}  (${asset._count.datasetMembers} members)`),
        "a dataset version still holds them, so the whole fixture is left alone"
      );
      continue;
    }

    const ids = assets.map((asset) => asset.id);
    for (const id of ids) doomed.add(id);
    report(`assets under ${partner.name}`, assets.map((asset) => asset.objectKey));

    const tasks = await prisma.visionAnnotationTask.count({
      where: { videoAssetId: { in: ids } },
    });
    const variants = await prisma.visionVideoVariant.count({
      where: { videoAssetId: { in: ids } },
    });
    if (tasks || variants) {
      console.log(`      (cascading ${tasks} annotation task(s) and ${variants} variant(s))`);
    }

    if (!APPLY) continue;

    // The relations that do not cascade, before the assets they point at.
    await prisma.visionJobEvent.deleteMany({ where: { job: { videoAssetId: { in: ids } } } });
    await prisma.visionJobCost.deleteMany({ where: { job: { videoAssetId: { in: ids } } } });
    await prisma.visionJob.deleteMany({ where: { videoAssetId: { in: ids } } });
    await prisma.visionUploadSession.deleteMany({ where: { videoAssetId: { in: ids } } });
    await prisma.visionDeletionRequest.deleteMany({ where: { videoAssetId: { in: ids } } });
    await prisma.visionAuditLog.deleteMany({
      where: { targetKind: "vision_video_asset", targetId: { in: ids } },
    });

    const assetsGone = await prisma.visionVideoAsset.deleteMany({ where: { id: { in: ids } } });
    const scopes = await prisma.visionRightsScope.deleteMany({
      where: { partnerId: partner.id },
    });
    const records = await prisma.visionSourceVideoRecord.deleteMany({
      where: { partnerId: partner.id },
    });
    await prisma.visionSourcePartner.delete({ where: { id: partner.id } });
    deleted += assetsGone.count + scopes.count + records.count + 1;
    console.log(
      `      deleted ${assetsGone.count} asset(s), ${records.count} record(s), ${scopes.count} scope(s) and the partner`
    );
  }

  return doomed;
}

async function purgeReviews() {
  console.log("\nReview decisions");
  console.log("----------------");

  const candidates = [];
  for (const prefix of prefixesOf(REVIEWER_IDS)) {
    candidates.push(
      ...(await prisma.visionReviewDecision.findMany({
        where: { reviewerId: { startsWith: prefix } },
        select: { id: true, reviewerId: true, annotationVersionId: true },
      }))
    );
  }

  const matched = candidates.filter((r) => isGateName(r.reviewerId, REVIEWER_IDS));
  keep(
    "reviews sharing a gate prefix",
    candidates.filter((r) => !matched.includes(r)).map((r) => String(r.reviewerId)),
    "the reviewer id does not end in a gate run id"
  );

  /* These are orphans by design: the relation is SetNull rather than cascade,
     because a record of someone's judgement should not vanish with the thing it
     judged. That is right for real reviews and pointless for the gate's. */
  report(
    "gate review decisions",
    matched.map((r) => `${r.reviewerId}${r.annotationVersionId ? "" : "  (orphaned)"}`)
  );

  if (!APPLY || !matched.length) return;
  const done = await prisma.visionReviewDecision.deleteMany({
    where: { id: { in: matched.map((r) => r.id) } },
  });
  deleted += done.count;
}

/**
 * Schema versions nothing will still be pointing at.
 *
 * "Still" is the important word, and the reason this takes arguments. In a dry run
 * the tasks and dataset versions above have not been deleted yet, so counting
 * references as they stand would report a schema as kept that `--apply` goes on to
 * delete — a dry run that misdescribes its own outcome is worse than no dry run.
 */
async function purgeLabelSchemas(doomedVersions: Set<string>, doomedAssets: Set<string>) {
  console.log("\nLabel schema versions");
  console.log("---------------------");

  const candidates = [];
  for (const prefix of prefixesOf(SCHEMA_VERSIONS)) {
    candidates.push(
      ...(await prisma.visionLabelSchemaVersion.findMany({
        where: { version: { startsWith: prefix } },
        select: { id: true, version: true },
      }))
    );
  }

  const seen = new Set<string>();
  const unique = candidates.filter((s) => !seen.has(s.id) && seen.add(s.id));
  const matched = unique.filter((s) => isGateName(s.version, SCHEMA_VERSIONS));
  keep(
    "schema versions sharing a gate prefix",
    unique.filter((s) => !matched.includes(s)).map((s) => s.version),
    "the name does not end in a gate run id"
  );

  const ids = matched.map((m) => m.id);
  const tasks = await prisma.visionAnnotationTask.findMany({
    where: { labelSchemaVersionId: { in: ids } },
    select: { labelSchemaVersionId: true, videoAssetId: true },
  });
  const usingVersions = await prisma.visionDatasetVersion.findMany({
    where: { labelSchemaVersionId: { in: ids } },
    select: { id: true, labelSchemaVersionId: true },
  });

  // Only what survives the steps above.
  const surviving = new Map<string, { tasks: number; versions: number }>();
  for (const id of ids) surviving.set(id, { tasks: 0, versions: 0 });
  for (const t of tasks) {
    if (!doomedAssets.has(t.videoAssetId)) surviving.get(t.labelSchemaVersionId)!.tasks += 1;
  }
  for (const v of usingVersions) {
    if (!doomedVersions.has(v.id)) surviving.get(v.labelSchemaVersionId!)!.versions += 1;
  }

  const stillUsed = (m: { id: string }) => {
    const c = surviving.get(m.id)!;
    return c.tasks > 0 || c.versions > 0;
  };

  keep(
    "gate-named schema versions",
    matched.filter(stillUsed).map((m) => {
      const c = surviving.get(m.id)!;
      return `${m.version}  (${c.tasks} tasks, ${c.versions} dataset versions)`;
    }),
    "something outside this purge still points at them"
  );

  const free = matched.filter((m) => !stillUsed(m));
  report(
    "unreferenced label schema versions",
    free.map((m) => m.version)
  );

  if (!APPLY || !free.length) return;
  const done = await prisma.visionLabelSchemaVersion.deleteMany({
    where: { id: { in: free.map((m) => m.id) } },
  });
  deleted += done.count;
}

async function main() {
  console.log(
    `Vision gate litter — ${APPLY ? "APPLYING" : "dry run, pass --apply to delete"}\n` +
      "  Only rows whose names end in a gate's 8-hex run id are considered."
  );

  /* Order is the whole difficulty. A label schema version cannot go while a dataset
     version or an annotation task still references it — the same mistake that caused
     this litter in the gate — and the gate's reviews are swept after the annotation
     versions they hang off, because that relation is SetNull and leaves them behind
     rather than taking them with it. */
  const doomedVersions = await purgeDatasetVersions();
  const doomedAssets = await purgeFixtures();
  await purgeReviews();
  await purgeLabelSchemas(doomedVersions, doomedAssets);

  console.log("\n" + "-".repeat(60));
  if (APPLY) {
    console.log(`Deleted ${deleted} row(s). Kept ${skipped} that did not qualify.`);
  } else {
    console.log(`Nothing was written. ${skipped} row(s) would be kept as not qualifying.`);
    console.log("Re-run with --apply to delete.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
