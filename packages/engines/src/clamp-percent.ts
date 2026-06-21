/** Clamp a percentile score to the inclusive 0–100 range. */
export function clampPercent(score: number, decimals = 0): number {
  if (!Number.isFinite(score)) return 0;
  const clamped = Math.min(100, Math.max(0, score));
  if (decimals <= 0) return Math.round(clamped);
  const factor = 10 ** decimals;
  return Math.round(clamped * factor) / factor;
}
