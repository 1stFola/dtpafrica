import { describe, it, expect, vi } from "vitest";
import { possessionCalibration } from "./possession-calibration";

const proxy = () => ({ id: "proxy", objectKey: "proxy.mp4", width: 500, height: 250, createdAt: new Date("2026-10-01") });
const calibration = () => ({ id: "cal", quality: "good", thresholdsVersion: "provisional/v1", homography: [.1, 0, 0, 0, .1, 0, 0, 0, 1], points: [], pitchLengthM: 105, pitchWidthM: 68, createdAt: new Date("2026-10-02") });
function fixture(c: any = calibration()) {
  return { visionVideoVariant: { findFirst: vi.fn().mockResolvedValue(proxy()) },
    visionJob: { findFirst: vi.fn().mockResolvedValue({ progress: { summary: { proxy: { key: "proxy.mp4", checksumSha256: "e".repeat(64) } }, artifacts: [{ role: "proxy", key: "proxy.mp4" }] } }) },
    visionCameraSegment: { findMany: vi.fn().mockResolvedValue([{ id: "cam", startMs: 0, endMs: 400, calibrations: c ? [c] : [] }]) } };
}
describe("possession calibration provenance", () => {
  it("reads only whole-segment calibrations: a keyframe is true of one frame, not of the segment", async () => {
    const db = fixture();
    await possessionCalibration(db as never, "asset");
    expect(db.visionCameraSegment.findMany.mock.calls[0]![0].include.calibrations.where).toEqual({ supersededBy: null, withdrawnAt: null, frameIndex: null });
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
