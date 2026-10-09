/** Synthetic footage with a keyframed segment and the calibrate run that pinned it, for the carried-calibration specifications. */
import { CALIBRATION_FRAMES_CHUNK_ROLE, CALIBRATION_FRAMES_INDEX_ROLE, CALIBRATION_PROPAGATION_VERSION, visionKeys } from "@dtp/vision-contracts";

export const PROXY_SUM = "e".repeat(64);
export const prefix = visionKeys.inferencePrefix("job", 1);
export const keyframe = (id: string, frameIndex: number, extra: Record<string, unknown> = {}) =>
  ({ id, frameIndex, quality: "good", thresholdsVersion: "provisional/v1", pitchLengthM: 105, pitchWidthM: 68, ...extra });

/** A footage with one keyframed segment and a calibrate run that pinned exactly it. */
export function carriedDb(over: { spec?: Record<string, unknown>; progress?: Record<string, unknown>; calibrate?: unknown; segments?: unknown[] } = {}) {
  const segments = over.segments ?? [{ id: "cam", startMs: 0, endMs: 400, kind: "live_play", calibrations: [keyframe("k2", 9), keyframe("k1", 3)] }];
  const calibrate = over.calibrate !== undefined ? over.calibrate : {
    id: "job", attemptNumber: 1, finishedAt: new Date("2026-10-03"),
    inputSpec: over.spec ?? { proxyChecksum: PROXY_SUM, segments: [{ cameraSegmentId: "cam", startMs: 0, endMs: 400, kind: "live_play", calibrations: [{ calibrationId: "k1" }, { calibrationId: "k2" }] }] },
    progress: over.progress ?? { summary: { indexChecksum: "a".repeat(64), chunks: 1, calculationVersion: CALIBRATION_PROPAGATION_VERSION },
      artifacts: [{ role: CALIBRATION_FRAMES_INDEX_ROLE, bucket: "derived", key: `${prefix}index.json` }, { role: CALIBRATION_FRAMES_CHUNK_ROLE, bucket: "derived", key: `${prefix}c0.jsonl` }] },
  };
  return {
    visionVideoVariant: { findFirst: async () => ({ id: "proxy", objectKey: "proxy.mp4", width: 1280, height: 720, fps: 25, sourceOffsetMs: 0, createdAt: new Date("2026-10-01") }) },
    visionJob: { findFirst: (async ({ where }: { where: { type: string } }) => where.type === "transcode"
      ? { progress: { summary: { proxy: { key: "proxy.mp4", checksumSha256: PROXY_SUM } }, artifacts: [{ role: "proxy", key: "proxy.mp4" }] } }
      : calibrate) as (q: { where: { type: string } }) => Promise<unknown> },
    visionCameraSegment: { findMany: async () => (segments) },
  };
}
