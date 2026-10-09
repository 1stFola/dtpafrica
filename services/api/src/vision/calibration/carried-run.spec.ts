import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { CALIBRATION_FRAMES_CHUNK_ROLE, CALIBRATION_FRAMES_INDEX_ROLE, CALIBRATION_PROPAGATION_VERSION, visionKeys } from "@dtp/vision-contracts";
import { carriedDb, keyframe, prefix, PROXY_SUM } from "./carried-run-fixture";
import { carriedReadKeys, carriedRunStale, carriedSegment, currentCarriedRun, readCarriedFrames } from "./carried-run";

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
describe("the current calibrate run", () => {
  it("is pinned by its index, checksum and chunks when it still describes the footage", async () => {
    expect(await currentCarriedRun(carriedDb() as never, "asset")).toEqual({ jobId: "job", indexKey: `${prefix}index.json`, indexChecksum: "a".repeat(64), chunkKeys: [`${prefix}c0.jsonl`] });
  });
  it("is none when no run succeeded", async () => {
    expect(await currentCarriedRun(carriedDb({ calibrate: null }) as never, "asset")).toBeNull();
  });
  it.each([
    ["a keyframe filed since", { segments: [{ id: "cam", startMs: 0, endMs: 400, kind: "live_play", calibrations: [keyframe("k1", 3), keyframe("k2", 9), keyframe("k3", 20)] }] }],
    ["a segment relabelled", { segments: [{ id: "cam", startMs: 0, endMs: 400, kind: "replay", calibrations: [keyframe("k1", 3), keyframe("k2", 9)] }] }],
    ["other proxy bytes, all else the same", { spec: { proxyChecksum: "f".repeat(64), segments: [{ cameraSegmentId: "cam", startMs: 0, endMs: 400, kind: "live_play", calibrations: [{ calibrationId: "k1" }, { calibrationId: "k2" }] }] } }],
  ])("is none when stale: %s", async (_, over) => {
    expect(await currentCarriedRun(carriedDb(over) as never, "asset")).toBeNull();
  });
  const artifacts = (a: unknown[]) => ({ summary: { indexChecksum: "a".repeat(64), chunks: 1, calculationVersion: CALIBRATION_PROPAGATION_VERSION }, artifacts: a });
  it.each([
    ["two indexes", artifacts([{ role: CALIBRATION_FRAMES_INDEX_ROLE, bucket: "derived", key: `${prefix}i1` }, { role: CALIBRATION_FRAMES_INDEX_ROLE, bucket: "derived", key: `${prefix}i2` }, { role: CALIBRATION_FRAMES_CHUNK_ROLE, bucket: "derived", key: `${prefix}c0` }])],
    ["a chunk missing", { summary: { indexChecksum: "a".repeat(64), chunks: 2, calculationVersion: CALIBRATION_PROPAGATION_VERSION }, artifacts: [{ role: CALIBRATION_FRAMES_INDEX_ROLE, bucket: "derived", key: `${prefix}i` }, { role: CALIBRATION_FRAMES_CHUNK_ROLE, bucket: "derived", key: `${prefix}c0` }] }],
    ["another attempt's keys", artifacts([{ role: CALIBRATION_FRAMES_INDEX_ROLE, bucket: "derived", key: `${visionKeys.inferencePrefix("job", 2)}i` }, { role: CALIBRATION_FRAMES_CHUNK_ROLE, bucket: "derived", key: `${prefix}c0` }])],
    ["another calculation", { summary: { indexChecksum: "a".repeat(64), chunks: 1, calculationVersion: "old" }, artifacts: [{ role: CALIBRATION_FRAMES_INDEX_ROLE, bucket: "derived", key: `${prefix}i` }, { role: CALIBRATION_FRAMES_CHUNK_ROLE, bucket: "derived", key: `${prefix}c0` }] }],
    ["no index checksum", { summary: { chunks: 1, calculationVersion: CALIBRATION_PROPAGATION_VERSION }, artifacts: [{ role: CALIBRATION_FRAMES_INDEX_ROLE, bucket: "derived", key: `${prefix}i` }, { role: CALIBRATION_FRAMES_CHUNK_ROLE, bucket: "derived", key: `${prefix}c0` }] }],
    ["the raw bucket", artifacts([{ role: CALIBRATION_FRAMES_INDEX_ROLE, bucket: "raw", key: `${prefix}i` }, { role: CALIBRATION_FRAMES_CHUNK_ROLE, bucket: "derived", key: `${prefix}c0` }])],
  ])("is none when its completion is not whole: %s", async (_, progress) => {
    expect(await currentCarriedRun(carriedDb({ progress }) as never, "asset")).toBeNull();
  });
  it("is stale when a whole-segment calibration replaces the pinned one", async () => {
    const db = carriedDb({ segments: [{ id: "cam", startMs: 0, endMs: 400, kind: "live_play", calibrations: [{ id: "w2", frameIndex: null }] }],
      spec: { proxyChecksum: PROXY_SUM, segments: [{ cameraSegmentId: "cam", startMs: 0, endMs: 400, kind: "live_play", calibrations: [{ calibrationId: "w1" }] }] } });
    expect(await carriedRunStale(db as never, "asset", (await db.visionJob.findFirst({ where: { type: "calibrate" } }) as { inputSpec: Record<string, unknown> }).inputSpec)).toBe(true);
  });
});

describe("a keyframed segment as a stage declares it", () => {
  it("names its keyframes, sorted, with the pitch they share and no transform of its own", () => {
    expect(carriedSegment([keyframe("k2", 9), keyframe("k1", 3)])).toEqual({ quality: "carried", thresholdsVersion: "provisional/v1", pitch: { lengthM: 105, widthM: 68 }, keyframeIds: ["k1", "k2"] });
  });
  it.each([{ pitchLengthM: 100 }, { pitchWidthM: 64 }, { thresholdsVersion: "provisional/v2" }])("refuses keyframes that describe two grounds: %o", (odd) => {
    expect(() => carriedSegment([keyframe("k1", 3), keyframe("k2", 9, odd)])).toThrow(expect.objectContaining({ status: 409 }));
  });
  it("lets a stage fetch the pinned index and chunks, and nothing when no run is pinned", () => {
    expect(carriedReadKeys({ jobId: "j", indexKey: "i", indexChecksum: "a".repeat(64), chunkKeys: ["c0", "c1"] })).toEqual([{ bucket: "derived", key: "i" }, { bucket: "derived", key: "c0" }, { bucket: "derived", key: "c1" }]);
    expect(carriedReadKeys(undefined)).toEqual([]);
  });
});

describe("reading carried frames", () => {
  const H = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const chunk0 = Buffer.from([{ f: 0, cameraSegmentId: "cam", H, quality: "good" }, { f: 1, cameraSegmentId: "cam", H: null, quality: "failed" }, { f: 2, cameraSegmentId: "other", H, quality: "good" }, { f: 3, cameraSegmentId: null, H, quality: "good" }].map((r) => JSON.stringify(r)).join("\n") + "\n");
  const chunk1 = Buffer.from(JSON.stringify({ f: 10, cameraSegmentId: "cam", H, quality: "usable" }) + "\n");
  const index = (c0 = sha(chunk0)) => Buffer.from(JSON.stringify({ chunks: [{ key: "c0", sha256: c0, firstFrame: 0, lastFrame: 9 }, { key: "c1", sha256: sha(chunk1), firstFrame: 10, lastFrame: 19 }] }));
  const store = (objects: Record<string, Buffer>) => ({ getSmallObject: vi.fn(async (_b: string, key: string) => objects[key] ?? null) });
  const pin = (i: Buffer) => ({ jobId: "job", indexKey: "i", indexChecksum: sha(i), chunkKeys: ["c0", "c1"] });

  it("returns the frames asked for, of the segments asked for, with a transform, reading only their chunks", async () => {
    const i = index(), s = store({ i, c0: chunk0, c1: chunk1 });
    const out = await readCarriedFrames(s as never, pin(i), new Set(["cam"]), new Set([0, 1, 2, 3, 5]));
    expect([...out.entries()]).toEqual([[0, { segmentId: "cam", H }]]);
    expect(s.getSmallObject.mock.calls.map((c) => c[1])).toEqual(["i", "c0"]);
  });
  it("refuses an index that is not the one pinned", async () => {
    const i = index();
    await expect(readCarriedFrames(store({ i: Buffer.from("{}"), c0: chunk0 }) as never, pin(i), new Set(["cam"]), new Set([0]))).rejects.toMatchObject({ status: 409 });
    await expect(readCarriedFrames(store({}) as never, pin(i), new Set(["cam"]), new Set([0]))).rejects.toMatchObject({ status: 409 });
  });
  it.each([["a failed quality", { quality: "failed" }], ["a short transform", { H: [1, 0, 0] }], ["a non-finite transform", { H: [1, 0, 0, 0, 1, 0, 0, 0, "x"] }]])("refuses a carried frame with %s", async (_, odd) => {
    const bad = Buffer.from(JSON.stringify({ f: 0, cameraSegmentId: "cam", H, quality: "good", ...odd }) + "\n");
    const i = Buffer.from(JSON.stringify({ chunks: [{ key: "c0", sha256: sha(bad), firstFrame: 0, lastFrame: 9 }] }));
    await expect(readCarriedFrames(store({ i, c0: bad }) as never, pin(i), new Set(["cam"]), new Set([0]))).rejects.toMatchObject({ status: 409 });
  });
  it("refuses a chunk that is not the one its index recorded", async () => {
    const i = index("0".repeat(64));
    await expect(readCarriedFrames(store({ i, c0: chunk0 }) as never, pin(i), new Set(["cam"]), new Set([0]))).rejects.toMatchObject({ status: 409 });
    const j = index();
    await expect(readCarriedFrames(store({ i: j }) as never, pin(j), new Set(["cam"]), new Set([0]))).rejects.toMatchObject({ status: 409 });
  });
});
