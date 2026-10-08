/**
 * The arithmetic under the calibration editor, kept out of the component.
 *
 * A click on the stage becomes a point in the proxy's own pixels; a point and a
 * polyline come back as fractions of the picture so they follow it at any size.
 * The next landmark to ask for is chosen in an order a person can follow round
 * the pitch. The segment at the playhead is the one a calibration is filed on.
 */

import type { VisionCalibrationPoint, VisionCalibrationQuality, VisionCameraSegment, VisionOverlay, VisionPitchLandmark } from "../../../api/vision";
import type { CameraSegmentKind } from "@dtp/vision-contracts";

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Where the picture sits inside a `<video>` element: the element keeps its own
 * box and letterboxes the picture into it (`object-fit: contain`), so a fraction
 * of the element is not a fraction of the picture. Every overlay and every click
 * is measured against this rectangle, in element pixels.
 */
export function pictureRect(element: { width: number; height: number }, proxy: { width: number; height: number }): Rect {
  if (element.width <= 0 || element.height <= 0 || proxy.width <= 0 || proxy.height <= 0) return { x: 0, y: 0, width: element.width, height: element.height };
  const scale = Math.min(element.width / proxy.width, element.height / proxy.height);
  const width = proxy.width * scale;
  const height = proxy.height * scale;
  return { x: (element.width - width) / 2, y: (element.height - height) / 2, width, height };
}

/** A click at (x, y) in the element is this proxy pixel, given where the picture sits in it. */
export function clickToProxyPixel(click: { x: number; y: number }, picture: Rect, proxy: { width: number; height: number }): { px: number; py: number } | null {
  if (picture.width <= 0 || picture.height <= 0 || proxy.width <= 0 || proxy.height <= 0) return null;
  const fx = (click.x - picture.x) / picture.width;
  const fy = (click.y - picture.y) / picture.height;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
  return { px: Math.round(fx * proxy.width * 10) / 10, py: Math.round(fy * proxy.height * 10) / 10 };
}

/** A proxy pixel as a fraction of the picture, for CSS. */
export function toFraction(p: { px: number; py: number }, proxy: { width: number; height: number }): { x: number; y: number } {
  return { x: p.px / proxy.width, y: p.py / proxy.height };
}

/** A polyline overlay as SVG path data in a 0-100 viewBox, points outside clipped by the SVG. */
export function overlayPaths(overlay: VisionOverlay, proxy: { width: number; height: number }): { id: string; d: string }[] {
  if (proxy.width <= 0 || proxy.height <= 0) return [];
  return overlay
    .filter((line) => line.points.length >= 2)
    .map((line) => ({
      id: line.id,
      d: line.points.map((p, i) => `${i === 0 ? "M" : "L"}${((p.px / proxy.width) * 100).toFixed(2)} ${((p.py / proxy.height) * 100).toFixed(2)}`).join(" "),
    }));
}

/**
 * The order to ask for landmarks: the ones a wide shot most often shows first,
 * so four clicks are usually enough to see the overlay, then the rest.
 */
export const LANDMARK_ORDER = [
  "corner_left_near",
  "corner_right_near",
  "halfway_near",
  "halfway_far",
  "centre_spot",
  "left_box_near",
  "left_box_far",
  "right_box_near",
  "right_box_far",
  "corner_left_far",
  "corner_right_far",
  "left_penalty_spot",
  "right_penalty_spot",
  "centre_circle_near",
  "centre_circle_far",
];

/** The next landmark not yet placed, in that order, then any other unplaced one. */
export function nextLandmark(landmarks: VisionPitchLandmark[], placed: VisionCalibrationPoint[]): VisionPitchLandmark | null {
  const used = new Set(placed.map((p) => p.landmark));
  const byId = new Map(landmarks.map((l) => [l.id, l]));
  for (const id of LANDMARK_ORDER) {
    const l = byId.get(id);
    if (l && !used.has(id)) return l;
  }
  return landmarks.find((l) => !used.has(l.id)) ?? null;
}

/** Place or move a landmark: one click per landmark, the latest wins. */
export function placePoint(placed: VisionCalibrationPoint[], point: VisionCalibrationPoint): VisionCalibrationPoint[] {
  return [...placed.filter((p) => p.landmark !== point.landmark), point];
}

export function removePoint(placed: VisionCalibrationPoint[], landmark: string): VisionCalibrationPoint[] {
  return placed.filter((p) => p.landmark !== landmark);
}

/**
 * The segment covering a moment in source time, if any. Half-open, `start <= t < end`,
 * as the API and the worker read it: at a cut the next shot's first frame belongs to
 * the next shot, so a calibration filed there lands where the pipeline will look.
 */
export function segmentAt(segments: VisionCameraSegment[], sourceMs: number): VisionCameraSegment | null {
  return segments.find((s) => s.startMs <= sourceMs && sourceMs < s.endMs) ?? null;
}

/**
 * A camera segment's kind, in words. Keyed by the contract's kinds, so a kind added
 * there without words here does not compile.
 */
export const SEGMENT_KIND_WORDS: Record<CameraSegmentKind, string> = {
  live_play: "live play",
  replay: "replay",
  intro: "intro",
  halftime: "half-time",
  camera_cut: "camera cut",
  unknown: "unknown",
};

/** `good · 0.42 m over 6 landmarks`, or why not. */
export function describeQuality(q: { quality: VisionCalibrationQuality; reprojectionErrorM: number; points: number }): string {
  return `${q.quality} · ${q.reprojectionErrorM.toFixed(2)} m over ${q.points} landmark(s)`;
}

export function fitReason(reason: string, detail?: string): string {
  switch (reason) {
    case "too_few_points":
      return "At least four landmarks are needed.";
    case "degenerate":
      return "These landmarks lie on a line, or too nearly so, to fix a view. Pick one off it.";
    case "duplicate_points":
      return "Two landmarks are on the same spot.";
    case "unknown_landmark":
      return `Unknown landmark${detail ? ` ${detail}` : ""}.`;
    default:
      return reason;
  }
}

/** Words for who proposed a segment nobody has labelled yet. */
export const PROPOSAL_WORDS: Record<string, string> = { scene_detect: "proposed cut", camera_motion: "proposed shot" };

/** A segment's label: `live play · 0:09–1:00 · good 0.42 m`, or `proposed shot · …`. */
export function describeSegment(s: VisionCameraSegment, formatClock: (ms: number) => string): string {
  const who = PROPOSAL_WORDS[s.source] ?? ((SEGMENT_KIND_WORDS as Record<string, string>)[s.kind] ?? s.kind);
  const cal = s.calibration ? `${s.calibration.quality} ${s.calibration.reprojectionErrorM.toFixed(2)} m` : "not calibrated";
  return `${who} · ${formatClock(s.startMs)}–${formatClock(s.endMs)} · ${cal}`;
}

/** What a declared segment from the two marks would be, or why not. */
export function segmentFromMarks(startMs: number | null, endMs: number | null, durationMs: number | null): { startMs: number; endMs: number } | string {
  if (startMs === null || endMs === null) return "Mark both the start and the end at the playhead.";
  const a = Math.round(Math.min(startMs, endMs));
  const b = Math.round(Math.max(startMs, endMs));
  if (b <= a) return "The segment is empty.";
  if (durationMs !== null && b > durationMs) return "The segment runs past the footage.";
  return { startMs: a, endMs: b };
}
