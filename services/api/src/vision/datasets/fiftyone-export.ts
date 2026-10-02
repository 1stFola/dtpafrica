import {
  validateAnnotationBoxes,
  type AnnotationBox,
  type BoxProblem,
} from "@dtp/vision-contracts";

/**
 * A frozen dataset version, in the shape FiftyOne loads.
 *
 * The export is the door footage leaves through. Everything upstream of here —
 * the eligibility firewall, the leakage checker, the gold benchmark — is a
 * refusal that only matters if the thing that finally walks out is the thing that
 * was checked. So this module is deliberately pure: it takes rows and returns
 * samples plus a QA report, and the decision about which problems are fatal is
 * made once, here, where it can be read.
 *
 * **Two clocks, and the export crosses between them.** A label is stored in
 * *source* time, because that is what it means: milliseconds into the original
 * match file. A FiftyOne sample points at the *proxy*, because the proxy is what
 * a machine can decode deterministically. So every label window is shifted by
 * the proxy's `sourceOffsetMs` and converted to proxy frames. Getting this wrong
 * produces an export whose labels are internally consistent and a few seconds
 * out — which survives review, because nothing looks wrong.
 *
 * See docs/vision/09-ML-PIPELINE.md and docs/vision/26-PHASE-2-INCREMENT-5.md.
 */

/**
 * Verdicts whose labels are fit to export.
 *
 * `rejected` and unreviewed are excluded, and the QA report says how many. An
 * export that quietly includes labels nobody signed off ships noise as ground
 * truth, and the model that trains on it will not say so.
 */
export const EXPORTABLE_DECISIONS = ["approved", "corrected"] as const;

/** The control group. Its share is the "are we only labelling easy frames?" number. */
const CONTROL_STRATEGY = "uniform_random";

export type ExportProxy = {
  objectKey: string;
  /** Constant by construction for a proxy. Null means the transcode never reported it. */
  fps: number | null;
  sourceOffsetMs: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
};

export type ExportLabel = {
  annotationVersionId: string;
  taskId: string;
  samplingStrategy: string;
  labelSchemaVersion: string | null;
  annotatorId: string | null;
  /** The task row's window, in source time. */
  sourceStartMs: number;
  sourceEndMs: number;
  /** The latest reviewer's verdict, or null when nobody has reviewed it. */
  decision: string | null;
  reviewerId: string | null;
  preLabelled: boolean;
  /** Which model drew the starting labels, when one did. A box may credit only it. */
  preLabelModelVersionId: string | null;
  effortMinutes: number | null;
  /** The annotator's own doubt, recorded with the labels. */
  uncertain: boolean;
  notes: string | null;
  /**
   * The payload's `boxes`, exactly as stored. Validated here with the same rule
   * the submit path applied, because a payload can be written behind the
   * service's back and a box that slipped past would train a detector on a frame
   * the annotator never saw.
   */
  boxes?: unknown;
  /**
   * The window as the *payload* recorded it.
   *
   * Carried separately so drift is detectable: if the task's window was re-cut
   * after submission, these disagree and the labels refer to footage that is no
   * longer what the row says.
   */
  payloadSourceStartMs: number | null;
  payloadSourceEndMs: number | null;
  /**
   * Whether the labels in object storage still match what was submitted.
   *
   * Resolved by the caller, which is the only layer that can read the store, but
   * judged here so `ok` is decided in one place. Reported per label rather than
   * thrown on the first, because the useful answer to "what drifted?" is the whole
   * list.
   */
  payloadIntegrity: "ok" | "missing" | "checksum_mismatch";
};

export type ExportMember = {
  videoAssetId: string;
  split: string;
  groupKey: string;
  checksumSha256: string;
  sbMatchId: string | null;
  durationMs: number | null;
  isVariableFrameRate: boolean;
  competitionName: string | null;
  partnerId: string | null;
  sourceQualityRank: string | null;
  proxy: ExportProxy | null;
  labels: ExportLabel[];
};

/**
 * Problems that stop an export.
 *
 * Every one of them produces a *loadable* dataset that is wrong, which is why
 * they are refusals rather than warnings. A dataset that fails to load gets
 * fixed; one that loads and lies gets trained on.
 */
export const FATAL_EXPORT_PROBLEMS = [
  /** The file the sample would name is not in object storage. */
  "missing_proxy",
  /** No frame rate, so a frame number cannot be computed without guessing one. */
  "proxy_without_fps",
  /** The label window starts before the proxy does. */
  "label_before_proxy_start",
  /** The label window ends past the proxy's last frame. */
  "label_past_proxy_end",
  /** A window of zero or negative length. */
  "empty_window",
  /** The payload's window and the task row's window disagree. */
  "window_drifted_from_payload",
  /** The labels are gone from object storage, though the row survives. */
  "payload_missing",
  /** The stored labels no longer hash to the checksum recorded at submission. */
  "payload_checksum_mismatch",
  /** The payload's boxes fail the rule the submit path applies. */
  "boxes_invalid",
  /** A box sits on a frame before the proxy begins. */
  "box_before_proxy_start",
  /** A box sits on a frame past the proxy's last. */
  "box_past_proxy_end",
] as const;
export type FatalExportProblem = (typeof FATAL_EXPORT_PROBLEMS)[number];

export type ExportProblemKind = FatalExportProblem | "no_exportable_labels";

export type ExportProblem = {
  kind: ExportProblemKind;
  videoAssetId: string;
  annotationVersionId?: string;
  detail: string;
  fatal: boolean;
};

export type TemporalDetection = {
  _cls: "TemporalDetection";
  label: string;
  /** FiftyOne frame numbers, 1-based and inclusive at both ends. */
  support: [number, number];
  confidence: null;
} & Record<string, unknown>;

/** One box on one frame, in FiftyOne's `Detection` shape plus provenance. */
export type FrameDetection = {
  _cls: "Detection";
  label: string;
  /** `[x, y, width, height]`, relative to the frame, top-left origin. */
  bounding_box: [number, number, number, number];
  confidence: null;
} & Record<string, unknown>;

export type FrameLabels = {
  detections: { _cls: "Detections"; detections: FrameDetection[] };
};

export type FiftyOneSample = {
  filepath: string;
  /** FiftyOne's idiom for a split. `dataset.match_tags("train")` is how it is read. */
  tags: string[];
  metadata: {
    _cls: "VideoMetadata";
    frame_width: number | null;
    frame_height: number | null;
    frame_rate: number | null;
    total_frame_count: number | null;
    duration: number | null;
  };
  annotations: { _cls: "TemporalDetections"; detections: TemporalDetection[] } | null;
  /**
   * Per-frame boxes, keyed by FiftyOne's 1-based frame number. Empty when the
   * member's labels carry none -- which every Phase 2 payload does.
   */
  frames: Record<string, FrameLabels>;
  provenance: Record<string, unknown>;
};

export type ExportQaReport = {
  generatedAt: string;
  datasetVersionId: string;
  ok: boolean;
  samples: number;
  labels: number;
  bySplit: Record<string, { samples: number; labels: number }>;
  /** Members carrying no exportable label. Legitimate, but silent, so counted. */
  unlabelledSamples: string[];
  excludedRejected: number;
  excludedUnreviewed: number;
  /** More than one means two handbooks are mixed into one corpus. */
  labelSchemaVersions: string[];
  samplingMix: Record<string, number>;
  /**
   * Share of labels that are not the control group.
   *
   * Null rather than 0 when there are no labels at all: "none were hard" and
   * "there is nothing to judge" are different answers.
   */
  hardCaseFraction: number | null;
  reviewMix: Record<string, number>;
  uncertainLabels: number;
  preLabelledLabels: number;
  labelledMinutes: number;
  /** Box-level ground truth, which is what a detector is actually scored against. */
  boxes: number;
  boxesByClass: Record<string, number>;
  framesWithBoxes: number;
  /** Boxes a model drew and the annotator kept. The anchoring question, measured. */
  boxesFromModel: number;
  boxesUncertain: number;
  problems: ExportProblem[];
};

export type FiftyOneExport = {
  metadata: {
    name: string;
    version: string;
    media_type: "video";
    info: Record<string, unknown>;
  };
  samples: FiftyOneSample[];
  qa: ExportQaReport;
};

/**
 * The 0-based frame a proxy time falls on.
 *
 * `floor`, not `round`: a time is *inside* a frame until the next one begins, and
 * rounding would push a label onto the following frame for anything past the
 * halfway point — a one-frame error on roughly half of all labels.
 *
 * The annotation workstation applies the same rule in
 * `apps/web/src/modules/admin/vision/annotation-time.ts`. The two are separate
 * because the web app does not depend on the API's packages; they must agree, and
 * both are tested against the rule rather than against each other.
 */
function frameIndexAt(proxyMs: number, fps: number): number {
  return Math.max(0, Math.floor((proxyMs / 1000) * fps));
}

/**
 * A half-open millisecond window as an inclusive, 1-based FiftyOne `support`.
 *
 * Two conversions at once, and both are off-by-one traps:
 *
 *   - A window is `[start, end)` in milliseconds. `support` is inclusive, so its
 *     last frame is the one holding the window's *final* millisecond — not the
 *     one beginning at `end`, which belongs to whatever comes next.
 *   - FiftyOne numbers video frames from 1, while frame indices here start at 0.
 *
 * At 25fps, `[0, 1000)` is frames 1–25 inclusive. Taking the frame at 1000ms
 * would give 26, quietly lengthening every label in the corpus by one frame.
 */
export function frameSupport(
  proxyStartMs: number,
  proxyEndMs: number,
  fps: number
): [number, number] {
  const first = frameIndexAt(proxyStartMs, fps);
  const last = Math.max(first, frameIndexAt(proxyEndMs - 1, fps));
  return [first + 1, last + 1];
}

/** The label a temporal detection carries: what was annotated, not who annotated it. */
function detectionLabel(label: ExportLabel): string {
  return label.uncertain ? "annotated_window_uncertain" : "annotated_window";
}

function proxyFrameCount(proxy: ExportProxy): number | null {
  if (!proxy.fps || proxy.durationMs === null) return null;
  return Math.max(0, Math.floor((proxy.durationMs / 1000) * proxy.fps));
}

/**
 * Build the export, and the report that says whether it is fit to use.
 *
 * `presentProxies` is the set of proxy object keys the caller has confirmed exist
 * in storage. Passed in rather than looked up here so this stays pure — and
 * required rather than optional, because "I did not check" and "they are all
 * there" must not be the same argument.
 */
export function buildFiftyOneExport(input: {
  datasetVersionId: string;
  label: string;
  frozenAt: Date | string;
  labelSchemaVersionId: string | null;
  members: ExportMember[];
  presentProxies: ReadonlySet<string>;
}): FiftyOneExport {
  const problems: ExportProblem[] = [];
  const samples: FiftyOneSample[] = [];
  const bySplit: Record<string, { samples: number; labels: number }> = {};
  const samplingMix: Record<string, number> = {};
  const reviewMix: Record<string, number> = {};
  const schemaVersions = new Set<string>();
  const unlabelled: string[] = [];

  let totalLabels = 0;
  let uncertainLabels = 0;
  let preLabelledLabels = 0;
  let labelledMs = 0;
  let excludedRejected = 0;
  let excludedUnreviewed = 0;
  let totalBoxes = 0;
  let boxesFromModel = 0;
  let boxesUncertain = 0;
  let framesWithBoxes = 0;
  const boxesByClass: Record<string, number> = {};

  const fail = (kind: FatalExportProblem, member: ExportMember, detail: string, versionId?: string) =>
    problems.push({
      kind,
      videoAssetId: member.videoAssetId,
      ...(versionId ? { annotationVersionId: versionId } : {}),
      detail,
      fatal: true,
    });

  for (const member of input.members) {
    const split = member.split;
    bySplit[split] ??= { samples: 0, labels: 0 };

    if (!member.proxy) {
      fail(
        "missing_proxy",
        member,
        "This member has no proxy variant. The master is never exported, so there is nothing to point at."
      );
      continue;
    }
    if (!input.presentProxies.has(member.proxy.objectKey)) {
      fail(
        "missing_proxy",
        member,
        `The proxy ${member.proxy.objectKey} is recorded but not in storage. An export that names a missing file loads as a silently smaller dataset.`
      );
      continue;
    }
    const fps = member.proxy.fps;
    if (!fps || fps <= 0 || !Number.isFinite(fps)) {
      fail(
        "proxy_without_fps",
        member,
        "The proxy reports no frame rate. Frame numbers would have to be guessed, and a guessed rate produces labels that look precise and are wrong."
      );
      continue;
    }

    const detections: TemporalDetection[] = [];
    const frames: Record<string, FrameLabels> = {};
    const lastFrame = proxyFrameCount(member.proxy);

    for (const label of member.labels) {
      /* A reviewer saying no is a normal outcome, so it is counted apart from
         nobody having said anything yet. Both are excluded; only the second is a
         sign that work is unfinished rather than done. */
      const decision = label.decision;
      if (decision === "rejected") {
        excludedRejected += 1;
        continue;
      }
      if (!decision || !(EXPORTABLE_DECISIONS as readonly string[]).includes(decision)) {
        excludedUnreviewed += 1;
        continue;
      }

      if (label.payloadIntegrity === "missing") {
        fail(
          "payload_missing",
          member,
          "The labels are not in object storage, though the row survives so the gap is visible. There is nothing to export for this version.",
          label.annotationVersionId
        );
        continue;
      }
      if (label.payloadIntegrity === "checksum_mismatch") {
        fail(
          "payload_checksum_mismatch",
          member,
          "The stored labels no longer match the checksum recorded at submission. Whatever is in storage is not what the annotator submitted, so its window cannot be trusted either.",
          label.annotationVersionId
        );
        continue;
      }

      if (label.sourceEndMs <= label.sourceStartMs) {
        fail(
          "empty_window",
          member,
          `Window ${label.sourceStartMs}–${label.sourceEndMs}ms has no length, so it labels no footage.`,
          label.annotationVersionId
        );
        continue;
      }

      /* The payload carries the window it was drawn against. If the row has since
         been re-cut, these labels describe different footage than they claim to. */
      const drifted =
        (label.payloadSourceStartMs !== null && label.payloadSourceStartMs !== label.sourceStartMs) ||
        (label.payloadSourceEndMs !== null && label.payloadSourceEndMs !== label.sourceEndMs);
      if (drifted) {
        fail(
          "window_drifted_from_payload",
          member,
          `The task's window is ${label.sourceStartMs}–${label.sourceEndMs}ms but the labels were drawn against ${label.payloadSourceStartMs}–${label.payloadSourceEndMs}ms.`,
          label.annotationVersionId
        );
        continue;
      }

      const proxyStartMs = label.sourceStartMs - member.proxy.sourceOffsetMs;
      const proxyEndMs = label.sourceEndMs - member.proxy.sourceOffsetMs;

      if (proxyStartMs < 0) {
        fail(
          "label_before_proxy_start",
          member,
          `Source ${label.sourceStartMs}ms is ${-proxyStartMs}ms before this proxy begins. Either the offset is wrong or the label belongs to a different variant.`,
          label.annotationVersionId
        );
        continue;
      }

      const support = frameSupport(proxyStartMs, proxyEndMs, fps);
      if (lastFrame !== null && support[1] > lastFrame) {
        fail(
          "label_past_proxy_end",
          member,
          `Frame ${support[1]} is past the proxy's last frame (${lastFrame}). A loader would read zero frames for the tail of this label.`,
          label.annotationVersionId
        );
        continue;
      }

      /* The boxes, under the same rule the submit path applied. The window is the
         task row's, which the drift check above has just proved the payload agrees
         with. */
      const checked = validateAnnotationBoxes(
        label.boxes,
        { startMs: label.sourceStartMs, endMs: label.sourceEndMs },
        { preLabelModelVersionId: label.preLabelModelVersionId }
      );
      if (checked.problems.length) {
        fail(
          "boxes_invalid",
          member,
          `${checked.problems.length} box problem(s): ${summariseBoxProblems(checked.problems)}`,
          label.annotationVersionId
        );
        continue;
      }
      const placed = placeBoxes(checked.boxes, member.proxy.sourceOffsetMs, fps, lastFrame);
      if (placed.problem) {
        fail(placed.problem.kind, member, placed.problem.detail, label.annotationVersionId);
        continue;
      }
      for (const [frameNumber, boxes] of placed.byFrame) {
        const key = String(frameNumber);
        frames[key] ??= { detections: { _cls: "Detections", detections: [] } };
        for (const box of boxes) {
          frames[key].detections.detections.push({
            _cls: "Detection",
            label: box.class,
            bounding_box: [box.x, box.y, box.width, box.height],
            confidence: null,
            uncertain: box.uncertain === true,
            from_model_version_id: box.fromModelVersionId ?? null,
            source_time_ms: box.sourceTimeMs,
            annotation_version_id: label.annotationVersionId,
            task_id: label.taskId,
            annotator_id: label.annotatorId,
            reviewer_id: label.reviewerId,
            review_decision: decision,
          });
          totalBoxes += 1;
          boxesByClass[box.class] = (boxesByClass[box.class] ?? 0) + 1;
          if (box.fromModelVersionId) boxesFromModel += 1;
          if (box.uncertain) boxesUncertain += 1;
        }
      }

      detections.push({
        _cls: "TemporalDetection",
        label: detectionLabel(label),
        support,
        confidence: null,
        /* Provenance on the label itself, not only the sample: a corpus is filtered
           by these, and a detection that loses its lineage cannot be excluded later. */
        annotation_version_id: label.annotationVersionId,
        task_id: label.taskId,
        sampling_strategy: label.samplingStrategy,
        label_schema_version: label.labelSchemaVersion,
        annotator_id: label.annotatorId,
        reviewer_id: label.reviewerId,
        review_decision: decision,
        pre_labelled: label.preLabelled,
        effort_minutes: label.effortMinutes,
        uncertain: label.uncertain,
        notes: label.notes,
        source_start_ms: label.sourceStartMs,
        source_end_ms: label.sourceEndMs,
      });

      totalLabels += 1;
      bySplit[split].labels += 1;
      samplingMix[label.samplingStrategy] = (samplingMix[label.samplingStrategy] ?? 0) + 1;
      reviewMix[decision] = (reviewMix[decision] ?? 0) + 1;
      if (label.labelSchemaVersion) schemaVersions.add(label.labelSchemaVersion);
      if (label.uncertain) uncertainLabels += 1;
      if (label.preLabelled) preLabelledLabels += 1;
      labelledMs += label.sourceEndMs - label.sourceStartMs;
    }

    if (!detections.length) unlabelled.push(member.videoAssetId);
    framesWithBoxes += Object.keys(frames).length;

    samples.push({
      filepath: member.proxy.objectKey,
      tags: [split],
      metadata: {
        _cls: "VideoMetadata",
        frame_width: member.proxy.width,
        frame_height: member.proxy.height,
        frame_rate: fps,
        total_frame_count: lastFrame,
        duration: member.proxy.durationMs === null ? null : member.proxy.durationMs / 1000,
      },
      annotations: detections.length ? { _cls: "TemporalDetections", detections } : null,
      frames,
      provenance: {
        video_asset_id: member.videoAssetId,
        split,
        group_key: member.groupKey,
        checksum_sha256: member.checksumSha256,
        sb_match_id: member.sbMatchId,
        competition: member.competitionName,
        partner_id: member.partnerId,
        source_quality_rank: member.sourceQualityRank,
        /* Kept on the sample because a VFR source is the one whose frame numbers
           cannot be trusted even when the proxy's can. */
        source_is_variable_frame_rate: member.isVariableFrameRate,
        source_duration_ms: member.durationMs,
        proxy_source_offset_ms: member.proxy.sourceOffsetMs,
      },
    });
    bySplit[split].samples += 1;
  }

  /* One entry, not one per member. `unlabelledSamples` already carries the list,
     and a corpus that is mostly unlabelled — which is the normal state early on —
     would otherwise put thousands of near-identical objects into a stored report. */
  if (unlabelled.length) {
    problems.push({
      kind: "no_exportable_labels",
      videoAssetId: unlabelled[0]!,
      detail: `${unlabelled.length} member(s) have no reviewed labels and export as empty samples. Valid for active learning, and worth knowing before they are counted as training data. See unlabelledSamples.`,
      fatal: false,
    });
  }

  const frozenAt =
    input.frozenAt instanceof Date ? input.frozenAt.toISOString() : new Date(input.frozenAt).toISOString();

  const nonRandom = Object.entries(samplingMix)
    .filter(([strategy]) => strategy !== CONTROL_STRATEGY)
    .reduce((sum, [, count]) => sum + count, 0);

  const qa: ExportQaReport = {
    generatedAt: new Date().toISOString(),
    datasetVersionId: input.datasetVersionId,
    ok: !problems.some((p) => p.fatal),
    samples: samples.length,
    labels: totalLabels,
    bySplit,
    unlabelledSamples: unlabelled,
    excludedRejected,
    excludedUnreviewed,
    labelSchemaVersions: [...schemaVersions].sort(),
    samplingMix,
    hardCaseFraction: totalLabels ? Number((nonRandom / totalLabels).toFixed(3)) : null,
    reviewMix,
    uncertainLabels,
    preLabelledLabels,
    labelledMinutes: Number((labelledMs / 60_000).toFixed(2)),
    boxes: totalBoxes,
    boxesByClass,
    framesWithBoxes,
    boxesFromModel,
    boxesUncertain,
    problems,
  };

  return {
    metadata: {
      name: input.label,
      version: "1.0",
      media_type: "video",
      info: {
        dataset_version_id: input.datasetVersionId,
        label_schema_version_id: input.labelSchemaVersionId,
        frozen_at: frozenAt,
        /* Stated in the export itself, because a consumer reading this file is
           exactly the person who needs to know the paths are bucket-relative. */
        filepath_note:
          "filepath values are object keys in the `derived` bucket, not local paths. Resolve them against the bucket before loading.",
        time_base_note:
          "TemporalDetection.support is in PROXY frames, 1-based and inclusive. source_start_ms and source_end_ms on each detection are the original SOURCE-time window.",
        box_note:
          "frames[n].detections holds per-frame Detection boxes with bounding_box = [x, y, width, height] relative to the proxy frame, top-left origin. n is the 1-based PROXY frame number; source_time_ms on each box is the SOURCE time of that frame.",
      },
    },
    samples,
    qa,
  };
}

/**
 * Put each box on its proxy frame, or say which one cannot be placed.
 *
 * The same conversion as the window: shift by the proxy's offset, floor to a
 * frame, number from 1. Unlike a window, a box names one frame, so there is no
 * inclusive end to get wrong -- but there are still two edges to fall off.
 */
function placeBoxes(
  boxes: AnnotationBox[],
  sourceOffsetMs: number,
  fps: number,
  lastFrame: number | null
): {
  byFrame: Map<number, AnnotationBox[]>;
  problem: { kind: "box_before_proxy_start" | "box_past_proxy_end"; detail: string } | null;
} {
  const byFrame = new Map<number, AnnotationBox[]>();
  for (const box of boxes) {
    const proxyMs = box.sourceTimeMs - sourceOffsetMs;
    if (proxyMs < 0) {
      return {
        byFrame,
        problem: {
          kind: "box_before_proxy_start",
          detail: `A box at source ${box.sourceTimeMs}ms is ${-proxyMs}ms before this proxy begins.`,
        },
      };
    }
    const frameNumber = frameIndexAt(proxyMs, fps) + 1;
    if (lastFrame !== null && frameNumber > lastFrame) {
      return {
        byFrame,
        problem: {
          kind: "box_past_proxy_end",
          detail: `A box at source ${box.sourceTimeMs}ms lands on frame ${frameNumber}, past the proxy's last frame (${lastFrame}).`,
        },
      };
    }
    const list = byFrame.get(frameNumber);
    if (list) list.push(box);
    else byFrame.set(frameNumber, [box]);
  }
  return { byFrame, problem: null };
}

function summariseBoxProblems(problems: BoxProblem[]): string {
  const shown = problems.slice(0, 3).map((p) => p.detail);
  const more = problems.length - shown.length;
  return shown.join("; ") + (more > 0 ? `; and ${more} more` : "");
}
