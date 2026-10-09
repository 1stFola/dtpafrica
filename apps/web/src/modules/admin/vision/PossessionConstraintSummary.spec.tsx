import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PossessionConstraintSummary } from "./PossessionConstraintSummary";

describe("possession constraint provenance", () => {
  it("labels legacy evidence without implying metric checks", () => {
    expect(renderToStaticMarkup(<PossessionConstraintSummary snapshot={{ index: {} }} />)).toContain("calibrated distance and motion checks were not applied");
  });
  it("shows passing coverage, explicit Unknown and the ground-plane limitation", () => {
    const html = renderToStaticMarkup(<PossessionConstraintSummary snapshot={{ index: { constraintMode: "calibrated", footballConfig: { maxGroundDistanceM: 2, maxBallGroundSpeedMps: 35, maxPlayerSpeedMps: 12 }, calibrationSnapshot: { proxyVariantId: "p", proxyWidth: 500, proxyHeight: 250, segments: [{ cameraSegmentId: "a", calibrationId: "c", quality: "good", thresholdsVersion: "v1" }, { cameraSegmentId: "b", calibrationId: null, quality: null }] } } }} />);
    expect(html).toContain("1 of 2"); expect(html).toContain("stays Unknown"); expect(html).toContain("does not establish its height or prove possession");
    expect(html).toContain("separate human interpretations"); expect(html).toContain("500 × 250"); expect(html).toContain("calibration c");
  });
  it("counts a moving camera's carried segment apart, naming its keyframes and the run its frames came from", () => {
    const html = renderToStaticMarkup(<PossessionConstraintSummary snapshot={{ index: { constraintMode: "calibrated", footballConfig: {}, calibrationSnapshot: { proxyVariantId: "p", proxyWidth: 500, proxyHeight: 250, carried: { jobId: "run-1" },
      segments: [{ cameraSegmentId: "a", calibrationId: "c", quality: "good", thresholdsVersion: "v1" }, { cameraSegmentId: "b", calibrationId: null, quality: "carried", thresholdsVersion: "v1", keyframeIds: ["k1", "k2"] }] } } }} />);
    expect(html).toContain("1 of 2 camera segments have passing calibration, and 1 follow a moving camera");
    expect(html).toContain("keyframes k1, k2"); expect(html).toContain("calibrate run run-1"); expect(html).toContain("frames no keyframe reached");
  });
});
