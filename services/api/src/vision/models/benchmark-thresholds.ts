import { ALL_SLICE, type BenchmarkMetric } from "@dtp/vision-contracts";

/**
 * Promotion thresholds, as configuration.
 *
 * docs/vision/10-EVALUATION-AND-GATES.md: *do not hard-code a "good" metric
 * today*. Run a baseline on representative Nigerian matches, then set thresholds
 * per task from what that baseline shows. So this ships with **no minimums** and
 * a version that says so, and every run records which version judged it. Until a
 * baseline exists a run's verdict is `unthresholded` -- a measurement with no
 * bar to clear, which is honest, rather than a bar copied from a paper trained on
 * European broadcast footage.
 *
 * Changing a threshold is a reviewed change with a new version string, never an
 * edit during a release.
 */
export type BenchmarkThresholds = {
  version: string;
  /** IoU at which a prediction counts as matching a box. */
  iou: number;
  /** Metric id (`"<name>:<class|all>"`) -> the minimum it must reach on `all` and on every critical slice. */
  minimums: Record<string, number>;
  /** Slices a regression on which blocks promotion regardless of the headline. */
  criticalSlices: readonly string[];
  /** Metrics compared candidate-against-production at promotion, per model task, on `all` and every critical slice. */
  regressionMetrics: Readonly<Record<string, readonly string[]>>;
  /** How far below production a candidate may fall on those before it is a regression. */
  regressionTolerance: number;
};

export const BENCHMARK_THRESHOLDS: BenchmarkThresholds = {
  version: "2026.10.0-unset",
  iou: 0.5,
  minimums: {},
  // Platform compression destroys exactly the small-object detail the engine depends
  // on, so model quality on platform copies is judged apart from originals.
  criticalSlices: ["quality:platform_copy"],
  // Detection: mAP and ball recall, the headline and the one metric docs/vision/10
  // names on its own. Tracking: identity F1 and MOTA. Two hundredths absorbs
  // benchmark noise without hiding a real drop.
  regressionMetrics: { detect: ["ap:all", "recall:ball"], track: ["idf1:all", "mota:all"] },
  regressionTolerance: 0.02,
};

export type ThresholdFailure = {
  metric: string;
  slice: string;
  value: number | null;
  minimum: number;
  reason: "below_minimum" | "missing" | "no_value";
};

export type BenchmarkVerdict = {
  verdict: "pass" | "fail" | "unthresholded";
  judgedUnder: string;
  failures: ThresholdFailure[];
};

/**
 * Judge a run's metrics against the thresholds.
 *
 * Every minimum is checked on `all` and on every critical slice. On `all`, a
 * missing metric is a failure: a run that did not measure what the bar is set on
 * has not cleared it. On a critical slice, a metric with no boxes to measure
 * (support 0) is skipped -- a gold set with no platform copies cannot regress on
 * them -- but a metric that had boxes and still produced no value is a failure.
 */
export function judge(metrics: readonly BenchmarkMetric[], thresholds: BenchmarkThresholds): BenchmarkVerdict {
  const entries = Object.entries(thresholds.minimums);
  if (!entries.length) {
    return { verdict: "unthresholded", judgedUnder: thresholds.version, failures: [] };
  }

  const byKey = new Map(metrics.map((m) => [`${m.metric}@${m.slice}`, m]));
  const failures: ThresholdFailure[] = [];

  for (const [metric, minimum] of entries) {
    for (const slice of [ALL_SLICE, ...thresholds.criticalSlices]) {
      const row = byKey.get(`${metric}@${slice}`);
      if (!row) {
        if (slice === ALL_SLICE) failures.push({ metric, slice, value: null, minimum, reason: "missing" });
        continue;
      }
      if (row.value === null) {
        if (slice === ALL_SLICE || row.support > 0) {
          failures.push({ metric, slice, value: null, minimum, reason: "no_value" });
        }
        continue;
      }
      if (row.value < minimum) {
        failures.push({ metric, slice, value: row.value, minimum, reason: "below_minimum" });
      }
    }
  }

  return { verdict: failures.length ? "fail" : "pass", judgedUnder: thresholds.version, failures };
}
