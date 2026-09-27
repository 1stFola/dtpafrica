import { describe, expect, it } from "vitest";
import {
  buildFiftyOneExport,
  frameSupport,
  type ExportLabel,
  type ExportMember,
} from "./fiftyone-export";

/**
 * The export is the door footage leaves through.
 *
 * Two kinds of test here, and the first kind matters more. The refusals are
 * straightforward: a missing file, a window past the end, labels nobody reviewed.
 * The arithmetic is where an export goes wrong *quietly* — a one-frame or
 * few-second shift produces a dataset that loads, trains, and benchmarks, and is
 * wrong in a way no downstream check can see.
 */

/**
 * A label that passes every check, so each test can break exactly one.
 *
 * The payload's window follows the task's unless a test overrides it on purpose:
 * drift between the two is a refusal, and a helper that made every changed window
 * look drifted would turn that refusal into noise.
 */
function label(overrides: Partial<ExportLabel> = {}): ExportLabel {
  const base = {
    annotationVersionId: "av-1",
    taskId: "task-1",
    samplingStrategy: "low_confidence",
    labelSchemaVersion: "1.0.0",
    annotatorId: "ann-1",
    sourceStartMs: 10_000,
    sourceEndMs: 11_000,
    decision: "approved" as string | null,
    reviewerId: "rev-1" as string | null,
    preLabelled: false,
    effortMinutes: 4 as number | null,
    uncertain: false,
    notes: null as string | null,
    payloadIntegrity: "ok" as "ok" | "missing" | "checksum_mismatch",
    ...overrides,
  };
  return {
    ...base,
    payloadSourceStartMs: base.sourceStartMs,
    payloadSourceEndMs: base.sourceEndMs,
    ...overrides,
  };
}

function member(overrides: Partial<ExportMember> = {}): ExportMember {
  return {
    videoAssetId: "asset-1",
    split: "train",
    groupKey: "match:1",
    checksumSha256: "a".repeat(64),
    sbMatchId: "match-1",
    durationMs: 120_000,
    isVariableFrameRate: false,
    competitionName: "Lagos League",
    partnerId: "partner-1",
    sourceQualityRank: "broadcast",
    proxy: {
      objectKey: "proxies/asset-1/proxy.mp4",
      fps: 25,
      sourceOffsetMs: 0,
      durationMs: 120_000,
      width: 1280,
      height: 720,
    },
    labels: [label()],
    ...overrides,
  };
}

function build(members: ExportMember[], present?: string[]) {
  return buildFiftyOneExport({
    datasetVersionId: "dsv-1",
    label: "v1",
    frozenAt: new Date("2026-09-01T00:00:00.000Z"),
    labelSchemaVersionId: "lsv-1",
    members,
    presentProxies: new Set(
      present ?? members.flatMap((m) => (m.proxy ? [m.proxy.objectKey] : []))
    ),
  });
}

describe("frame support", () => {
  it("converts a half-open window to an inclusive, 1-based support", () => {
    // At 25fps a frame is 40ms. [0, 1000) is frames 1..25 inclusive: the frame
    // beginning at 1000ms belongs to whatever comes next, not to this window.
    expect(frameSupport(0, 1000, 25)).toEqual([1, 25]);
  });

  it("floors rather than rounds, so a label never moves to the next frame", () => {
    // 60ms is inside frame 1 (0-based), which covers [40, 80). Rounding would
    // give frame 2 and put roughly half of all labels one frame late.
    expect(frameSupport(60, 100, 25)).toEqual([2, 3]);
  });

  it("never returns a support shorter than one frame", () => {
    // A sub-frame window still names the frame it happens in.
    expect(frameSupport(0, 1, 25)).toEqual([1, 1]);
  });

  it("does not go negative on a zero start", () => {
    expect(frameSupport(0, 40, 25)[0]).toBe(1);
  });
});

describe("source time to proxy time", () => {
  it("shifts every label by the proxy's offset", () => {
    /* The failure this prevents: a proxy that does not start at source zero puts
       every label a few seconds out, and the labels stay internally consistent so
       review never catches it. */
    const e = build([
      member({
        proxy: {
          objectKey: "proxies/asset-1/proxy.mp4",
          fps: 25,
          sourceOffsetMs: 9_000,
          durationMs: 120_000,
          width: 1280,
          height: 720,
        },
        labels: [label({ sourceStartMs: 10_000, sourceEndMs: 11_000 })],
      }),
    ]);
    // Source 10s on a proxy starting at source 9s is proxy 1s → frame 26.
    expect(e.samples[0]?.annotations?.detections[0]?.support).toEqual([26, 50]);
  });

  it("keeps the source window on the detection alongside the proxy frames", () => {
    // Both are needed: the frames address the file, the milliseconds are what the
    // label actually means.
    const d = build([member()]).samples[0]?.annotations?.detections[0];
    expect(d?.source_start_ms).toBe(10_000);
    expect(d?.source_end_ms).toBe(11_000);
  });

  it("refuses a label that starts before the proxy does", () => {
    const e = build([
      member({
        proxy: {
          objectKey: "proxies/asset-1/proxy.mp4",
          fps: 25,
          sourceOffsetMs: 20_000,
          durationMs: 120_000,
          width: 1280,
          height: 720,
        },
      }),
    ]);
    expect(e.qa.ok).toBe(false);
    expect(e.qa.problems.map((p) => p.kind)).toContain("label_before_proxy_start");
  });

  it("refuses a label that runs past the proxy's last frame", () => {
    const e = build([
      member({
        proxy: {
          objectKey: "proxies/asset-1/proxy.mp4",
          fps: 25,
          sourceOffsetMs: 0,
          durationMs: 10_500,
          width: 1280,
          height: 720,
        },
        labels: [label({ sourceStartMs: 10_000, sourceEndMs: 11_000 })],
      }),
    ]);
    expect(e.qa.ok).toBe(false);
    expect(e.qa.problems.map((p) => p.kind)).toContain("label_past_proxy_end");
  });
});

describe("what cannot be exported", () => {
  it("refuses a member with no proxy", () => {
    const e = build([member({ proxy: null })]);
    expect(e.qa.ok).toBe(false);
    expect(e.qa.problems[0]?.kind).toBe("missing_proxy");
    expect(e.samples).toHaveLength(0);
  });

  it("refuses a proxy that is recorded but absent from storage", () => {
    // The row says it exists. An export naming a missing file loads as a silently
    // smaller dataset, which is the version of this bug nobody notices.
    const e = build([member()], []);
    expect(e.qa.ok).toBe(false);
    expect(e.qa.problems[0]?.kind).toBe("missing_proxy");
  });

  it("refuses a proxy with no frame rate rather than assuming 25", () => {
    const e = build([
      member({
        proxy: {
          objectKey: "proxies/asset-1/proxy.mp4",
          fps: null,
          sourceOffsetMs: 0,
          durationMs: 120_000,
          width: 1280,
          height: 720,
        },
      }),
    ]);
    expect(e.qa.ok).toBe(false);
    expect(e.qa.problems[0]?.kind).toBe("proxy_without_fps");
  });

  it("refuses a window whose labels were drawn against different bounds", () => {
    /* The task was re-cut after submission. The labels describe footage that is no
       longer what the row claims, and nothing about the numbers looks odd. */
    const e = build([
      member({ labels: [label({ payloadSourceStartMs: 9_000, payloadSourceEndMs: 10_000 })] }),
    ]);
    expect(e.qa.ok).toBe(false);
    expect(e.qa.problems[0]?.kind).toBe("window_drifted_from_payload");
  });

  it("refuses labels that are gone from storage", () => {
    const e = build([member({ labels: [label({ payloadIntegrity: "missing" })] })]);
    expect(e.qa.ok).toBe(false);
    expect(e.qa.problems[0]?.kind).toBe("payload_missing");
  });

  it("refuses labels that no longer match their submission checksum", () => {
    /* Whatever is in storage is not what the annotator submitted. Exporting it
       would train on an unknown edit. */
    const e = build([member({ labels: [label({ payloadIntegrity: "checksum_mismatch" })] })]);
    expect(e.qa.ok).toBe(false);
    expect(e.qa.problems[0]?.kind).toBe("payload_checksum_mismatch");
  });

  it("names every drifted label, not just the first", () => {
    // The useful answer to "what drifted?" is the whole list.
    const e = build([
      member({
        labels: [
          label({ annotationVersionId: "v1", payloadIntegrity: "checksum_mismatch" }),
          label({ annotationVersionId: "v2", payloadIntegrity: "checksum_mismatch" }),
        ],
      }),
    ]);
    expect(e.qa.problems.filter((p) => p.kind === "payload_checksum_mismatch")).toHaveLength(2);
    expect(e.qa.problems.map((p) => p.annotationVersionId)).toContain("v2");
  });

  it("refuses a window with no length", () => {
    const e = build([member({ labels: [label({ sourceEndMs: 10_000 })] })]);
    expect(e.qa.ok).toBe(false);
    expect(e.qa.problems.map((p) => p.kind)).toContain("empty_window");
  });

  it("tolerates a payload that never recorded its window", () => {
    // Absent is not the same as disagreeing. An older payload without the field
    // cannot be checked, and refusing it would be a claim the data does not support.
    const e = build([
      member({ labels: [label({ payloadSourceStartMs: null, payloadSourceEndMs: null })] }),
    ]);
    expect(e.qa.ok).toBe(true);
    expect(e.qa.labels).toBe(1);
  });
});

describe("labels nobody signed off are left out, and counted", () => {
  it("excludes a rejected label", () => {
    const e = build([member({ labels: [label({ decision: "rejected" })] })]);
    expect(e.qa.labels).toBe(0);
    expect(e.qa.excludedRejected).toBe(1);
    // Not fatal: a rejected label is a normal part of the workflow.
    expect(e.qa.ok).toBe(true);
  });

  it("excludes an unreviewed label", () => {
    const e = build([member({ labels: [label({ decision: null })] })]);
    expect(e.qa.labels).toBe(0);
    expect(e.qa.excludedUnreviewed).toBe(1);
  });

  it("excludes a verdict outside the closed vocabulary", () => {
    /* The verdict vocabulary is closed, so this should be unreachable. It is
       checked anyway: an unrecognised value reaching the corpus as ground truth is
       worse than one being dropped and counted. */
    const e = build([member({ labels: [label({ decision: "looks_fine_to_me" })] })]);
    expect(e.qa.labels).toBe(0);
    expect(e.qa.excludedUnreviewed).toBe(1);
  });

  it("exports a corrected label, because the correction is the signal", () => {
    const e = build([member({ labels: [label({ decision: "corrected" })] })]);
    expect(e.qa.labels).toBe(1);
    expect(e.qa.reviewMix).toEqual({ corrected: 1 });
  });

  it("reports a member left with nothing to export without failing the export", () => {
    const e = build([member({ labels: [] })]);
    expect(e.qa.unlabelledSamples).toEqual(["asset-1"]);
    expect(e.qa.problems[0]?.fatal).toBe(false);
    expect(e.qa.ok).toBe(true);
    // Still a sample: unlabelled footage is useful, it just is not training data.
    expect(e.samples[0]?.annotations).toBeNull();
  });

  it("summarises unlabelled members in one entry rather than one each", () => {
    /* A corpus that is mostly unlabelled is the normal state early on. One problem
       per member would put thousands of near-identical objects in a stored report. */
    const e = build([
      member({ videoAssetId: "a1", labels: [] }),
      member({
        videoAssetId: "a2",
        labels: [],
        proxy: {
          objectKey: "proxies/a2/proxy.mp4",
          fps: 25,
          sourceOffsetMs: 0,
          durationMs: 120_000,
          width: 1280,
          height: 720,
        },
      }),
    ]);
    expect(e.qa.unlabelledSamples).toEqual(["a1", "a2"]);
    expect(e.qa.problems.filter((p) => p.kind === "no_exportable_labels")).toHaveLength(1);
    expect(e.qa.problems[0]?.detail).toContain("2 member(s)");
  });
});

describe("the QA report", () => {
  it("counts samples and labels per split, using tags as FiftyOne reads them", () => {
    const e = build([
      member({ videoAssetId: "a1", split: "train" }),
      member({
        videoAssetId: "a2",
        split: "gold",
        proxy: {
          objectKey: "proxies/a2/proxy.mp4",
          fps: 25,
          sourceOffsetMs: 0,
          durationMs: 120_000,
          width: 1280,
          height: 720,
        },
      }),
    ]);
    expect(e.qa.bySplit).toEqual({
      train: { samples: 1, labels: 1 },
      gold: { samples: 1, labels: 1 },
    });
    expect(e.samples.map((s) => s.tags)).toEqual([["train"], ["gold"]]);
  });

  it("measures the hard-case mix rather than leaving it to opinion", () => {
    const e = build([
      member({
        labels: [
          label({ annotationVersionId: "v1", samplingStrategy: "uniform_random" }),
          label({ annotationVersionId: "v2", samplingStrategy: "low_confidence" }),
          label({ annotationVersionId: "v3", samplingStrategy: "new_domain_slice" }),
        ],
      }),
    ]);
    expect(e.qa.hardCaseFraction).toBe(0.667);
    expect(e.qa.samplingMix).toEqual({
      uniform_random: 1,
      low_confidence: 1,
      new_domain_slice: 1,
    });
  });

  it("reports no hard-case fraction at all rather than zero when there are no labels", () => {
    // "None were hard" and "there is nothing to judge" are different answers.
    const e = build([member({ labels: [] })]);
    expect(e.qa.hardCaseFraction).toBeNull();
  });

  it("names every label schema version present, so a mixed corpus is visible", () => {
    const e = build([
      member({
        labels: [
          label({ annotationVersionId: "v1", labelSchemaVersion: "1.0.0" }),
          label({ annotationVersionId: "v2", labelSchemaVersion: "2.0.0" }),
        ],
      }),
    ]);
    expect(e.qa.labelSchemaVersions).toEqual(["1.0.0", "2.0.0"]);
  });

  it("carries the annotator's own doubt through to the label", () => {
    const e = build([member({ labels: [label({ uncertain: true })] })]);
    expect(e.qa.uncertainLabels).toBe(1);
    expect(e.samples[0]?.annotations?.detections[0]?.label).toBe("annotated_window_uncertain");
  });

  it("counts pre-labelled work separately", () => {
    // Whether pre-labelling saves anyone time is measurable only if the corpus
    // records which labels started from a model.
    const e = build([member({ labels: [label({ preLabelled: true })] })]);
    expect(e.qa.preLabelledLabels).toBe(1);
  });

  it("totals the labelled footage", () => {
    const e = build([member({ labels: [label({ sourceStartMs: 0, sourceEndMs: 90_000 })] })]);
    expect(e.qa.labelledMinutes).toBe(1.5);
  });
});

describe("the export a consumer actually reads", () => {
  it("says the filepaths are object keys, not local paths", () => {
    // The one thing a first-time loader gets wrong.
    const e = build([member()]);
    expect(e.samples[0]?.filepath).toBe("proxies/asset-1/proxy.mp4");
    expect(String(e.metadata.info.filepath_note)).toContain("object keys");
  });

  it("states which clock the frame numbers are in", () => {
    const e = build([member()]);
    expect(String(e.metadata.info.time_base_note)).toContain("PROXY frames");
  });

  it("declares itself a video dataset", () => {
    expect(build([member()]).metadata.media_type).toBe("video");
  });

  it("carries the provenance a corpus gets filtered by", () => {
    const p = build([member()]).samples[0]?.provenance;
    expect(p).toMatchObject({
      video_asset_id: "asset-1",
      checksum_sha256: "a".repeat(64),
      competition: "Lagos League",
      partner_id: "partner-1",
      source_quality_rank: "broadcast",
      source_is_variable_frame_rate: false,
    });
  });

  it("reports the proxy's own frame count, not the source's", () => {
    // A transcode may trim. The loader reads the proxy, so the proxy's count is
    // the one that can be checked against.
    const e = build([
      member({
        durationMs: 200_000,
        proxy: {
          objectKey: "proxies/asset-1/proxy.mp4",
          fps: 25,
          sourceOffsetMs: 0,
          durationMs: 120_000,
          width: 1280,
          height: 720,
        },
      }),
    ]);
    expect(e.samples[0]?.metadata.total_frame_count).toBe(3000);
    expect(e.samples[0]?.provenance.source_duration_ms).toBe(200_000);
  });

  it("produces nothing and reports it when there are no members", () => {
    const e = build([]);
    expect(e.samples).toHaveLength(0);
    expect(e.qa.labels).toBe(0);
    expect(e.qa.hardCaseFraction).toBeNull();
  });
});
