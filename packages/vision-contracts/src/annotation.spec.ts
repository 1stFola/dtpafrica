import { describe, expect, it } from "vitest";
import { MAX_BOXES_PER_SUBMISSION, validateAnnotationBoxes } from "./annotation";

/**
 * One rule for boxes, applied at submit and at export.
 *
 * Every refusal here is a box that would otherwise load fine and train a detector
 * on something the annotator never saw: a frame outside the window, a corner past
 * the edge of the picture, a model credited for a box it never drew.
 */

const WINDOW = { startMs: 10_000, endMs: 11_000 };
const NOBODY = { preLabelModelVersionId: null };
const MODEL = "55556666-7777-4888-9999-aaaabbbbcccc";

function box(overrides: Record<string, unknown> = {}) {
  return { sourceTimeMs: 10_500, class: "player", x: 0.1, y: 0.2, width: 0.05, height: 0.1, ...overrides };
}

describe("a Phase 2 payload", () => {
  it("passes with no boxes when the field is absent", () => {
    expect(validateAnnotationBoxes(undefined, WINDOW, NOBODY)).toEqual({ boxes: [], problems: [] });
  });

  it("accepts an empty array as 'looked, found nothing'", () => {
    expect(validateAnnotationBoxes([], WINDOW, NOBODY)).toEqual({ boxes: [], problems: [] });
  });
});

describe("what a box must be", () => {
  it("accepts a well-formed box and carries only the fields it means", () => {
    const result = validateAnnotationBoxes([box({ extra: "ignored" })], WINDOW, NOBODY);
    expect(result.problems).toEqual([]);
    expect(result.boxes).toEqual([
      { sourceTimeMs: 10_500, class: "player", x: 0.1, y: 0.2, width: 0.05, height: 0.1 },
    ]);
  });

  it("keeps the annotator's doubt and a kept pre-label's provenance", () => {
    const result = validateAnnotationBoxes(
      [box({ uncertain: true, fromModelVersionId: MODEL })],
      WINDOW,
      { preLabelModelVersionId: MODEL }
    );
    expect(result.boxes[0]).toMatchObject({ uncertain: true, fromModelVersionId: MODEL });
  });

  it("refuses something that is not an array", () => {
    expect(validateAnnotationBoxes({ x: 1 }, WINDOW, NOBODY).problems[0]?.kind).toBe("boxes_not_array");
    expect(validateAnnotationBoxes("boxes", WINDOW, NOBODY).problems[0]?.kind).toBe("boxes_not_array");
    expect(validateAnnotationBoxes(null, WINDOW, NOBODY).problems[0]?.kind).toBe("boxes_not_array");
  });

  it("refuses an entry that is not an object", () => {
    const result = validateAnnotationBoxes([box(), 7, null, [1, 2]], WINDOW, NOBODY);
    expect(result.problems.map((p) => [p.kind, p.index])).toEqual([
      ["box_not_object", 1],
      ["box_not_object", 2],
      ["box_not_object", 3],
    ]);
  });

  it("refuses a time that is not an integer millisecond", () => {
    for (const sourceTimeMs of [10_500.5, "10500", null, undefined, Number.NaN]) {
      const result = validateAnnotationBoxes([box({ sourceTimeMs })], WINDOW, NOBODY);
      expect(result.problems[0]?.kind, String(sourceTimeMs)).toBe("box_bad_time");
    }
  });

  it("refuses a box outside the half-open window", () => {
    // 9,999 is before; 11,000 is the first frame of whatever comes next.
    for (const sourceTimeMs of [9_999, 11_000, 12_000]) {
      const result = validateAnnotationBoxes([box({ sourceTimeMs })], WINDOW, NOBODY);
      expect(result.problems[0]?.kind, String(sourceTimeMs)).toBe("box_outside_window");
    }
    expect(validateAnnotationBoxes([box({ sourceTimeMs: 10_000 })], WINDOW, NOBODY).problems).toEqual([]);
    expect(validateAnnotationBoxes([box({ sourceTimeMs: 10_999 })], WINDOW, NOBODY).problems).toEqual([]);
  });

  it("refuses a class the contract does not declare", () => {
    for (const cls of ["person", "sports ball", "", 3, undefined]) {
      const result = validateAnnotationBoxes([box({ class: cls })], WINDOW, NOBODY);
      expect(result.problems[0]?.kind, String(cls)).toBe("box_unknown_class");
    }
  });

  it("refuses geometry that leaves the frame, has no size, or is not a number", () => {
    const bad = [
      { x: -0.01 },
      { y: 1.2 },
      { width: 0 },
      { height: -0.1 },
      { x: 0.98, width: 0.05 },
      { y: 0.95, height: 0.1 },
      { x: "0.1" },
      { width: Number.POSITIVE_INFINITY },
    ];
    for (const overrides of bad) {
      const result = validateAnnotationBoxes([box(overrides)], WINDOW, NOBODY);
      expect(result.problems[0]?.kind, JSON.stringify(overrides)).toBe("box_bad_geometry");
    }
  });

  it("tolerates float noise at the frame's edge and clamps it away", () => {
    const result = validateAnnotationBoxes([box({ x: 0.9, width: 0.1000000001 })], WINDOW, NOBODY);
    expect(result.problems).toEqual([]);
    expect(result.boxes[0]!.x + result.boxes[0]!.width).toBeLessThanOrEqual(1);
  });

  it("accepts a box that fills the whole frame", () => {
    expect(
      validateAnnotationBoxes([box({ x: 0, y: 0, width: 1, height: 1 })], WINDOW, NOBODY).problems
    ).toEqual([]);
  });
});

describe("crediting a model", () => {
  it("refuses a model claim on a task no model pre-labelled", () => {
    const result = validateAnnotationBoxes([box({ fromModelVersionId: MODEL })], WINDOW, NOBODY);
    expect(result.problems[0]?.kind).toBe("box_model_claim_unsupported");
    expect(result.problems[0]?.detail).toMatch(/not pre-labelled/);
  });

  it("refuses a claim naming a different model than the one that pre-labelled", () => {
    const result = validateAnnotationBoxes([box({ fromModelVersionId: "other" })], WINDOW, {
      preLabelModelVersionId: MODEL,
    });
    expect(result.problems[0]?.kind).toBe("box_model_claim_unsupported");
    expect(result.problems[0]?.detail).toContain(MODEL);
  });

  it("refuses a claim that is not an id", () => {
    const result = validateAnnotationBoxes([box({ fromModelVersionId: 42 })], WINDOW, {
      preLabelModelVersionId: MODEL,
    });
    expect(result.problems[0]?.kind).toBe("box_model_claim_unsupported");
  });

  it("treats null and absent as hand-drawn", () => {
    const result = validateAnnotationBoxes([box({ fromModelVersionId: null }), box()], WINDOW, {
      preLabelModelVersionId: MODEL,
    });
    expect(result.problems).toEqual([]);
    expect(result.boxes.every((b) => !("fromModelVersionId" in b))).toBe(true);
  });
});

describe("the whole list", () => {
  it("reports every problem, not the first, each with its index", () => {
    const result = validateAnnotationBoxes(
      [box(), box({ sourceTimeMs: 1 }), box({ class: "dog" }), box({ width: 0, class: "dog" })],
      WINDOW,
      NOBODY
    );
    expect(result.problems.map((p) => [p.index, p.kind])).toEqual([
      [1, "box_outside_window"],
      [2, "box_unknown_class"],
      [3, "box_unknown_class"],
      [3, "box_bad_geometry"],
    ]);
    // One bad box spoils the submission: nothing is returned as accepted.
    expect(result.boxes).toEqual([]);
  });

  it("refuses more boxes than one submission may carry", () => {
    const many = Array.from({ length: MAX_BOXES_PER_SUBMISSION + 1 }, () => box());
    expect(validateAnnotationBoxes(many, WINDOW, NOBODY).problems[0]?.kind).toBe("too_many_boxes");
  });
});

describe("a box may belong to a track", () => {
  it("keeps a track id, as a trimmed string, whatever it was typed as", () => {
    const result = validateAnnotationBoxes([box({ trackId: 7 }), box({ sourceTimeMs: 10_540, trackId: " 7 " })], WINDOW, NOBODY);
    expect(result.problems).toEqual([]);
    expect(result.boxes.map((b) => b.trackId)).toEqual(["7", "7"]);
  });

  it("leaves a box without one unlinked", () => {
    const result = validateAnnotationBoxes([box(), box({ trackId: null })], WINDOW, NOBODY);
    expect(result.boxes.every((b) => !("trackId" in b))).toBe(true);
  });

  it("refuses a track id that is not a short string or number", () => {
    for (const trackId of ["", "   ", {}, [], true, "x".repeat(65)]) {
      const result = validateAnnotationBoxes([box({ trackId })], WINDOW, NOBODY);
      expect(result.problems[0]?.kind, JSON.stringify(trackId)).toBe("box_bad_track_id");
    }
  });

  it("refuses one track with two classes: a player cannot become the ball", () => {
    const result = validateAnnotationBoxes(
      [box({ trackId: "A" }), box({ sourceTimeMs: 10_540, trackId: "A", class: "ball", x: 0.5 })],
      WINDOW,
      NOBODY
    );
    expect(result.problems).toEqual([expect.objectContaining({ kind: "track_class_conflict", index: 1 })]);
    expect(result.boxes).toEqual([]);
  });

  it("refuses one track twice on one frame: a thing is in one place at a time", () => {
    const result = validateAnnotationBoxes([box({ trackId: "A" }), box({ trackId: "A", x: 0.5 })], WINDOW, NOBODY);
    expect(result.problems).toEqual([expect.objectContaining({ kind: "track_frame_conflict", index: 1 })]);
  });

  it("allows two different tracks on one frame and one track across frames", () => {
    const result = validateAnnotationBoxes(
      [box({ trackId: "A" }), box({ trackId: "B", x: 0.5 }), box({ sourceTimeMs: 10_540, trackId: "A" })],
      WINDOW,
      NOBODY
    );
    expect(result.problems).toEqual([]);
  });
});
