import type { PrismaClient } from "@prisma/client";
import { CALIBRATION_FRAMES_CHUNK_ROLE, CALIBRATION_FRAMES_INDEX_ROLE, CALIBRATION_PROPAGATION_VERSION, visionKeys, type CarriedCalibrationPin } from "@dtp/vision-contracts";
import { createHash } from "node:crypto";
import { refusal } from "../shared/refusals";
import type { ObjectStore } from "../storage/object-store";
import { pinnedProxy } from "./pinned-proxy";

type Db = Pick<PrismaClient, "visionJob" | "visionCameraSegment" | "visionVideoVariant">;

/**
 * Whether a calibrate run's pins still describe the footage: the same proxy bytes, the
 * same segments with the same kinds, and the same current calibrations on each. Any
 * change -- a keyframe filed or withdrawn, a segment relabelled -- makes it stale, and a
 * stale run is shown but never read as evidence (docs/vision/93, /94).
 */
export async function carriedRunStale(db: Db, videoAssetId: string, spec: Record<string, unknown> | null): Promise<boolean> {
  let checksum: string;
  try { checksum = (await pinnedProxy(db, videoAssetId)).checksum; } catch { return true; }
  if (spec?.proxyChecksum !== checksum) return true;
  const segments = await db.visionCameraSegment.findMany({ where: { videoAssetId }, orderBy: { startMs: "asc" },
    include: { calibrations: { where: { supersededBy: null, withdrawnAt: null }, select: { id: true, frameIndex: true } } } });
  const now = segments.map((s) => {
    const keyframes = s.calibrations.filter((c) => c.frameIndex != null).map((c) => c.id).sort();
    const whole = s.calibrations.filter((c) => c.frameIndex == null).map((c) => c.id);
    return `${s.id}:${s.startMs}:${s.endMs}:${s.kind}:${(keyframes.length ? keyframes : whole.slice(0, 1)).join(",")}`;
  });
  const pinned = (Array.isArray(spec?.segments) ? (spec!.segments as { cameraSegmentId: string; startMs: number; endMs: number; kind: string; calibrations?: { calibrationId: string }[] }[]) : [])
    .map((s) => `${s.cameraSegmentId}:${s.startMs}:${s.endMs}:${s.kind}:${(s.calibrations ?? []).map((c) => c.calibrationId).sort().join(",")}`);
  return JSON.stringify(now) !== JSON.stringify(pinned);
}

/**
 * The calibrate run whose frames a stage may read now: the latest that succeeded, if it
 * is not stale and its completion is whole. Null otherwise, and then keyframed segments
 * are not calibrated for any stage: unknown, rather than a run for other keyframes.
 */
export async function currentCarriedRun(db: Db, videoAssetId: string): Promise<CarriedCalibrationPin | null> {
  const job = await db.visionJob.findFirst({ where: { videoAssetId, type: "calibrate", state: "succeeded" }, orderBy: { finishedAt: "desc" } });
  if (!job) return null;
  const progress = job.progress as { summary?: Record<string, unknown>; artifacts?: { key: string; bucket: string; role: string }[] } | null;
  const artifacts = Array.isArray(progress?.artifacts) ? progress!.artifacts : [];
  const index = artifacts.filter((a) => a.role === CALIBRATION_FRAMES_INDEX_ROLE && a.bucket === "derived");
  const chunks = artifacts.filter((a) => a.role === CALIBRATION_FRAMES_CHUNK_ROLE && a.bucket === "derived");
  const checksum = progress?.summary?.indexChecksum;
  const prefix = visionKeys.inferencePrefix(job.id, job.attemptNumber);
  if (index.length !== 1 || !chunks.length || chunks.length !== progress?.summary?.chunks || progress?.summary?.calculationVersion !== CALIBRATION_PROPAGATION_VERSION
    || typeof checksum !== "string" || !/^[a-f0-9]{64}$/i.test(checksum) || [...index, ...chunks].some((a) => !a.key.startsWith(prefix)))
    return null;
  if (await carriedRunStale(db, videoAssetId, job.inputSpec as Record<string, unknown> | null)) return null;
  return { jobId: job.id, indexKey: index[0]!.key, indexChecksum: checksum.toLowerCase(), chunkKeys: chunks.map((c) => c.key) };
}

type KeyframeRow = { id: string; quality: string; thresholdsVersion: string; pitchLengthM: number; pitchWidthM: number };

/**
 * A keyframed segment as a stage declares it: no single transform, its keyframes named,
 * the pitch they share. Keyframes of one segment that disagree on the pitch's size or the
 * thresholds they were judged by describe two grounds, and are refused rather than averaged.
 */
export function carriedSegment(keyframes: KeyframeRow[]) {
  const first = keyframes[0]!;
  if (keyframes.some((k) => k.pitchLengthM !== first.pitchLengthM || k.pitchWidthM !== first.pitchWidthM || k.thresholdsVersion !== first.thresholdsVersion))
    throw refusal(409, "KeyframesDisagree", "Keyframes of one segment were filed with different pitch sizes or thresholds.", "Withdraw the odd keyframe and file it again with the segment's pitch size.");
  return { quality: "carried" as const, thresholdsVersion: first.thresholdsVersion, pitch: { lengthM: first.pitchLengthM, widthM: first.pitchWidthM },
    keyframeIds: keyframes.map((k) => k.id).sort() };
}

/**
 * The carried homographies of some frames, from a pinned run, checked as a worker checks
 * them: the index against the pin, each chunk read against the checksum its index
 * recorded. Only the chunks holding the frames asked for are read.
 */
export async function readCarriedFrames(store: ObjectStore, pin: CarriedCalibrationPin, segmentIds: Set<string>, frames: Set<number>): Promise<Map<number, { segmentId: string; H: number[] }>> {
  const out = new Map<number, { segmentId: string; H: number[] }>();
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const index = await store.getSmallObject("derived", pin.indexKey, 4_000_000);
  if (!index || sha(index) !== pin.indexChecksum) throw refusal(409, "CarriedCalibrationChanged", "The pinned calibrate run's index is missing or changed.", "Follow the camera again.");
  const chunks = ((JSON.parse(index.toString("utf8")) as { chunks?: { key: string; sha256: string; firstFrame: number; lastFrame: number }[] }).chunks ?? [])
    .filter((c) => [...frames].some((f) => c.firstFrame <= f && f <= c.lastFrame));
  for (const chunk of chunks) {
    const body = await store.getSmallObject("derived", chunk.key, 64_000_000);
    if (!body || sha(body) !== chunk.sha256) throw refusal(409, "CarriedCalibrationChanged", "A chunk of the pinned calibrate run is missing or changed.", "Follow the camera again.");
    for (const line of body.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as { f: number; cameraSegmentId: string | null; H: unknown; quality: string | null };
      if (!frames.has(row.f) || row.H == null || !row.cameraSegmentId || !segmentIds.has(row.cameraSegmentId)) continue;
      // As the worker reads it: a carried frame is a passing keyframe's finite transform, or the run is not trusted.
      if (!["good", "usable"].includes(String(row.quality)) || !Array.isArray(row.H) || row.H.length !== 9 || row.H.some((v) => typeof v !== "number" || !Number.isFinite(v)))
        throw refusal(409, "CarriedCalibrationInvalid", `Frame ${row.f} of the pinned calibrate run is not a passing finite transform.`, "Follow the camera again.");
      out.set(row.f, { segmentId: row.cameraSegmentId, H: row.H as number[] });
    }
  }
  return out;
}

/** The objects a stage reading a pinned run may fetch: its index and its chunks. */
export function carriedReadKeys(pin: CarriedCalibrationPin | undefined): { bucket: "derived"; key: string }[] {
  return pin ? [pin.indexKey, ...pin.chunkKeys].map((key) => ({ bucket: "derived" as const, key })) : [];
}
