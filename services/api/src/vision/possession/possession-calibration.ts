import type { PrismaClient } from "@prisma/client";
import type { CarriedCalibrationPin, PossessionCalibrationSnapshot } from "@dtp/vision-contracts";
import { carriedSegment, currentCarriedRun } from "../calibration/carried-run";
import { invert3, orientStored } from "../calibration/homography";
import { refusal } from "../shared/refusals";

/**
 * Calibration uses proxy pixels; detection pixels must be explicitly scaled.
 *
 * A segment with keyframes (a moving camera) is `carried`: its frames are read from the
 * current calibrate run, pinned here beside the segments (docs/vision/94). With no
 * current run -- never run, or stale since a keyframe changed -- it is uncalibrated, and
 * the stages say Unknown rather than borrow a run made for other keyframes.
 */
export async function possessionCalibration(db: Pick<PrismaClient, "visionCameraSegment" | "visionVideoVariant" | "visionJob">, videoAssetId: string): Promise<PossessionCalibrationSnapshot> {
  const proxy = await db.visionVideoVariant.findFirst({ where: { videoAssetId, kind: "proxy" }, orderBy: { createdAt: "desc" },
    select: { id: true, objectKey: true, width: true, height: true, createdAt: true } });
  if (!proxy || !Number.isSafeInteger(proxy.width) || !Number.isSafeInteger(proxy.height) || !proxy.width || !proxy.height || proxy.width < 1 || proxy.height < 1)
    throw refusal(409, "PossessionCalibrationGeometryMissing", "Calibrated constraints need the current proxy's recorded dimensions.", "Produce a current proxy with recorded geometry before choosing calibrated constraints.");
  const transcode = await db.visionJob.findFirst({ where: { videoAssetId, type: "transcode", state: "succeeded" }, orderBy: { finishedAt: "desc" } });
  const progress = transcode?.progress as { summary?: { proxy?: { key?: string; checksumSha256?: string } }; artifacts?: { key: string; role: string }[] } | null;
  const declared = progress?.summary?.proxy;
  if (declared?.key !== proxy.objectKey || !/^[a-f0-9]{64}$/i.test(declared?.checksumSha256 ?? "") || !progress?.artifacts?.some((a) => a.role === "proxy" && a.key === proxy.objectKey))
    throw refusal(409, "PossessionCalibrationProxyUnpinned", "The current proxy has no matching completed checksum evidence.", "Produce a proxy with the updated local worker, then recalibrate and regenerate detection evidence.");
  const cameras = await db.visionCameraSegment.findMany({ where: { videoAssetId }, orderBy: { startMs: "asc" },
    include: { calibrations: { where: { supersededBy: null, withdrawnAt: null }, orderBy: { createdAt: "desc" } } } });
  let run: CarriedCalibrationPin | null | undefined;
  let carried = false;
  const segments: PossessionCalibrationSnapshot["segments"] = [];
  for (const s of cameras) {
    const keyframes = s.calibrations.filter((c) => c.frameIndex != null);
    if (keyframes.length) {
      if (keyframes.some((k) => k.createdAt < proxy.createdAt)) throw refusal(409, "PossessionCalibrationPredatesProxy", "A keyframe predates the current proxy.", "File the keyframes again against the current review proxy, then follow the camera.");
      if (run === undefined) run = await currentCarriedRun(db, videoAssetId);
      if (run) {
        carried = true;
        segments.push({ cameraSegmentId: s.id, startMs: s.startMs, endMs: s.endMs, calibrationId: null, homography: null, ...carriedSegment(keyframes) });
      } else {
        segments.push({ cameraSegmentId: s.id, startMs: s.startMs, endMs: s.endMs, calibrationId: null, quality: null, thresholdsVersion: null, homography: null, pitch: null });
      }
      continue;
    }
    const c = s.calibrations.find((x) => x.frameIndex == null) ?? null;
    const passing = c?.quality === "good" || c?.quality === "usable";
    if (passing && c.createdAt < proxy.createdAt) throw refusal(409, "PossessionCalibrationPredatesProxy", "The calibration predates the current proxy.", "Recalibrate against the current review proxy before applying pitch constraints.");
    if (passing && (!Array.isArray(c.homography) || c.homography.length !== 9 || c.homography.some((v) => typeof v !== "number" || !Number.isFinite(v))))
      throw refusal(409, "PossessionCalibrationInvalid", "The calibration transform is malformed.", "File a valid calibration before queueing calibrated constraints.");
    const homography = passing ? orientStored(c.homography, c.points) : null;
    if (c && (!["good", "usable", "failed"].includes(c.quality) || !c.id || !c.thresholdsVersion
      || (passing && (!homography || homography.length !== 9 || homography.some((v) => !Number.isFinite(v)) || !invert3(homography)
        || !Number.isFinite(c.pitchLengthM) || !Number.isFinite(c.pitchWidthM) || c.pitchLengthM <= 0 || c.pitchWidthM <= 0 || c.pitchLengthM > 200 || c.pitchWidthM > 200))))
      throw refusal(409, "PossessionCalibrationInvalid", "Current calibration evidence is malformed.", "File a valid calibration before queueing calibrated constraints.");
    segments.push({ cameraSegmentId: s.id, startMs: s.startMs, endMs: s.endMs, calibrationId: c?.id ?? null,
      quality: (c?.quality ?? null) as PossessionCalibrationSnapshot["segments"][number]["quality"], thresholdsVersion: c?.thresholdsVersion ?? null,
      homography, pitch: passing ? { lengthM: c.pitchLengthM, widthM: c.pitchWidthM } : null });
  }
  return { proxyWidth: proxy.width, proxyHeight: proxy.height, proxyVariantId: proxy.id, proxyKey: proxy.objectKey, proxyChecksum: declared!.checksumSha256!, segments,
    ...(carried && run ? { carried: run } : {}) };
}
