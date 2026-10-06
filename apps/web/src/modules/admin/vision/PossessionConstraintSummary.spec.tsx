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
});
