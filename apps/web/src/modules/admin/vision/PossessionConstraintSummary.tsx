const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export function PossessionConstraintSummary({ snapshot }: { snapshot: unknown }) {
  const index = object(object(snapshot).index), config = object(index.footballConfig), calibration = object(index.calibrationSnapshot);
  const segments = Array.isArray(calibration.segments) ? calibration.segments.map(object) : [];
  if (index.constraintMode !== "calibrated") return <p>Image proximity only; calibrated distance and motion checks were not applied.</p>;
  const passing = segments.filter((s) => s.quality === "good" || s.quality === "usable").length;
  const carried = segments.filter((s) => s.quality === "carried").length;
  const run = object(calibration.carried);
  return <div className="vision-possession-constraints"><strong>Calibrated ground-plane checks applied</strong>
    <p>{passing} of {segments.length} camera segments have passing calibration{carried ? `, and ${carried} follow a moving camera frame by frame from keyframes` : ""}. Missing or failed calibration stays Unknown, as do frames no keyframe reached.</p>
    <p>Ground distance limit: {String(config.maxGroundDistanceM)} m. Ground-plane ball motion limit: {String(config.maxBallGroundSpeedMps)} m/s. Player motion limit: {String(config.maxPlayerSpeedMps)} m/s.</p>
    <p>A ball projected onto the pitch plane does not establish its height or prove possession. These checks apply to original producer output; manual corrections remain separate human interpretations.</p>
    <details><summary>Calibration provenance</summary><p>Proxy variant {String(calibration.proxyVariantId)} · {String(calibration.proxyWidth)} × {String(calibration.proxyHeight)} pixels</p>
      {segments.map((s) => <p key={String(s.cameraSegmentId)}>Camera {String(s.cameraSegmentId)}: {String(s.quality ?? "uncalibrated")} · {s.quality === "carried"
        ? `keyframes ${Array.isArray(s.keyframeIds) ? s.keyframeIds.join(", ") : "none"}` : `calibration ${String(s.calibrationId ?? "none")}`} · thresholds {String(s.thresholdsVersion ?? "none")}</p>)}
      {carried ? <p>Carried frames from calibrate run {String(run.jobId ?? "none")}</p> : null}
    </details>
  </div>;
}
