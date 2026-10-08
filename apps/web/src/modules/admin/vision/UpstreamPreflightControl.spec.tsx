import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BallTrajectoryPreflightResult, PossessionPreflightResult } from "./UpstreamPreflightControl";

const blocker = { statusCode: 409, error: "BallDetectionsMissing", message: "Ball trajectory needs a succeeded detection artifact.", remediation: "Complete a current detector run." };

describe("upstream compatibility results", () => {
  it("shows the first ball refusal and does not claim later checks passed", () => {
    const html = renderToStaticMarkup(<BallTrajectoryPreflightResult result={{ videoAssetId: "asset", checkedAt: "2026-10-08T00:00:00Z", ready: false, blocker }} />);
    for (const text of ["BallDetectionsMissing", "succeeded detection artifact", "Complete a current detector run", "later inputs have not all been verified", "not a reservation"]) expect(html).toContain(text);
  });
  it("keeps compatible ball inputs separate from queueing and detector licensing", () => {
    const html = renderToStaticMarkup(<BallTrajectoryPreflightResult result={{ videoAssetId: "asset", checkedAt: "2026-10-08T00:00:00Z", ready: true, detectJobId: "detect-run-1", detectorVersionId: "detector-1", cameraSegments: 2 }} />);
    for (const text of ["inputs passed", "detect-r", "2 declared camera window", "queueing repeats", "licensing and ball accuracy are separate"]) expect(html).toContain(text);
    expect(html).not.toContain("<button");
  });
  it("counts calibrated windows and warns when some have no passing calibration", () => {
    const partial = renderToStaticMarkup(<PossessionPreflightResult result={{ videoAssetId: "asset", checkedAt: "2026-10-08T00:00:00Z", ready: true, ballJobId: "ball-run-1", trackJobId: "track-run-1", constraintMode: "calibrated", cameraSegments: 3, calibratedSegments: 1 }} />);
    for (const text of ["Calibrated possession inputs passed", "1 of 3 camera window", "no pitch-constrained evidence", "queueing repeats"]) expect(partial).toContain(text);
    const full = renderToStaticMarkup(<PossessionPreflightResult result={{ videoAssetId: "asset", checkedAt: "2026-10-08T00:00:00Z", ready: true, ballJobId: "ball-run-1", trackJobId: "track-run-1", constraintMode: "calibrated", cameraSegments: 2, calibratedSegments: 2 }} />);
    expect(full).not.toContain("no pitch-constrained evidence");
  });
  it("shows a possession refusal with its remediation", () => {
    const html = renderToStaticMarkup(<PossessionPreflightResult result={{ videoAssetId: "asset", checkedAt: "2026-10-08T00:00:00Z", ready: false, blocker: { statusCode: 409, error: "PossessionCalibrationPredatesProxy", message: "The calibration predates the current proxy.", remediation: "Recalibrate against the current review proxy." } }} />);
    for (const text of ["PossessionCalibrationPredatesProxy", "Recalibrate against", "later inputs have not all been verified"]) expect(html).toContain(text);
  });
});
