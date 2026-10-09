/**
 * Game state in the browser: the rows under the tactical minimap.
 *
 * The chunks are Parquet in object storage, written by the `gamestate` stage
 * (docs/vision/42). The API hands out a presigned URL per chunk and reads none
 * of the rows (docs/vision/01: the review UI fetches Parquet directly), so this
 * module fetches the chunk covering the playhead, decodes it with hyparquet,
 * indexes its rows by frame, and keeps the last few chunks so scrubbing within
 * a minute costs nothing. The suppression rule arrives in the data: a row with
 * no metres carries a reason, and the minimap says so rather than drawing it.
 *
 * Pure logic, kept out of the component so it can be tested against a chunk the
 * worker actually wrote.
 */

import { parquetReadObjects } from "hyparquet";
import { DEFAULT_PITCH_DIMENSIONS, type GAMESTATE_SUPPRESSION_REASONS } from "@dtp/vision-contracts";

export type GameStateRow = {
  frameIndex: number;
  sourceMs: number;
  half: number | null;
  matchMinute: number | null;
  localTrackId: number;
  class: string;
  xM: number | null;
  yM: number | null;
  cameraSegmentId: string | null;
  quality: string | null;
  reason: string | null;
};

export type ChunkRef = { key: string; url: string; bytes: number | null; index: number | null; fromMs: number | null; toMs: number | null };

export type DecodedChunk = { ref: ChunkRef; rows: GameStateRow[]; byFrame: Map<number, GameStateRow[]> };

export type PitchDims = { lengthM: number; widthM: number };
export const DEFAULT_PITCH: PitchDims = DEFAULT_PITCH_DIMENSIONS;

/** The chunk whose source-time range holds this millisecond, or null between or beyond them. */
export function chunkCovering(chunks: readonly ChunkRef[], sourceMs: number): ChunkRef | null {
  return chunks.find((c) => c.fromMs !== null && c.toMs !== null && sourceMs >= c.fromMs && sourceMs < c.toMs) ?? null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  return null;
}
function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

/** One Parquet row, as hyparquet hands it back, into a row this screen can trust. */
export function toRow(raw: Record<string, unknown>): GameStateRow {
  return {
    frameIndex: num(raw.frame_index) ?? -1,
    sourceMs: num(raw.source_ms) ?? -1,
    half: num(raw.half),
    matchMinute: num(raw.match_minute),
    localTrackId: num(raw.local_track_id) ?? -1,
    class: str(raw.class) ?? "player",
    xM: num(raw.x_m),
    yM: num(raw.y_m),
    cameraSegmentId: str(raw.camera_segment_id),
    quality: str(raw.quality),
    reason: str(raw.reason),
  };
}

/** Rows grouped by proxy frame, the key the playhead already uses for boxes. */
export function indexByFrame(rows: readonly GameStateRow[]): Map<number, GameStateRow[]> {
  const out = new Map<number, GameStateRow[]>();
  for (const r of rows) {
    const list = out.get(r.frameIndex);
    if (list) list.push(r);
    else out.set(r.frameIndex, [r]);
  }
  return out;
}

/** Decode a whole chunk from its bytes. Snappy is the one codec hyparquet carries, and the one the worker writes. */
export async function decodeChunk(ref: ChunkRef, bytes: ArrayBuffer): Promise<DecodedChunk> {
  const file = { byteLength: bytes.byteLength, slice: (start: number, end?: number) => bytes.slice(start, end) };
  const raw = (await parquetReadObjects({ file })) as Record<string, unknown>[];
  const rows = raw.map(toRow);
  return { ref, rows, byFrame: indexByFrame(rows) };
}

/** The rows on a proxy frame; none when the chunk has no row there (a frame no track was seen on). */
export function rowsOnFrame(chunk: DecodedChunk | null, frameIndex: number | null): GameStateRow[] {
  if (!chunk || frameIndex === null) return [];
  return chunk.byFrame.get(frameIndex) ?? [];
}

/** Without a frame rate: the rows nearest the millisecond, within half a typical frame. */
export function rowsNear(chunk: DecodedChunk | null, sourceMs: number, toleranceMs = 50): GameStateRow[] {
  if (!chunk) return [];
  let best: number | null = null;
  for (const r of chunk.rows) {
    const d = Math.abs(r.sourceMs - sourceMs);
    if (d <= toleranceMs && (best === null || d < Math.abs(best - sourceMs))) best = r.sourceMs;
  }
  return best === null ? [] : chunk.rows.filter((r) => r.sourceMs === best);
}

/** The last few decoded chunks, most recently used last. Four minutes of a match, by default. */
export class ChunkCache {
  private readonly chunks = new Map<string, DecodedChunk>();

  constructor(private readonly capacity = 4) {}

  get(key: string): DecodedChunk | null {
    const hit = this.chunks.get(key);
    if (!hit) return null;
    this.chunks.delete(key);
    this.chunks.set(key, hit);
    return hit;
  }

  put(chunk: DecodedChunk): void {
    this.chunks.delete(chunk.ref.key);
    this.chunks.set(chunk.ref.key, chunk);
    while (this.chunks.size > this.capacity) {
      const oldest = this.chunks.keys().next().value;
      if (oldest === undefined) break;
      this.chunks.delete(oldest);
    }
  }

  keys(): string[] {
    return [...this.chunks.keys()];
  }
}

/** Fetch a chunk from its presigned URL and decode it. One plain GET: no range requests, so one CORS preflight at most. */
export async function loadChunk(ref: ChunkRef, fetchImpl: typeof fetch = fetch): Promise<DecodedChunk> {
  const res = await fetchImpl(ref.url);
  if (!res.ok) throw new Error(`The bucket answered ${res.status} for ${ref.key.split("/").pop()}.`);
  return decodeChunk(ref, await res.arrayBuffer());
}

/**
 * Why a chunk could not be read, in words a reviewer can act on. A browser reports
 * a CORS refusal as a bare network failure, so that is named first: it is the
 * one failure this screen expects until the bucket's rule is set (docs/vision/36).
 */
export function explainChunkFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "The browser could not read the chunk from the bucket. This is almost always the bucket's CORS rule: it must allow GET from this site. The positions exist; the minimap cannot see them from here.";
  }
  return `The chunk could not be read: ${message}`;
}

// ── Geometry ────────────────────────────────────────────────────────────────

/** The pitch's markings in metres, mirrored from the API's pitch model for drawing only. */
export const PENALTY_AREA_DEPTH_M = 16.5;
export const PENALTY_AREA_WIDTH_M = 40.32;
export const GOAL_AREA_DEPTH_M = 5.5;
export const GOAL_AREA_WIDTH_M = 18.32;
export const PENALTY_SPOT_M = 11;
export const CENTRE_CIRCLE_RADIUS_M = 9.15;

export type Polyline = { id: string; points: [number, number][] };

export function pitchLines(dims: PitchDims = DEFAULT_PITCH): Polyline[] {
  const L = dims.lengthM;
  const W = dims.widthM;
  const mid = W / 2;
  const lines: Polyline[] = [];
  lines.push({ id: "outline", points: [[0, 0], [L, 0], [L, W], [0, W], [0, 0]] });
  lines.push({ id: "halfway", points: [[L / 2, 0], [L / 2, W]] });
  const circle: [number, number][] = [];
  for (let i = 0; i <= 36; i += 1) {
    const a = (i / 36) * Math.PI * 2;
    circle.push([L / 2 + CENTRE_CIRCLE_RADIUS_M * Math.cos(a), mid + CENTRE_CIRCLE_RADIUS_M * Math.sin(a)]);
  }
  lines.push({ id: "centre_circle", points: circle });
  for (const [side, x0, dir] of [["left", 0, 1], ["right", L, -1]] as const) {
    const boxX = x0 + dir * PENALTY_AREA_DEPTH_M;
    const goalX = x0 + dir * GOAL_AREA_DEPTH_M;
    lines.push({ id: `${side}_box`, points: [[x0, mid - PENALTY_AREA_WIDTH_M / 2], [boxX, mid - PENALTY_AREA_WIDTH_M / 2], [boxX, mid + PENALTY_AREA_WIDTH_M / 2], [x0, mid + PENALTY_AREA_WIDTH_M / 2]] });
    lines.push({ id: `${side}_goal_area`, points: [[x0, mid - GOAL_AREA_WIDTH_M / 2], [goalX, mid - GOAL_AREA_WIDTH_M / 2], [goalX, mid + GOAL_AREA_WIDTH_M / 2], [x0, mid + GOAL_AREA_WIDTH_M / 2]] });
  }
  return lines;
}

/** Spots that are points, not lines: the penalty spots and the centre spot. */
export function pitchSpots(dims: PitchDims = DEFAULT_PITCH): [number, number][] {
  return [[PENALTY_SPOT_M, dims.widthM / 2], [dims.lengthM - PENALTY_SPOT_M, dims.widthM / 2], [dims.lengthM / 2, dims.widthM / 2]];
}

/** Margin of grass drawn around the pitch, in metres. */
export const MINIMAP_MARGIN_M = 3;

/** The SVG viewBox for a pitch: metres are the unit, with a margin all round. */
export function minimapViewBox(dims: PitchDims = DEFAULT_PITCH): string {
  return `${-MINIMAP_MARGIN_M} ${-MINIMAP_MARGIN_M} ${dims.lengthM + 2 * MINIMAP_MARGIN_M} ${dims.widthM + 2 * MINIMAP_MARGIN_M}`;
}

/** Whether a placed point is on the drawn grass, margin included; a wildly wrong point is not drawn off the edge. */
export function onMinimap(xM: number, yM: number, dims: PitchDims = DEFAULT_PITCH): boolean {
  return xM >= -MINIMAP_MARGIN_M && xM <= dims.lengthM + MINIMAP_MARGIN_M && yM >= -MINIMAP_MARGIN_M && yM <= dims.widthM + MINIMAP_MARGIN_M;
}

// ── Words ───────────────────────────────────────────────────────────────────

/** Keyed by the contract's reasons, so a reason added there without words here does not compile. */
const SUPPRESSION_WORDS: Record<(typeof GAMESTATE_SUPPRESSION_REASONS)[number], string> = {
  no_camera_segment: "no camera segment",
  segment_not_calibrated: "segment not calibrated",
  calibration_failed: "calibration failed",
  calibration_not_carried: "camera not followed here",
  beyond_horizon: "beyond the horizon",
  off_pitch: "far off the pitch",
};

export const REASON_WORDS: Record<string, string> = SUPPRESSION_WORDS;

/** `11 placed · 2 not placed: calibration failed`, or why nothing is. */
export function describeFrame(rows: readonly GameStateRow[]): string {
  if (!rows.length) return "no track on this frame";
  const placed = rows.filter((r) => r.xM !== null).length;
  const reasons = new Map<string, number>();
  for (const r of rows) if (r.xM === null) reasons.set(r.reason ?? "unknown", (reasons.get(r.reason ?? "unknown") ?? 0) + 1);
  const parts = [`${placed} placed`];
  if (reasons.size) {
    parts.push(`${rows.length - placed} not placed: ${[...reasons.entries()].map(([k, n]) => `${REASON_WORDS[k] ?? k}${reasons.size > 1 ? ` (${n})` : ""}`).join(", ")}`);
  }
  return parts.join(" · ");
}

/** `placed on 41% of frames · 2 of 3 segments calibrated`. */
export function describeCoverage(
  coverage: { validFrameCoverage: number | null; frames: number | null; coverageBasis?: string | null } | null,
  placedWith: { segments: number; calibrations: number } | null
): string {
  if (!coverage) return "no game state yet";
  // An older run measured against the frames that had a track on them, which reads higher; say which.
  const of = coverage.coverageBasis === "frames_tracked" ? "frames" : "frames with a track";
  const share = coverage.validFrameCoverage === null ? "no frame" : `${Math.round(coverage.validFrameCoverage * 100)}% of ${of}`;
  const segs = placedWith ? ` · ${placedWith.calibrations} of ${placedWith.segments} segment(s) calibrated` : "";
  return `placed on ${share}${segs}`;
}
