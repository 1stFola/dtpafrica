import type { VisionResourceClass } from "@dtp/vision-contracts";

/**
 * Configured per-second rates, in USD cents.
 *
 * Indicative only. docs/vision/12-COST-MODEL.md is explicit that GPU pricing
 * moves and must be re-verified before procurement or budgeting — and that a
 * stale rate here would quietly make every historical cost-per-match figure
 * wrong, which matters because the trend is what decisions are made on.
 *
 * `fromConfiguredRate` is carried on every estimate so a reader can tell a
 * configured figure from a live quote.
 */
export type ResourceRate = {
  usdCentsPerSecond: number;
  /** What the rate was derived from, so it can be re-checked. */
  basis: string;
};

/** Derived from the indicative hourly figures in docs/vision/12-COST-MODEL.md. */
export const DEFAULT_RESOURCE_RATES: Record<VisionResourceClass, ResourceRate> = {
  cpu_small: { usdCentsPerSecond: 0.0017, basis: "~$0.06/hr, 4 vCPU CPU-only worker" },
  gpu_24gb: { usdCentsPerSecond: 0.0136, basis: "~$0.49/hr, L4 24 GB" },
  gpu_48gb: { usdCentsPerSecond: 0.0147, basis: "~$0.53/hr, RTX A6000 48 GB" },
  gpu_80gb: { usdCentsPerSecond: 0.0442, basis: "~$1.59/hr, A100 80 GB" },
};

export function parseRateOverrides(env: NodeJS.ProcessEnv): Partial<Record<VisionResourceClass, ResourceRate>> {
  const overrides: Partial<Record<VisionResourceClass, ResourceRate>> = {};
  const keys: VisionResourceClass[] = ["cpu_small", "gpu_24gb", "gpu_48gb", "gpu_80gb"];
  for (const key of keys) {
    const raw = env[`VISION_RATE_${key.toUpperCase()}_USD_PER_HOUR`]?.trim();
    if (!raw) continue;
    const perHour = Number(raw);
    if (!Number.isFinite(perHour) || perHour <= 0) continue;
    overrides[key] = {
      usdCentsPerSecond: (perHour * 100) / 3600,
      basis: `configured override: $${perHour}/hr`,
    };
  }
  return overrides;
}

export function rateFor(
  resourceClass: VisionResourceClass,
  overrides: Partial<Record<VisionResourceClass, ResourceRate>> = {}
): ResourceRate {
  return overrides[resourceClass] ?? DEFAULT_RESOURCE_RATES[resourceClass];
}

export function estimateUsdCents(
  resourceClass: VisionResourceClass,
  seconds: number,
  overrides?: Partial<Record<VisionResourceClass, ResourceRate>>
): number {
  if (seconds <= 0) return 0;
  // Round up: a budget check that rounds down can let a job slip past its cap.
  return Math.ceil(rateFor(resourceClass, overrides).usdCentsPerSecond * seconds);
}
