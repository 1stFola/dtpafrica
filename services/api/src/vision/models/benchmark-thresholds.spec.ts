import { describe, expect, it } from "vitest";
import type { BenchmarkMetric } from "@dtp/vision-contracts";
import { BENCHMARK_THRESHOLDS, judge, type BenchmarkThresholds } from "./benchmark-thresholds";

/**
 * The verdict. A threshold is policy, and this is the one place policy meets a
 * number -- so the cases are the ones that would otherwise let a regression pass:
 * a missing metric, a critical slice, a slice with nothing on it.
 */

const m = (metric: string, slice: string, value: number | null, support = 10): BenchmarkMetric => ({
  metric,
  slice,
  value,
  support,
});

const strict: BenchmarkThresholds = {
  version: "test-1",
  iou: 0.5,
  minimums: { "ap:all": 0.5, "recall:ball": 0.3 },
  criticalSlices: ["quality:platform_copy"],
  regressionMetrics: { detect: ["ap:all", "recall:ball"], track: ["idf1:all", "mota:all"] },
  regressionTolerance: 0.02,
};

describe("with no minimums configured", () => {
  it("a run is unthresholded, not passed", () => {
    // The shipped configuration: no baseline has been measured yet.
    expect(BENCHMARK_THRESHOLDS.minimums).toEqual({});
    const verdict = judge([m("ap:all", "all", 0.1)], BENCHMARK_THRESHOLDS);
    expect(verdict.verdict).toBe("unthresholded");
    expect(verdict.judgedUnder).toBe(BENCHMARK_THRESHOLDS.version);
    expect(verdict.failures).toEqual([]);
  });
});

describe("with minimums", () => {
  it("passes when every minimum is met on all and on every critical slice", () => {
    const verdict = judge(
      [
        m("ap:all", "all", 0.6),
        m("recall:ball", "all", 0.4),
        m("ap:all", "quality:platform_copy", 0.5),
        m("recall:ball", "quality:platform_copy", 0.3),
      ],
      strict
    );
    expect(verdict).toEqual({ verdict: "pass", judgedUnder: "test-1", failures: [] });
  });

  it("fails a metric below its minimum and names it", () => {
    const verdict = judge([m("ap:all", "all", 0.6), m("recall:ball", "all", 0.2)], strict);
    expect(verdict.verdict).toBe("fail");
    expect(verdict.failures).toEqual([
      { metric: "recall:ball", slice: "all", value: 0.2, minimum: 0.3, reason: "below_minimum" },
    ]);
  });

  it("fails a run that never measured what the bar is set on", () => {
    const verdict = judge([m("ap:all", "all", 0.9)], strict);
    expect(verdict.failures).toEqual([
      { metric: "recall:ball", slice: "all", value: null, minimum: 0.3, reason: "missing" },
    ]);
  });

  it("fails a regression on a critical slice however good the headline", () => {
    const verdict = judge(
      [
        m("ap:all", "all", 0.9),
        m("recall:ball", "all", 0.9),
        m("ap:all", "quality:platform_copy", 0.1),
        m("recall:ball", "quality:platform_copy", 0.9),
      ],
      strict
    );
    expect(verdict.verdict).toBe("fail");
    expect(verdict.failures.map((f) => [f.metric, f.slice])).toEqual([["ap:all", "quality:platform_copy"]]);
  });

  it("skips a critical slice with nothing to measure, but not one that had boxes and no value", () => {
    const empty = judge(
      [m("ap:all", "all", 0.9), m("recall:ball", "all", 0.9), m("recall:ball", "quality:platform_copy", null, 0)],
      strict
    );
    expect(empty.verdict).toBe("pass");

    const broken = judge(
      [m("ap:all", "all", 0.9), m("recall:ball", "all", 0.9), m("recall:ball", "quality:platform_copy", null, 12)],
      strict
    );
    expect(broken.failures).toEqual([
      { metric: "recall:ball", slice: "quality:platform_copy", value: null, minimum: 0.3, reason: "no_value" },
    ]);
  });

  it("treats a missing critical-slice row as absent, not as a failure", () => {
    // A gold set with no platform copies at all produces no such rows.
    const verdict = judge([m("ap:all", "all", 0.9), m("recall:ball", "all", 0.9)], strict);
    expect(verdict.verdict).toBe("pass");
  });

  it("a metric with no value on all is a failure", () => {
    const verdict = judge([m("ap:all", "all", null, 0), m("recall:ball", "all", 0.9)], strict);
    expect(verdict.failures[0]).toMatchObject({ metric: "ap:all", slice: "all", reason: "no_value" });
  });

  it("meets a minimum exactly", () => {
    const verdict = judge([m("ap:all", "all", 0.5), m("recall:ball", "all", 0.3)], strict);
    expect(verdict.verdict).toBe("pass");
  });
});
