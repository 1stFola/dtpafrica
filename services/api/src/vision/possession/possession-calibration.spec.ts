import { describe, it, expect, vi } from "vitest";
import { possessionCalibration } from "./possession-calibration";
import { carriedDb, keyframe, prefix } from "../calibration/carried-run-fixture";

const proxy = () => ({ id: "proxy", objectKey: "proxy.mp4", width: 500, height: 250, createdAt: new Date("2026-10-01") });
const calibration = () => ({ id: "cal", quality: "good", thresholdsVersion: "provisional/v1", homography: [.1, 0, 0, 0, .1, 0, 0, 0, 1], points: [], pitchLengthM: 105, pitchWidthM: 68, createdAt: new Date("2026-10-02") });
function fixture(c: any = calibration()) {
  return { visionVideoVariant: { findFirst: vi.fn().mockResolvedValue(proxy()) },
    visionJob: { findFirst: vi.fn().mockResolvedValue({ progress: { summary: { proxy: { key: "proxy.mp4", checksumSha256: "e".repeat(64) } }, artifacts: [{ role: "proxy", key: "proxy.mp4" }] } }) },
    visionCameraSegment: { findMany: vi.fn().mockResolvedValue([{ id: "cam", startMs: 0, endMs: 400, calibrations: c ? [c] : [] }]) } };
}
describe("possession calibration provenance", () => {
  it("reads every current calibration, keyframes included, newest first", async () => {
    const db = fixture();
    await possessionCalibration(db as never, "asset");
    expect(db.visionCameraSegment.findMany.mock.calls[0]![0].include.calibrations).toEqual({ where: { supersededBy: null, withdrawnAt: null }, orderBy: { createdAt: "desc" } });
  });
  it("uses the segment's whole calibration, not a keyframe filed on another segment's frame", async () => {
    const db = fixture();
    db.visionCameraSegment.findMany.mockResolvedValue([{ id: "cam", startMs: 0, endMs: 400, calibrations: [{ ...calibration(), frameIndex: null }] }]);
    expect((await possessionCalibration(db as never, "asset")).segments[0]).toMatchObject({ calibrationId: "cal", quality: "good" });
  });
  describe("a moving camera's segment", () => {
    const later = new Date("2026-10-02");
    it("is carried, naming its keyframes, with the current calibrate run pinned beside the segments", async () => {
      const out = await possessionCalibration(carriedDb({ segments: [{ id: "cam", startMs: 0, endMs: 400, kind: "live_play", calibrations: [keyframe("k2", 9, { createdAt: later }), keyframe("k1", 3, { createdAt: later })] }] }) as never, "asset");
      expect(out.segments).toEqual([{ cameraSegmentId: "cam", startMs: 0, endMs: 400, calibrationId: null, homography: null, quality: "carried", thresholdsVersion: "provisional/v1", pitch: { lengthM: 105, widthM: 68 }, keyframeIds: ["k1", "k2"] }]);
      expect(out.carried).toEqual({ jobId: "job", indexKey: `${prefix}index.json`, indexChecksum: "a".repeat(64), chunkKeys: [`${prefix}c0.jsonl`] });
    });
    it("is uncalibrated, with no run pinned, when no current run follows its keyframes", async () => {
      const out = await possessionCalibration(carriedDb({ calibrate: null, segments: [{ id: "cam", startMs: 0, endMs: 400, kind: "live_play", calibrations: [keyframe("k1", 3, { createdAt: later })] }] }) as never, "asset");
      expect(out.segments[0]).toMatchObject({ calibrationId: null, quality: null, homography: null, pitch: null });
      expect(out).not.toHaveProperty("carried");
    });
    it("pins no run when only still cameras are calibrated", async () => {
      const out = await possessionCalibration(carriedDb({ segments: [{ id: "cam", startMs: 0, endMs: 400, kind: "live_play", calibrations: [{ ...calibration(), frameIndex: null }] }] }) as never, "asset");
      expect(out).not.toHaveProperty("carried");
    });
    it("refuses a keyframe filed before the current proxy", async () => {
      await expect(possessionCalibration(carriedDb({ segments: [{ id: "cam", startMs: 0, endMs: 400, kind: "live_play", calibrations: [keyframe("k1", 3, { createdAt: new Date("2026-09-01") })] }] }) as never, "asset"))
        .rejects.toMatchObject({ status: 409 });
    });
  });
  it("pins the exact proxy variant, checksum, calibration ID, geometry and thresholds", async () => {
    const db = fixture();
    expect(await possessionCalibration(db as never, "asset")).toMatchObject({ proxyVariantId: "proxy", proxyWidth: 500, proxyChecksum: "e".repeat(64), segments: [{ calibrationId: "cal", quality: "good", thresholdsVersion: "provisional/v1" }] });
  });
  it.each([null, "failed"])("keeps absent/failed calibration explicit with no numerical projection: %s", async (quality) => {
    const result = await possessionCalibration(fixture(quality ? { ...calibration(), quality } : null) as never, "asset");
    expect(result.segments[0]).toMatchObject({ quality, homography: null, pitch: null });
  });
  it.each(["geometry", "checksum", "proxy key", "old calibration", "singular", "malformed", "pitch"])("refuses unsafe provenance: %s", async (change) => {
    const c: any = calibration(), db = fixture(c);
    if (change === "geometry") db.visionVideoVariant.findFirst.mockResolvedValue({ ...proxy(), width: null });
    if (change === "checksum") db.visionJob.findFirst.mockResolvedValue({ progress: {} });
    if (change === "proxy key") db.visionJob.findFirst.mockResolvedValue({ progress: { summary: { proxy: { key: "other", checksumSha256: "e".repeat(64) } } } });
    if (change === "old calibration") c.createdAt = new Date("2026-09-01");
    if (change === "singular") c.homography = [0,0,0,0,0,0,0,0,1];
    if (change === "malformed") c.homography = {};
    if (change === "pitch") c.pitchWidthM = 0;
    await expect(possessionCalibration(db as never, "asset")).rejects.toMatchObject({ status: 409 });
  });
});
