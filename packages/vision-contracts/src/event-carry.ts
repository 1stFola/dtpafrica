/** First automatic event rule. No learned weights, roster guesses or human edits. */
export const EVENT_CARRY_VERSION = "event-carry/v1";
export const EVENT_CARRY_MANIFEST = { algorithm: EVENT_CARRY_VERSION, minDurationMs: 1000, minDisplacementM: 2, maxPlayerSpeedMps: 12, maxEvents: 200 } as const;
/** SHA-256 of the sorted compact UTF-8 manifest; this is not a weights checksum. */
export const EVENT_CARRY_MANIFEST_CHECKSUM = "0618c52603b92990d68b65f0e854a1762ca84b82da84fbdbb83ac0dfd0751581";
export type EventCarryProducer = {
  algorithm: typeof EVENT_CARRY_VERSION;
  manifestChecksum: string;
  possessionJobId: string;
  possessionIndexChecksum: string;
  tracksChecksum: string;
  calibrationSnapshot: import("./possession").PossessionCalibrationSnapshot;
  cameraSegments: import("./ball-trajectory").BallTrajectoryJobParams["segments"];
};

export function validCarryProducer(raw: unknown): raw is EventCarryProducer {
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const id = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 2000;
  const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
  const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  if (!obj(raw) || raw.algorithm !== EVENT_CARRY_VERSION || raw.manifestChecksum !== EVENT_CARRY_MANIFEST_CHECKSUM || !id(raw.possessionJobId) || !hash(raw.possessionIndexChecksum) || !hash(raw.tracksChecksum)) return false;
  const s = raw.calibrationSnapshot, cameras = raw.cameraSegments;
  if (!obj(s) || !count(s.proxyWidth) || !s.proxyWidth || !count(s.proxyHeight) || !s.proxyHeight || !id(s.proxyVariantId) || !id(s.proxyKey) || !hash(s.proxyChecksum)
    || !Array.isArray(cameras) || cameras.length > 200 || !Array.isArray(s.segments) || s.segments.length !== cameras.length) return false;
  const ids = new Set<string>();
  for (let i = 0; i < cameras.length; i++) {
    const c = cameras[i], r = s.segments[i];
    if (!obj(c) || !id(c.cameraSegmentId) || ids.has(c.cameraSegmentId) || !count(c.startMs) || !count(c.endMs) || c.endMs <= c.startMs
      || typeof c.kind !== "string" || !["live_play", "replay", "intro", "halftime", "camera_cut", "unknown"].includes(c.kind) || (i > 0 && c.startMs < cameras[i - 1].endMs)
      || !obj(r) || r.cameraSegmentId !== c.cameraSegmentId || r.startMs !== c.startMs || r.endMs !== c.endMs || ![null, "failed", "good", "usable"].includes(r.quality as never)) return false;
    ids.add(c.cameraSegmentId);
    if (r.quality === null) { if ([r.calibrationId, r.thresholdsVersion, r.homography, r.pitch].some((v) => v !== null)) return false; }
    else if (!id(r.calibrationId) || !id(r.thresholdsVersion)) return false;
    if (r.quality === "failed") { if (r.homography !== null || r.pitch !== null) return false; }
    if (r.quality === "good" || r.quality === "usable") {
      if (!Array.isArray(r.homography) || r.homography.length !== 9 || r.homography.some((v) => typeof v !== "number" || !Number.isFinite(v)) || !obj(r.pitch)
        || [r.pitch.lengthM, r.pitch.widthM].some((v) => typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 200)) return false;
      const h = r.homography;
      const determinant = h[0]*(h[4]*h[8]-h[5]*h[7])-h[1]*(h[3]*h[8]-h[5]*h[6])+h[2]*(h[3]*h[7]-h[4]*h[6]);
      if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-14) return false;
    }
  }
  return true;
}
