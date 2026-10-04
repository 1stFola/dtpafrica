import { describe, expect, it } from "vitest";
import {
  ChunkCache,
  chunkCovering,
  decodeChunk,
  REASON_WORDS,
  describeCoverage,
  describeFrame,
  indexByFrame,
  loadChunk,
  explainChunkFailure,
  minimapViewBox,
  onMinimap,
  pitchLines,
  pitchSpots,
  rowsNear,
  rowsOnFrame,
  toRow,
  type ChunkRef,
  type GameStateRow,
} from "./game-state";

/* A chunk the worker's `write_chunk` actually wrote (pyarrow, snappy): two tracks on
 * frames 0..2, placed through seg-a, and on frame 3 one under a failed calibration
 * and one under no segment. Kept as bytes so the decoder is tested against the
 * real schema, not a hand-made imitation of it. */
const CHUNK_B64 =
  "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RVFBQUFHTmhiV1Z5WVY5elpXZHRaVzUwWDJsa0FBQUFpUC8vLzdEKy8vOEFBQUVERUFBQUFCUUFBQUFFQUFBQUFBQUFBQU1BQUFCNVgyMEFRdi8vL3dBQUFnRFkvdi8vQUFBQkF4QUFBQUFVQUFBQUJBQUFBQUFBQUFBREFBQUFlRjl0QUdyLy8vOEFBQUlBQVAvLy93QUFBUVVRQUFBQUhBQUFBQVFBQUFBQUFBQUFCUUFBQUdOc1lYTnpBQUFBQkFBRUFBUUFBQUFzLy8vL0FBQUJBaEFBQUFBZ0FBQUFCQUFBQUFBQUFBQU9BQUFBYkc5allXeGZkSEpoWTJ0ZmFXUUFBQ0QvLy84QUFBQUJJQUFBQUdULy8vOEFBQUVERUFBQUFDUUFBQUFFQUFBQUFBQUFBQXdBQUFCdFlYUmphRjl0YVc1MWRHVUFBQVlBQ0FBR0FBWUFBQUFBQUFJQW5QLy8vd0FBQVFJUUFBQUFHQUFBQUFRQUFBQUFBQUFBQkFBQUFHaGhiR1lBQUFBQWlQLy8vd0FBQUFFSUFBQUF6UC8vL3dBQUFRSVFBQUFBSEFBQUFBUUFBQUFBQUFBQUNRQUFBSE52ZFhKalpWOXRjd0FBQUx6Ly8vOEFBQUFCUUFBQUFCQUFGQUFJQUFZQUJ3QU1BQUFBRUFBUUFBQUFBQUFCQWhBQUFBQWtBQUFBQkFBQUFBQUFBQUFMQUFBQVpuSmhiV1ZmYVc1a1pYZ0FDQUFNQUFnQUJ3QUlBQUFBQUFBQUFTQUFBQUFBQUFBQQAYIHBhcnF1ZXQtY3BwLWFycm93IHZlcnNpb24gMjUuMC4xGbwcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAcAAAA5QgAAFBBUjE=";

function chunkBytes(): ArrayBuffer {
  const bin = atob(CHUNK_B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

const REF: ChunkRef = { key: "inference/j/1/gamestate/chunk-00000.parquet", url: "https://bucket.test/chunk-00000.parquet", bytes: 3371, index: 0, fromMs: 0, toMs: 60_000 };

describe("a chunk the worker wrote decodes in the browser", () => {
  it("reads every column with the right type, nulls where the row was suppressed", async () => {
    const chunk = await decodeChunk(REF, chunkBytes());
    expect(chunk.rows).toHaveLength(8);
    const first = chunk.rows[0]!;
    expect(first).toEqual({ frameIndex: 0, sourceMs: 9000, half: 1, matchMinute: 0, localTrackId: 1, class: "player", xM: 10, yM: 34, cameraSegmentId: "seg-a", quality: "good", reason: null });
    expect(typeof first.sourceMs).toBe("number");
    const keeper = chunk.rows.find((r) => r.frameIndex === 2 && r.localTrackId === 2)!;
    expect(keeper).toMatchObject({ class: "goalkeeper", xM: 3, yM: 34, matchMinute: 0.0013 });
    const failed = chunk.rows.find((r) => r.frameIndex === 3 && r.localTrackId === 1)!;
    expect(failed).toEqual({ frameIndex: 3, sourceMs: 9120, half: null, matchMinute: null, localTrackId: 1, class: "player", xM: null, yM: null, cameraSegmentId: "seg-b", quality: "failed", reason: "calibration_failed" });
    const nowhere = chunk.rows.find((r) => r.frameIndex === 3 && r.localTrackId === 2)!;
    expect(nowhere).toMatchObject({ xM: null, cameraSegmentId: null, quality: null, reason: "no_camera_segment" });
  });

  it("indexes rows by frame and answers the playhead by frame, or by millisecond without a rate", async () => {
    const chunk = await decodeChunk(REF, chunkBytes());
    expect([...chunk.byFrame.keys()]).toEqual([0, 1, 2, 3]);
    expect(rowsOnFrame(chunk, 1).map((r) => r.localTrackId)).toEqual([1, 2]);
    expect(rowsOnFrame(chunk, 7)).toEqual([]);
    expect(rowsOnFrame(chunk, null)).toEqual([]);
    expect(rowsOnFrame(null, 1)).toEqual([]);
    expect(rowsNear(chunk, 9050).map((r) => r.sourceMs)).toEqual([9040, 9040]);
    expect(rowsNear(chunk, 9500)).toEqual([]);
  });

  it("fetches a chunk from its URL and refuses a bad answer", async () => {
    const ok = (async () => new Response(chunkBytes(), { status: 200 })) as unknown as typeof fetch;
    const chunk = await loadChunk(REF, ok);
    expect(chunk.rows).toHaveLength(8);
    const gone = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    await expect(loadChunk(REF, gone)).rejects.toThrow("answered 404 for chunk-00000.parquet");
  });
});

describe("rows and chunks", () => {
  it("converts hyparquet's bigints and leaves nulls alone", () => {
    expect(toRow({ frame_index: 4, source_ms: 9160n, half: null, match_minute: undefined, local_track_id: 9, class: "ball", x_m: 1.5, y_m: 2.5, camera_segment_id: "s", quality: "usable", reason: null })).toEqual({
      frameIndex: 4, sourceMs: 9160, half: null, matchMinute: null, localTrackId: 9, class: "ball", xM: 1.5, yM: 2.5, cameraSegmentId: "s", quality: "usable", reason: null,
    });
    expect(indexByFrame([]).size).toBe(0);
  });

  it("finds the chunk covering a millisecond, and none between or beyond", () => {
    const chunks: ChunkRef[] = [
      { ...REF, index: 4, fromMs: 8000, toMs: 10_000 },
      { ...REF, key: "k6", index: 6, fromMs: 12_000, toMs: 14_000 },
      { ...REF, key: "k?", index: null, fromMs: null, toMs: null },
    ];
    expect(chunkCovering(chunks, 9999)?.index).toBe(4);
    expect(chunkCovering(chunks, 10_000)).toBeNull();
    expect(chunkCovering(chunks, 12_000)?.index).toBe(6);
    expect(chunkCovering(chunks, 14_000)).toBeNull();
    expect(chunkCovering([], 1)).toBeNull();
  });

  it("keeps the last four chunks and refreshes one on use", () => {
    const cache = new ChunkCache(2);
    const mk = (key: string) => ({ ref: { ...REF, key }, rows: [], byFrame: new Map() });
    cache.put(mk("a"));
    cache.put(mk("b"));
    expect(cache.get("a")?.ref.key).toBe("a");
    cache.put(mk("c"));
    expect(cache.keys()).toEqual(["a", "c"]);
    expect(cache.get("b")).toBeNull();
    cache.put(mk("c"));
    expect(cache.keys()).toEqual(["a", "c"]);
  });

  it("names a CORS refusal for what it is and passes other failures through", () => {
    expect(explainChunkFailure(new TypeError("Failed to fetch"))).toContain("CORS rule");
    expect(explainChunkFailure(new TypeError("NetworkError when attempting to fetch resource."))).toContain("CORS rule");
    expect(explainChunkFailure(new Error("The bucket answered 403 for chunk-00001.parquet."))).toBe("The chunk could not be read: The bucket answered 403 for chunk-00001.parquet.");
  });
});

describe("the drawn pitch", () => {
  it("draws the markings in metres on the pitch's own dimensions", () => {
    const lines = pitchLines({ lengthM: 100, widthM: 64 });
    expect(lines.map((l) => l.id)).toEqual(["outline", "halfway", "centre_circle", "left_box", "left_goal_area", "right_box", "right_goal_area"]);
    expect(lines[0]!.points).toEqual([[0, 0], [100, 0], [100, 64], [0, 64], [0, 0]]);
    expect(lines[1]!.points).toEqual([[50, 0], [50, 64]]);
    expect(lines.find((l) => l.id === "right_box")!.points[1]).toEqual([83.5, 32 - 20.16]);
    expect(pitchSpots({ lengthM: 100, widthM: 64 })).toEqual([[11, 32], [89, 32], [50, 32]]);
    expect(minimapViewBox({ lengthM: 100, widthM: 64 })).toBe("-3 -3 106 70");
  });

  it("keeps a wildly wrong point off the map", () => {
    expect(onMinimap(52.5, 34)).toBe(true);
    expect(onMinimap(-2, 70)).toBe(true);
    expect(onMinimap(-4, 34)).toBe(false);
    expect(onMinimap(52.5, 80)).toBe(false);
  });
});

describe("words", () => {
  const row = (over: Partial<GameStateRow>): GameStateRow => ({ frameIndex: 0, sourceMs: 0, half: null, matchMinute: null, localTrackId: 1, class: "player", xM: 1, yM: 1, cameraSegmentId: null, quality: null, reason: null, ...over });

  it("describes a frame: placed, and not placed with the reason", () => {
    expect(describeFrame([])).toBe("no track on this frame");
    expect(describeFrame([row({}), row({ localTrackId: 2 })])).toBe("2 placed");
    expect(describeFrame([row({}), row({ xM: null, yM: null, reason: "calibration_failed" })])).toBe("1 placed · 1 not placed: calibration failed");
    expect(describeFrame([row({ xM: null, reason: "beyond_horizon" }), row({ xM: null, reason: "no_camera_segment" }), row({ xM: null, reason: "no_camera_segment" })])).toBe(
      "0 placed · 3 not placed: beyond the horizon (1), no camera segment (2)"
    );
  });

  it("describes the coverage", () => {
    expect(describeCoverage(null, null)).toBe("no game state yet");
    expect(describeCoverage({ validFrameCoverage: 0.408, frames: 125, coverageBasis: "frames_tracked" }, { segments: 3, calibrations: 2 })).toBe("placed on 41% of frames · 2 of 3 segment(s) calibrated");
    // A run from before the tracker reported its frames measured against a smaller whole, and says so.
    expect(describeCoverage({ validFrameCoverage: 0.408, frames: 125 }, null)).toBe("placed on 41% of frames with a track");
    expect(describeCoverage({ validFrameCoverage: 0.408, frames: 125, coverageBasis: "frames_with_tracks" }, null)).toBe("placed on 41% of frames with a track");
    expect(describeCoverage({ validFrameCoverage: null, frames: 0 }, null)).toBe("placed on no frame");
    expect(REASON_WORDS.off_pitch).toBe("far off the pitch");
  });
});
