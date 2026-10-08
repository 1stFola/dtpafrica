import { ConflictException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { InMemoryObjectStore } from "../storage/in-memory-object-store";
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
  visionCameraSegment: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn(), update: vi.fn() },
  visionPitchCalibration: { create: vi.fn(), updateMany: vi.fn() },
  visionTrack: { findUnique: vi.fn() },
  visionJob: { findFirst: vi.fn() },
  visionEventCandidate: { count: vi.fn() },
  visionEvidenceLink: { count: vi.fn() },
  $transaction: vi.fn(),
};
const mockAudit = { record: vi.fn() };
const mockIdentity = { positions: vi.fn() };
const reviewer: AdminAuthContext = { method: "jwt", roleSlug: "vision_reviewer", roleName: null, permissions: [], userId: "u-reviewer" };
const apiKey: AdminAuthContext = { method: "api_key", roleSlug: null, roleName: null, permissions: [] };

let service: VisionCalibrationService;

beforeEach(() => {
  vi.clearAllMocks();
  service = new VisionCalibrationService(mockPrisma as never, mockAudit as never, mockIdentity as never, new InMemoryObjectStore(), { playback: { urlTtlSeconds: 600 } } as never);
  mockAudit.record.mockResolvedValue(undefined);
  mockPrisma.visionVideoAsset.findUnique.mockResolvedValue({ id: ASSET, durationMs: 120_000 });
  mockPrisma.visionCameraSegment.findFirst.mockResolvedValue(null);
  mockPrisma.visionCameraSegment.create.mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: SEGMENT, ...data }));
  mockPrisma.visionCameraSegment.findUnique.mockResolvedValue({ id: SEGMENT, videoAssetId: ASSET });
  mockPrisma.visionPitchCalibration.create.mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: "cal-1", modelVersionId: null, supersededBy: null, createdAt: new Date(), ...data }));
  mockPrisma.visionPitchCalibration.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma));
  mockPrisma.visionTrack.findUnique.mockResolvedValue({ id: TRACK, videoAssetId: ASSET });
  mockPrisma.visionEventCandidate.count.mockResolvedValue(0);
  mockPrisma.visionEvidenceLink.count.mockResolvedValue(0);
});

describe("a camera segment", () => {
  it("is declared by a person, inside the footage, beside the others", async () => {
    await expect(service.declareSegment(ASSET, { startMs: 0, endMs: 1000, kind: "live_play" }, apiKey)).rejects.toMatchObject({ response: { error: "CalibrationNeedsAPerson" } });
    await expect(service.declareSegment(ASSET, { startMs: 1000, endMs: 1000, kind: "live_play" }, reviewer)).rejects.toMatchObject({ response: { error: "SegmentEmpty" } });
    await expect(service.declareSegment(ASSET, { startMs: 0, endMs: 130_000, kind: "live_play" }, reviewer)).rejects.toMatchObject({ response: { error: "SegmentOutsideAsset" } });
    mockPrisma.visionCameraSegment.findFirst.mockResolvedValueOnce({ id: "s-0", startMs: 500, endMs: 2000 });
    await expect(service.declareSegment(ASSET, { startMs: 0, endMs: 1000, kind: "live_play" }, reviewer)).rejects.toMatchObject({ response: { error: "SegmentOverlaps" } });
    expect(mockPrisma.visionCameraSegment.findFirst.mock.calls.at(-1)![0].where).toEqual({ videoAssetId: ASSET, startMs: { lt: 1000 }, endMs: { gt: 0 } });
    const out = await service.declareSegment(ASSET, { startMs: 0, endMs: 1000, kind: "live_play" }, reviewer);
    expect(out).toMatchObject({ videoAssetId: ASSET, startMs: 0, endMs: 1000, kind: "live_play", source: "manual", createdBy: "u-reviewer" });
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

  it("stays while a current event candidate rests on it: its kind decided whether that event was play", async () => {
    mockPrisma.visionCameraSegment.findUnique.mockResolvedValue({ id: SEGMENT, videoAssetId: ASSET, source: "manual", startMs: 0, endMs: 1000, _count: { calibrations: 0 } });
    // Filed under it, or linked to it as evidence: either is a reference with no foreign key behind it.
    mockPrisma.visionEventCandidate.count.mockResolvedValueOnce(2);
    await expect(service.deleteSegment(SEGMENT, reviewer)).rejects.toMatchObject({ response: { error: "SegmentReferenced" } });
    mockPrisma.visionEvidenceLink.count.mockResolvedValueOnce(1);
    await expect(service.deleteSegment(SEGMENT, reviewer)).rejects.toMatchObject({ response: { error: "SegmentReferenced" } });
    expect(mockPrisma.visionCameraSegment.delete).not.toHaveBeenCalled();
    // Only current candidates hold it: one that was superseded does not.
    expect(mockPrisma.visionEventCandidate.count.mock.calls[0]![0].where).toEqual({ cameraSegmentId: SEGMENT, supersededBy: null });
    expect(mockPrisma.visionEvidenceLink.count.mock.calls[0]![0].where).toEqual({ kind: "camera_segment", targetId: SEGMENT, candidate: { supersededBy: null } });
    mockPrisma.visionCameraSegment.delete.mockResolvedValue({});
    expect(await service.deleteSegment(SEGMENT, reviewer)).toEqual({ removed: SEGMENT });
  });
});

describe("a segment's kind", () => {
  const proposal = { id: SEGMENT, videoAssetId: ASSET, kind: "unknown", source: "camera_motion", startMs: 0, endMs: 4120 };
  beforeEach(() => {
    mockPrisma.visionCameraSegment.findUnique.mockResolvedValue(proposal);
    mockPrisma.visionCameraSegment.update.mockImplementation(({ data }: { data: object }) => Promise.resolve({ ...proposal, ...data }));
  });

  it("is set by a person, and labelling a proposal makes it that person's declaration", async () => {
    await expect(service.setSegmentKind(SEGMENT, "live_play", apiKey)).rejects.toMatchObject({ response: { error: "CalibrationNeedsAPerson" } });
    const out = await service.setSegmentKind(SEGMENT, "live_play", reviewer);
    expect(mockPrisma.visionCameraSegment.update).toHaveBeenCalledWith({ where: { id: SEGMENT }, data: { kind: "live_play", source: "manual", createdBy: "u-reviewer" } });
    expect(out).toMatchObject({ kind: "live_play", source: "manual" });
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "camera.segment.updated", targetId: SEGMENT,
      data: expect.objectContaining({ kindFrom: "unknown", kindTo: "live_play", sourceFrom: "camera_motion" }) }), reviewer);
  });

  it("keeps the declaring person's name on a manual segment, and a no-op writes nothing", async () => {
    mockPrisma.visionCameraSegment.findUnique.mockResolvedValue({ ...proposal, source: "manual", kind: "live_play" });
    await service.setSegmentKind(SEGMENT, "live_play", reviewer);
    expect(mockPrisma.visionCameraSegment.update).not.toHaveBeenCalled();
    expect(mockAudit.record).not.toHaveBeenCalled();
    await service.setSegmentKind(SEGMENT, "replay", reviewer);
    expect(mockPrisma.visionCameraSegment.update).toHaveBeenCalledWith({ where: { id: SEGMENT }, data: { kind: "replay", source: "manual" } });
  });

  it("will not change under a current event candidate, whose in-play flag came from it", async () => {
    mockPrisma.visionEventCandidate.count.mockResolvedValueOnce(1);
    await expect(service.setSegmentKind(SEGMENT, "replay", reviewer)).rejects.toMatchObject({ response: { error: "SegmentReferenced" } });
    mockPrisma.visionEvidenceLink.count.mockResolvedValueOnce(2);
    await expect(service.setSegmentKind(SEGMENT, "replay", reviewer)).rejects.toMatchObject({ response: { error: "SegmentReferenced" } });
    expect(mockPrisma.visionCameraSegment.update).not.toHaveBeenCalled();
    mockPrisma.visionCameraSegment.findUnique.mockResolvedValue(null);
    await expect(service.setSegmentKind("missing", "replay", reviewer)).rejects.toMatchObject({ status: 404 });
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
    // The pitch drawn back in pixels: the outline's first corner is where the camera saw (0, 0).
    const outline = out.overlay.find((l) => l.id === "outline")!;
    expect(outline.points[0]!.px).toBeCloseTo(see(0, 0).x, 1);
    expect(outline.points[0]!.py).toBeCloseTo(see(0, 0).y, 1);
    expect(out.overlay.map((l) => l.id)).toContain("centre_circle");
    // And each click, reprojected: with an exact fit it lands on itself.
    expect(out.reprojected).toHaveLength(6);
    expect(out.reprojected[0]!.landmark).toBe("corner_left_near");
    expect(out.reprojected[0]!.errorM).toBeLessThan(0.01);
  });

  it("breaks the drawn pitch where it crosses the horizon rather than mirroring it", () => {
    // A camera so low that the far touchline is behind it: w changes sign across the pitch.
    const low: Homography = [9.2, -3.1, 160, 0.4, 2.6, 80, 0.0004, -0.02, 1];
    const by = landmarkById({ lengthM: 105, widthM: 68 });
    const near = ["corner_left_near", "corner_right_near", "halfway_near", "left_box_near", "right_box_near"].map((id) => {
      const l = by.get(id)!;
      const p = project(low, { x: l.xM, y: l.yM })!;
      return { landmark: id, px: p.x, py: p.y };
    });
    const out = service.preview(near);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // The outline loses its two far corners; the halfway line, with one end beyond, is not drawn at all.
    const outlinePoints = out.overlay.filter((l) => l.id === "outline").reduce((n, l) => n + l.points.length, 0);
    expect(outlinePoints).toBeGreaterThanOrEqual(2);
    expect(outlinePoints).toBeLessThan(5);
    expect(out.overlay.some((l) => l.id === "halfway")).toBe(false);
    const farCorner = project(low, { x: 0, y: 68 })!;
    expect(out.overlay.flatMap((l) => l.points).some((p) => Math.abs(p.px - farCorner.x) < 1 && Math.abs(p.py - farCorner.y) < 1)).toBe(false);
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
    expect(out.clicked).toHaveLength(6);
    expect(out.clicked[0]).toMatchObject({ landmark: "corner_left_near" });
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
  const calibration = (quality: string, over: Record<string, unknown> = {}) => ({ quality, homography: PIXEL_TO_PITCH, points: clicks(SIX), pitchLengthM: 105, pitchWidthM: 68, ...over });

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
      { id: "s-2", startMs: 9800, endMs: 10_000, calibrations: [] },
    ]);
    const out = await service.pitchPositions(TRACK);
    // Half-open: the position at 9800 is the second segment's, which has no calibration.
    expect(out.summary.placed).toBe(20);
    expect(out.positions.at(-1)).toMatchObject({ sourceTimeMs: 9760, cameraSegmentId: SEGMENT });
    expect(out.summary.reasons).toEqual({ segment_not_calibrated: 5, no_camera_segment: 16 });
    expect(out.distance).toMatchObject({ suppressed: true, reason: expect.stringContaining("21 of 41") });
  });

  it("gives the millisecond two segments meet on to the one that starts there", async () => {
    // The same camera either side of 9800, the second shifted ten metres: which one placed a position shows in its x.
    const shifted = PIXEL_TO_PITCH.map((v, i) => (i < 3 ? v + 10 * PIXEL_TO_PITCH[6 + i]! : v)) as Homography;
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([
      { id: "before", startMs: 0, endMs: 9800, calibrations: [calibration("good")] },
      { id: "after", startMs: 9800, endMs: 60_000, calibrations: [calibration("good", { homography: shifted })] },
    ]);
    const out = await service.pitchPositions(TRACK);
    const onCut = out.positions.find((p) => p.sourceTimeMs === 9800)!;
    const justBefore = out.positions.find((p) => p.sourceTimeMs === 9760)!;
    expect(justBefore.cameraSegmentId).toBe("before");
    expect(onCut.cameraSegmentId).toBe("after");
    expect(onCut.xM).toBeCloseTo(justBefore.xM + 0.5 + 10, 1);
    expect(mockPrisma.visionCameraSegment.findMany.mock.calls[0]![0].include.calibrations).toMatchObject({ where: { supersededBy: null }, orderBy: { createdAt: "desc" }, take: 1 });
  });

  it("places through a matrix stored the other way round, by orienting it with its own points", async () => {
    // Rows filed before the fit oriented its result: every entry negated, the same map.
    const older = PIXEL_TO_PITCH.map((v) => -v) as Homography;
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([{ id: SEGMENT, startMs: 0, endMs: 60_000, calibrations: [calibration("good", { homography: older })] }]);
    const out = await service.pitchPositions(TRACK);
    expect(out.summary).toEqual({ positions: 41, placed: 41, suppressed: 0, reasons: {} });
    expect(out.positions[0]).toMatchObject({ xM: 10, yM: 34 });
  });

  it("does not call a point hundreds of metres away a position", async () => {
    // A camera that maps the walk a hundred metres past the far touchline.
    const far = PIXEL_TO_PITCH.map((v, i) => (i >= 3 && i < 6 ? v + 100 * PIXEL_TO_PITCH[3 + i]! : v)) as Homography;
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([{ id: SEGMENT, startMs: 0, endMs: 60_000, calibrations: [calibration("good", { homography: far })] }]);
    const out = await service.pitchPositions(TRACK);
    expect(out.summary).toEqual({ positions: 41, placed: 0, suppressed: 41, reasons: { off_pitch: 41 } });
    expect(out.distance).toMatchObject({ suppressed: true });
  });

  it("has nothing to say about a track with no positions", async () => {
    mockIdentity.positions.mockResolvedValue({ positions: [] });
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([]);
    const out = await service.pitchPositions(TRACK);
    expect(out.distance).toEqual({ suppressed: true, reason: "no positions" });
  });
});

describe("the latest game state", () => {
  it("is nothing until a gamestate job succeeded", async () => {
    mockPrisma.visionJob.findFirst.mockResolvedValue(null);
    expect(await service.gameState(ASSET)).toMatchObject({ job: null, coverage: null, chunks: [], index: null });
  });

  it("hands out the index and a presigned url per chunk, with the coverage the job reported", async () => {
    mockPrisma.visionJob.findFirst.mockResolvedValue({
      id: "job-g",
      finishedAt: new Date("2026-10-03"),
      inputSpec: { segments: [{ quality: null, pitch: null }, { quality: "good", pitch: { lengthM: 100, widthM: 64 } }, { quality: "failed", pitch: { lengthM: 105, widthM: 68 } }], anchors: [{}] },
      progress: {
        artifacts: [
          { key: "inference/job-g/1/gamestate/chunk-00000.parquet", role: "gamestate_chunk", bytes: 1200 },
          { key: "inference/job-g/1/gamestate/chunk-00001.parquet", role: "gamestate_chunk", bytes: 900 },
          { key: "inference/job-g/1/gamestate.json", role: "gamestate", bytes: 300 },
        ],
        summary: { trackJobId: "job-t", rows: 82, frames: 41, placed: 80, suppressed: 2, reasons: { beyond_horizon: 2 }, validFrameCoverage: 1, chunkMs: 1000, chunks: 2 },
      },
    });
    const out = await service.gameState(ASSET);
    expect(out.job).toMatchObject({ id: "job-g" });
    expect(out.coverage).toMatchObject({ rows: 82, frames: 41, placed: 80, suppressed: 2, validFrameCoverage: 1, chunkMs: 1000 });
    expect(out.placedWith).toEqual({ segments: 3, calibrations: 2, anchors: 1 });
    expect(out.trackJobId).toBe("job-t");
    expect(out.pitch).toEqual({ lengthM: 100, widthM: 64 });
    expect(out.chunks.map((c) => [c.index, c.fromMs, c.toMs])).toEqual([[0, 0, 1000], [1, 1000, 2000]]);
    expect(out.chunks.map((c) => c.key)).toEqual(["inference/job-g/1/gamestate/chunk-00000.parquet", "inference/job-g/1/gamestate/chunk-00001.parquet"]);
    expect(out.chunks[0]!.url).toContain("chunk-00000.parquet");
    expect(out.index?.url).toContain("gamestate.json");
    expect(mockPrisma.visionJob.findFirst.mock.calls[0]![0].where).toEqual({ videoAssetId: ASSET, type: "gamestate", state: "succeeded" });
  });
});
