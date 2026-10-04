/**
 * What a calibration's reprojection error is allowed to be before coordinates
 * derived from it are suppressed.
 *
 * Provisional, and versioned so that every calibration records which rule
 * judged it. docs/vision/10 names reprojection error and valid-frame coverage
 * as the metrics and says nothing about the bar; these numbers are what a
 * careful person would accept from clicked landmarks on a 720p proxy, and the
 * first real matches will move them. A metre of error on a 105 m pitch is a
 * percent of length; three metres is a player's stride being wrong by a body.
 *
 * `good` and `usable` both yield coordinates; a reader may tell them apart.
 * `failed` yields none: docs/vision/09's suppression rule says a coordinate
 * metric below the bar is suppressed and labelled, not emitted with a caveat.
 */
export type CalibrationThresholds = {
  version: string;
  /** RMSE in metres at or under which a calibration is `good`, given enough points. */
  goodRmseM: number;
  goodMinPoints: number;
  /** RMSE in metres at or under which a calibration is `usable`. */
  usableRmseM: number;
  /** A single landmark further out than this fails the calibration whatever the mean. */
  maxPointErrorM: number;
};

export const CALIBRATION_THRESHOLDS: CalibrationThresholds = {
  version: "2026.10.0-provisional",
  goodRmseM: 0.75,
  goodMinPoints: 6,
  usableRmseM: 2,
  maxPointErrorM: 5,
};

import type { CalibrationQuality } from "@dtp/vision-contracts";

export type { CalibrationQuality };

export function qualityOf(
  fit: { rmseM: number; maxErrorM: number; points: number; acrossHorizon?: number },
  thresholds: CalibrationThresholds = CALIBRATION_THRESHOLDS
): CalibrationQuality {
  // A clicked landmark beyond the fit's horizon: the fit has the camera wrong, whatever its error reads.
  if (fit.acrossHorizon) return "failed";
  if (fit.maxErrorM > thresholds.maxPointErrorM) return "failed";
  if (fit.rmseM <= thresholds.goodRmseM && fit.points >= thresholds.goodMinPoints) return "good";
  if (fit.rmseM <= thresholds.usableRmseM) return "usable";
  return "failed";
}
