import { ConflictException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { VisionCalibrationService } from "./calibration.service";
import { invert3, project, type Homography } from "./homography";
import { landmarkById } from "./pitch-model";

/**
 * Segments, a person's calibration, and the suppression rule.
 *
 * The synthetic camera is the one in homography.spec.ts; what matters here is what
 * the service refuses, what it files, and that nothing in metres comes out of a
 * calibration that failed.
 */
const ASSET = "aaaa1111-2222-4333-8444-555566667777";
const SEGMENT = "bbbb1111-2222-4333-8444-555566667777";
const TRACK = "cccc1111-2222-4333-8444-555566667777";
const CAMERA: Homography = [9.2, -3.1, 160, 0.4, 2.6, 80, 0.0004, 0.011, 1];
const PIXEL_TO_PITCH = invert3(CAMERA)!;

const see = (xM: number, yM: number) => project(CAMERA, { x: xM, y: yM })!;
function clicks(ids: string[]) {
  const by = landmarkById({ lengthM: 105, widthM: 68 });
  return ids.map((id) => {
    const l = by.get(id)!;
    const p = see(l.xM, l.yM);
    return { landmark: id, px: p.x, py: p.y };
  });
}
const SIX = ["corner_left_near", "corner_left_far", "halfway_near", "halfway_far", "left_penalty_spot", "centre_spot"];

const mockPrisma = {
  visionVideoAsset: { findUnique: vi.fn() },
  visionCameraSegment: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  visionPitchCalibration: { create: vi.fn(), updateMany: vi.fn() },
  visionTrack: { findUnique: vi.fn() },
  $transaction: vi.fn(),
};
const mockAudit = { record: vi.fn() };
const mockIdentity = { positions: vi.fn() };
const reviewer: AdminAuthContext = { method: "jwt", roleSlug: "vision_reviewer", roleName: null, permissions: [], userId: "u-reviewer" };
const apiKey: AdminAuthContext = { method: "api_key", roleSlug: null, roleName: null, permissions: [] };

let service: VisionCalibrationService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new VisionCalibrationService(mockPrisma as never, mockAudit as never, mockIdentity as never);
  mockAudit.record.mockResolvedValue(undefined);
  mockPrisma.visionVideoAsset.findUnique.mockResolvedValue({ id: ASSET, durationMs: 120_000 });
  mockPrisma.visionCameraSegment.findFirst.mockResolvedValue(null);
  mockPrisma.visionCameraSegment.create.mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: SEGMENT, ...data }));
  mockPrisma.visionCameraSegment.findUnique.mockResolvedValue({ id: SEGMENT, videoAssetId: ASSET });
  mockPrisma.visionPitchCalibration.create.mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: "cal-1", modelVersionId: null, supersededBy: null, createdAt: new Date(), ...data }));
  mockPrisma.visionPitchCalibration.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma));
  mockPrisma.visionTrack.findUnique.mockResolvedValue({ id: TRACK, videoAssetId: ASSET });
});

describe("a camera segment", () => {
  it("is declared by a person, inside the footage, beside the others", async () => {
    await expect(service.declareSegment(ASSET, { startMs: 0, endMs: 1000, kind: "wide" }, apiKey)).rejects.toMatchObject({ response: { error: "CalibrationNeedsAPerson" } });
    await expect(service.declareSegment(ASSET, { startMs: 1000, endMs: 1000, kind: "wide" }, reviewer)).rejects.toMatchObject({ response: { error: "SegmentEmpty" } });
    await expect(service.declareSegment(ASSET, { startMs: 0, endMs: 130_000, kind: "wide" }, reviewer)).rejects.toMatchObject({ response: { error: "SegmentOutsideAsset" } });
    mockPrisma.visionCameraSegment.findFirst.mockResolvedValueOnce({ id: "s-0", startMs: 500, endMs: 2000 });
    await expect(service.declareSegment(ASSET, { startMs: 0, endMs: 1000, kind: "wide" }, reviewer)).rejects.toMatchObject({ response: { error: "SegmentOverlaps" } });
    expect(mockPrisma.visionCameraSegment.findFirst.mock.calls.at(-1)![0].where).toEqual({ videoAssetId: ASSET, startMs: { lt: 1000 }, endMs: { gt: 0 } });
    const out = await service.declareSegment(ASSET, { startMs: 0, endMs: 1000, kind: "wide" }, reviewer);
    expect(out).toMatchObject({ videoAssetId: ASSET, startMs: 0, endMs: 1000, kind: "wide", source: "manual", createdBy: "u-reviewer" });
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "camera.segment.declared" }), reviewer);
  });
});

describe("removing a segment", () => {
  it("is a person's, and only for a segment with no calibration on it", async () => {
    mockPrisma.visionCameraSegment.findUnique.mockResolvedValue({ id: SEGMENT, videoAssetId: ASSET, source: "scene_detect", startMs: 0, endMs: 1000, _count: { calibrations: 0 } });
    mockPrisma.visionCameraSegment.delete.mockResolvedValue({});
    await expect(service.deleteSegment(SEGMENT, apiKey)).rejects.toMatchObject({ response: { error: "CalibrationNeedsAPerson" } });
    expect(await service.deleteSegment(SEGMENT, reviewer)).toEqual({ removed: SEGMENT });
    expect(mockPrisma.visionCameraSegment.delete).toHaveBeenCalledWith({ where: { id: SEGMENT } });
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "camera.segment.removed" }), reviewer);
    mockPrisma.visionCameraSegment.findUnique.mockResolvedValue({ id: SEGMENT, videoAssetId: ASSET, source: "manual", startMs: 0, endMs: 1000, _count: { calibrations: 2 } });
    await expect(service.deleteSegment(SEGMENT, reviewer)).rejects.toMatchObject({ response: { error: "SegmentCalibrated" } });
  });
});

describe("a person's calibration", () => {
  it("previews without saving, with the quality the thresholds give", () => {
    const out = service.preview(clicks(SIX));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.quality).toBe("good");
    expect(out.reprojectionErrorM).toBeLessThan(0.01);
    expect(out.thresholdsVersion).toContain("provisional");
    expect(mockPrisma.visionPitchCalibration.create).not.toHaveBeenCalled();
  });

  it("names an unknown landmark, too few points, and a degenerate set", () => {
    expect(service.preview([{ landmark: "the_dugout", px: 1, py: 1 }])).toMatchObject({ ok: false, reason: "unknown_landmark", detail: "the_dugout" });
    expect(service.preview(clicks(SIX.slice(0, 3)))).toMatchObject({ ok: false, reason: "too_few_points" });
    expect(service.preview(clicks(["corner_left_near", "halfway_near", "corner_right_near", "left_box_near_goalline"]))).toMatchObject({ ok: false, reason: "degenerate" });
  });

  it("refuses dimensions no pitch has", () => {
    expect(() => service.preview(clicks(SIX), { lengthM: 30, widthM: 68 })).toThrow();
  });

  it("is saved by a person with its quality, superseding the segment's current one", async () => {
    await expect(service.calibrate(SEGMENT, { points: clicks(SIX) }, apiKey)).rejects.toMatchObject({ response: { error: "CalibrationNeedsAPerson" } });
    const out = await service.calibrate(SEGMENT, { points: clicks(SIX), pitch: { lengthM: 105, widthM: 68 } }, reviewer);
    expect(out).toMatchObject({ cameraSegmentId: SEGMENT, method: "manual", quality: "good", points: 6, decidedBy: "u-reviewer", pitch: { lengthM: 105, widthM: 68 } });
    expect(mockPrisma.visionPitchCalibration.updateMany).toHaveBeenCalledWith({ where: { cameraSegmentId: SEGMENT, supersededBy: null, id: { not: "cal-1" } }, data: { supersededBy: "cal-1" } });
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "calibration.set", data: expect.objectContaining({ quality: "good" }) }), reviewer);
  });

  it("refuses to save a fit that cannot be made, and saves one that failed the bar", async () => {
    await expect(service.calibrate(SEGMENT, { points: clicks(SIX.slice(0, 3)) }, reviewer)).rejects.toBeInstanceOf(ConflictException);
    expect(mockPrisma.visionPitchCalibration.create).not.toHaveBeenCalled();
    // Two landmarks swapped: a homography exists, and it is wrong by metres.
    const swapped = clicks(SIX);
    [swapped[0]!.landmark, swapped[1]!.landmark] = [swapped[1]!.landmark, swapped[0]!.landmark];
    const out = await service.calibrate(SEGMENT, { points: swapped }, reviewer);
    expect(out.quality).toBe("failed");
    expect(mockPrisma.visionPitchCalibration.create).toHaveBeenCalledTimes(1);
  });
});

describe("the suppression rule", () => {
  /** A player walking from (10, 34) to (30, 34) metres, seen by the camera, two positions per metre. */
  function walk() {
    const positions = [];
    for (let i = 0; i <= 40; i += 1) {
      const xM = 10 + i * 0.5;
      const foot = see(xM, 34);
      positions.push({ frameIndex: i, sourceTimeMs: 9000 + i * 40, box: { x: foot.x - 20, y: foot.y - 80, width: 40, height: 80 } });
    }
    return positions;
  }
  const calibration = (quality: string) => ({ quality, homography: PIXEL_TO_PITCH, pitchLengthM: 105, pitchWidthM: 68 });

  beforeEach(() => {
    mockIdentity.positions.mockResolvedValue({ positions: walk() });
  });

  it("places every position and reports the distance when the calibration is good", async () => {
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([{ id: SEGMENT, startMs: 0, endMs: 60_000, calibrations: [calibration("good")] }]);
    const out = await service.pitchPositions(TRACK);
    expect(out.summary).toEqual({ positions: 41, placed: 41, suppressed: 0, reasons: {} });
    expect(out.positions[0]).toMatchObject({ xM: 10, yM: 34 });
    expect(out.positions[40]!.xM).toBeCloseTo(30, 1);
    expect(out.distance).toEqual({ suppressed: false, metres: 20 });
    expect(out.pitch).toEqual({ lengthM: 105, widthM: 68 });
  });

  it("suppresses the distance, labelled, when the calibration failed", async () => {
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([{ id: SEGMENT, startMs: 0, endMs: 60_000, calibrations: [calibration("failed")] }]);
    const out = await service.pitchPositions(TRACK);
    expect(out.positions).toEqual([]);
    expect(out.summary).toMatchObject({ placed: 0, suppressed: 41, reasons: { calibration_failed: 41 } });
    expect(out.distance).toMatchObject({ suppressed: true });
    if (out.distance.suppressed) expect(out.distance.reason).toContain("calibration_failed");
    expect(JSON.stringify(out)).not.toContain("metres");
  });

  it("suppresses the distance when any position has no segment or no calibration, and says which", async () => {
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([
      { id: SEGMENT, startMs: 0, endMs: 9800, calibrations: [calibration("usable")] },
      { id: "s-2", startMs: 9801, endMs: 10_000, calibrations: [] },
    ]);
    const out = await service.pitchPositions(TRACK);
    expect(out.summary.placed).toBe(21);
    expect(out.summary.reasons).toEqual({ segment_not_calibrated: 5, no_camera_segment: 15 });
    expect(out.distance).toMatchObject({ suppressed: true, reason: expect.stringContaining("20 of 41") });
  });

  it("has nothing to say about a track with no positions", async () => {
    mockIdentity.positions.mockResolvedValue({ positions: [] });
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([]);
    const out = await service.pitchPositions(TRACK);
    expect(out.distance).toEqual({ suppressed: true, reason: "no positions" });
  });
});
