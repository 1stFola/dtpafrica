/**
 * Phase 2 Increment 1 gate — the dataset factory's two refusals.
 *
 *   pnpm --filter @dtp/api vision:datasetcheck
 *
 * Unit tests prove the logic; this proves the refusals survive the HTTP boundary,
 * the real database and the real object store. Two claims are on trial:
 *
 *   1. Footage DTP has no right to train on cannot enter a corpus.
 *   2. A dataset whose benchmark shares a match with its training set cannot be
 *      frozen.
 *
 * The leak in step 5 is created deliberately, by writing splits straight into the
 * database behind the service's back — because a checker that only ever sees states
 * its own generator produced has not been tested.
 */
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { loadVisionConfig } from "../src/vision/config/vision.config";
import { InMemoryObjectStore } from "../src/vision/storage/in-memory-object-store";
import { R2ObjectStore } from "../src/vision/storage/r2-object-store";
import type { ObjectStore } from "../src/vision/storage/object-store";

loadApiEnv();

const API = process.env.VISION_E2E_API ?? "http://localhost:3000/api/v1";
const prisma = new PrismaClient();
const RUN = randomUUID().slice(0, 8);

let checks = 0;
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(64)} ${
      ok ? String(actual) : `expected ${expected}, got ${actual}`
    }`
  );
}

function section(t: string) {
  console.log(`\n${t}\n${"-".repeat(t.length)}`);
}

function adminHeaders(): Record<string, string> {
  const key = process.env.ADMIN_API_KEY?.trim();
  if (!key) throw new Error("ADMIN_API_KEY is not set");
  return { "x-admin-api-key": key, "Content-Type": "application/json" };
}

/** Returns status and body together: the refusals are the subject, not exceptions. */
async function api(
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API}${path}`, { ...init, headers: adminHeaders() });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body };
}

// ── Fixtures ───────────────────────────────────────────────────────────────
//
// Built directly through Prisma rather than over the API. The catalogue path is
// already covered by vision:catalogcheck; what this gate needs is assets in
// precisely chosen states, including states the API will not produce.

type Fixture = { partnerId: string; recordId: string; assetIds: Record<string, string> };

async function seed(): Promise<Fixture> {
  const partner = await prisma.visionSourcePartner.create({
    data: { name: `Dataset gate ${RUN}`, contactEmail: "gate@example.test" },
  });

  const record = await prisma.visionSourceVideoRecord.create({
    data: {
      partnerId: partner.id,
      title: `Gate record ${RUN}`,
      sourceQualityRank: "broadcast",
      originalAvailable: true,
      acquisitionStatus: "acquired",
      acquisitionMethod: "partner_direct_upload",
    },
  });

  // A second record, authorised but never acquired.
  const unacquired = await prisma.visionSourceVideoRecord.create({
    data: {
      partnerId: partner.id,
      title: `Gate unacquired ${RUN}`,
      sourceQualityRank: "broadcast",
      acquisitionStatus: "authorized",
      acquisitionMethod: "partner_direct_upload",
    },
  });

  // canTrain at partner level. Note canPublishHighlight is false: the scopes are
  // independent, and a dataset must not be gated on the wrong one.
  await prisma.visionRightsScope.create({
    data: {
      partnerId: partner.id,
      grantLevel: "partner",
      canAnalyze: true,
      canTrain: true,
      canPublishHighlight: false,
      canShareWithScout: false,
      grantedAt: new Date(),
    },
  });

  const asset = async (
    slug: string,
    over: Record<string, unknown> = {}
  ): Promise<[string, string]> => {
    const row = await prisma.visionVideoAsset.create({
      data: {
        sourceVideoRecordId: record.id,
        corpus: "dtp_owned",
        objectKey: `originals/gate-${RUN}-${slug}/source.mp4`,
        bytes: BigInt(1024),
        mimeType: "video/mp4",
        checksumSha256: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64),
        width: 1280,
        height: 720,
        ingestState: "ready",
        ...over,
      },
    });
    return [slug, row.id];
  };

  const cluster = await prisma.visionDuplicateCluster.create({
    data: { method: "checksum", confidence: 1 },
  });

  const entries = await Promise.all([
    // Eligible, three distinct groups so the splits can spread.
    asset("ok-a"),
    asset("ok-b"),
    asset("ok-c"),
    // Two copies of one fixture: same cluster, so they must never split apart.
    asset("dup-1", { duplicateClusterId: cluster.id }),
    asset("dup-2", { duplicateClusterId: cluster.id }),
    // One refusal each.
    asset("research", { corpus: "research_only" }),
    asset("experimental", { corpus: "experimental" }),
    asset("unacquired", { sourceVideoRecordId: unacquired.id }),
    asset("nochecksum", { checksumSha256: "" }),
    asset("orphan", { sourceVideoRecordId: null }),
  ]);

  return {
    partnerId: partner.id,
    recordId: record.id,
    assetIds: Object.fromEntries(entries),
  };
}

async function cleanup(fx: Fixture | null) {
  if (!fx) return;
  const ids = Object.values(fx.assetIds);
  await prisma.visionDatasetMember.deleteMany({ where: { videoAssetId: { in: ids } } });
  await prisma.visionDatasetVersion.deleteMany({ where: { label: { startsWith: `gate-${RUN}` } } });
  await prisma.visionVideoAsset.deleteMany({ where: { id: { in: ids } } });
  await prisma.visionRightsScope.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourceVideoRecord.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourcePartner.deleteMany({ where: { id: fx.partnerId } });
}

async function main() {
  const config = loadVisionConfig();
  const store: ObjectStore =
    config.storage.backend === "r2" ? new R2ObjectStore(config.storage) : new InMemoryObjectStore();

  console.log("Vision dataset factory — eligibility and leakage");
  console.log(`  api ${API}`);
  console.log(`  object store ${store.backendId}`);

  let fx: Fixture | null = null;
  try {
    fx = await seed();
    const a = fx.assetIds;

    // ── 1. Versions ──────────────────────────────────────────────────────
    section("1. Dataset versions");

    const created = await api("/vision/datasets", {
      method: "POST",
      body: JSON.stringify({
        label: `gate-${RUN}-v1`,
        description: "Phase 2 Increment 1 gate",
        splitPolicy: { train: 60, val: 20, test: 20, gold: 0, seed: `gate-${RUN}` },
      }),
    });
    check("version created", created.status, 201);
    const versionId = String(created.body.id ?? "");
    check("version has an id", versionId.length > 0, true);

    const badPolicy = await api("/vision/datasets", {
      method: "POST",
      body: JSON.stringify({ label: `gate-${RUN}-bad`, splitPolicy: { groupBy: [] } }),
    });
    // Rejected by the DTO before the service sees it: assigning splits per member
    // is the leak the whole module exists to prevent.
    check("empty groupBy rejected", badPolicy.status, 400);

    const unknownGrouping = await api("/vision/datasets", {
      method: "POST",
      body: JSON.stringify({ label: `gate-${RUN}-bad2`, splitPolicy: { groupBy: ["stadium"] } }),
    });
    check("unknown grouping level rejected", unknownGrouping.status, 400);

    // ── 2. Eligibility ───────────────────────────────────────────────────
    section("2. Membership eligibility — the corpus firewall");

    const addAll = await api(`/vision/datasets/${versionId}/members`, {
      method: "POST",
      body: JSON.stringify({ videoAssetIds: Object.values(a) }),
    });
    check("members accepted", addAll.status, 201);

    const added = Number(addAll.body.added ?? -1);
    const rejected = (addAll.body.rejected ?? []) as { videoAssetId: string; reason: string }[];
    const reasonFor = (slug: string) =>
      rejected.find((r) => r.videoAssetId === a[slug])?.reason ?? "ADMITTED";

    check("five eligible assets admitted", added, 5);
    check("five refused", rejected.length, 5);
    check("research_only refused", reasonFor("research"), "wrong_corpus");
    check("experimental refused", reasonFor("experimental"), "wrong_corpus");
    check("never-acquired refused", reasonFor("unacquired"), "not_acquired");
    check("missing checksum refused", reasonFor("nochecksum"), "no_checksum");
    // No source record means no acquisition to point at, so there is nothing to
    // establish the footage was obtained legitimately.
    check("asset with no source record refused", reasonFor("orphan"), "not_acquired");
    check("eligible asset admitted", reasonFor("ok-a"), "ADMITTED");

    const again = await api(`/vision/datasets/${versionId}/members`, {
      method: "POST",
      body: JSON.stringify({ videoAssetIds: [a["ok-a"]!] }),
    });
    check(
      "re-adding an existing member refused",
      ((again.body.rejected ?? []) as { reason: string }[])[0]?.reason,
      "already_member"
    );

    const revoked = await api("/vision/datasets", {
      method: "POST",
      body: JSON.stringify({ label: `gate-${RUN}-v2` }),
    });
    const v2 = String(revoked.body.id ?? "");

    // Withdraw the training right, then try to add the same asset that just
    // qualified. Nothing about the asset changed.
    await prisma.visionRightsScope.updateMany({
      where: { partnerId: fx.partnerId },
      data: { revokedAt: new Date(), revokedReason: "gate: withdrawal test" },
    });
    const afterRevoke = await api(`/vision/datasets/${v2}/members`, {
      method: "POST",
      body: JSON.stringify({ videoAssetIds: [a["ok-a"]!] }),
    });
    check(
      "asset refused once canTrain is withdrawn",
      ((afterRevoke.body.rejected ?? []) as { reason: string }[])[0]?.reason,
      "rights_denied"
    );

    await prisma.visionRightsScope.updateMany({
      where: { partnerId: fx.partnerId },
      data: { revokedAt: null, revokedReason: null },
    });

    // ── 3. Freeze refuses before splits exist ────────────────────────────
    section("3. Freeze requires splits to have been generated");

    const prematureFreeze = await api(`/vision/datasets/${versionId}/freeze`, { method: "POST" });
    // Without this the version is 100% train: one split, so the leakage check
    // passes trivially and the corpus has no test set while looking validated.
    check("freeze before splits refused", prematureFreeze.status, 409);
    check("refusal names the cause", prematureFreeze.body.error, "SplitsNotGenerated");

    // ── 4. Split generation ──────────────────────────────────────────────
    section("4. Split generation groups before it assigns");

    const split = await api(`/vision/datasets/${versionId}/splits`, { method: "POST" });
    check("splits generated", split.status, 201);
    check("groups below members (the duplicates merged)", Number(split.body.groups) < 5, true);
    check("generated splits do not leak", (split.body.leakage as { ok: boolean }).ok, true);

    const dupMembers = await prisma.visionDatasetMember.findMany({
      where: { datasetVersionId: versionId, videoAssetId: { in: [a["dup-1"]!, a["dup-2"]!] } },
      select: { split: true, groupKey: true },
    });
    check("both copies of the fixture found", dupMembers.length, 2);
    // The claim that matters: the same football in two files cannot end up on
    // opposite sides of a benchmark.
    check("duplicate cluster shares one group", new Set(dupMembers.map((m) => m.groupKey)).size, 1);
    check("duplicate cluster shares one split", new Set(dupMembers.map((m) => m.split)).size, 1);

    const rerun = await api(`/vision/datasets/${versionId}/splits`, { method: "POST" });
    const firstAssignment = await prisma.visionDatasetMember.findMany({
      where: { datasetVersionId: versionId },
      select: { videoAssetId: true, split: true },
      orderBy: { videoAssetId: "asc" },
    });
    check("re-running split generation succeeds", rerun.status, 201);
    await api(`/vision/datasets/${versionId}/splits`, { method: "POST" });
    const secondAssignment = await prisma.visionDatasetMember.findMany({
      where: { datasetVersionId: versionId },
      select: { videoAssetId: true, split: true },
      orderBy: { videoAssetId: "asc" },
    });
    // Reproducibility: without it, two machines building "v1" disagree on what v1 is.
    check(
      "split assignment is deterministic across runs",
      JSON.stringify(firstAssignment) === JSON.stringify(secondAssignment),
      true
    );

    // ── 5. The leak, created behind the service's back ───────────────────
    section("5. Leakage blocks the freeze");

    const [dupA, dupB] = await prisma.visionDatasetMember.findMany({
      where: { datasetVersionId: versionId, videoAssetId: { in: [a["dup-1"]!, a["dup-2"]!] } },
      select: { id: true, split: true },
    });
    // Straight into the database, bypassing the generator entirely — a checker that
    // only ever sees states its own generator produced has not been tested.
    await prisma.visionDatasetMember.update({
      where: { id: dupB!.id },
      data: { split: dupA!.split === "train" ? "test" : "train" },
    });

    const leak = await api(`/vision/datasets/${versionId}/leakage`);
    check("leakage detected", (leak.body as { ok: boolean }).ok, false);
    check(
      "the offending group is named",
      ((leak.body.offendingGroups ?? []) as unknown[]).length,
      1
    );

    const leakyFreeze = await api(`/vision/datasets/${versionId}/freeze`, { method: "POST" });
    check("freeze refused while leaking", leakyFreeze.status, 409);
    check("refusal names the cause", leakyFreeze.body.error, "LeakageDetected");

    const stillOpen = await prisma.visionDatasetVersion.findUnique({ where: { id: versionId } });
    check("the version was not frozen anyway", stillOpen?.frozenAt, null);

    // Regenerating is the documented remedy, so it must actually work.
    const repaired = await api(`/vision/datasets/${versionId}/splits`, { method: "POST" });
    check("regenerating splits repairs the leak", (repaired.body.leakage as { ok: boolean }).ok, true);

    // ── 6. Freeze ────────────────────────────────────────────────────────
    section("6. Freeze, and what it writes");

    const representation = await api(`/vision/datasets/${versionId}/representation`);
    check("representation reports every member", Number(representation.body.members), 5);
    check(
      "representation slices by source quality",
      Object.keys((representation.body.bySourceQuality ?? {}) as object).length > 0,
      true
    );

    const frozen = await api(`/vision/datasets/${versionId}/freeze`, { method: "POST" });
    check("freeze succeeded", frozen.status, 201);
    const manifestKey = String(frozen.body.manifestKey ?? "");
    check("a manifest key was recorded", manifestKey.includes(versionId), true);

    const raw = await store.getSmallObject("derived", manifestKey);
    check("the manifest exists in the object store", raw !== null, true);
    const manifest = JSON.parse((raw ?? Buffer.from("{}")).toString("utf8")) as {
      members?: { checksumSha256: string }[];
      leakage?: { ok: boolean };
    };
    // The manifest must stand alone: what a model was trained on, answerable from
    // storage without the database.
    check("the manifest lists every member", manifest.members?.length, 5);
    check(
      "every member carries a real checksum",
      manifest.members?.every((m) => m.checksumSha256.length === 64),
      true
    );
    check("the manifest records the leakage verdict", manifest.leakage?.ok, true);

    // ── 7. Immutability ──────────────────────────────────────────────────
    section("7. A frozen version is immutable");

    const addAfterFreeze = await api(`/vision/datasets/${versionId}/members`, {
      method: "POST",
      body: JSON.stringify({ videoAssetIds: [a["ok-b"]!] }),
    });
    check("adding members after freeze refused", addAfterFreeze.status, 409);

    const splitAfterFreeze = await api(`/vision/datasets/${versionId}/splits`, { method: "POST" });
    check("re-splitting after freeze refused", splitAfterFreeze.status, 409);

    const refreeze = await api(`/vision/datasets/${versionId}/freeze`, { method: "POST" });
    check("freezing twice refused", refreeze.status, 409);

    // ── 8. Revocation reaches frozen history ─────────────────────────────
    // ── 8. The gold benchmark ────────────────────────────────────────────
    section("8. The gold benchmark: two reviewers, and never trained on");

    /* A gold-only policy, so every member of this version lands in gold. The
       main fixture above is 5 members on the default policy, where gold rounds
       to nothing and both gates would pass without ever being exercised. */
    const goldVersion = await api("/vision/datasets", {
      method: "POST",
      body: JSON.stringify({
        label: `gold benchmark ${RUN}`,
        splitPolicy: { train: 0, val: 0, test: 0, gold: 100, seed: `gold-${RUN}` },
      }),
    });
    check("a gold-only version was created", goldVersion.status, 201);
    const goldId = String(goldVersion.body.id ?? "");

    const goldAsset = fx.assetIds["ok-a"]!;
    await api(`/vision/datasets/${goldId}/members`, {
      method: "POST",
      body: JSON.stringify({ videoAssetIds: [goldAsset] }),
    });
    await api(`/vision/datasets/${goldId}/splits`, { method: "POST" });

    const beforeReviews = await api(`/vision/datasets/${goldId}/gold`);
    check("the gold member is visible", Number(beforeReviews.body.goldMembers), 1);
    check("and is not yet double-reviewed", Number(beforeReviews.body.doubleReviewed), 0);
    check("so the version says it cannot freeze", beforeReviews.body.canFreeze, false);

    const refused = await api(`/vision/datasets/${goldId}/freeze`, { method: "POST" });
    check("freezing a singly-reviewed gold set is refused", refused.status, 409);
    check("and names the reason", refused.body.error, "GoldNotDoubleReviewed");

    /* The reviews are created through Prisma rather than the API because an
       api-key caller carries no user id, and two unattributed verdicts are
       exactly what this gate has to refuse to accept as two reviewers. */
    const schema = await prisma.visionLabelSchemaVersion.create({
      data: {
        version: `gate-gold-${RUN}`,
        definitions: { ball: {} } as Prisma.InputJsonValue,
        effectiveFrom: new Date(),
      },
    });
    const task = await prisma.visionAnnotationTask.create({
      data: {
        videoAssetId: goldAsset,
        labelSchemaVersionId: schema.id,
        samplingStrategy: "business_value",
        startMs: 0,
        endMs: 1000,
        state: "submitted",
      },
    });
    const annotation = await prisma.visionAnnotationVersion.create({
      data: {
        taskId: task.id,
        payloadKey: `annotations/${task.id}/gate.json`,
        payloadChecksum: "0".repeat(64),
        annotatorId: `gate-annotator-${RUN}`,
      },
    });

    // One reviewer twice: still one opinion, recorded twice.
    for (let i = 0; i < 2; i += 1) {
      await prisma.visionReviewDecision.create({
        data: {
          annotationVersionId: annotation.id,
          targetKind: "vision_annotation_version",
          targetId: annotation.id,
          decision: "approved",
          reviewerId: `gate-reviewer-one-${RUN}`,
        },
      });
    }
    const sameTwice = await api(`/vision/datasets/${goldId}/gold`);
    check("the same reviewer twice is still one reviewer", Number(sameTwice.body.doubleReviewed), 0);

    await prisma.visionReviewDecision.create({
      data: {
        annotationVersionId: annotation.id,
        targetKind: "vision_annotation_version",
        targetId: annotation.id,
        decision: "rejected",
        reviewerId: `gate-reviewer-two-${RUN}`,
      },
    });

    const ready = await api(`/vision/datasets/${goldId}/gold`);
    check("a second person clears the bar", Number(ready.body.doubleReviewed), 1);
    // They disagreed, and that is the number the benchmark has to carry.
    check("their disagreement is measured", Number(ready.body.disagreementRate), 1);
    check("the version can now freeze", ready.body.canFreeze, true);

    const goldFrozen = await api(`/vision/datasets/${goldId}/freeze`, { method: "POST" });
    check("the gold set freezes", goldFrozen.status, 201);
    const stored = await prisma.visionDatasetVersion.findUnique({
      where: { id: goldId },
      select: { representationReport: true },
    });
    const report = (stored?.representationReport ?? {}) as { gold?: { disagreementRate?: number } };
    check("the disagreement is recorded on the frozen version", report.gold?.disagreementRate, 1);

    // ── 9. Gold is never trained on ─────────────────────────────────────
    section("9. A later version may not train on frozen gold");

    const trainOnGold = await api("/vision/datasets", {
      method: "POST",
      body: JSON.stringify({
        label: `trains on gold ${RUN}`,
        splitPolicy: { train: 100, val: 0, test: 0, gold: 0, seed: `t-${RUN}` },
      }),
    });
    const trainId = String(trainOnGold.body.id ?? "");
    await api(`/vision/datasets/${trainId}/members`, {
      method: "POST",
      body: JSON.stringify({ videoAssetIds: [goldAsset] }),
    });
    await api(`/vision/datasets/${trainId}/splits`, { method: "POST" });

    const contaminated = await api(`/vision/datasets/${trainId}/freeze`, { method: "POST" });
    /* The failure this prevents is silent: every number taken against the frozen
       benchmark would become a measure of the model's memory, not its ability. */
    check("training on frozen gold is refused", contaminated.status, 409);
    check("and names the reason", contaminated.body.error, "GoldContamination");
    const hits = (contaminated.body.members ?? []) as { heldOutBy?: string }[];
    check("it names the version holding it out", hits[0]?.heldOutBy, `gold benchmark ${RUN}`);

    section("10. Revoking a training right reaches the frozen dataset");

    const memberCountBefore = await prisma.visionDatasetMember.count({
      where: { datasetVersionId: versionId },
    });
    const beforeRevoke = await prisma.visionDatasetVersion.findUnique({
      where: { id: versionId },
      select: { containsRevokedMembers: true, frozenAt: true },
    });
    check("frozen version starts unflagged", beforeRevoke?.containsRevokedMembers, false);

    // Through the real endpoint, not by writing the flag directly: the gap this
    // closes was that revoking a grant never touched the datasets at all.
    const scope = await prisma.visionRightsScope.findFirst({
      where: { partnerId: fx.partnerId },
      select: { id: true },
    });
    const revocation = await api(`/vision/rights/scopes/${scope!.id}/revoke`, {
      method: "POST",
      body: JSON.stringify({ reason: "gate: partner agreement ended" }),
    });
    check("revocation accepted", revocation.status, 201);
    check(
      "the response names the affected dataset",
      ((revocation.body.affectedDatasetVersions ?? []) as string[]).includes(versionId),
      true
    );

    const flaggedVersion = await prisma.visionDatasetVersion.findUnique({
      where: { id: versionId },
      select: { containsRevokedMembers: true, frozenAt: true },
    });
    check("the frozen version is now flagged", flaggedVersion?.containsRevokedMembers, true);
    // The flag blocks new training runs; deleting the rows to look clean would leave
    // DTP unable to answer which datasets were affected, which is the question that
    // actually gets asked.
    check(
      "frozen membership is left intact",
      await prisma.visionDatasetMember.count({ where: { datasetVersionId: versionId } }),
      memberCountBefore
    );
    check("the frozen timestamp survives", flaggedVersion?.frozenAt !== null, true);
    check(
      "the freeze itself was not rolled back",
      flaggedVersion?.frozenAt?.toISOString(),
      beforeRevoke?.frozenAt?.toISOString()
    );

    // ── 9. Audit ─────────────────────────────────────────────────────────
    section("11. The audit trail");

    const entries = await prisma.visionAuditLog.findMany({
      where: { targetKind: "vision_dataset_version", targetId: { in: [versionId, v2] } },
      select: { action: true, data: true },
    });
    const actions = new Set(entries.map((e) => e.action));
    check("version creation audited", actions.has("dataset.version.created"), true);
    check("membership audited", actions.has("dataset.member.added"), true);
    check("split generation audited", actions.has("dataset.split.generated"), true);
    check("freeze audited", actions.has("dataset.frozen"), true);

    const memberEntry = entries.find(
      (e) => e.action === "dataset.member.added" && (e.data as { rejected?: number })?.rejected
    );
    // The refusals are the audit value: the record that footage was offered to a
    // corpus and declined, and why.
    check(
      "the refusals are recorded, not just the count",
      Array.isArray((memberEntry?.data as { rejections?: unknown[] })?.rejections),
      true
    );
  } finally {
    await cleanup(fx);
  }

  section(`Result: ${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    console.log(`\n${failures} check(s) failed.`);
    process.exitCode = 1;
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("\nGate aborted:", error instanceof Error ? error.message : error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
