import { describe, expect, it } from "vitest";
import type { VisionCameraSegment, VisionPitchLandmark } from "../../../api/vision";
import { CAMERA_SEGMENT_KINDS } from "@dtp/vision-contracts";
import { SEGMENT_KIND_WORDS, clickToProxyPixel, describeCarried, keyframeFrameOf, describeQuality, describeSegment, fitReason, nextLandmark, overlayPaths, pictureRect, placePoint, removePoint, segmentAt, segmentFromMarks, toFraction } from "./calibration-editor";

const PROXY = { width: 1280, height: 720 };

describe("clicks and pixels", () => {
  it("finds the letterboxed picture inside the element", () => {
    // A 16:9 picture in a wider element: bars at the sides.
    const boxed = pictureRect({ width: 856, height: 446 }, PROXY);
    expect(boxed.y).toBe(0);
    expect(boxed.height).toBe(446);
    expect(boxed.width).toBeCloseTo(446 * (16 / 9), 6);
    expect(boxed.x).toBeCloseTo((856 - 446 * (16 / 9)) / 2, 6);
    // In a taller element: bars above and below.
    expect(pictureRect({ width: 640, height: 480 }, PROXY)).toEqual({ x: 0, y: 60, width: 640, height: 360 });
    // A matching element: the whole of it.
    expect(pictureRect({ width: 640, height: 360 }, PROXY)).toEqual({ x: 0, y: 0, width: 640, height: 360 });
    expect(pictureRect({ width: 0, height: 0 }, PROXY)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("turns a click in the element into the proxy's own pixel, through the picture", () => {
    const picture = { x: 0, y: 0, width: 640, height: 360 };
    expect(clickToProxyPixel({ x: 320, y: 90 }, picture, PROXY)).toEqual({ px: 640, py: 180 });
    expect(clickToProxyPixel({ x: 0, y: 0 }, picture, PROXY)).toEqual({ px: 0, py: 0 });
    expect(clickToProxyPixel({ x: 641, y: 0 }, picture, PROXY)).toBeNull();
    // A click on a side bar is not on the picture.
    const boxed = pictureRect({ width: 856, height: 446 }, PROXY);
    expect(clickToProxyPixel({ x: 5, y: 100 }, boxed, PROXY)).toBeNull();
    expect(clickToProxyPixel({ x: boxed.x + boxed.width / 2, y: boxed.y + boxed.height / 4 }, boxed, PROXY)).toEqual({ px: 640, py: 180 });
    expect(clickToProxyPixel({ x: 1, y: 1 }, { x: 0, y: 0, width: 0, height: 360 }, PROXY)).toBeNull();
    expect(clickToProxyPixel({ x: 1, y: 1 }, picture, { width: 0, height: 0 })).toBeNull();
  });

  it("and back to a fraction of the picture", () => {
    expect(toFraction({ px: 640, py: 180 }, PROXY)).toEqual({ x: 0.5, y: 0.25 });
  });

  it("draws an overlay polyline as path data in a hundred-unit box", () => {
    const paths = overlayPaths([{ id: "halfway", points: [{ px: 640, py: 0 }, { px: 640, py: 720 }] }, { id: "stub", points: [{ px: 1, py: 1 }] }], PROXY);
    expect(paths).toEqual([{ id: "halfway", d: "M50.00 0.00 L50.00 100.00" }]);
    expect(overlayPaths([], { width: 0, height: 0 })).toEqual([]);
  });
});

describe("placing landmarks", () => {
  const landmarks: VisionPitchLandmark[] = [
    { id: "centre_spot", name: "Centre spot", xM: 52.5, yM: 34 },
    { id: "corner_left_near", name: "Left corner, near", xM: 0, yM: 0 },
    { id: "left_post_near", name: "Left near post", xM: 0, yM: 30.34 },
  ];

  it("asks for landmarks in a wide shot's order, then whatever is left", () => {
    expect(nextLandmark(landmarks, [])?.id).toBe("corner_left_near");
    expect(nextLandmark(landmarks, [{ landmark: "corner_left_near", px: 1, py: 1 }])?.id).toBe("centre_spot");
    expect(nextLandmark(landmarks, [{ landmark: "corner_left_near", px: 1, py: 1 }, { landmark: "centre_spot", px: 2, py: 2 }])?.id).toBe("left_post_near");
    expect(nextLandmark(landmarks, landmarks.map((l) => ({ landmark: l.id, px: 0, py: 0 })))).toBeNull();
  });

  it("places one click per landmark, the latest winning, and removes by name", () => {
    const a = placePoint([], { landmark: "centre_spot", px: 10, py: 10 });
    const b = placePoint(a, { landmark: "centre_spot", px: 20, py: 20 });
    expect(b).toEqual([{ landmark: "centre_spot", px: 20, py: 20 }]);
    const c = placePoint(b, { landmark: "corner_left_near", px: 1, py: 1 });
    expect(removePoint(c, "centre_spot")).toEqual([{ landmark: "corner_left_near", px: 1, py: 1 }]);
  });
});

describe("segments and words", () => {
  const seg = (over: Partial<VisionCameraSegment> = {}): VisionCameraSegment => ({
    id: "s1", kind: "live_play", source: "manual", startMs: 9000, endMs: 60000, calibration: null, superseded: 0, ...over,
  });
  const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

  it("finds the segment at the playhead half-open, as the API and worker do", () => {
    // Shots meet edge to edge: the cut's first frame belongs to the next shot.
    const segments = [seg(), seg({ id: "s2", startMs: 60000, endMs: 120000 })];
    expect(segmentAt(segments, 9000)?.id).toBe("s1");
    expect(segmentAt(segments, 59999)?.id).toBe("s1");
    expect(segmentAt(segments, 60000)?.id).toBe("s2");
    expect(segmentAt(segments, 120000)).toBeNull();
    expect(segmentAt(segments, 8999)).toBeNull();
  });

  it("names a proposal by what proposed it until a person labels it", () => {
    const clockWords = (ms: number) => `${ms}`;
    expect(describeSegment(seg({ source: "camera_motion", kind: "unknown" }), clockWords)).toMatch(/^proposed shot · /);
    expect(describeSegment(seg({ source: "scene_detect", kind: "unknown" }), clockWords)).toMatch(/^proposed cut · /);
    expect(describeSegment(seg({ source: "manual", kind: "replay" }), clockWords)).toMatch(/^replay · /);
  });

  it("describes a fit and a segment in words a reviewer reads", () => {
    expect(describeQuality({ quality: "good", reprojectionErrorM: 0.4219, points: 6 })).toBe("good · 0.42 m over 6 landmark(s)");
    expect(describeSegment(seg(), clock)).toBe("live play · 0:09–1:00 · not calibrated");
    // A row from before the kinds were the contract's keeps its own word until it is migrated.
    expect(describeSegment({ ...seg(), kind: "wide" }, clock)).toBe("wide · 0:09–1:00 · not calibrated");
    // Every kind the contract has, has words here.
    expect(Object.keys(SEGMENT_KIND_WORDS).sort()).toEqual([...CAMERA_SEGMENT_KINDS].sort());
    expect(describeSegment(seg({ source: "scene_detect", kind: "unknown", calibration: { quality: "usable", reprojectionErrorM: 1.5 } as never }), clock)).toBe("proposed cut · 0:09–1:00 · usable 1.50 m");
    expect(fitReason("too_few_points")).toContain("four");
    expect(fitReason("degenerate")).toContain("line");
    expect(fitReason("unknown_landmark", "dugout")).toContain("dugout");
    expect(fitReason("other")).toBe("other");
  });

  it("makes a segment from two marks, either way round, inside the footage", () => {
    expect(segmentFromMarks(60000.4, 9000, 120000)).toEqual({ startMs: 9000, endMs: 60000 });
    expect(segmentFromMarks(null, 9000, 120000)).toContain("both");
    expect(segmentFromMarks(9000, 9000, 120000)).toContain("empty");
    expect(segmentFromMarks(9000, 130000, 120000)).toContain("past");
    expect(segmentFromMarks(9000, 130000, null)).toEqual({ startMs: 9000, endMs: 130000 });
  });
});

describe("keyframes and the carried calibration, in words", () => {
  const clock = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
  it("allows a keyframe only from points all placed on the frame on screen", () => {
    expect(keyframeFrameOf([{ frameIndex: 50 }, { frameIndex: 50 }], 50)).toBe(50);
    expect(keyframeFrameOf([{ frameIndex: 50 }, { frameIndex: 51 }], 50)).toMatch(/another frame/);
    expect(keyframeFrameOf([{ frameIndex: 50 }], 51)).toMatch(/another frame/);
    expect(keyframeFrameOf([{}], 50)).toMatch(/another frame/);
    expect(keyframeFrameOf([], 50)).toMatch(/Place the landmarks/);
    expect(keyframeFrameOf([{ frameIndex: 0 }], null)).toMatch(/frame rate is unknown/);
  });

  it("says where a frame's calibration came from, or why there is none", () => {
    const carried = { H: [1, 0, 0, 0, 1, 0, 0, 0, 1], quality: "good", keyframe: 50, framesFromKeyframe: 12, reason: null };
    expect(describeCarried(carried, 25, clock)).toBe("Carried from the keyframe at 2.00s, 12 frame(s) away · good.");
    expect(describeCarried({ ...carried, keyframe: null, framesFromKeyframe: null }, 25, clock)).toBe("Whole-segment calibration · good.");
    expect(describeCarried({ ...carried, H: null, reason: "no_keyframe_in_shot" }, 25, clock)).toBe("No calibration here: no keyframe in this shot.");
    expect(describeCarried({ ...carried, H: null, reason: "beyond_reach" }, 25, clock)).toBe("No calibration here: too far from any keyframe in this shot.");
    expect(describeCarried(null, 25, clock)).toBe("No carried calibration for this frame.");
  });
});
