/**
 * Phase 3 Increment 2 gate — box-level ground truth, from submission to export.
 *
 *   pnpm --filter @dtp/api vision:boxcheck
 *
 * Unit tests prove the rule; this proves it survives the HTTP boundary, the real
 * database and the real object store. It needs the API on :3000 (`VISION_E2E_API`)
 * and whatever `DATABASE_URL` points at — never production. The object store is
 * whatever the API is configured with; every object written is named after the
 * run and deleted at the end.
 *
 * Three claims are on trial:
 *
 *   1. A submission with a box outside the task's window, of an unknown class, with
 *      geometry outside the frame, or crediting a model that never pre-labelled the
 *      task, is refused at the door with every problem named.
 *   2. An accepted, reviewed submission exports its boxes as per-frame FiftyOne
 *      `Detections`, on the frame the annotator was looking at — checked against
 *      arithmetic done by hand in the comments, because a conversion tested only
 *      against itself proves nothing.
 *   3. A payload written behind the service's back with a box the rule refuses is
 *      refused by the export too, by name.
 */
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
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
    `  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(66)} ${
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

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, any> }> {
  const res = await fetch(`${API}${path}`, { ...init, headers: adminHeaders() });
  const text = await res.text();
  let body: Record<string, any> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body };
}
const post = (path: string, body: unknown) => api(path, { method: "POST", body: JSON.stringify(body) });

// ── Fixtures ───────────────────────────────────────────────────────────────

type Fixture = {
  partnerId: string;
  assetId: string;
  proxyKey: string;
  modelId: string;
  modelVersionId: string;
  taskIds: string[];
  wrote: string[];
};

async function seed(): Promise<Fixture> {
  const partner = await prisma.visionSourcePartner.create({
    data: { name: `Boxes gate ${RUN}`, contactEmail: "gate@example.test" },
  });
  const record = await prisma.visionSourceVideoRecord.create({
    data: {
      partnerId: partner.id,
      title: `Boxes gate record ${RUN}`,
      sourceQualityRank: "broadcast",
      originalAvailable: true,
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
      canPublishHighlight: false,
      canShareWithScout: false,
      grantedAt: new Date(),
    },
  });

  const proxyKey = `proxies/gate-${RUN}-boxes/proxy.mp4`;
  const asset = await prisma.visionVideoAsset.create({
    data: {
      sourceVideoRecordId: record.id,
      corpus: "dtp_owned",
      objectKey: `originals/gate-${RUN}-boxes/source.mp4`,
      bytes: BigInt(1024),
      mimeType: "video/mp4",
      checksumSha256: randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64),
      width: 1280,
      height: 720,
      durationMs: 130_000,
      ingestState: "ready",
      variants: {
        create: {
          kind: "proxy",
          objectKey: proxyKey,
          width: 1280,
          height: 720,
          fps: 25,
          durationMs: 120_000,
          /* Nine seconds, so an ignored offset is visible as a nine-second error
             rather than hidden by zero. */
          sourceOffsetMs: 9_000,
        },
      },
    },
  });

  // The model a pre-label may credit.
  const model = await prisma.visionModel.create({
    data: { key: `detector/gate-${RUN}`, task: "detect" },
  });
  const version = await prisma.visionModelVersion.create({
    data: { modelId: model.id, version: "0.1", licenceNote: "gate", gitCommit: "3eeec6e0" },
  });

  return {
    partnerId: partner.id,
    assetId: asset.id,
    proxyKey,
    modelId: model.id,
    modelVersionId: version.id,
    taskIds: [],
    wrote: [],
  };
}

async function cleanup(fx: Fixture | null, store: ObjectStore) {
  if (!fx) return;
  for (const key of fx.wrote) await store.delete("derived", key).catch(() => undefined);
  for (const taskId of fx.taskIds) {
    const page = await store.list("derived", `annotations/${taskId}/`).catch(() => null);
    for (const key of page?.keys ?? []) await store.delete("derived", key).catch(() => undefined);
  }
  const versions = await prisma.visionDatasetVersion.findMany({
    where: { label: { contains: RUN } },
    select: { id: true },
  });
  for (const v of versions) {
    const page = await store.list("derived", `datasets/${v.id}/`).catch(() => null);
    for (const key of page?.keys ?? []) await store.delete("derived", key).catch(() => undefined);
  }

  await prisma.visionReviewDecision.deleteMany({ where: { reviewerId: { contains: RUN } } });
  await prisma.visionDatasetMember.deleteMany({ where: { videoAssetId: fx.assetId } });
  await prisma.visionDatasetVersion.deleteMany({ where: { label: { contains: RUN } } });
  // Cascades the variants, tasks and annotation versions.
  await prisma.visionVideoAsset.deleteMany({ where: { id: fx.assetId } });
  await prisma.visionLabelSchemaVersion.deleteMany({ where: { version: { contains: RUN } } });
  await prisma.visionAuditLog.deleteMany({
    where: { targetId: { in: [fx.modelId, fx.modelVersionId, ...fx.taskIds, ...versions.map((v) => v.id)] } },
  });
  await prisma.visionModel.deleteMany({ where: { id: fx.modelId } });
  await prisma.visionRightsScope.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourceVideoRecord.deleteMany({ where: { partnerId: fx.partnerId } });
  await prisma.visionSourcePartner.deleteMany({ where: { id: fx.partnerId } });
}

// ── The boxes under test ───────────────────────────────────────────────────

const PLAYER_AT_10000 = { sourceTimeMs: 10_000, class: "player", x: 0.1, y: 0.2, width: 0.05, height: 0.1 };
const BALL_AT_10500 = { sourceTimeMs: 10_500, class: "ball", x: 0.5, y: 0.5, width: 0.02, height: 0.03, uncertain: true };
const PLAYER_AT_10540 = { sourceTimeMs: 10_540, class: "player", x: 0.7, y: 0.1, width: 0.06, height: 0.12 };

async function main() {
  const config = loadVisionConfig();
  const store: ObjectStore =
    config.storage.backend === "r2" ? new R2ObjectStore(config.storage) : new InMemoryObjectStore();

  console.log("Vision boxes — submission, export, and the frame they land on");
  console.log(`  api ${API}`);
  console.log(`  object store ${store.backendId}`);
  console.log(`  run ${RUN}`);

  let fx: Fixture | null = null;
  try {
    fx = await seed();

    // ── 1. Submission ────────────────────────────────────────────────────
    section("1. A submission's boxes are checked at the door");

    const schema = await post("/vision/annotation/schemas", {
      version: `gate-${RUN}-schema`,
      definitions: { player: "a player", goalkeeper: "a keeper", referee: "the ref", ball: "the ball" },
    });
    check("label schema published", schema.status, 201);
    const schemaId = String(schema.body.id ?? "");

    const task = await post("/vision/annotation/tasks", {
      videoAssetId: fx.assetId,
      labelSchemaVersionId: schemaId,
      samplingStrategy: "low_confidence",
      startMs: 10_000,
      endMs: 11_000,
      preLabelModelVersionId: fx.modelVersionId,
    });
    check("task created, pre-labelled by the gate's model", task.status, 201);
    const taskId = String(task.body.id ?? "");
    fx.taskIds.push(taskId);
    const annotator = `gate-ann-${RUN}`;
    const submit = (boxes: unknown) =>
      post(`/vision/annotation/tasks/${taskId}/submit`, {
        payload: { windowSourceStartMs: 10_000, windowSourceEndMs: 11_000, uncertain: false, notes: null, boxes },
        annotatorId: annotator,
      });

    const outside = await submit([{ ...PLAYER_AT_10000, sourceTimeMs: 9_999 }]);
    check("a box before the window refused", outside.status, 400);
    check("…by name", outside.body.error, "InvalidBoxes");
    check("…with the problem kind", outside.body.problems?.[0]?.kind, "box_outside_window");

    const atEnd = await submit([{ ...PLAYER_AT_10000, sourceTimeMs: 11_000 }]);
    check("a box at the window's end is outside it (half-open)", atEnd.body.problems?.[0]?.kind, "box_outside_window");

    const coco = await submit([{ ...PLAYER_AT_10000, class: "person" }]);
    check("the detector's native label is not a class", coco.body.problems?.[0]?.kind, "box_unknown_class");

    const offFrame = await submit([{ ...PLAYER_AT_10000, x: 0.98, width: 0.05 }]);
    check("a box past the frame's edge refused", offFrame.body.problems?.[0]?.kind, "box_bad_geometry");

    const impostor = await submit([{ ...PLAYER_AT_10000, fromModelVersionId: fx.modelId }]);
    check("crediting a model that did not pre-label refused", impostor.body.problems?.[0]?.kind, "box_model_claim_unsupported");

    const notArray = await submit({ a: 1 });
    check("boxes that are not a list refused", notArray.body.problems?.[0]?.kind, "boxes_not_array");

    const several = await submit([{ ...PLAYER_AT_10000, sourceTimeMs: 1 }, { ...BALL_AT_10500, class: "dog" }]);
    check("every problem is listed, not the first", several.body.problems?.length, 2);
    check("…each with its index", several.body.problems?.[1]?.index, 1);

    const nothingYet = await prisma.visionAnnotationVersion.count({ where: { taskId } });
    check("no refused submission was recorded", nothingYet, 0);

    const accepted = await submit([
      { ...PLAYER_AT_10000, fromModelVersionId: fx.modelVersionId },
      BALL_AT_10500,
      PLAYER_AT_10540,
    ]);
    check("three well-formed boxes accepted", accepted.status, 201);
    const versionId = String(accepted.body.id ?? "");

    const readBack = await api(`/vision/annotation/versions/${versionId}`);
    check("the payload is stored as submitted, boxes and all", (readBack.body.payload?.boxes ?? []).length, 3);

    const phase2 = await submit(undefined);
    check("a payload without boxes still submits (Phase 2 shape)", phase2.status, 201);

    // ── 2. Export ────────────────────────────────────────────────────────
    section("2. Reviewed boxes export on the frame they were drawn on");

    // The accepted submission is now superseded by the Phase 2 one. Resubmit it as
    // the tip, then review the tip -- a corpus trains on the latest attempt.
    const tip = await submit([
      { ...PLAYER_AT_10000, fromModelVersionId: fx.modelVersionId },
      BALL_AT_10500,
      PLAYER_AT_10540,
    ]);
    const tipId = String(tip.body.id ?? "");
    await prisma.visionReviewDecision.create({
      data: {
        annotationVersionId: tipId,
        targetKind: "vision_annotation_version",
        targetId: tipId,
        decision: "approved",
        reviewerId: `gate-reviewer-${RUN}`,
      },
    });

    const dataset = await post("/vision/datasets", {
      label: `gate-${RUN}-v1`,
      splitPolicy: { train: 100, val: 0, test: 0, gold: 0, seed: `x-${RUN}` },
    });
    const datasetId = String(dataset.body.id ?? "");
    const added = await post(`/vision/datasets/${datasetId}/members`, { videoAssetIds: [fx.assetId] });
    check("the asset joins the dataset", added.body.added, 1);
    await post(`/vision/datasets/${datasetId}/splits`, {});
    const frozen = await post(`/vision/datasets/${datasetId}/freeze`, {});
    check("the version freezes", frozen.status, 201);

    await store.putSmallObject("derived", fx.proxyKey, "not really a video", "video/mp4");
    fx.wrote.push(fx.proxyKey);

    const exported = await post(`/vision/datasets/${datasetId}/export`, {});
    check("the export succeeds", exported.status, 201);
    const qa = (exported.body.qa ?? {}) as Record<string, any>;
    check("three boxes exported", qa.boxes, 3);
    check("two players", qa.boxesByClass?.player, 2);
    check("one ball", qa.boxesByClass?.ball, 1);
    check("three frames carry boxes", qa.framesWithBoxes, 3);
    check("one box was a model's, kept", qa.boxesFromModel, 1);
    check("one box the annotator doubted", qa.boxesUncertain, 1);

    const samplesRaw = await store.getSmallObject("derived", `datasets/${datasetId}/export/samples.json`);
    const sample = (JSON.parse(String(samplesRaw)) as { samples: { frames: Record<string, any> }[] }).samples[0]!;
    /* By hand. The proxy begins at source 9,000ms and runs at 25fps.
         source 10,000 -> proxy 1,000 -> frame 25.0 -> 25 zero-based -> FiftyOne 26
         source 10,500 -> proxy 1,500 -> frame 37.5 -> 37             -> 38
         source 10,540 -> proxy 1,540 -> frame 38.5 -> 38             -> 39
       Rounding would have put the second on 39 and the third on 40. */
    check("boxes land on frames 26, 38 and 39", Object.keys(sample.frames).sort().join(","), "26,38,39");
    const first = sample.frames["26"]?.detections?.detections?.[0];
    check("frame 26 holds the player", first?.label, "player");
    check("…with its normalised box", JSON.stringify(first?.bounding_box), "[0.1,0.2,0.05,0.1]");
    check("…crediting the model that drew it", first?.from_model_version_id, fx.modelVersionId);
    check("…and the source time it was drawn at", first?.source_time_ms, 10_000);
    const ball = sample.frames["38"]?.detections?.detections?.[0];
    check("frame 38 holds the ball", ball?.label, "ball");
    check("…marked uncertain", ball?.uncertain, true);
    check("…drawn by a person", ball?.from_model_version_id, null);
    check("the window-level label is still there too", sample && "annotations" in sample, true);

    const metaRaw = await store.getSmallObject("derived", `datasets/${datasetId}/export/metadata.json`);
    const meta = JSON.parse(String(metaRaw)) as { info: Record<string, string> };
    check("the metadata says which frame numbering the boxes use", meta.info.box_note?.includes("1-based PROXY"), true);

    // ── 3. Behind the service's back ─────────────────────────────────────
    section("3. A payload written behind the service's back is refused by the export");

    const rogue = await prisma.visionAnnotationTask.create({
      data: {
        videoAssetId: fx.assetId,
        labelSchemaVersionId: schemaId,
        samplingStrategy: "low_confidence",
        startMs: 20_000,
        endMs: 21_000,
        state: "submitted",
        // Not pre-labelled -- so a box crediting a model is a claim nothing stands behind.
      },
    });
    fx.taskIds.push(rogue.id);
    const rogueBody = JSON.stringify({
      windowSourceStartMs: 20_000,
      windowSourceEndMs: 21_000,
      uncertain: false,
      notes: null,
      boxes: [{ ...PLAYER_AT_10000, sourceTimeMs: 20_500, fromModelVersionId: fx.modelVersionId }],
    });
    const rogueKey = `annotations/${rogue.id}/rogue.json`;
    const rogueVersion = await prisma.visionAnnotationVersion.create({
      data: {
        taskId: rogue.id,
        payloadKey: rogueKey,
        payloadChecksum: createHash("sha256").update(rogueBody).digest("hex"),
        annotatorId: annotator,
      },
    });
    await store.putSmallObject("derived", rogueKey, rogueBody, "application/json");
    fx.wrote.push(rogueKey);
    await prisma.visionReviewDecision.create({
      data: {
        annotationVersionId: rogueVersion.id,
        targetKind: "vision_annotation_version",
        targetId: rogueVersion.id,
        decision: "approved",
        reviewerId: `gate-reviewer-${RUN}`,
      },
    });

    const refused = await post(`/vision/datasets/${datasetId}/export`, {});
    check("the export is refused", refused.status, 409);
    check("…as a QA failure", refused.body.error, "ExportQaFailed");
    const problems = (refused.body.problems ?? []) as { kind: string; detail: string }[];
    check("…naming the boxes", problems[0]?.kind, "boxes_invalid");
    check("…and why", problems[0]?.detail?.includes("not pre-labelled"), true);

    await prisma.visionAnnotationTask.delete({ where: { id: rogue.id } });
    const again = await post(`/vision/datasets/${datasetId}/export`, {});
    check("with the rogue task gone the export passes again", again.status, 201);
  } catch (error) {
    failures += 1;
    console.error("\nGate aborted:", error);
  } finally {
    await cleanup(fx, store).catch((e) => console.error("cleanup failed:", e));
    await prisma.$disconnect();
  }

  console.log(`\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ""}`);
  process.exitCode = failures ? 1 : 0;
}

void main();
