import { summarizeCalibratedRatings } from "./rating-summary";

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function maxLiftForRawOverall(rawOverall: number) {
  if (rawOverall < 45) return 8;
  if (rawOverall < 55) return 10;
  if (rawOverall < 65) return 12;
  if (rawOverall < 75) return 15;
  return 18;
}

function blendForRawOverall(rawOverall: number) {
  if (rawOverall < 45) return 0.25;
  if (rawOverall < 55) return 0.3;
  if (rawOverall < 65) return 0.35;
  return 0.4;
}

/**
 * Benchmark calibration should add scouting context, not overwrite match evidence.
 * This keeps the 18 calibrated attributes anchored to raw performance so public
 * radar values and headline ratings show a believable current level.
 */
export function applyCalibrationRealityControls(
  raw: Record<string, number>,
  calibrated: Record<string, number>,
  position?: string,
): Record<string, number> {
  const rawSummary = summarizeCalibratedRatings(raw, position);
  const rawOverall = rawSummary.overall_rating;
  const maxLift = maxLiftForRawOverall(rawOverall);
  const blend = blendForRawOverall(rawOverall);
  const controlled: Record<string, number> = {};

  for (const [key, calibratedValue] of Object.entries(calibrated)) {
    const rawValue = typeof raw[key] === "number" && Number.isFinite(raw[key]) ? raw[key] : 50;
    const blended = rawValue + (calibratedValue - rawValue) * blend;
    const capped =
      calibratedValue >= rawValue
        ? Math.min(blended, rawValue + maxLift)
        : Math.max(blended, rawValue - 10);
    controlled[key] = clampScore(capped);
  }

  return controlled;
}
