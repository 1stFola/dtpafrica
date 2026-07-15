import { CALIBRATION_ATTRIBUTE_KEYS } from "./attribute-keys";

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function selectedBenchmarkBlend(rawOverall: number) {
  if (rawOverall < 45) return 0.1;
  if (rawOverall < 55) return 0.14;
  if (rawOverall < 65) return 0.18;
  return 0.22;
}

/**
 * Admin-selected benchmarks should affect the calibrated attribute profile.
 * Keep this deliberately modest; reality controls still cap the final output.
 */
export function applySelectedBenchmarkInfluence(
  calibrated: Record<string, number>,
  selectedBenchmark: Record<string, unknown> | null | undefined,
  rawOverall: number,
): Record<string, number> {
  if (!selectedBenchmark) return calibrated;
  const blend = selectedBenchmarkBlend(rawOverall);
  const out: Record<string, number> = {};

  for (const attr of CALIBRATION_ATTRIBUTE_KEYS) {
    const current = numeric(calibrated[attr]) ?? 50;
    const benchmark = numeric(selectedBenchmark[attr]);
    out[attr] = benchmark == null ? current : Math.round(current + (benchmark - current) * blend);
  }

  return out;
}
