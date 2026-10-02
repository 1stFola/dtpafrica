/**
 * The annotation payload, and the boxes inside it.
 *
 * Phase 2 shipped a window-level payload: the source window, the annotator's
 * doubt, a note. Phase 3 trains a detector, and a detector cannot be scored
 * against a window — so the payload gains per-frame boxes. The window stays; the
 * boxes sit inside it.
 *
 * Two decisions a reader of the file needs to know, because both are the kind
 * that produce a dataset which loads and is wrong:
 *
 *   - **A box's time is SOURCE time**, like every other label here. The export
 *     converts it to a proxy frame with the floor rule, so the frame a box lands
 *     on is the frame the annotator was looking at and not its neighbour.
 *   - **A box's geometry is normalised to the proxy frame**, `[0, 1]` on both axes
 *     with `x, y` the top-left corner. Pixels would tie every label to one
 *     transcode; FiftyOne wants relative coordinates anyway.
 *
 * The validator lives here rather than in the API so the submit path and the
 * export apply one rule. A box the submit accepted and the export refused, or the
 * reverse, would be the drift this package exists to prevent.
 */
import { DETECTION_CLASSES, type DetectionClass } from "./prediction";

export type AnnotationBox = {
  /** Source time of the frame this box was drawn on, in milliseconds. */
  sourceTimeMs: number;
  class: DetectionClass;
  /** Normalised to the proxy frame: top-left corner and size, all in [0, 1]. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The annotator's doubt about this box specifically. */
  uncertain?: boolean;
  /**
   * The model version that drew the box, when the annotator kept a pre-label.
   * Absent or null for a box a person drew. Reviewers always see which is which:
   * an unmarked model suggestion is an anchoring-bias machine.
   */
  fromModelVersionId?: string | null;
};

/** What the workstation submits. Fields outside these are kept but unread. */
export type AnnotationPayload = {
  windowSourceStartMs: number;
  windowSourceEndMs: number;
  reviewedAtSourceMs?: number;
  labelSchemaVersion?: string | null;
  uncertain: boolean;
  notes: string | null;
  /** Absent on a Phase 2 payload. An empty array means "looked, found nothing to box". */
  boxes?: AnnotationBox[];
};

/**
 * A ceiling on one submission, so a runaway client cannot write a payload the
 * small-object path will not read back. Ten seconds at 25fps with 22 players and
 * a ball is 5,750 boxes; this leaves room for a long window without inviting a
 * whole match into one task.
 */
export const MAX_BOXES_PER_SUBMISSION = 20_000;

export const BOX_PROBLEM_KINDS = [
  "boxes_not_array",
  "too_many_boxes",
  "box_not_object",
  "box_bad_time",
  "box_outside_window",
  "box_unknown_class",
  "box_bad_geometry",
  "box_model_claim_unsupported",
] as const;
export type BoxProblemKind = (typeof BOX_PROBLEM_KINDS)[number];

export type BoxProblem = {
  kind: BoxProblemKind;
  /** Position in the submitted array, or null for a problem with the array itself. */
  index: number | null;
  detail: string;
};

export type BoxValidation = {
  /** Every box, in submitted order, when there are no problems; empty otherwise. */
  boxes: AnnotationBox[];
  problems: BoxProblem[];
};

/** Absorbs float noise at the edges: a box drawn to the frame's edge may compute to 1.0000001. */
const EPSILON = 1e-6;

/**
 * Check a payload's `boxes` against the task's window and pre-label provenance.
 *
 * Returns problems rather than throwing, and all of them rather than the first,
 * because the useful answer to "what is wrong with this submission?" is the list.
 * A payload with `boxes` absent is a Phase 2 payload and passes with none.
 */
export function validateAnnotationBoxes(
  raw: unknown,
  window: { startMs: number; endMs: number },
  provenance: { preLabelModelVersionId: string | null }
): BoxValidation {
  if (raw === undefined) return { boxes: [], problems: [] };

  const problems: BoxProblem[] = [];
  if (!Array.isArray(raw)) {
    return {
      boxes: [],
      problems: [{ kind: "boxes_not_array", index: null, detail: `boxes must be an array; got ${describe(raw)}` }],
    };
  }
  if (raw.length > MAX_BOXES_PER_SUBMISSION) {
    return {
      boxes: [],
      problems: [
        {
          kind: "too_many_boxes",
          index: null,
          detail: `${raw.length} boxes in one submission; the ceiling is ${MAX_BOXES_PER_SUBMISSION}. Split the window.`,
        },
      ],
    };
  }

  const boxes: AnnotationBox[] = [];
  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push({ kind: "box_not_object", index, detail: `box ${index} is ${describe(entry)}` });
      return;
    }
    const box = entry as Record<string, unknown>;
    const before = problems.length;

    const time = box.sourceTimeMs;
    if (typeof time !== "number" || !Number.isInteger(time)) {
      problems.push({
        kind: "box_bad_time",
        index,
        detail: `box ${index}: sourceTimeMs must be an integer millisecond; got ${describe(time)}`,
      });
    } else if (time < window.startMs || time >= window.endMs) {
      /* Half-open, like the window itself: a box at `endMs` is on the first frame
         of whatever comes next, which this task never showed the annotator. */
      problems.push({
        kind: "box_outside_window",
        index,
        detail: `box ${index}: source ${time}ms is outside the task's window [${window.startMs}, ${window.endMs})`,
      });
    }

    const cls = box.class;
    if (typeof cls !== "string" || !(DETECTION_CLASSES as readonly string[]).includes(cls)) {
      problems.push({
        kind: "box_unknown_class",
        index,
        detail: `box ${index}: class ${describe(cls)} is not one of ${DETECTION_CLASSES.join(", ")}`,
      });
    }

    const geometry = unitRect(box);
    if (!geometry) {
      problems.push({
        kind: "box_bad_geometry",
        index,
        detail: `box ${index}: x, y, width, height must be finite, inside [0, 1], with a positive size that stays inside the frame`,
      });
    }

    const claimed = box.fromModelVersionId;
    if (claimed !== undefined && claimed !== null) {
      if (typeof claimed !== "string" || !claimed.trim()) {
        problems.push({
          kind: "box_model_claim_unsupported",
          index,
          detail: `box ${index}: fromModelVersionId must be a model version id or null; got ${describe(claimed)}`,
        });
      } else if (claimed !== provenance.preLabelModelVersionId) {
        /* A box crediting a model that never pre-labelled this task is a provenance
           claim nothing can stand behind. Refused, not stripped: silently turning a
           model's box into a person's would be the same lie the other way round. */
        problems.push({
          kind: "box_model_claim_unsupported",
          index,
          detail: provenance.preLabelModelVersionId
            ? `box ${index}: credits model version ${claimed}, but this task was pre-labelled by ${provenance.preLabelModelVersionId}`
            : `box ${index}: credits model version ${claimed}, but this task was not pre-labelled by a model`,
        });
      }
    }

    if (problems.length === before && geometry) {
      boxes.push({
        sourceTimeMs: time as number,
        class: cls as DetectionClass,
        ...geometry,
        ...(box.uncertain === true ? { uncertain: true } : {}),
        ...(typeof claimed === "string" ? { fromModelVersionId: claimed } : {}),
      });
    }
  });

  return { boxes: problems.length ? [] : boxes, problems };
}

function unitRect(box: Record<string, unknown>): Pick<AnnotationBox, "x" | "y" | "width" | "height"> | null {
  const { x, y, width, height } = box;
  const values = [x, y, width, height];
  if (!values.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const [bx, by, bw, bh] = values as number[];
  if (bx < -EPSILON || by < -EPSILON) return null;
  if (bw <= EPSILON || bh <= EPSILON) return null;
  if (bx + bw > 1 + EPSILON || by + bh > 1 + EPSILON) return null;
  /* Clamped, and then the size trimmed so the far edge never passes 1: a box drawn
     to the edge of the picture computes to 1.0000001 wide more often than not. */
  const left = clamp01(bx);
  const top = clamp01(by);
  return {
    x: left,
    y: top,
    width: Math.min(clamp01(bw), 1 - left),
    height: Math.min(clamp01(bh), 1 - top),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value === "object" ? "an object" : `${typeof value} ${JSON.stringify(value)}`;
}
