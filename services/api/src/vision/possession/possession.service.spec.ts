import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { VisionPossessionService } from "./possession.service";
import { calibratePossessionFixture, possessionFixture } from "./possession-fixture";

const alice = { userId: "alice", method: "jwt" } as never, bob = { userId: "bob", method: "jwt" } as never;
let fixture: ReturnType<typeof possessionFixture>, service: VisionPossessionService, run: any, segment: any;
const db: any = { visionVideoAsset: { findUnique: vi.fn() }, visionVideoVariant: { findFirst: vi.fn() }, visionJob: { findFirst: vi.fn(), findMany: vi.fn() }, visionJobEvent: { findFirst: vi.fn() },
  visionCameraSegment: { findMany: vi.fn() }, visionTrack: { findMany: vi.fn(), findUnique: vi.fn() }, visionPossessionRun: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  visionPossessionSegment: { createMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() }, visionPossessionDecision: { create: vi.fn() },
  visionPossessionCorrection: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() }, visionPossessionCorrectionDecision: { create: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn() };
const rights = { canAnalyze: vi.fn() }, audit = { record: vi.fn() };
const track = () => ({ id: "actor-track", localTrackId: 1, videoAssetId: "asset", inferenceJobId: "track", class: "player", confirmed: true,
  artifactKey: "inference/track/1/tracks.json", trackerVersionId: "tracker", detectorVersionId: "detector", startMs: 0, endMs: 360 });
beforeEach(async () => {
  vi.resetAllMocks(); fixture = possessionFixture(); await fixture.write();
  db.visionVideoAsset.findUnique.mockImplementation(async () => fixture.asset);
  db.visionJob.findFirst.mockImplementation(async () => fixture.job); db.visionJobEvent.findFirst.mockImplementation(async () => fixture.log);
  db.visionCameraSegment.findMany.mockImplementation(async () => fixture.cameras.map((s) => ({ id: s.cameraSegmentId, startMs: s.startMs, endMs: s.endMs, kind: s.kind })));
  db.visionTrack.findMany.mockResolvedValue([track()]); db.visionTrack.findUnique.mockResolvedValue(track());
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
  db.visionPossessionRun.findUnique.mockResolvedValue(null);
  db.visionPossessionRun.create.mockImplementation(async ({ data }: any) => { run = { id: "run", ...data }; return run; });
  db.visionPossessionSegment.createMany.mockResolvedValue({ count: 2 });
  db.visionPossessionDecision.create.mockImplementation(async ({ data }: any) => ({ id: "decision", ...data }));
  db.visionPossessionCorrection.findMany.mockResolvedValue([]);
  db.visionPossessionCorrection.findUnique.mockResolvedValue(null);
  db.visionPossessionCorrection.create.mockImplementation(async ({ data }: any) => ({ id: "correction", ...data }));
  db.visionPossessionCorrectionDecision.create.mockImplementation(async ({ data }: any) => ({ id: "correction-decision", ...data }));
  rights.canAnalyze.mockResolvedValue({ allowed: true }); audit.record.mockResolvedValue(undefined);
  service = new VisionPossessionService(db, fixture.store, rights as never, audit as never);
  run = { id: "run", videoAssetId: "asset", inferenceJobId: "job", attemptNumber: 1, sourceChecksum: fixture.asset.checksumSha256, trackJobId: "track", createdBy: "alice",
    snapshot: { index: fixture.index, input: fixture.input, sourceDurationMs: 400 }, indexChecksum: fixture.job.progress.summary.indexChecksum };
  segment = { id: "segment", runId: "run", ordinal: 1, startMs: 200, endMs: 400, frames: 5, sourceState: "candidate", localTrackId: 1, actorTrackId: "actor-track", run, decision: null };
  db.visionPossessionSegment.findUnique.mockImplementation(async () => segment);
});

const proposal = () => ({ parentKey: "segment", startMs: 240, endMs: 400, state: "candidate", actorTrackId: "actor-track", reason: "Boundary reviewed on video" });
describe("immutable possession corrections", () => {
  it("appends a trim with provenance, preserves originals and takes no review decision", async () => {
    const original = structuredClone(segment);
    expect(await service.correct("segment", proposal(), alice)).toMatchObject({ startMs: 240, localTrackId: 1, proposedBy: "alice", parentKey: "segment" });
    expect(segment).toEqual(original); expect(db.visionPossessionCorrectionDecision.create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "possession.corrected" }), alice);
  });
  it("records Unknown with no actor or copied confidence", async () => {
    const result = await service.correct("segment", { ...proposal(), startMs: 200, state: "unknown", actorTrackId: null }, bob);
    expect(result).toMatchObject({ state: "unknown", actorTrackId: null, localTrackId: null, proposedBy: "bob" });
    expect(result).not.toHaveProperty("evidenceConfidence");
    expect(db.visionTrack.findUnique).not.toHaveBeenCalled();
  });
  it.each([{ startMs: 160 }, { endMs: 440 }, { startMs: 241 }, { startMs: 400 }, { endMs: 200 }, { startMs: 240.5 }])("refuses overlapping, empty or off-frame bounds %j", async (change) => {
    await expect(service.correct("segment", { ...proposal(), ...change }, alice)).rejects.toMatchObject({ status: 400 });
    expect(db.visionPossessionCorrection.create).not.toHaveBeenCalled();
  });
  it("uses round-to-even frame boundaries and the previous contributing observation", async () => {
    fixture.index.proxy.fps = 16; segment.startMs = 0; segment.endMs = 250;
    db.visionTrack.findUnique.mockResolvedValue({ ...track(), endMs: 125 });
    expect(await service.correct("segment", { ...proposal(), startMs: 62, endMs: 188 }, alice)).toMatchObject({ startMs: 62, endMs: 188 });
    await expect(service.correct("segment", { ...proposal(), startMs: 63, endMs: 188 }, alice)).rejects.toMatchObject({ response: { error: "InvalidPossessionCorrectionBounds" } });
  });
  it("refuses shared keys, missing reasons, no-op and stale source", async () => {
    await expect(service.correct("segment", proposal())).rejects.toMatchObject({ response: { error: "PossessionNeedsAPerson" } });
    await expect(service.correct("segment", { ...proposal(), reason: " " }, alice)).rejects.toMatchObject({ status: 400 });
    await expect(service.correct("segment", { ...proposal(), startMs: 200 }, alice)).rejects.toMatchObject({ response: { error: "PossessionCorrectionUnchanged" } });
    fixture.asset.durationMs = 401;
    await expect(service.correct("segment", proposal(), alice)).rejects.toMatchObject({ response: { error: "PossessionEvidenceStale" } });
  });
  it("refuses a new actor on original Unknown", async () => {
    segment.sourceState = "unknown"; segment.actorTrackId = null;
    await expect(service.correct("segment", proposal(), alice)).rejects.toMatchObject({ response: { error: "PossessionEvidenceInvalid" } });
  });
  it.each(["foreign run", "referee", "unconfirmed", "too short", "different artifact"])("refuses incompatible corrected actor: %s", async (change) => {
    const t = track();
    if (change === "foreign run") t.inferenceJobId = "other";
    if (change === "referee") t.class = "referee";
    if (change === "unconfirmed") t.confirmed = false;
    if (change === "too short") t.endMs = 320;
    if (change === "different artifact") t.artifactKey = "other";
    db.visionTrack.findUnique.mockResolvedValue(t);
    await expect(service.correct("segment", proposal(), alice)).rejects.toMatchObject({ response: { error: "PossessionEvidenceInvalid" } });
  });
  it("refuses stale parent versions and bounded history overflow", async () => {
    db.visionPossessionCorrection.findMany.mockResolvedValue([{ id: "newer" }]);
    await expect(service.correct("segment", proposal(), alice)).rejects.toMatchObject({ response: { error: "PossessionCorrectionChanged" } });
    db.visionPossessionCorrection.findMany.mockResolvedValue(Array.from({ length: 20 }, () => ({ id: "newer" })));
    await expect(service.correct("segment", { ...proposal(), parentKey: "newer" }, alice)).rejects.toMatchObject({ response: { error: "PossessionCorrectionLimit" } });
  });
  it("requires another person even if the other person imported the original run", async () => {
    const correction = { id: "correction", segmentId: "segment", ...proposal(), proposedBy: "bob", decision: null, segment };
    db.visionPossessionCorrection.findUnique.mockImplementation(async ({ where }: any) => where.id ? correction : null);
    await expect(service.decideCorrection("correction", { decision: "accepted" }, bob)).rejects.toMatchObject({ response: { error: "PossessionSelfReview" } });
    expect(await service.decideCorrection("correction", { decision: "accepted" }, alice)).toMatchObject({ reviewedBy: "alice", decision: "accepted" });
    correction.decision = { decision: "accepted" } as any;
    await expect(service.decideCorrection("correction", { decision: "accepted" }, alice)).rejects.toMatchObject({ response: { error: "PossessionAlreadyReviewed" } });
  });
  it("refuses decisions on superseded proposals and requires rejection reasons", async () => {
    await expect(service.decideCorrection("correction", { decision: "rejected", reason: " " }, bob)).rejects.toMatchObject({ status: 400 });
    db.visionPossessionCorrection.findUnique.mockResolvedValue({ id: "correction", segmentId: "segment", ...proposal(), proposedBy: "alice", decision: null, segment });
    await expect(service.decideCorrection("correction", { decision: "accepted" }, bob)).rejects.toMatchObject({ response: { error: "PossessionCorrectionChanged" } });
  });
});
describe("possession review ledger", () => {
  it("marks changed calibration evidence stale and refuses original decisions and corrections", async () => {
    const snapshot = calibratePossessionFixture(fixture);
    db.visionPossessionRun.findUnique.mockResolvedValue(run);
    db.visionPossessionSegment.findMany.mockResolvedValue([segment]);
    db.visionVideoVariant.findFirst.mockResolvedValue({ id: "proxy", objectKey: "proxy.mp4", width: 1000, height: 500, createdAt: new Date("2026-10-01") });
    db.visionJob.findFirst.mockResolvedValue({ progress: { summary: { proxy: { key: "proxy.mp4", checksumSha256: fixture.input.proxyChecksum } }, artifacts: [{ role: "proxy", key: "proxy.mp4" }] } });
    const c = { id: "cal", quality: "good", thresholdsVersion: "provisional/v1", homography: snapshot.segments[0]!.homography, pitchLengthM: 105, pitchWidthM: 68, points: [], createdAt: new Date("2026-10-02") };
    db.visionCameraSegment.findMany.mockResolvedValue([{ id: "cam", startMs: 0, endMs: 400, kind: "live_play", calibrations: [c] }]);
    expect((await service.get("run")).stale).toBe(false);
    c.id = "superseding-calibration";
    expect((await service.get("run")).stale).toBe(true);
    await expect(service.decide("segment", { decision: "accepted" }, bob)).rejects.toMatchObject({ response: { error: "PossessionEvidenceStale" } });
    await expect(service.correct("segment", proposal(), alice)).rejects.toMatchObject({ response: { error: "PossessionEvidenceStale" } });
    expect(db.visionPossessionDecision.create).not.toHaveBeenCalled(); expect(db.visionPossessionCorrection.create).not.toHaveBeenCalled();
  });
  it("imports originals and Unknown without decisions or new player identity", async () => {
    expect(await service.importRun("asset", "job", alice)).toEqual({ id: "run", imported: true });
    expect(run.createdBy).toBe("alice");
    expect(db.visionPossessionSegment.createMany.mock.calls[0][0].data).toMatchObject([
      { sourceState: "unknown", localTrackId: null, actorTrackId: null, reason: "continuity_pending" }, { sourceState: "candidate", actorTrackId: "actor-track", localTrackId: 1, evidenceConfidence: .8 }]);
    expect(db.visionPossessionDecision.create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "possession.imported" }), alice);
  });
  it("does not duplicate a run or change its first importer", async () => {
    db.visionPossessionRun.findUnique.mockResolvedValue(run);
    expect(await service.importRun("asset", "job", bob)).toEqual({ id: "run", imported: false });
    expect(run.createdBy).toBe("alice"); expect(db.visionPossessionRun.create).not.toHaveBeenCalled();
    run.indexChecksum = "changed";
    await expect(service.importRun("asset", "job", bob)).rejects.toMatchObject({ response: { error: "PossessionEvidenceInvalid" } });
  });
  it("refuses shared keys, denied rights and stale camera evidence", async () => {
    await expect(service.importRun("asset", "job")).rejects.toMatchObject({ response: { error: "PossessionNeedsAPerson" } });
    rights.canAnalyze.mockResolvedValueOnce({ allowed: false });
    await expect(service.importRun("asset", "job", alice)).rejects.toMatchObject({ response: { error: "RightsDenied" } });
    db.visionCameraSegment.findMany.mockResolvedValue([]);
    await expect(service.importRun("asset", "job", alice)).rejects.toMatchObject({ response: { error: "PossessionEvidenceInvalid" } });
    expect(db.visionPossessionRun.create).not.toHaveBeenCalled();
  });
  it.each(["missing", "wrong asset", "wrong tracker", "wrong artifact", "referee", "unconfirmed", "too short"])("refuses a candidate without original compatible track evidence: %s", async (change) => {
    const t = track();
    if (change === "wrong asset") t.videoAssetId = "other";
    if (change === "wrong tracker") t.trackerVersionId = "other";
    if (change === "wrong artifact") t.artifactKey = "other";
    if (change === "referee") t.class = "referee";
    if (change === "unconfirmed") t.confirmed = false;
    if (change === "too short") t.endMs = 320;
    db.visionTrack.findMany.mockResolvedValue(change === "missing" ? [] : [t]);
    await expect(service.importRun("asset", "job", alice)).rejects.toMatchObject({ response: { error: "PossessionEvidenceInvalid" } });
    expect(db.visionPossessionRun.create).not.toHaveBeenCalled();
  });
  it("requires the second person and a stated rejection reason", async () => {
    await expect(service.decide("segment", { decision: "accepted" }, alice)).rejects.toMatchObject({ response: { error: "PossessionSelfReview" } });
    await expect(service.decide("segment", { decision: "rejected", reason: " " }, bob)).rejects.toMatchObject({ response: { error: "InvalidPossessionDecision" } });
    expect(db.visionPossessionDecision.create).not.toHaveBeenCalled();
  });
  it("appends one immutable decision and preserves original candidate evidence", async () => {
    const original = structuredClone(segment);
    const result = await service.decide("segment", { decision: "accepted" }, bob);
    expect(result).toMatchObject({ decision: "accepted", reviewedBy: "bob", segmentId: "segment" });
    expect(segment).toEqual(original);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "possession.accepted" }), bob);
    segment.decision = result;
    await expect(service.decide("segment", { decision: "rejected", reason: "changed mind" }, bob)).rejects.toMatchObject({ response: { error: "PossessionAlreadyReviewed" } });
    expect(db.visionPossessionDecision.create).toHaveBeenCalledTimes(1);
  });
  it("confirmation of Unknown never introduces a possessor", async () => {
    segment.sourceState = "unknown"; segment.actorTrackId = null; segment.localTrackId = null;
    await service.decide("segment", { decision: "accepted" }, bob);
    expect(segment.actorTrackId).toBeNull(); expect(segment.localTrackId).toBeNull();
    expect(db.visionTrack.findUnique).not.toHaveBeenCalled();
  });
  it("refuses decisions after rights, source, camera or original track evidence changes", async () => {
    rights.canAnalyze.mockResolvedValueOnce({ allowed: false });
    await expect(service.decide("segment", { decision: "accepted" }, bob)).rejects.toMatchObject({ response: { error: "RightsDenied" } });
    fixture.asset.checksumSha256 = "f".repeat(64);
    await expect(service.decide("segment", { decision: "accepted" }, bob)).rejects.toMatchObject({ response: { error: "PossessionEvidenceStale" } });
    fixture.asset.checksumSha256 = run.sourceChecksum;
    db.visionTrack.findUnique.mockResolvedValue(null);
    await expect(service.decide("segment", { decision: "accepted" }, bob)).rejects.toMatchObject({ response: { error: "PossessionEvidenceInvalid" } });
    db.visionCameraSegment.findMany.mockResolvedValue([]);
    await expect(service.decide("segment", { decision: "accepted" }, bob)).rejects.toMatchObject({ response: { error: "PossessionEvidenceStale" } });
    expect(db.visionPossessionDecision.create).not.toHaveBeenCalled();
  });
  it("turns concurrent unique-decision collisions into an explicit refusal", async () => {
    db.visionPossessionDecision.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "6" }));
    await expect(service.decide("segment", { decision: "accepted" }, bob)).rejects.toMatchObject({ response: { error: "PossessionAlreadyReviewed" } });
  });
  it("paginates without dropping Unknown and marks changed source evidence stale", async () => {
    db.visionPossessionRun.findUnique.mockResolvedValue(run);
    db.visionPossessionSegment.findMany.mockResolvedValue(Array.from({ length: 101 }, (_, ordinal) => ({ ...segment, sourceState: "unknown", ordinal })));
    const page = await service.get("run");
    expect(page.segments).toHaveLength(100); expect(page.nextCursor).toBe(100); expect(page.stale).toBe(false);
    fixture.asset.durationMs = 500;
    expect((await service.get("run")).stale).toBe(true);
    await expect(service.get("run", NaN)).rejects.toMatchObject({ response: { error: "InvalidPossessionCursor" } });
  });
});
