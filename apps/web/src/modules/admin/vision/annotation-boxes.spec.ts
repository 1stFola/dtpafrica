import { describe, expect, it } from "vitest";
import { boxIou, boxesOnFrame, countByClass, countTracks, frameOfBox, framesWithBoxes, inheritTrackId, nextTrackId, parseStoredBoxes, pointOnPicture, rectFromDrag, snapSourceTimeMs, toPayloadBoxes, type DraftBox } from "./annotation-boxes";
import { pictureRect } from "./calibration-editor";

/**
 * The arithmetic that decides whether a box means what it says.
 *
 * A proxy offset by nine seconds and a scrubber that stops mid-frame are the
 * normal case. A box that ignored either would be stored on a frame the annotator
 * never looked at, and look fine on screen.
 */

const STAGE = { width: 1000, height: 500 };
const OFFSET = 9_000;
const FPS = 25;

const box = (over: Partial<DraftBox> = {}): DraftBox => ({
  id: "b1",
  sourceTimeMs: 10_500,
  class: "player",
  x: 0.1,
  y: 0.2,
  width: 0.05,
  height: 0.1,
  ...over,
});

describe("a drag becomes a normalised rectangle", () => {
  it("normalises to the stage and takes either corner as the start", () => {
    expect(rectFromDrag({ x: 100, y: 50 }, { x: 300, y: 150 }, STAGE)).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.2,
    });
    expect(rectFromDrag({ x: 300, y: 150 }, { x: 100, y: 50 }, STAGE)).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.2,
    });
  });

  it("treats a tiny drag as a click, not a box", () => {
    expect(rectFromDrag({ x: 100, y: 100 }, { x: 103, y: 150 }, STAGE)).toBeNull();
    expect(rectFromDrag({ x: 100, y: 100 }, { x: 150, y: 102 }, STAGE)).toBeNull();
  });

  it("clamps a drag that leaves the picture to its edge", () => {
    const rect = rectFromDrag({ x: 900, y: 450 }, { x: 1200, y: 700 }, STAGE)!;
    expect(rect.x + rect.width).toBeLessThanOrEqual(1);
    expect(rect.y + rect.height).toBeLessThanOrEqual(1);
    expect(rect).toEqual({ x: 0.9, y: 0.9, width: 0.1, height: 0.1 });
  });

  it("refuses a stage with no size rather than dividing by zero", () => {
    expect(rectFromDrag({ x: 0, y: 0 }, { x: 50, y: 50 }, { width: 0, height: 0 })).toBeNull();
  });
});

describe("a box's time is the start of its frame, in source time", () => {
  it("snaps the scrubber's millisecond back to the frame start", () => {
    // Proxy 1,510ms is inside frame 37 (1,480-1,520). The box is stored at the
    // frame's start, 1,480, plus the offset: source 10,480.
    expect(snapSourceTimeMs(1_510, FPS, OFFSET)).toBe(10_480);
  });

  it("keeps the millisecond when there is no frame rate to snap to", () => {
    expect(snapSourceTimeMs(1_510, null, OFFSET)).toBe(10_510);
  });

  it("agrees with the export about which frame a box is on", () => {
    // Source 10,500 on a 9,000 offset is proxy 1,500 -> frame 37 (floor of 37.5).
    expect(frameOfBox(box(), FPS, OFFSET)).toBe(37);
    expect(frameOfBox(box({ sourceTimeMs: 10_480 }), FPS, OFFSET)).toBe(37);
    expect(frameOfBox(box({ sourceTimeMs: 10_520 }), FPS, OFFSET)).toBe(38);
    expect(frameOfBox(box(), null, OFFSET)).toBeNull();
  });

  it("a box stored at a frame start lands on that frame after any round trip", () => {
    const stored = snapSourceTimeMs(1_519, FPS, OFFSET);
    expect(frameOfBox(box({ sourceTimeMs: stored }), FPS, OFFSET)).toBe(37);
  });
});

describe("which boxes to draw", () => {
  const boxes = [
    box({ id: "a", sourceTimeMs: 10_480 }),
    box({ id: "b", sourceTimeMs: 10_500 }),
    box({ id: "c", sourceTimeMs: 10_520 }),
  ];

  it("shows the boxes on the current frame, by the floor rule", () => {
    expect(boxesOnFrame(boxes, 1_500, FPS, OFFSET).map((b) => b.id)).toEqual(["a", "b"]);
    expect(boxesOnFrame(boxes, 1_539, FPS, OFFSET).map((b) => b.id)).toEqual(["c"]);
    expect(boxesOnFrame(boxes, 1_000, FPS, OFFSET)).toEqual([]);
  });

  it("falls back to an exact millisecond without a frame rate", () => {
    expect(boxesOnFrame(boxes, 1_500, null, OFFSET).map((b) => b.id)).toEqual(["b"]);
  });

  it("lists the frames that carry boxes, once each, in order", () => {
    expect(framesWithBoxes(boxes, FPS, OFFSET)).toEqual([37, 38]);
    expect(framesWithBoxes(boxes, null, OFFSET)).toEqual([]);
  });

  it("counts by class, including the classes with none", () => {
    expect(countByClass([box(), box({ class: "ball" }), box()])).toEqual({
      player: 2,
      goalkeeper: 0,
      referee: 0,
      ball: 1,
    });
  });
});

describe("reading a previous attempt back", () => {
  it("keeps well-formed boxes and gives each a key", () => {
    const parsed = parseStoredBoxes({
      boxes: [
        { sourceTimeMs: 10_500, class: "ball", x: 0.5, y: 0.5, width: 0.02, height: 0.03, uncertain: true },
        { sourceTimeMs: 10_500, class: "player", x: 0.1, y: 0.1, width: 0.1, height: 0.2, fromModelVersionId: "mv-1" },
      ],
    });
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ class: "ball", uncertain: true });
    expect(parsed[1]).toMatchObject({ fromModelVersionId: "mv-1" });
    expect(parsed[0]!.id).not.toBe(parsed[1]!.id);
  });

  it("drops an odd entry rather than blanking the picture", () => {
    const parsed = parseStoredBoxes({
      boxes: [
        { sourceTimeMs: 10_500, class: "player", x: 0.1, y: 0.1, width: 0.1, height: 0.2 },
        { sourceTimeMs: "soon", class: "player", x: 0.1, y: 0.1, width: 0.1, height: 0.2 },
        { sourceTimeMs: 10_500, class: "dog", x: 0.1, y: 0.1, width: 0.1, height: 0.2 },
        null,
        7,
      ],
    });
    expect(parsed).toHaveLength(1);
  });

  it("reads nothing from a Phase 2 payload", () => {
    expect(parseStoredBoxes({ uncertain: false, notes: null })).toEqual([]);
    expect(parseStoredBoxes(null)).toEqual([]);
    expect(parseStoredBoxes({ boxes: "none" })).toEqual([]);
  });

  it("strips the screen's key and nothing else on the way out", () => {
    expect(toPayloadBoxes([box({ uncertain: true, fromModelVersionId: "mv-1" })])).toEqual([
      {
        sourceTimeMs: 10_500,
        class: "player",
        x: 0.1,
        y: 0.2,
        width: 0.05,
        height: 0.1,
        uncertain: true,
        fromModelVersionId: "mv-1",
      },
    ]);
  });
});

describe("linking a new box to a track", () => {
  const prev = [box({ id: "p1", trackId: "3" }), box({ id: "p2", trackId: "4", x: 0.6 }), box({ id: "p3", class: "ball", trackId: "9" })];

  it("inherits the track of the overlapping same-class box on the previous frame", () => {
    expect(inheritTrackId({ x: 0.105, y: 0.2, width: 0.05, height: 0.1 }, "player", prev)).toBe("3");
  });

  it("does not link across classes, or below the overlap threshold, or to an unlinked box", () => {
    // No referee on the previous frame, however well the player there overlaps.
    expect(inheritTrackId({ x: 0.1, y: 0.2, width: 0.05, height: 0.1 }, "referee", prev)).toBeNull();
    expect(inheritTrackId({ x: 0.3, y: 0.2, width: 0.05, height: 0.1 }, "player", prev)).toBeNull();
    expect(inheritTrackId({ x: 0.1, y: 0.2, width: 0.05, height: 0.1 }, "player", [box({ id: "u" })])).toBeNull();
  });

  it("picks the best overlap when two candidates qualify", () => {
    const two = [box({ id: "a", trackId: "1", x: 0.1 }), box({ id: "b", trackId: "2", x: 0.11 })];
    expect(inheritTrackId({ x: 0.112, y: 0.2, width: 0.05, height: 0.1 }, "player", two)).toBe("2");
  });

  it("hands out the next numeric id, past any the annotator typed", () => {
    expect(nextTrackId([])).toBe("1");
    expect(nextTrackId([box({ trackId: "3" }), box({ trackId: "7" }), box({ trackId: "A" })])).toBe("8");
  });

  it("counts distinct tracks per class", () => {
    expect(countTracks([box({ trackId: "1" }), box({ trackId: "1" }), box({ trackId: "2" }), box({ class: "ball", trackId: "1" }), box()])).toBe(3);
  });

  it("computes overlap by hand", () => {
    expect(boxIou({ x: 0, y: 0, width: 2, height: 2 }, { x: 1, y: 1, width: 2, height: 2 })).toBeCloseTo(1 / 7);
  });

  it("keeps a track id through a stored payload and out again", () => {
    const parsed = parseStoredBoxes({ boxes: [{ sourceTimeMs: 10_500, class: "player", x: 0.1, y: 0.1, width: 0.1, height: 0.2, trackId: 4 }] });
    expect(parsed[0]!.trackId).toBe("4");
    expect(toPayloadBoxes(parsed)[0]).toMatchObject({ trackId: "4" });
  });
});

describe("a drag on a letterboxed stage", () => {
  // A 16:9 clip in a column 1600 px wide whose video may be no taller than 558 px: the
  // picture is 992 x 558 in the middle, with a 304 px bar either side.
  const stage = { width: 1600, height: 558 };
  const picture = pictureRect(stage, { width: 1280, height: 720 });
  const drag = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const end = pointOnPicture(to, picture);
    return rectFromDrag(pointOnPicture(from, picture), end, end);
  };

  it("has the picture in the middle, with a bar either side", () => {
    expect(picture).toEqual({ x: 304, y: 0, width: 992, height: 558 });
  });

  it("stores a box as a fraction of the picture, not of the element", () => {
    // The left half of the picture, full height.
    expect(drag({ x: 304, y: 0 }, { x: 800, y: 558 })).toEqual({ x: 0, y: 0, width: 0.5, height: 1 });
    // Measured against the element, bars included, the same drag was x 0.19, width 0.31.
    expect(rectFromDrag({ x: 304, y: 0 }, { x: 800, y: 558 }, stage)).toEqual({ x: 0.19, y: 0, width: 0.31, height: 1 });
    // A box in the middle of the picture.
    expect(drag({ x: 304 + 248, y: 139.5 }, { x: 304 + 744, y: 418.5 })).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  });

  it("clamps a drag that starts or ends on a bar to the picture's edge", () => {
    expect(drag({ x: 100, y: 100 }, { x: 800, y: 300 })).toMatchObject({ x: 0, width: 0.5 });
    expect(drag({ x: 800, y: 100 }, { x: 1590, y: 300 })).toMatchObject({ x: 0.5, width: 0.5 });
    // Wholly on a bar: no box.
    expect(drag({ x: 10, y: 100 }, { x: 200, y: 300 })).toBeNull();
  });

  it("is the element itself when the picture fills it", () => {
    const exact = pictureRect({ width: 1280, height: 720 }, { width: 1280, height: 720 });
    const end = pointOnPicture({ x: 640, y: 360 }, exact);
    expect(rectFromDrag(pointOnPicture({ x: 0, y: 0 }, exact), end, end)).toEqual({ x: 0, y: 0, width: 0.5, height: 0.5 });
  });
});
