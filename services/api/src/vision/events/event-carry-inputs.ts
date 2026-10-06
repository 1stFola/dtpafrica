import type { PrismaClient } from "@prisma/client";
import { CALIBRATED_POSSESSION_VERSION, EVENT_CARRY_VERSION, EVENT_CARRY_MANIFEST_CHECKSUM, validCarryProducer } from "@dtp/vision-contracts";
import { object, readPossessionEvidence, sameEvidence } from "../possession/possession-evidence";
import { possessionCalibration } from "../possession/possession-calibration";
import { refusal } from "../shared/refusals";
import type { ObjectStore } from "../storage/object-store";

/** Resolve only original stored outputs. Review decisions and manual edits never become producer inputs. */
export async function eventCarryInputs(db: Pick<PrismaClient, "visionJob" | "visionJobEvent" | "visionModelVersion" | "visionCameraSegment" | "visionVideoVariant">,
  store: ObjectStore, asset: { id: string; checksumSha256: string; durationMs: number | null }, modelVersionId: string, requested?: Record<string, unknown>) {
  const bad = (message: string) => refusal(409, "EventCarryEvidenceMissing", message, "Complete current calibrated possession on a clip of at most five minutes; explicitly select a registered event-carry/v1 algorithm version.");
  const selected = requested?.possessionJobId;
  if (selected !== undefined && (typeof selected !== "string" || !selected.trim() || selected.length > 100)) throw refusal(400, "InvalidEventCarryInput", "Select a completed possession job ID.", "Use possessionJobId or omit it to select the latest completed run.");
  const model = await db.visionModelVersion.findUnique({ where: { id: modelVersionId }, select: { id: true, configKey: true, gitCommit: true, workerImage: true, weightsKey: true, weightsChecksum: true, model: { select: { task: true } } } });
  if (!model || model.model.task !== "event" || model.configKey !== EVENT_CARRY_VERSION || model.weightsKey !== null || model.weightsChecksum !== null || !model.gitCommit?.trim() || !model.workerImage?.trim())
    throw bad("This producer requires a weight-free event-carry/v1 registry version with commit and worker image provenance.");
  const job = await db.visionJob.findFirst({ where: { videoAssetId: asset.id, type: "possession", state: "succeeded", ...(typeof selected === "string" ? { id: selected } : {}) }, orderBy: { finishedAt: "desc" } });
  if (!job) throw bad("No completed possession run exists for this asset.");
  const evidence = await readPossessionEvidence(db, store, asset, job.id);
  const index = evidence.index, input = object(job.inputSpec);
  if (index.calculationVersion !== CALIBRATED_POSSESSION_VERSION || index.constraintMode !== "calibrated" || Number(index.windowEndMs) - Number(index.windowStartMs) > 300_000)
    throw bad("Carry proposals require calibrated original possession over a source window of at most five minutes.");
  const cameras = (await db.visionCameraSegment.findMany({ where: { videoAssetId: asset.id }, orderBy: { startMs: "asc" }, select: { id: true, startMs: true, endMs: true, kind: true } }))
    .map((s) => ({ cameraSegmentId: s.id, startMs: s.startMs, endMs: s.endMs, kind: s.kind }));
  if (!sameEvidence(index.cameraSegments, cameras) || !sameEvidence(index.calibrationSnapshot, await possessionCalibration(db, asset.id))) throw bad("Camera, calibration or proxy evidence changed since the possession run.");
  const currentProxy = await db.visionVideoVariant.findFirst({ where: { videoAssetId: asset.id, kind: "proxy" }, orderBy: { createdAt: "desc" }, select: { fps: true, sourceOffsetMs: true } });
  if (!currentProxy || !sameEvidence(index.proxy, { fps: currentProxy.fps, sourceOffsetMs: currentProxy.sourceOffsetMs })) throw bad("The current proxy clock differs from the original possession clock.");
  const tracks = object(input.tracks);
  if (!validCarryProducer({ algorithm: EVENT_CARRY_VERSION, manifestChecksum: EVENT_CARRY_MANIFEST_CHECKSUM, possessionJobId: job.id, possessionIndexChecksum: evidence.indexChecksum,
    tracksChecksum: tracks.checksum, calibrationSnapshot: index.calibrationSnapshot, cameraSegments: index.cameraSegments })) throw bad("Original carry calibration provenance is invalid or exceeds 200 camera segments.");
  const chunks = (index.chunks as Record<string, unknown>[]).map((c) => ({ bucket: "derived", key: String(c.key) }));
  return { sourceChecksum: asset.checksumSha256, sourceDurationMs: asset.durationMs, windowStartMs: index.windowStartMs, windowEndMs: index.windowEndMs,
    proxy: index.proxy, tracks, possession: { jobId: job.id, key: evidence.indexKey, indexChecksum: evidence.indexChecksum }, possessionIndex: index,
    possessionSource: { proxyDurationMs: input.proxyDurationMs },
    eventAlgorithm: { modelVersionId: model.id, configKey: model.configKey, gitCommit: model.gitCommit, workerImage: model.workerImage, weightsChecksum: null, manifestChecksum: EVENT_CARRY_MANIFEST_CHECKSUM },
    readKeys: [{ bucket: "derived", key: evidence.indexKey }, ...chunks, { bucket: "derived", key: String(tracks.key) }] };
}
