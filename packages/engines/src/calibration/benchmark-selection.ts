/** Top similarity-ranked real-player candidates considered for benchmark selection. */
export const CALIBRATION_BENCHMARK_POOL_SIZE = 6;

/**
 * Maps raw overall rating to a primary benchmark slot (0 = closest match, 5 = 6th-ranked).
 * Higher OVR players anchor to tighter similarity matches; lower OVR to broader ones.
 */
export function resolvePrimaryBenchmarkIndex(rawOverallRating: number): number {
  if (rawOverallRating >= 70) return 0;
  if (rawOverallRating >= 65) return 1;
  if (rawOverallRating >= 60) return 2;
  if (rawOverallRating >= 55) return 3;
  if (rawOverallRating >= 50) return 4;
  return 5;
}

export function selectBenchmarkFromPool(
  rankedCandidates: Record<string, unknown>[],
  primaryIndex: number,
): {
  nearest: Record<string, unknown>;
  alternativeBenchmarks: Record<string, unknown>[];
  primaryBenchmarkIndex: number;
} {
  if (rankedCandidates.length === 0) {
    return {
      nearest: { __similarity: 50, __distance: 999 },
      alternativeBenchmarks: [],
      primaryBenchmarkIndex: 0,
    };
  }

  const clamped = Math.min(
    Math.max(0, primaryIndex),
    rankedCandidates.length - 1,
  );
  const nearest = rankedCandidates[clamped];
  const alternativeBenchmarks = rankedCandidates.filter((_, i) => i !== clamped);

  return {
    nearest,
    alternativeBenchmarks,
    primaryBenchmarkIndex: clamped,
  };
}
