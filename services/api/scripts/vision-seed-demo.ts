/**
 * Demo data for the Vision operator screens.
 *
 *   pnpm --filter @dtp/api vision:seed-demo            # create or refresh
 *   pnpm --filter @dtp/api vision:seed-demo --remove   # take it all out again
 *
 * Every partner it creates is named "… (demo)", and that marker is the only thing
 * it will ever delete. Re-running it removes its own rows and rebuilds them, so it
 * is safe to run repeatedly and leaves nothing else in the database touched.
 *
 * The three partners are deliberately in different states, because the screens are
 * mostly about *refusals* and a happy-path fixture would hide all of them:
 *
 *   - Lagos Talent Academy — the fully worked case. Evidence, signatories, a
 *     partner-wide grant, a narrower source-level grant that overrides it, an
 *     expired grant and a withdrawn one.
 *   - Kano Youth FC — no evidence at all, so the screen refuses to let anything be
 *     granted or acquired. This is the state an operator meets most often in real
 *     life and the one worth seeing.
 *   - Ibadan Schools League — analysis permitted, training not. Its footage is
 *     `research_only`, so the dataset factory will refuse it.
 *
 * **No source media or documents are uploaded.** The original-footage and evidence
 * rows point at keys that hold nothing, so document download will not resolve. That
 * is on purpose: `master` is write-once and delete-protected, and filling it with
 * fabricated partner agreements would leave objects nothing can cleanly remove.
 * Attach the real partner PDFs through the UI instead.
 *
 * **One exception, and it is deliberate.** A five-second synthetic clip IS uploaded,
 * as a proxy, because the annotation workstation is unusable without something to
 * play. It goes to `derived`, which is regenerable and neither write-once nor
 * delete-protected, so `--remove` takes it out again. It is a test pattern, not
 * football, and it is uploaded through a presigned PUT rather than
 * `putSmallObject` — that helper says "never video", and a demo is not a reason to
 * quietly cross a boundary this codebase enforces elsewhere.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { visionKeys } from "@dtp/vision-contracts";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { loadVisionConfig } from "../src/vision/config/vision.config";
import { InMemoryObjectStore } from "../src/vision/storage/in-memory-object-store";
import { R2ObjectStore } from "../src/vision/storage/r2-object-store";
import type { ObjectStore } from "../src/vision/storage/object-store";

loadApiEnv();

const prisma = new PrismaClient();

/** The only thing this script will delete. */
const MARKER = "(demo)";
/** An earlier hand-made fixture from building the screens, folded in so the UI is not confusing. */
const LEGACY_NAMES = ["Demo Partner FC"];

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const ahead = (days: number) => new Date(Date.now() + days * DAY);

/** A plausible 64-char digest, so the column looks like what the pipeline writes. */
const fakeChecksum = (seed: string) => createHash("sha256").update(seed).digest("hex");

async function removeDemoData(): Promise<number> {
  const partners = await prisma.visionSourcePartner.findMany({
    where: { OR: [{ name: { contains: MARKER } }, { name: { in: LEGACY_NAMES } }] },
    select: { id: true, name: true },
  });
  if (!partners.length) return 0;

  const ids = partners.map((p) => p.id);
  const assets = await prisma.visionVideoAsset.findMany({
    where: { sourceVideoRecord: { partnerId: { in: ids } } },
    select: { id: true },
  });
  const assetIds = assets.map((a) => a.id);

  // Annotation first: review rows hold a SetNull FK onto versions, so deleting the
  // versions alone would leave orphaned verdicts behind rather than removing them.
  const tasks = await prisma.visionAnnotationTask.findMany({
    where: { videoAssetId: { in: assetIds } },
    select: { id: true },
  });
  const taskIds = tasks.map((t) => t.id);
  const versions = await prisma.visionAnnotationVersion.findMany({
    where: { taskId: { in: taskIds } },
    select: { id: true, payloadKey: true },
  });

  // The objects this seed uploaded. `derived` is regenerable and not delete-protected,
  // which is exactly why the demo proxy went there rather than into `master`.
  const variants = await prisma.visionVideoVariant.findMany({
    where: { videoAssetId: { in: assetIds } },
    select: { objectKey: true },
  });
  const uploadedKeys = [
    ...variants.map((v) => v.objectKey),
    ...versions.map((v) => v.payloadKey),
  ];
  if (uploadedKeys.length) {
    const config = loadVisionConfig();
    const store: ObjectStore =
      config.storage.backend === "r2"
        ? new R2ObjectStore(config.storage)
        : new InMemoryObjectStore();
    for (const key of uploadedKeys) {
      // Already gone counts as removed: the point is that nothing is left behind.
      await store.delete("derived", key).catch(() => undefined);
    }
    console.log(`  removed  ${uploadedKeys.length} demo object(s) from derived storage`);
  }

  await prisma.visionReviewDecision.deleteMany({
    where: { annotationVersionId: { in: versions.map((v) => v.id) } },
  });
  await prisma.visionAnnotationVersion.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.visionActiveLearningItem.deleteMany({ where: { videoAssetId: { in: assetIds } } });
  await prisma.visionAnnotationTask.deleteMany({ where: { id: { in: taskIds } } });
  await prisma.visionLabelSchemaVersion.deleteMany({ where: { version: { contains: MARKER } } });

  // Ordered by dependency: members hold a Restrict FK onto assets, so they go first.
  await prisma.visionDatasetMember.deleteMany({ where: { videoAssetId: { in: assetIds } } });
  await prisma.visionDatasetVersion.deleteMany({ where: { label: { contains: MARKER } } });
  await prisma.visionVideoVariant.deleteMany({ where: { videoAssetId: { in: assetIds } } });
  await prisma.visionVideoAsset.deleteMany({ where: { id: { in: assetIds } } });
  // Scopes, evidence, signatories and records all cascade from the partner, but the
  // signatory <- record FK is SetNull, so records are cleared explicitly first.
  await prisma.visionSourceVideoRecord.deleteMany({ where: { partnerId: { in: ids } } });
  await prisma.visionSourcePartner.deleteMany({ where: { id: { in: ids } } });

  for (const p of partners) console.log(`  removed  ${p.name}`);
  return partners.length;
}

async function main() {
  const remove = process.argv.includes("--remove");

  console.log(remove ? "Removing Vision demo data" : "Seeding Vision demo data");
  const removed = await removeDemoData();
  if (!removed) console.log("  (nothing existing to remove)");

  if (remove) {
    console.log(`\nDone. ${removed} demo partner(s) removed.`);
    await prisma.$disconnect();
    return;
  }

  // Real fixtures, so the Fixture column and match linking are not empty. Whatever
  // the database actually has — this must not invent football.
  const matches = await prisma.sbMatch.findMany({
    select: { id: true, competitionId: true, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } },
    take: 4,
    orderBy: { kickoffAt: "desc" },
  });
  const fixture = (i: number) => matches[i] ?? null;
  const label = (i: number) => {
    const m = fixture(i);
    return m ? `${m.homeTeam?.name ?? "Home"} v ${m.awayTeam?.name ?? "Away"}` : `Demo fixture ${i + 1}`;
  };
  console.log(`  ${matches.length} real fixture(s) available to link`);

  // ── 1. The fully worked partner ───────────────────────────────────────────
  const lagos = await prisma.visionSourcePartner.create({
    data: {
      name: `Lagos Talent Academy ${MARKER}`,
      contactName: "Adebayo Okonkwo",
      contactEmail: "rights@lagos-talent.example",
      contactPhone: "+234 800 000 0001",
      notes: "Fully papered partner. Use this one to see the rights panel in its normal state.",
    },
  });

  const agreement = await prisma.visionRightsEvidence.create({
    data: {
      partnerId: lagos.id,
      kind: "contract",
      // Nothing is stored at this key — see the note at the top of this file.
      objectKey: visionKeys.rightsEvidence(lagos.id, randomUUID(), "pdf").key,
      documentDate: ago(120),
      notes: "Footage licence, 2026 season. Placeholder row: no PDF uploaded.",
    },
  });
  await prisma.visionRightsEvidence.create({
    data: {
      partnerId: lagos.id,
      kind: "consent_form",
      objectKey: visionKeys.rightsEvidence(lagos.id, randomUUID(), "pdf").key,
      documentDate: ago(118),
      notes: "Guardian consent pack for minors. Placeholder row: no PDF uploaded.",
    },
  });

  const manager = await prisma.visionPartnerAuthorizedSignatory.create({
    data: {
      partnerId: lagos.id,
      name: "Chidinma Eze",
      role: "Team Manager",
      contactEmail: "c.eze@lagos-talent.example",
      authorityEvidenceId: agreement.id,
      activeFrom: ago(120),
    },
  });
  await prisma.visionPartnerAuthorizedSignatory.create({
    data: {
      partnerId: lagos.id,
      name: "Emeka Nwosu",
      role: "Academy Director",
      contactEmail: "e.nwosu@lagos-talent.example",
      activeFrom: ago(400),
    },
  });

  // Partner-wide: analysis and training, but NOT publication or scout sharing.
  // The four scopes are independent, and this is what that looks like on screen.
  await prisma.visionRightsScope.create({
    data: {
      partnerId: lagos.id,
      grantLevel: "partner",
      canAnalyze: true,
      canTrain: true,
      canPublishHighlight: false,
      canShareWithScout: false,
      grantedAt: ago(120),
      expiresAt: ahead(240),
      evidenceId: agreement.id,
    },
  });

  const acquired = await prisma.visionSourceVideoRecord.create({
    data: {
      partnerId: lagos.id,
      title: `${label(0)} — full match`,
      sourceQualityRank: "original_master",
      originalAvailable: true,
      acquisitionStatus: "acquired",
      acquisitionMethod: "partner_direct_upload",
      acquisitionAuthorizedBySignatoryId: manager.id,
      acquisitionAuthorizedAt: ago(30),
      sbMatchId: fixture(0)?.id ?? null,
      sbCompetitionId: fixture(0)?.competitionId ?? null,
      durationSeconds: 5_400,
      notes: "Acquired copy. Two assets, so the Copies column shows more than one.",
    },
  });

  // Two copies of one fixture: the duplicate cluster the dataset splitter must keep
  // together. Cluster them so the grouping is visible if you build a dataset.
  const cluster = await prisma.visionDuplicateCluster.create({
    data: { method: "checksum", confidence: 1 },
  });

  for (const [i, part] of ["first-half", "second-half"].entries()) {
    await prisma.visionVideoAsset.create({
      data: {
        sourceVideoRecordId: acquired.id,
        sbMatchId: fixture(0)?.id ?? null,
        corpus: "dtp_owned",
        objectKey: `originals/demo-${acquired.id}-${part}/source.mp4`,
        bytes: BigInt(1_800_000_000 + i),
        mimeType: "video/mp4",
        checksumSha256: fakeChecksum(`${acquired.id}:${part}`),
        duplicateClusterId: cluster.id,
        container: "mp4",
        videoCodec: "h264",
        width: 1920,
        height: 1080,
        fpsNumerator: 25,
        fpsDenominator: 1,
        durationMs: 2_700_000,
        ingestState: "ready",
      },
    });
  }

  const authorized = await prisma.visionSourceVideoRecord.create({
    data: {
      partnerId: lagos.id,
      title: `${label(1)} — authorised, not yet uploaded`,
      sourceQualityRank: "authorized_export",
      originalAvailable: true,
      acquisitionStatus: "authorized",
      acquisitionMethod: "partner_authorized_export",
      acquisitionAuthorizedBySignatoryId: manager.id,
      acquisitionAuthorizedAt: ago(4),
      sbMatchId: fixture(1)?.id ?? null,
      sbCompetitionId: fixture(1)?.competitionId ?? null,
      durationSeconds: 5_100,
      notes: "Approved to acquire. Issue an upload link from this screen to test the partner flow.",
    },
  });

  // Source-level, and narrower than the partner grant: publication allowed for this
  // one match only. Most-specific-wins, so the screen should show Publish granted
  // here and nowhere else.
  await prisma.visionRightsScope.create({
    data: {
      sourceVideoRecordId: authorized.id,
      grantLevel: "source",
      canAnalyze: true,
      canTrain: true,
      canPublishHighlight: true,
      canShareWithScout: false,
      grantedAt: ago(4),
      evidenceId: agreement.id,
      restrictions: { demo: "Publication limited to this fixture and this season." },
    },
  });

  const catalogued = await prisma.visionSourceVideoRecord.create({
    data: {
      partnerId: lagos.id,
      title: `${label(2)} — catalogued only`,
      url: "https://www.youtube.com/watch?v=demo-catalogued",
      sourceQualityRank: "platform_copy",
      originalAvailable: false,
      acquisitionStatus: "catalogued",
      sbMatchId: fixture(2)?.id ?? null,
      sbCompetitionId: fixture(2)?.competitionId ?? null,
      durationSeconds: 600,
      notes: "Metadata only — no DTP copy, so it can never be trained on.",
    },
  });

  // An expired grant and a withdrawn one, so the Live grants table shows a row that
  // exists but no longer permits anything. A grant existing is not a grant allowing.
  await prisma.visionRightsScope.create({
    data: {
      sourceVideoRecordId: catalogued.id,
      grantLevel: "source",
      canAnalyze: true,
      canTrain: false,
      canPublishHighlight: false,
      canShareWithScout: false,
      grantedAt: ago(400),
      expiresAt: ago(35),
      evidenceId: agreement.id,
    },
  });
  await prisma.visionRightsScope.create({
    data: {
      sourceVideoRecordId: catalogued.id,
      grantLevel: "source",
      canAnalyze: true,
      canTrain: true,
      canPublishHighlight: true,
      canShareWithScout: true,
      grantedAt: ago(200),
      revokedAt: ago(20),
      revokedReason: "Demo: partner withdrew consent for this fixture.",
      evidenceId: agreement.id,
    },
  });

  // ── 2. The partner nothing can happen for ─────────────────────────────────
  const kano = await prisma.visionSourcePartner.create({
    data: {
      name: `Kano Youth FC ${MARKER}`,
      contactName: "Musa Ibrahim",
      contactEmail: "contact@kano-youth.example",
      notes: "No rights evidence on file. The screen should refuse to grant or acquire anything.",
    },
  });
  await prisma.visionSourceVideoRecord.create({
    data: {
      partnerId: kano.id,
      title: `${label(3)} — blocked, no evidence`,
      url: "https://www.youtube.com/watch?v=demo-blocked",
      sourceQualityRank: "platform_copy",
      acquisitionStatus: "catalogued",
      sbMatchId: fixture(3)?.id ?? null,
      sbCompetitionId: fixture(3)?.competitionId ?? null,
      durationSeconds: 480,
      notes: "Catalogued while the paperwork is chased. Acquisition is impossible until it lands.",
    },
  });

  // ── 3. Analysis yes, training no ──────────────────────────────────────────
  const ibadan = await prisma.visionSourcePartner.create({
    data: {
      name: `Ibadan Schools League ${MARKER}`,
      contactName: "Folake Adeyemi",
      contactEmail: "rights@ibadan-schools.example",
      notes: "Analysis permitted, training refused. Its footage is research_only.",
    },
  });
  const ibadanEvidence = await prisma.visionRightsEvidence.create({
    data: {
      partnerId: ibadan.id,
      kind: "competition_authorization",
      objectKey: visionKeys.rightsEvidence(ibadan.id, randomUUID(), "pdf").key,
      documentDate: ago(60),
      notes: "Competition authorisation, analysis only. Placeholder row: no PDF uploaded.",
    },
  });
  await prisma.visionRightsScope.create({
    data: {
      partnerId: ibadan.id,
      grantLevel: "partner",
      canAnalyze: true,
      canTrain: false,
      canPublishHighlight: false,
      canShareWithScout: false,
      grantedAt: ago(60),
      evidenceId: ibadanEvidence.id,
    },
  });
  const research = await prisma.visionSourceVideoRecord.create({
    data: {
      partnerId: ibadan.id,
      title: "Ibadan schools final — research only",
      sourceQualityRank: "authorized_export",
      originalAvailable: true,
      acquisitionStatus: "acquired",
      acquisitionMethod: "partner_authorized_export",
      durationSeconds: 4_800,
      notes: "Acquired, but training is not permitted. The dataset factory refuses it.",
    },
  });
  await prisma.visionVideoAsset.create({
    data: {
      sourceVideoRecordId: research.id,
      corpus: "research_only",
      objectKey: `originals/demo-${research.id}/source.mp4`,
      bytes: BigInt(1_200_000_000),
      mimeType: "video/mp4",
      checksumSha256: fakeChecksum(research.id),
      container: "mp4",
      videoCodec: "h264",
      width: 1280,
      height: 720,
      fpsNumerator: 25,
      fpsDenominator: 1,
      durationMs: 2_400_000,
      ingestState: "ready",
    },
  });

  // ── 4. Something to actually annotate ─────────────────────────────────────
  //
  // The workstation needs three things the rest of this seed does not provide: a
  // label schema, a proxy it can play, and tasks in different states so the queue,
  // the submit path and the review panel all have something to show.

  const store: ObjectStore = (() => {
    const config = loadVisionConfig();
    return config.storage.backend === "r2"
      ? new R2ObjectStore(config.storage)
      : new InMemoryObjectStore();
  })();

  const schema = await prisma.visionLabelSchemaVersion.create({
    data: {
      version: `demo-2026.1 ${MARKER}`,
      definitions: {
        player: "A box round every visible player, including partially occluded ones.",
        ball: "The ball, when you can actually see it. Mark uncertain rather than guessing.",
        pass: "A deliberate ball transfer between two players of the same side.",
        goalkeeper: "Tag the keeper separately — kit differs and the model needs the distinction.",
      },
      notes: "Demo taxonomy. Short on purpose; a real one is authored with coaches.",
      effectiveFrom: ago(30),
    },
  });

  // The first-half copy of the acquired fixture gets a playable proxy.
  const firstHalf = await prisma.visionVideoAsset.findFirstOrThrow({
    where: { sourceVideoRecordId: acquired.id },
    orderBy: { objectKey: "asc" },
    select: { id: true },
  });

  const clipPath = resolve(__dirname, "..", "test-media", "sample-720p.mp4");
  const clip = readFileSync(clipPath);
  const proxyKey = `proxies/demo-${firstHalf.id}/proxy.mp4`;

  // Presigned PUT, not putSmallObject: that helper is documented "never video".
  const uploadUrl = await store.presignPut("derived", proxyKey, 900, {
    contentType: "video/mp4",
  });
  const uploaded = await fetch(uploadUrl, {
    method: "PUT",
    body: new Uint8Array(clip),
    headers: { "Content-Type": "video/mp4" },
  });
  if (!uploaded.ok) {
    throw new Error(
      `Could not upload the demo proxy (${uploaded.status}). Object storage is configured as ` +
        `"${store.backendId}" — check the Vision credentials in services/api/.env.`
    );
  }

  const CLIP_MS = 5_000;
  /**
   * Five seconds, on purpose.
   *
   * The proxy starts five seconds into the "source", so the workstation's two clocks
   * read differently the moment it loads — which is the behaviour most worth seeing,
   * and the one a zero offset would hide.
   */
  const PROXY_OFFSET_MS = 5_000;

  await prisma.visionVideoVariant.create({
    data: {
      videoAssetId: firstHalf.id,
      kind: "proxy",
      objectKey: proxyKey,
      width: 1280,
      height: 720,
      fps: 25,
      durationMs: CLIP_MS,
      sourceOffsetMs: PROXY_OFFSET_MS,
      settingsHash: "demo-720p25",
      bytes: BigInt(clip.byteLength),
    },
  });

  /** Source-time window that maps onto the whole clip. */
  const WINDOW = { startMs: PROXY_OFFSET_MS, endMs: PROXY_OFFSET_MS + CLIP_MS };

  const task = async (over: Record<string, unknown> = {}) =>
    prisma.visionAnnotationTask.create({
      data: {
        videoAssetId: firstHalf.id,
        labelSchemaVersionId: schema.id,
        samplingStrategy: "low_confidence",
        startMs: WINDOW.startMs,
        endMs: WINDOW.endMs,
        state: "queued",
        ...over,
      },
    });

  /**
   * None of these use `targeted_event`, and none should.
   *
   * `vision:annotation-check` tags its own tasks with that strategy and filters every
   * claim on it, which is how the gate stays isolated from this data. Before that, a
   * gate run against a seeded database claimed three of these tasks, reassigned them
   * and rejected one. If this seed ever needs `targeted_event`, give the gate a
   * different strategy in the same change.
   */
  // Waiting, so "Claim next window" has something to hand out.
  await task({ samplingStrategy: "new_domain_slice" });
  await task({ samplingStrategy: "stage_disagreement" });
  // Pre-labelled, so the anchoring-bias warning is visible on the workstation.
  await task({
    samplingStrategy: "low_confidence",
    preLabelled: true,
    preLabelModelVersionId: null,
  });
  // A control-group task, so the hard-case share is not a meaningless 100%.
  await task({ samplingStrategy: "uniform_random", state: "approved" });

  // One already submitted, so the review panel and the attempt history have content.
  const submitted = await task({
    samplingStrategy: "reviewer_disagreement",
    state: "submitted",
    assignedTo: "demo-annotator",
  });

  const payload = {
    windowSourceStartMs: WINDOW.startMs,
    windowSourceEndMs: WINDOW.endMs,
    labelSchemaVersion: schema.version,
    uncertain: false,
    notes: "Demo submission. Two players clear, ball occluded from 00:02.",
  };
  const body = JSON.stringify(payload);
  const versionId = randomUUID();
  const payloadRef = visionKeys.annotationPayload(submitted.id, versionId);
  // JSON, so putSmallObject is exactly what it is for.
  await store.putSmallObject(payloadRef.bucket, payloadRef.key, body, "application/json");

  await prisma.visionAnnotationVersion.create({
    data: {
      id: versionId,
      taskId: submitted.id,
      payloadKey: payloadRef.key,
      payloadChecksum: createHash("sha256").update(body).digest("hex"),
      annotatorId: "demo-annotator",
      effortMinutes: 8.5,
    },
  });

  // Flagged windows, so the active-learning table is not empty. Highest score first
  // in the UI, so the numbers differ.
  for (const [reason, score] of [
    ["low_confidence", 0.94],
    ["stage_disagreement", 0.71],
    ["new_domain_slice", 0.55],
  ] as const) {
    await prisma.visionActiveLearningItem.create({
      data: {
        videoAssetId: firstHalf.id,
        startMs: WINDOW.startMs,
        endMs: WINDOW.endMs,
        reason,
        score,
        state: "queued",
      },
    });
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const counts = {
    partners: await prisma.visionSourcePartner.count({ where: { name: { contains: MARKER } } }),
    sources: await prisma.visionSourceVideoRecord.count({
      where: { partner: { name: { contains: MARKER } } },
    }),
    assets: await prisma.visionVideoAsset.count({
      where: { sourceVideoRecord: { partner: { name: { contains: MARKER } } } },
    }),
    grants: await prisma.visionRightsScope.count({
      where: {
        OR: [
          { partner: { name: { contains: MARKER } } },
          { sourceVideoRecord: { partner: { name: { contains: MARKER } } } },
        ],
      },
    }),
  };

  console.log("\nSeeded:");
  console.log(`  partners  ${counts.partners}`);
  console.log(`  sources   ${counts.sources}  (catalogued, authorized and acquired)`);
  console.log(`  assets    ${counts.assets}   (2 clustered as duplicates, 1 research_only)`);
  console.log(`  grants    ${counts.grants}   (incl. one expired and one withdrawn)`);
  console.log(`  schema    1   (${schema.version})`);
  console.log(
    `  tasks     ${await prisma.visionAnnotationTask.count({
      where: { labelSchemaVersionId: schema.id },
    })}   (queued, submitted and approved)`
  );
  console.log("  queue     3   (flagged windows awaiting a human)");
  console.log(
    `  proxy     ${(clip.byteLength / 1024).toFixed(0)} KiB synthetic clip in derived storage`
  );
  console.log("\nOpen  http://localhost:5173/admin/vision/sources");
  console.log("      http://localhost:5173/admin/vision/annotation");
  console.log("Remove with  pnpm --filter @dtp/api vision:seed-demo --remove");

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("\nSeed failed:", error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
