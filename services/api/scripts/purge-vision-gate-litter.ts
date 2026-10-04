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
  GATE_COMPETITION_SLUGS,
  GATE_EVENT_DETAILS,
  GATE_MODEL_KEYS,
  GATE_PARTNER,
  GATE_PLAYER_SLUGS,
  GATE_USER_EMAILS,
  GATE_WORKER_PROVIDER,
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
 * Assets go last of the things that point at them. Most relations cascade (variants,
 * camera segments, tracks, jobs, annotation tasks); upload sessions and deletion
 * requests are set null and would be left pointing at nothing, and dataset membership
 * is `Restrict` on purpose. Each partner's fixture goes in one transaction: a purge
 * that died halfway used to leave a partner with no assets, which the next run then
 * could not tell from a real one being set up.
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

    // All of one fixture or none of it.
    const [, , , , , , assetsGone, scopes, records] = await prisma.$transaction([
      prisma.visionJobEvent.deleteMany({ where: { job: { videoAssetId: { in: ids } } } }),
      prisma.visionJobCost.deleteMany({ where: { job: { videoAssetId: { in: ids } } } }),
      prisma.visionJob.deleteMany({ where: { videoAssetId: { in: ids } } }),
      prisma.visionUploadSession.deleteMany({ where: { videoAssetId: { in: ids } } }),
      prisma.visionDeletionRequest.deleteMany({ where: { videoAssetId: { in: ids } } }),
      prisma.visionAuditLog.deleteMany({ where: { targetKind: "vision_video_asset", targetId: { in: ids } } }),
      prisma.visionVideoAsset.deleteMany({ where: { id: { in: ids } } }),
      prisma.visionRightsScope.deleteMany({ where: { partnerId: partner.id } }),
      prisma.visionSourceVideoRecord.deleteMany({ where: { partnerId: partner.id } }),
      prisma.visionSourcePartner.deleteMany({ where: { id: partner.id } }),
    ]);
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

/** Rows of one model whose name a gate generated, fetched by prefix and held against the pattern. */
async function gateNamed<T>(patterns: Parameters<typeof prefixesOf>[0], fetch: (prefix: string) => Promise<T[]>, nameOf: (row: T) => string | null, idOf: (row: T) => string): Promise<{ matched: T[]; others: T[] }> {
  const seen = new Set<string>();
  const rows: T[] = [];
  for (const prefix of prefixesOf(patterns)) for (const row of await fetch(prefix)) if (!seen.has(idOf(row)) && seen.add(idOf(row))) rows.push(row);
  const matched = rows.filter((r) => isGateName(nameOf(r), patterns));
  return { matched, others: rows.filter((r) => !matched.includes(r)) };
}

/** The admin accounts a gate signs in as. An interrupted gate left them active, with every competition. */
async function purgePeople() {
  console.log("\nGate sign-ins");
  console.log("-------------");
  const { matched, others } = await gateNamed(
    GATE_USER_EMAILS,
    (prefix) => prisma.adminUser.findMany({ where: { email: { startsWith: prefix } }, select: { id: true, email: true, isActive: true } }),
    (u) => u.email,
    (u) => u.id
  );
  keep("accounts sharing the gate prefix", others.map((u) => u.email), "the address is not a gate's");
  report("gate accounts", matched.map((u) => `${u.email}${u.isActive ? "  ACTIVE" : ""}`));
  if (!APPLY || !matched.length) return;
  const ids = matched.map((u) => u.id);
  const [, gone] = await prisma.$transaction([prisma.visionAuditLog.deleteMany({ where: { actorId: { in: ids } } }), prisma.adminUser.deleteMany({ where: { id: { in: ids } } })]);
  deleted += gone.count;
}

/** Models a gate registered. Their versions, benchmark runs and promotion requests go with them. */
async function purgeModels() {
  console.log("\nGate models");
  console.log("-----------");
  const { matched, others } = await gateNamed(
    GATE_MODEL_KEYS,
    (prefix) => prisma.visionModel.findMany({ where: { key: { startsWith: prefix } }, select: { id: true, key: true, versions: { select: { id: true, stage: true } } } }),
    (m) => m.key,
    (m) => m.id
  );
  keep("models sharing a gate prefix", others.map((m) => m.key), "the key does not end in a gate run id");
  report("gate models", matched.map((m) => `${m.key}  (${m.versions.length} version(s)${m.versions.some((v) => v.stage === "production") ? ", one IN PRODUCTION" : ""})`));
  if (!APPLY || !matched.length) return;
  const ids = matched.map((m) => m.id);
  const versionIds = matched.flatMap((m) => m.versions.map((v) => v.id));
  const [, , , gone] = await prisma.$transaction([
    prisma.visionBenchmarkRun.deleteMany({ where: { modelVersionId: { in: versionIds } } }),
    prisma.visionAuditLog.deleteMany({ where: { targetId: { in: [...ids, ...versionIds] } } }),
    prisma.visionModelVersion.deleteMany({ where: { id: { in: versionIds } } }),
    prisma.visionModel.deleteMany({ where: { id: { in: ids } } }),
  ]);
  deleted += gone.count;
}

/** Workers of the mock provider that hold no job. No machine stands behind one. */
async function purgeWorkers() {
  console.log("\nGate workers");
  console.log("------------");
  const workers = await prisma.visionWorker.findMany({ where: { providerId: GATE_WORKER_PROVIDER }, select: { id: true, resourceClass: true, retiredAt: true } });
  const busy = new Set((await prisma.visionJob.findMany({ where: { workerId: { in: workers.map((w) => w.id) }, state: { in: ["claimed", "running"] } }, select: { workerId: true } })).map((j) => j.workerId));
  keep(`${GATE_WORKER_PROVIDER}-provider workers`, workers.filter((w) => busy.has(w.id)).map((w) => w.id), "they hold a job");
  const idle = workers.filter((w) => !busy.has(w.id));
  report(`${GATE_WORKER_PROVIDER}-provider workers holding no job`, idle.map((w) => `${w.id}  ${w.resourceClass}${w.retiredAt ? "  retired" : ""}`));
  if (!APPLY || !idle.length) return;
  deleted += (await prisma.visionWorker.deleteMany({ where: { id: { in: idle.map((w) => w.id) } } })).count;
}

/**
 * What an earlier gate run wrote into a match somebody recorded. The row goes; the
 * score it may have moved does not come back by itself, so the matches are named.
 */
async function purgeMatchEvents() {
  console.log("\nGate rows in real matches");
  console.log("-------------------------");
  const { matched } = await gateNamed(
    GATE_EVENT_DETAILS,
    (prefix) => prisma.sbMatchEvent.findMany({ where: { detail: { startsWith: prefix }, match: { NOT: { slug: { startsWith: "gate-" } } } }, select: { id: true, detail: true, type: true, minute: true, matchId: true } }),
    (e) => e.detail,
    (e) => e.id
  );
  report("match events a gate wrote", matched.map((e) => `${e.type} at ${e.minute}'  ${e.detail}  match ${e.matchId}`));
  if (matched.length) console.log(`      Check the score of: ${[...new Set(matched.map((e) => e.matchId))].join(", ")}. A goal created by promotion moved it.`);
  if (!APPLY || !matched.length) return;
  deleted += (await prisma.sbMatchEvent.deleteMany({ where: { id: { in: matched.map((e) => e.id) } } })).count;
}

/** A gate's own competition, with its teams, matches, squads and events, and its players. */
async function purgeGateMatches() {
  console.log("\nGate matches");
  console.log("------------");
  const competitions = await gateNamed(
    GATE_COMPETITION_SLUGS,
    (prefix) => prisma.sbCompetition.findMany({ where: { slug: { startsWith: prefix } }, select: { id: true, slug: true, name: true, _count: { select: { matches: true } } } }),
    (c) => c.slug,
    (c) => c.id
  );
  /* The slug and the name both, as with partners: a slug alone is a short thing to trust. */
  const ours = competitions.matched.filter((c) => c.name === `Vision ${c.slug.replace("-", " ")}`);
  keep("competitions sharing the gate prefix", [...competitions.others, ...competitions.matched.filter((c) => !ours.includes(c))].map((c) => `${c.slug}  "${c.name}"`), "the slug or the name is not a gate's");
  report("gate competitions", ours.map((c) => `${c.slug}  (${c._count.matches} match(es))`));
  const players = await gateNamed(
    GATE_PLAYER_SLUGS,
    (prefix) => prisma.player.findMany({ where: { slug: { startsWith: prefix }, firstName: "Gate" }, select: { id: true, slug: true } }),
    (p) => p.slug,
    (p) => p.id
  );
  report("gate players", players.matched.map((p) => p.slug));
  if (!APPLY) return;
  if (ours.length) {
    const ids = ours.map((c) => c.id);
    const [, gone] = await prisma.$transaction([prisma.sbMatch.deleteMany({ where: { competitionId: { in: ids } } }), prisma.sbCompetition.deleteMany({ where: { id: { in: ids } } })]);
    deleted += gone.count;
  }
  if (players.matched.length) deleted += (await prisma.player.deleteMany({ where: { id: { in: players.matched.map((p) => p.id) } } })).count;
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
  /* What a gate creates outside its partner: the people it signs in as, the models it
     registers, the workers it provisions, and what it wrote into a match. */
  await purgeModels();
  await purgeWorkers();
  await purgeMatchEvents();
  await purgeGateMatches();
  await purgePeople();

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
