import type { PublicPlayerProfile } from "../../../api/client";
import { resolvePlayerMetrics } from "./positionScoutingMetrics";

/** Player fields required to merge API metrics with calibration CSV fallback. */
export type CalibratedPlayerInput = Pick<
  PublicPlayerProfile,
  "metrics" | "positionPrimary" | "role" | "scoutingIntelligence" | "benchmarkMetadata"
>;

/** Snake_case tracking metrics with calibration snapshot fallback (mirrors API presenter). */
export function resolveCalibratedPlayerMetrics(
  player: CalibratedPlayerInput
): Record<string, number> {
  return resolvePlayerMetrics(player);
}

/** Return player slice with `metrics` re-resolved using calibration fallback. */
export function withCalibratedMetrics<T extends CalibratedPlayerInput>(player: T): T {
  return {
    ...player,
    metrics: resolveCalibratedPlayerMetrics(player),
  };
}
