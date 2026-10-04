/**
 * Box mathematics for the annotation workstation.
 *
 * Pure, like `annotation-time.ts`, and for the same reason: this is where a label
 * gets silently corrupted, and it has to be testable without a DOM. Three rules,
 * each of which produces a plausible wrong box if broken:
 *
 *   - **A box is stored in SOURCE time and NORMALISED coordinates.** The proxy is
 *     a viewing convenience; a box tied to proxy pixels is wrong the moment the
 *     clip is re-cut or re-encoded at another size.
 *   - **A box's time is the START of the frame it was drawn on.** The export floors
 *     a time to a frame. Storing the scrubber's arbitrary millisecond would let a
 *     box drawn on frame 37 be stored at 37.9 and still land on 37 -- until a
 *     re-transcode nudges the rate, when it lands on 38.
 *   - **"Which frame is this box on" is decided by the same floor rule** the
 *     export uses, so the overlay shows exactly the boxes the corpus will carry.
 *
 * The contract's own rule lives in `packages/vision-contracts/src/annotation.ts`;
 * this app does not depend on that package (see docs/vision/26 § seam), so the
 * class list is mirrored here and the API refuses anything this file got wrong.
 */
import { frameIndexAt, frameStartMs, toProxyMs, toSourceMs } from "./annotation-time";

/** Mirrors `DETECTION_CLASSES` in the contracts. The API is the authority. */
export const DETECTION_CLASSES = ["player", "goalkeeper", "referee", "ball"] as const;
export type DetectionClass = (typeof DETECTION_CLASSES)[number];

/** What the payload carries. Matches `AnnotationBox` in the contracts. */
export type AnnotationBox = {
  sourceTimeMs: number;
  class: DetectionClass;
  x: number;
  y: number;
  width: number;
  height: number;
  uncertain?: boolean;
  fromModelVersionId?: string | null;
  /** The same id on boxes across frames says "the same player". Local to the task. */
  trackId?: string;
};

/** A box on screen: the payload's shape plus a key React can track it by. */
export type DraftBox = AnnotationBox & { id: string };

export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

/** Below this, in pixels on screen, a drag is a click and not a box. */
export const MIN_BOX_PX = 4;

let counter = 0;
export function newBoxId(): string {
  counter += 1;
  return `box-${Date.now().toString(36)}-${counter}`;
}

/**
 * The normalised rectangle a drag describes, or null when it is too small to be a
 * box. Either corner may be the start, and the rectangle is clamped to the frame:
 * a drag that leaves the picture still means "to the edge".
 */
export function rectFromDrag(start: Point, end: Point, stage: Size): Rect | null {
  if (stage.width <= 0 || stage.height <= 0) return null;
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);
  if (right - left < MIN_BOX_PX || bottom - top < MIN_BOX_PX) return null;

  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  const x = clamp(left, stage.width) / stage.width;
  const y = clamp(top, stage.height) / stage.height;
  const width = clamp(right, stage.width) / stage.width - x;
  const height = clamp(bottom, stage.height) / stage.height - y;
  if (width <= 0 || height <= 0) return null;
  return {
    x: round(x),
    y: round(y),
    width: round(Math.min(width, 1 - x)),
    height: round(Math.min(height, 1 - y)),
  };
}

/** Four decimals: a tenth of a pixel at 4K, and a payload that is not drowning in digits. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * The SOURCE time a box drawn at this proxy position is stored at: the start of
 * the frame, not the scrubber's millisecond. Without a frame rate there is no
 * frame to snap to, so the position is kept as it is.
 */
export function snapSourceTimeMs(proxyMs: number, fps: number | null, offsetMs: number): number {
  const frame = frameIndexAt(proxyMs, fps);
  const start = frame === null ? proxyMs : (frameStartMs(frame, fps) ?? proxyMs);
  return Math.round(toSourceMs(start, offsetMs));
}

/** Which proxy frame a box sits on, by the export's floor rule. Null without a frame rate. */
export function frameOfBox(box: AnnotationBox, fps: number | null, offsetMs: number): number | null {
  return frameIndexAt(toProxyMs(box.sourceTimeMs, offsetMs), fps);
}

/**
 * The boxes to draw at this position: those on the same frame when the rate is
 * known, otherwise those at exactly this millisecond.
 */
export function boxesOnFrame<T extends AnnotationBox>(
  boxes: readonly T[],
  proxyMs: number,
  fps: number | null,
  offsetMs: number
): T[] {
  const here = frameIndexAt(proxyMs, fps);
  if (here === null) {
    const sourceMs = Math.round(toSourceMs(proxyMs, offsetMs));
    return boxes.filter((b) => b.sourceTimeMs === sourceMs);
  }
  return boxes.filter((b) => frameOfBox(b, fps, offsetMs) === here);
}

/** Boxes per class, for the running total beside the picker. */
export function countByClass(boxes: readonly AnnotationBox[]): Record<DetectionClass, number> {
  const counts = { player: 0, goalkeeper: 0, referee: 0, ball: 0 };
  for (const box of boxes) counts[box.class] += 1;
  return counts;
}

/** The frames that carry at least one box, ascending, for the strip under the scrubber. */
export function framesWithBoxes(
  boxes: readonly AnnotationBox[],
  fps: number | null,
  offsetMs: number
): number[] {
  const frames = new Set<number>();
  for (const box of boxes) {
    const frame = frameOfBox(box, fps, offsetMs);
    if (frame !== null) frames.add(frame);
  }
  return [...frames].sort((a, b) => a - b);
}

/**
 * Read a previous submission's boxes back, keeping only well-formed ones.
 *
 * Tolerant on purpose: a correction starts from the last attempt, and one odd entry
 * in an old payload must not blank the whole picture. The API applies the strict
 * rule on submit; this only decides what to show.
 */
export function parseStoredBoxes(payload: unknown): DraftBox[] {
  if (!payload || typeof payload !== "object") return [];
  const raw = (payload as { boxes?: unknown }).boxes;
  if (!Array.isArray(raw)) return [];

  const out: DraftBox[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const b = entry as Record<string, unknown>;
    const nums = [b.sourceTimeMs, b.x, b.y, b.width, b.height];
    if (!nums.every((v) => typeof v === "number" && Number.isFinite(v))) continue;
    if (typeof b.class !== "string" || !(DETECTION_CLASSES as readonly string[]).includes(b.class)) continue;
    out.push({
      id: newBoxId(),
      sourceTimeMs: b.sourceTimeMs as number,
      class: b.class as DetectionClass,
      x: b.x as number,
      y: b.y as number,
      width: b.width as number,
      height: b.height as number,
      ...(b.uncertain === true ? { uncertain: true } : {}),
      ...(typeof b.fromModelVersionId === "string" ? { fromModelVersionId: b.fromModelVersionId } : {}),
      ...(typeof b.trackId === "string" || typeof b.trackId === "number" ? { trackId: String(b.trackId) } : {}),
    });
  }
  return out;
}

/** Overlap at or above which a new box is taken to be the same thing as one on the previous frame. */
export const LINK_IOU = 0.5;

export function boxIou(a: Rect, b: Rect): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * The track a freshly drawn box most likely continues: the best-overlapping box
 * of the same class on the previous frame, if it overlaps enough and has a track.
 * Null when there is nothing to continue -- the caller then starts a new track.
 * A suggestion the reviewer can override with N; never a silent merge of two
 * players, because the threshold is high and the class must agree.
 */
export function inheritTrackId(rect: Rect, cls: DetectionClass, previousFrame: readonly AnnotationBox[]): string | null {
  let best: { trackId: string; iou: number } | null = null;
  for (const b of previousFrame) {
    if (b.class !== cls || b.trackId === undefined) continue;
    const overlap = boxIou(rect, b);
    if (overlap >= LINK_IOU && (!best || overlap > best.iou)) best = { trackId: b.trackId, iou: overlap };
  }
  return best?.trackId ?? null;
}

/** The next unused numeric track id in this task: one more than the largest so far. */
export function nextTrackId(boxes: readonly AnnotationBox[]): string {
  let max = 0;
  for (const b of boxes) {
    const n = b.trackId !== undefined ? Number(b.trackId) : Number.NaN;
    if (Number.isInteger(n) && n > max) max = n;
  }
  return String(max + 1);
}

/** Distinct tracks in the window, for the running count. */
export function countTracks(boxes: readonly AnnotationBox[]): number {
  return new Set(boxes.filter((b) => b.trackId !== undefined).map((b) => `${b.class}:${b.trackId}`)).size;
}

/** The payload's shape: the screen's key stripped, nothing else changed. */
export function toPayloadBoxes(boxes: readonly DraftBox[]): AnnotationBox[] {
  return boxes.map(({ id: _id, ...box }) => box);
}

/**
 * A pointer position on the stage, as a position on the picture.
 *
 * The video is as wide as its column and no taller than 62% of the window, so on
 * a wide window it is letterboxed: the picture sits in the middle of the element
 * with a bar either side. A box is stored as fractions of the *picture*. Dragging
 * was measured against the whole element, bars included, so on a wide window
 * every stored x and width was wrong, and the benchmark scores models against
 * those boxes (docs/vision/50 C6).
 *
 * `picture` is where the picture sits inside the stage (`pictureRect`). The
 * result is in the picture's own pixels, with the picture's size, which is what
 * `rectFromDrag` divides by; a point on a bar comes out negative or past the
 * width, and `rectFromDrag` clamps it to the picture's edge.
 */
export function pointOnPicture(pointer: Point, picture: { x: number; y: number; width: number; height: number }): Point & Size {
  return { x: pointer.x - picture.x, y: pointer.y - picture.y, width: picture.width, height: picture.height };
}
