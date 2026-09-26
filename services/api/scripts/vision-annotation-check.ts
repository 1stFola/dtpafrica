/**
 * Phase 2 Increment 2 gate — annotation.
 *
 *   pnpm --filter @dtp/api vision:annotationcheck
 *
 * Four claims on trial, each about something that cannot be undone afterwards:
 *
 *   1. A correction is never lost. A resubmission supersedes; both payloads survive.
 *   2. An unattributable verdict is recorded as one. Self-review refusal itself is
 *      covered by unit tests, not here: this gate authenticates with an API key,
 *      which is a shared full-access operator credential carrying no user id, so
 *      there is no "self" for the check to compare against over HTTP.
 *   3. An annotator is handed a proxy, never the master.
 *   4. Two annotators working at once never get the same window.
 *
 * Claim 4 is fired as two genuinely concurrent HTTP requests against real Postgres,
 * because `FOR UPDATE SKIP LOCKED` cannot be demonstrated by a sequential test — a
 * broken read-then-update passes that every time.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";

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
    `  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(62)} ${
      ok ? String(actual) : `expected ${expected}, got ${actual}`
    }`
  );
}

function section(t: string) {
  console.log(`\n${t}\n${"-".repeat(t.length)}`);
}

function headers(): Record<string, string> {
  const key = process.env.ADMIN_API_KEY?.trim();
  if (!key) throw new Error("ADMIN_API_KEY is not set");
  return { "x-admin-api-key": key, "Content-Type": "application/json" };
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, { ...init, headers: headers() });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body };
}

type Fixture = { partnerId: string; recordId: string; assetIds: Record<string, string> };

/**
 * Built through Prisma: the gate needs an asset that genuinely has a proxy variant
 * and one that genuinely does not, and the API offers no route to manufacture either.
 */
async function seed(): Promise<Fixture> {
  const partner = await prisma.visionSourcePartner.create({
    data: { name: `Annotation gate ${RUN}`, contactEmail: "gate@example.test" },
  });
  const record = await prisma.visionSourceVideoRecord.create({
    data: {
      partnerId: partner.id,
      title: `Annotation gate record ${RUN}`,
      sourceQualityRank: "broadcast",
      acquisitionStatus: "acquired",
      acquisitionMethod: "partner_direct_upload",
    },
  });
  await prisma.visionRightsScope.create({
    data: {
      partnerId: partner.id,
      grantLevel: "partner",
      canAnalyze: true,
      canTrain: true,
      grantedAt: new Date(),
    },
  });

  const asset = async (slug: string, withProxy: boolean, over: Record<string, unknown> = {}) => {
    const row = await prisma.visionVideoAsset.create({
      data: {
        sourceVideoRecordId: record.id,
        corpus: "dtp_owned",
        objectKey: `originals/anngate-${RUN}-${slug}/source.mp4`,
        bytes: BigInt(1024),
        mimeType: "video/mp4",
        checksumSha256: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64),
        width: 1280,
        height: 720,
        durationMs: 600_000,
        ingestState: "ready",
        ...over,
      },
    });
    if (withProxy) {
      await prisma.visionVideoVariant.create({
        data: {
          videoAssetId: row.id,
          kind: "proxy",
          objectKey: `proxies/anngate-${RUN}-${slug}/proxy.mp4`,
          width: 1280,
          height: 720,
          fps: 25,
          durationMs: 600_000,
          // Non-zero on purpose: a proxy that does not start at source zero is what
          // puts every label a few seconds out if the offset is ignored.
          sourceOffsetMs: 5_000,
          settingsHash: "gate",
        },
      });
    }
    return [slug, row.id] as [string, string];
  };

  const entries = await Promise.all([
    asset("ok-a", true),
    asset("ok-b", true),
    asset("no-proxy", false),
  ]);
  return { partnerId: partner.id, recordId: record.id, assetIds: Object.fromEntries(entries) };
}

async function cleanup(fx: Fixture | null) {
  if (!fx) return;
  const ids = Object.values(fx.assetIds);
  const tasks = await prisma.visionAnnotationTask.findMany({
    where: { videoAssetId: { in: ids } },
    select: { id: true },
  });
  const taskIds = tasks.map((t) => t.id);
  const versions = await prisma.visionAnnotationVersion.findMany({
    where: { taskId: { in: taskIds } },
    select: { id: true },
  });

  await prisma.visionReviewDecision.deleteMany({
    where: { annotationVersionId: { in: versions.map((v) => v.id) } },
  });
  // supersedesId is a self-relation with SetNull, so the chain unlinks on delete.
  await prisma.visionAnnotationVersion.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.visionActiveLearningItem.deleteMany({ where: { videoAssetId: { in: ids } } });
  await prisma.visionAnnotationTask.deleteMany({ where: { id: { in: taskIds } } });
  await prisma.visionLabelSchemaVersion.deleteMany({ where: { version: { startsWith: `gate-${RUN}` } } });
  await prisma.visionVideoVariant.deleteMany({ where: { videoAssetId: { in: ids } } });
  await prisma.visionVideoAsset.deleteMany({ where: { id: { in: ids } } });
  await prisma.visionRightsScope.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourceVideoRecord.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourcePartner.deleteMany({ where: { id: fx.partnerId } });
}

async function main() {
  console.log("Vision annotation — corrections, review and the claim race");
  console.log(`  api ${API}`);

  let fx: Fixture | null = null;
  try {
    fx = await seed();
    const a = fx.assetIds;

    // ── 1. Label schema ──────────────────────────────────────────────────
    section("1. Label schema versions");

    const schema = await api("/vision/annotation/schemas", {
      method: "POST",
      body: JSON.stringify({
        version: `gate-${RUN}-v1`,
        definitions: { player: { box: true }, ball: { box: true }, pass: { event: true } },
        notes: "Gate schema",
      }),
    });
    check("schema published", schema.status, 201);
    const schemaId = String(schema.body.id ?? "");

    const duplicate = await api("/vision/annotation/schemas", {
      method: "POST",
      body: JSON.stringify({ version: `gate-${RUN}-v1`, definitions: { player: {} } }),
    });
    // Editing what a version means would change what every existing label meant.
    check("reusing a version number refused", duplicate.status, 409);

    const empty = await api("/vision/annotation/schemas", {
      method: "POST",
      body: JSON.stringify({ version: `gate-${RUN}-empty`, definitions: {} }),
    });
    check("empty taxonomy refused", empty.status, 400);

    // ── 2. Task creation ─────────────────────────────────────────────────
    section("2. Task creation, and what it refuses");

    /**
     * Every task this gate creates carries `targeted_event`, and every claim filters
     * on it.
     *
     * Without that, the gate is not isolated from whatever else is in the database:
     * the claim endpoint hands out the oldest queued task, so a run against a seeded
     * database claimed three of the **demo** tasks, reassigned them to gate
     * annotators and rejected one — then cleaned up only its own rows and left the
     * wreckage. It also made the "empty queue" assertion depend on nobody else having
     * queued work, which is why a second run passed where the first had failed.
     *
     * `targeted_event` is the strategy `vision:seed-demo` deliberately does not use.
     */
    const GATE_STRATEGY = "targeted_event";

    const mk = (assetId: string, over: Record<string, unknown> = {}) =>
      api("/vision/annotation/tasks", {
        method: "POST",
        body: JSON.stringify({
          videoAssetId: assetId,
          labelSchemaVersionId: schemaId,
          samplingStrategy: GATE_STRATEGY,
          startMs: 60_000,
          endMs: 120_000,
          ...over,
        }),
      });

    const taskA = await mk(a["ok-a"]!);
    check("task created", taskA.status, 201);
    check("sampling strategy recorded", taskA.body.samplingStrategy, GATE_STRATEGY);
    check("not marked pre-labelled without a model", taskA.body.preLabelled, false);

    const noProxy = await mk(a["no-proxy"]!);
    // An annotator has no route to the master by design, so this would be work
    // nobody can open.
    check("asset with no proxy refused", noProxy.status, 409);
    check("refusal names the cause", noProxy.body.error, "NoProxyAvailable");

    const backwards = await mk(a["ok-a"]!, { startMs: 120_000, endMs: 60_000 });
    check("window ending before it starts refused", backwards.status, 400);

    const tooLong = await mk(a["ok-a"]!, { startMs: 0, endMs: 11 * 60 * 1000 });
    check("window over ten minutes refused", tooLong.status, 400);

    const pastEnd = await mk(a["ok-a"]!, { startMs: 0, endMs: 900_000 });
    check("window past the end of the footage refused", pastEnd.status, 400);

    const badStrategy = await mk(a["ok-a"]!, { samplingStrategy: "because_i_felt_like_it" });
    check("unknown sampling strategy refused", badStrategy.status, 400);

    // Withdraw canAnalyze and try again. Nothing about the asset changed.
    await prisma.visionRightsScope.updateMany({
      where: { partnerId: fx.partnerId },
      data: { revokedAt: new Date(), revokedReason: "gate: analysis withdrawn" },
    });
    const denied = await mk(a["ok-a"]!);
    check("footage that may not be analysed refused", denied.status, 403);
    check("refusal names rights", denied.body.error, "RightsDenied");
    await prisma.visionRightsScope.updateMany({
      where: { partnerId: fx.partnerId },
      data: { revokedAt: null, revokedReason: null },
    });

    // ── 3. The claim race ────────────────────────────────────────────────
    section("3. Two annotators claiming at the same instant");

    const taskB = await mk(a["ok-b"]!);
    check("a second task exists to race for", taskB.status, 201);

    // Genuinely concurrent, against real Postgres. A read-then-update would pass a
    // sequential version of this test every single time.
    const [claim1, claim2] = await Promise.all([
      api("/vision/annotation/tasks/claim", {
        method: "POST",
        body: JSON.stringify({ annotatorId: `gate-ann-1-${RUN}`, samplingStrategy: GATE_STRATEGY }),
      }),
      api("/vision/annotation/tasks/claim", {
        method: "POST",
        body: JSON.stringify({ annotatorId: `gate-ann-2-${RUN}`, samplingStrategy: GATE_STRATEGY }),
      }),
    ]);
    check("first claim succeeded", claim1.status, 201);
    check("second claim succeeded", claim2.status, 201);

    const id1 = (claim1.body.task as { id?: string } | null)?.id ?? null;
    const id2 = (claim2.body.task as { id?: string } | null)?.id ?? null;
    check("both annotators got work", Boolean(id1 && id2), true);
    // The assertion this section exists for.
    check("they were given different windows", id1 !== id2, true);

    const claimedTask = claim1.body.task as { id: string; assignedTo: string; state: string };
    check("the claim assigned the task", claimedTask.state, "assigned");

    const media = claim1.body.media as { url: string; windowStartMs: number };
    check("a media URL was issued", typeof media?.url === "string", true);
    // The security-relevant one: the annotator gets the proxy, never the master.
    check("the URL points at a proxy", media.url.includes("proxies/"), true);
    check("the URL does not point at an original", media.url.includes("originals/"), false);
    // 60000 - 5000: the proxy starts 5s into the source, so proxy time differs.
    check("the window is translated into proxy time", media.windowStartMs, 55_000);

    const empty2 = await api("/vision/annotation/tasks/claim", {
      method: "POST",
      body: JSON.stringify({ annotatorId: `gate-ann-3-${RUN}`, samplingStrategy: GATE_STRATEGY }),
    });
    check("an empty queue returns no task rather than erroring", empty2.status, 201);
    check("and hands out nothing", (empty2.body.task as unknown) === null, true);

    // ── 4. Submission supersedes ─────────────────────────────────────────
    section("4. A correction is never lost");

    const claimedId = claimedTask.id;
    const annotator = claimedTask.assignedTo;

    const first = await api(`/vision/annotation/tasks/${claimedId}/submit`, {
      method: "POST",
      body: JSON.stringify({
        payload: { attempt: 1, boxes: [{ x: 1, y: 2 }] },
        effortMinutes: 12,
        annotatorId: annotator,
      }),
    });
    check("first submission accepted", first.status, 201);
    const firstId = String(first.body.id ?? "");
    check("effort recorded", first.body.effortMinutes, 12);

    const second = await api(`/vision/annotation/tasks/${claimedId}/submit`, {
      method: "POST",
      body: JSON.stringify({
        payload: { attempt: 2, boxes: [{ x: 3, y: 4 }] },
        effortMinutes: 7,
        annotatorId: annotator,
      }),
    });
    check("second submission accepted", second.status, 201);
    check("it supersedes the first", second.body.supersedesId, firstId);

    // The claim of this whole increment: the earlier attempt still exists, with its
    // labels intact. The correction is the training signal.
    const readFirst = await api(`/vision/annotation/versions/${firstId}`);
    check("the first submission still exists", readFirst.status, 200);
    check(
      "and its labels are unchanged",
      (readFirst.body.payload as { attempt?: number })?.attempt,
      1
    );
    const readSecond = await api(`/vision/annotation/versions/${String(second.body.id)}`);
    check("the second has its own labels", (readSecond.body.payload as { attempt?: number })?.attempt, 2);

    // Corrupt the stored bytes and confirm the checksum catches it.
    await prisma.visionAnnotationVersion.update({
      where: { id: firstId },
      data: { payloadChecksum: "0".repeat(64) },
    });
    const tampered = await api(`/vision/annotation/versions/${firstId}`);
    check("labels failing their checksum are refused", tampered.status, 409);
    check("refusal names the cause", tampered.body.error, "PayloadChecksumMismatch");

    const foreign = await api(`/vision/annotation/tasks/${claimedId}/submit`, {
      method: "POST",
      body: JSON.stringify({ payload: {}, annotatorId: `someone-else-${RUN}` }),
    });
    check("a submission from the wrong annotator refused", foreign.status, 403);

    // ── 5. Review ────────────────────────────────────────────────────────
    section("5. Review, and separation of duty");

    const secondId = String(second.body.id);

    const noReason = await api(`/vision/annotation/versions/${secondId}/review`, {
      method: "POST",
      body: JSON.stringify({ decision: "rejected" }),
    });
    check("rejection without a structured reason refused", noReason.status, 400);

    const badReason = await api(`/vision/annotation/versions/${secondId}/review`, {
      method: "POST",
      body: JSON.stringify({ decision: "rejected", rejectionReason: "i_didnt_like_it" }),
    });
    check("an unrecognised rejection reason refused", badReason.status, 400);

    const queueBefore = await api("/vision/annotation/queue?limit=200");
    const countBefore = ((queueBefore.body.items ?? []) as unknown[]).length;

    const rejected = await api(`/vision/annotation/versions/${secondId}/review`, {
      method: "POST",
      body: JSON.stringify({ decision: "rejected", rejectionReason: "wrong_identity", notes: "gate" }),
    });
    check("rejection with a reason accepted", rejected.status, 201);

    const queueAfter = await api("/vision/annotation/queue?limit=200");
    // A rejection is a signal about the footage, not just about the annotator.
    check(
      "the rejected window came back to the queue",
      ((queueAfter.body.items ?? []) as unknown[]).length,
      countBefore + 1
    );

    // The weakness made visible: an api-key verdict has no human behind it, so the
    // second-pair-of-eyes control could not have applied, and the audit row says so.
    const reviewAudit = await prisma.visionAuditLog.findFirst({
      where: { action: "annotation.reviewed", targetId: secondId },
      orderBy: { createdAt: "desc" },
      select: { data: true, actorId: true, actorMethod: true },
    });
    check("the verdict was audited", Boolean(reviewAudit), true);
    check(
      "an api-key verdict is flagged as unattributable",
      (reviewAudit?.data as { unattributed?: boolean })?.unattributed,
      true
    );
    check("and the auth method is recorded", reviewAudit?.actorMethod, "api_key");
    check("with no user behind it", reviewAudit?.actorId, null);

    const taskAfterReject = await api(`/vision/annotation/tasks/${claimedId}`);
    check(
      "the task went back for another pass, not to approved",
      (taskAfterReject.body.task as { state: string }).state,
      "rejected"
    );

    // ── 6. Mix report ────────────────────────────────────────────────────
    section("6. The mix report");

    const mix = await api("/vision/annotation/mix");
    check("mix report served", mix.status, 200);
    check("it counts tasks", typeof mix.body.tasks === "number", true);
    // The number the module exists to keep honest.
    check("it reports a hard-case share", typeof mix.body.hardCaseShare === "number", true);
    check(
      "it reports average correction time",
      typeof (mix.body.effort as { averageMinutes?: unknown })?.averageMinutes !== "undefined",
      true
    );

    // ── 7. Audit ─────────────────────────────────────────────────────────
    section("7. The audit trail");

    const entries = await prisma.visionAuditLog.findMany({
      where: {
        OR: [
          { targetKind: "vision_annotation_task" },
          { targetKind: "vision_annotation_version" },
          { targetKind: "vision_label_schema_version", targetId: schemaId },
        ],
      },
      select: { action: true },
    });
    const actions = new Set(entries.map((e) => e.action));
    check("schema publication audited", actions.has("annotation.schema.published"), true);
    check("task creation audited", actions.has("annotation.task.created"), true);
    check("submission audited", actions.has("annotation.submitted"), true);
    check("review audited", actions.has("annotation.reviewed"), true);
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
