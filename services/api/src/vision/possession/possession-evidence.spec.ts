import { beforeEach, describe, expect, it, vi } from "vitest";
import { frameMs, MAX_POSSESSION_INDEX_BYTES, readPossessionEvidence } from "./possession-evidence";
import { calibratePossessionFixture, possessionFixture } from "./possession-fixture";
import { SmallObjectTooLargeError } from "../storage/object-store";

let fixture: ReturnType<typeof possessionFixture>;
const db = { visionJob: { findFirst: vi.fn() }, visionJobEvent: { findFirst: vi.fn() } };
const read = () => readPossessionEvidence(db as never, fixture.store, fixture.asset, "job");
beforeEach(async () => { vi.resetAllMocks(); fixture = possessionFixture(); await fixture.write(); db.visionJob.findFirst.mockImplementation(async () => fixture.job); db.visionJobEvent.findFirst.mockImplementation(async () => fixture.log); });

describe("bounded possession review evidence", () => {
  it("accepts a checksum-pinned calibrated run while keeping original evidence unreviewed", async () => {
    calibratePossessionFixture(fixture); await fixture.write();
    expect((await read()).index.calculationVersion).toBe("possession-candidates/v2");
  });
  it.each(["snapshot", "proxy", "mode", "limits", "candidate calibration", "legacy reason"])("refuses calibrated inconsistencies: %s", async (change) => {
    calibratePossessionFixture(fixture);
    if (change === "snapshot") fixture.index.calibrationSnapshot.segments[0].calibrationId = "other";
    if (change === "proxy") fixture.index.calibrationSnapshot.proxyChecksum = "f".repeat(64);
    if (change === "mode") fixture.input.constraintMode = "image";
    if (change === "limits") fixture.index.footballConfig.maxPlayerSpeedMps = 15;
    if (change === "candidate calibration") { fixture.index.calibrationSnapshot.segments[0].quality = "failed"; fixture.input.calibrationSnapshot.segments[0].quality = "failed"; }
    if (change === "legacy reason") { fixture.index.calculationVersion = "possession-candidates/v1"; fixture.rows[0].reason = "calibration_unavailable"; }
    await fixture.write(); await expect(read()).rejects.toMatchObject({ response: { error: "PossessionEvidenceInvalid" } });
  });
  it("pins original candidate and Unknown intervals to the exact successful attempt", async () => {
    const result = await read();
    expect(result.segments).toEqual(fixture.rows);
    expect(result.indexChecksum).toBe(fixture.job.progress.summary.indexChecksum);
    expect(result.snapshot).toMatchObject({ workerImage: "qa-only-image", attemptNumber: 1, sourceDurationMs: 400 });
  });
  it.each(["state", "asset", "type", "model", "finished", "worker", "idempotency", "attempt", "log", "log checksum", "image", "versions", "bucket", "duplicate"])("refuses invalid completion evidence: %s", async (condition) => {
    const j = fixture.job;
    if (condition === "state") j.state = "failed";
    if (condition === "asset") j.videoAssetId = "other";
    if (condition === "type") j.type = "track";
    if (condition === "model") j.modelVersionId = "unexpected-model";
    if (condition === "finished") j.finishedAt = null;
    if (condition === "worker") j.workerId = null;
    if (condition === "idempotency") j.idempotencyKey = null;
    if (condition === "attempt") j.outputPrefix = "inference/job/2/";
    if (condition === "log") db.visionJobEvent.findFirst.mockResolvedValue(null);
    if (condition === "log checksum") fixture.log.data.summary.indexChecksum = "f".repeat(64);
    if (condition === "image") j.progress.workerImage = "other";
    if (condition === "versions") j.progress.modelVersionIds.push("model");
    if (condition === "bucket") j.progress.artifacts[0].bucket = "master";
    if (condition === "duplicate") j.progress.artifacts.push(j.progress.artifacts[0]);
    await expect(read()).rejects.toMatchObject({ response: { error: "PossessionEvidenceInvalid" } });
  });
  it.each(["source", "clock", "geometry", "track lineage", "too many", "counts", "gap", "overlap", "actor unknown", "candidate reason", "replay", "camera missing", "confidence", "frame count", "review state", "fractional frames", "lost trajectory"])("refuses corrupt original segments even with repinned bytes: %s", async (change) => {
    if (change === "source") fixture.index.sourceChecksum = "f".repeat(64);
    if (change === "clock") fixture.index.proxy = { fps: 25, sourceOffsetMs: 1 };
    if (change === "geometry") fixture.index.imageWidth = 999;
    if (change === "track lineage") fixture.index.trackJobId = "other";
    if (change === "too many") fixture.index.segments = 20001;
    if (change === "counts") fixture.index.candidateFrames = 6;
    if (change === "gap") fixture.rows[1].startMs = 240;
    if (change === "overlap") fixture.rows[1].startMs = 160;
    if (change === "actor unknown") fixture.rows[0].localTrackId = 1;
    if (change === "candidate reason") fixture.rows[1].reason = "invented";
    if (change === "replay") fixture.cameras[0]!.kind = "replay";
    if (change === "camera missing") fixture.rows[1].cameraSegmentId = "other";
    if (change === "confidence") fixture.rows[1].evidenceConfidence = 2;
    if (change === "frame count") fixture.rows[1].frames = 4;
    if (change === "review state") fixture.rows[1].reviewState = "accepted";
    if (change === "fractional frames") fixture.rows[1].frames = 4.5;
    if (change === "lost trajectory") fixture.rows[0].reason = "ball_lost";
    await fixture.write();
    await expect(read()).rejects.toMatchObject({ response: { error: "PossessionEvidenceInvalid" } });
  });
  it("keeps all-Unknown output as original evidence", async () => {
    fixture.rows[1] = { ...fixture.rows[0], startMs: 200, endMs: 400 };
    Object.assign(fixture.index, { candidateFrames: 0, unknownFrames: 10, candidateFrameCoverage: 0, reasons: { continuity_pending: 10 } });
    await fixture.write();
    expect((await read()).segments.every((r) => r.state === "unknown")).toBe(true);
  });
  it("bounds reads before and during download and refuses checksum changes", async () => {
    const spy = vi.spyOn(fixture.store, "getSmallObject");
    fixture.job.progress.artifacts[0].bytes = MAX_POSSESSION_INDEX_BYTES + 1;
    fixture.log.data = structuredClone(fixture.job.progress);
    await expect(read()).rejects.toMatchObject({ response: { error: "PossessionEvidenceInvalid" } });
    expect(spy).not.toHaveBeenCalled();
    await fixture.write();
    spy.mockRejectedValueOnce(new SmallObjectTooLargeError(MAX_POSSESSION_INDEX_BYTES));
    await expect(read()).rejects.toMatchObject({ response: { error: "PossessionEvidenceInvalid" } });
    expect(spy).toHaveBeenCalledWith("derived", "inference/job/1/possession.json", MAX_POSSESSION_INDEX_BYTES);
    await fixture.store.putSmallObject("derived", "inference/job/1/possession.json", "tampered", "application/json");
    await expect(read()).rejects.toMatchObject({ response: { error: "PossessionEvidenceInvalid" } });
  });
  it("uses the producer's round-to-even source milliseconds", () => { expect(frameMs(1, 16)).toBe(62); expect(frameMs(3, 16)).toBe(188); expect(frameMs(1, 25)).toBe(40); });
});
