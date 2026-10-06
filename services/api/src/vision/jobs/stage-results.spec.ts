import { beforeEach, describe, expect, it, vi } from "vitest";
import { VisionStageResultsService } from "./stage-results.service";
import { BALL_TRAJECTORY_VERSION } from "@dtp/vision-contracts";

const ASSET = "aaaa1111-2222-3333-4444-555566667777";

const mockPrisma = {
  visionVideoAsset: { update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  visionVideoVariant: { upsert: vi.fn() },
  visionDuplicateCluster: { create: vi.fn() },
  visionTrack: { createMany: vi.fn(), findMany: vi.fn() },
  visionTeamAssignment: { createMany: vi.fn() },
  visionCameraSegment: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn(),
};

/** The ledger is tested in models/benchmarks.spec.ts; here it only has to be reached. */
const mockBenchmarks = { complete: vi.fn(), fail: vi.fn() };

function service() {
  return new VisionStageResultsService(mockPrisma as never, mockBenchmarks as never);
}

function lastAssetUpdate() {
  return mockPrisma.visionVideoAsset.update.mock.calls.at(-1)![0].data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.visionVideoAsset.update.mockResolvedValue({});
  mockPrisma.visionVideoAsset.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.visionVideoAsset.findMany.mockResolvedValue([]);
  mockPrisma.visionVideoVariant.upsert.mockReturnValue("upsert-op");
  mockPrisma.$transaction.mockResolvedValue([]);
});

describe("ball trajectory remains derived image evidence", () => {
  const artifacts = [{ key: "inference/ball/1/ball-trajectory.json", bucket: "derived", role: "ball_trajectory" }, { key: "inference/ball/1/ball/ball-000000.jsonl", bucket: "derived", role: "ball_trajectory_chunk" }];
  const summary = () => ({ calculationVersion: BALL_TRAJECTORY_VERSION, chunks: 1, frames: 5, observed: 2, lost: 3, observedFrameCoverage: 0.4, reasons: { no_detection: 3 }, sourceChecksum: "a".repeat(64), windowStartMs: 0, windowEndMs: 200, indexChecksum: "b".repeat(64) });
  const context = { modelVersionId: null, inputSpec: { sourceChecksum: "a".repeat(64), sourceDurationMs: 200, proxyDurationMs: 240, proxy: { fps: 25, sourceOffsetMs: 0 } } };
  it("checks honest observed/lost coverage without writing match, player or coordinate facts", async () => {
    const result = await service().apply("ball_trajectory", ASSET, { artifacts, summary: summary() }, context);
    expect(result).toMatchObject({ applied: true });
    expect(result.detail).toContain("no possession or physical metric claim");
    expect(mockPrisma.visionVideoAsset.update).not.toHaveBeenCalled();
    expect(mockPrisma.visionTrack.createMany).not.toHaveBeenCalled();
  });
  it("refuses inconsistent counts, source windows, coverage, lost states and artifacts", async () => {
    for (const patch of [{ observed: 3 }, { observed: 2.5 }, { observedFrameCoverage: 1 }, { reasons: { invented: 3 } }, { reasons: { no_detection: 2 } }, { sourceChecksum: "other" }, { windowEndMs: 240 }, { frames: 6, observed: 3, lost: 3, observedFrameCoverage: 0.5 }, { calculationVersion: "other" }])
      expect((await service().apply("ball_trajectory", ASSET, { artifacts, summary: { ...summary(), ...patch } }, context)).applied).toBe(false);
    expect((await service().apply("ball_trajectory", ASSET, { artifacts: [], summary: summary() }, context)).applied).toBe(false);
  });
});

describe("possession completion remains unreviewed image evidence", () => {
  const artifacts = [{ key: "inference/p/1/possession.json", bucket: "derived", role: "possession" }, { key: "inference/p/1/chunk.jsonl", bucket: "derived", role: "possession_chunk" }];
  const context = { modelVersionId: null, inputSpec: { sourceChecksum: "a".repeat(64), sourceDurationMs: 200, proxyDurationMs: 240, proxy: { fps: 25, sourceOffsetMs: 0 }, ball: { jobId: "ball", indexChecksum: "b".repeat(64) }, tracks: { jobId: "track", checksum: "c".repeat(64) } } };
  const summary = () => ({ calculationVersion: "possession-candidates/v1", frames: 5, candidateFrames: 2, unknownFrames: 3, candidateFrameCoverage: .4, segments: 2, chunks: 1,
    reasons: { continuity_pending: 3 }, sourceChecksum: "a".repeat(64), windowStartMs: 0, windowEndMs: 200,
    ballJobId: "ball", trackJobId: "track", ballIndexChecksum: "b".repeat(64), tracksChecksum: "c".repeat(64), indexChecksum: "d".repeat(64), coordinateBasis: "image_foot_proximity", reviewState: "unreviewed" });
  it("validates counts without writing accepted possession, tracks or player metrics", async () => {
    const result = await service().apply("possession", ASSET, { artifacts, summary: summary() }, context);
    expect(result.applied).toBe(true);
    expect(result.detail).toContain("no confirmed possession or player statistics");
    expect(mockPrisma.visionTrack.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.visionVideoAsset.update).not.toHaveBeenCalled();
  });
  it("accepts v2 only with the queued calibration and configuration, without domain writes", async () => {
    const calibrationSnapshot = { proxyVariantId: "proxy", segments: [] };
    const inputSpec = { ...context.inputSpec, constraintMode: "calibrated", calibrationSnapshot };
    const s = { ...summary(), calculationVersion: "possession-candidates/v2", constraintMode: "calibrated", calibrationSnapshot, footballConfig: { maxGroundDistanceM: 2, maxBallGroundSpeedMps: 35, maxPlayerSpeedMps: 12 }, reasons: { calibration_unavailable: 3 } };
    expect((await service().apply("possession", ASSET, { artifacts, summary: s }, { ...context, inputSpec })).applied).toBe(true);
    expect((await service().apply("possession", ASSET, { artifacts, summary: { ...s, calibrationSnapshot: {} } }, { ...context, inputSpec })).applied).toBe(false);
    expect((await service().apply("possession", ASSET, { artifacts, summary: s }, context)).applied).toBe(false);
    expect(mockPrisma.visionTrack.createMany).not.toHaveBeenCalled(); expect(mockPrisma.visionVideoAsset.update).not.toHaveBeenCalled();
  });
  it("refuses altered source, upstream evidence, counters, reasons or review state", async () => {
    for (const patch of [{ reviewState: "accepted" }, { coordinateBasis: "pitch" }, { candidateFrames: 3 }, { reasons: { invented: 3 } }, { reasons: { continuity_pending: 2 } }, { sourceChecksum: "other" }, { trackJobId: "other" }, { ballIndexChecksum: "other" }, { tracksChecksum: "other" }, { candidateFrameCoverage: 1 }, { windowEndMs: 240 }, { calculationVersion: "other" }, { segments: 6 }])
      expect((await service().apply("possession", ASSET, { artifacts, summary: { ...summary(), ...patch } }, context)).applied).toBe(false);
    expect((await service().apply("possession", ASSET, { artifacts: [], summary: summary() }, context)).applied).toBe(false);
  });
});

describe("probe results reach the asset", () => {
  const summary = {
    container: "mov,mp4,m4a",
    videoCodec: "h264",
    width: 1920,
    height: 1080,
    fpsNumerator: 25,
    fpsDenominator: 1,
    isVariableFrameRate: false,
    durationMs: 5_400_000,
  };

  it("writes the metadata the pipeline depends on", async () => {
    const outcome = await service().apply("probe", ASSET, { artifacts: [], summary });

    expect(outcome.applied).toBe(true);
    expect(lastAssetUpdate()).toMatchObject({
      videoCodec: "h264",
      width: 1920,
      height: 1080,
      fpsNumerator: 25,
      durationMs: 5_400_000,
      isVariableFrameRate: false,
    });
  });

  // Flagged rather than silently accepted: annotating VFR footage against
  // wall-clock time is how timestamps drift.
  it("carries the variable-frame-rate finding", async () => {
    await service().apply("probe", ASSET, {
      artifacts: [],
      summary: { ...summary, isVariableFrameRate: true },
    });
    expect(lastAssetUpdate().isVariableFrameRate).toBe(true);
  });

  it("clears a previous ingest error on success", async () => {
    await service().apply("probe", ASSET, { artifacts: [], summary });
    expect(lastAssetUpdate().ingestError).toBeNull();
  });

  it("refuses a summary with nothing usable rather than writing nulls over good data", async () => {
    const outcome = await service().apply("probe", ASSET, { artifacts: [], summary: {} });
    expect(outcome.applied).toBe(false);
    expect(mockPrisma.visionVideoAsset.update).not.toHaveBeenCalled();
  });

  it("ignores a value of the wrong type instead of trusting it", async () => {
    await service().apply("probe", ASSET, {
      artifacts: [],
      summary: { ...summary, width: "1920", durationMs: null },
    });
    const data = lastAssetUpdate();
    expect(data.width).toBeNull();
    expect(data.durationMs).toBeNull();
  });
});

describe("fingerprint results and duplicate clustering", () => {
  const summary = { checksumSha256: "a".repeat(64), perceptualFingerprint: "b".repeat(64) };

  it("writes both hashes", async () => {
    await service().apply("fingerprint", ASSET, { artifacts: [], summary });
    expect(lastAssetUpdate()).toMatchObject({
      checksumSha256: summary.checksumSha256,
      perceptualFingerprint: summary.perceptualFingerprint,
    });
  });

  it("leaves an asset unclustered when nothing matches", async () => {
    const outcome = await service().apply("fingerprint", ASSET, { artifacts: [], summary });
    expect(outcome.detail).toMatch(/no duplicate/);
    expect(lastAssetUpdate().duplicateClusterId).toBeUndefined();
    expect(mockPrisma.visionDuplicateCluster.create).not.toHaveBeenCalled();
  });

  // The whole point: the same match uploaded twice must not be splittable across
  // a train/test boundary.
  it("creates a cluster for an exact byte-for-byte twin", async () => {
    mockPrisma.visionVideoAsset.findMany.mockResolvedValue([
      { id: "twin-1", duplicateClusterId: null, checksumSha256: summary.checksumSha256 },
    ]);
    mockPrisma.visionDuplicateCluster.create.mockResolvedValue({ id: "cluster-1" });

    await service().apply("fingerprint", ASSET, { artifacts: [], summary });

    expect(mockPrisma.visionDuplicateCluster.create.mock.calls[0]![0].data).toMatchObject({
      method: "checksum",
      confidence: 1,
    });
    expect(lastAssetUpdate().duplicateClusterId).toBe("cluster-1");
  });

  it("clusters a re-encode on the perceptual hash with lower confidence", async () => {
    mockPrisma.visionVideoAsset.findMany.mockResolvedValue([
      { id: "twin-1", duplicateClusterId: null, checksumSha256: "different" },
    ]);
    mockPrisma.visionDuplicateCluster.create.mockResolvedValue({ id: "cluster-2" });

    await service().apply("fingerprint", ASSET, { artifacts: [], summary });

    const created = mockPrisma.visionDuplicateCluster.create.mock.calls[0]![0].data;
    expect(created.method).toBe("perceptual");
    expect(created.confidence).toBeLessThan(1);
  });

  // A third re-upload must join the group, not start a rival one.
  it("joins an existing cluster rather than creating a second", async () => {
    mockPrisma.visionVideoAsset.findMany.mockResolvedValue([
      { id: "twin-1", duplicateClusterId: "cluster-existing", checksumSha256: "x" },
    ]);

    await service().apply("fingerprint", ASSET, { artifacts: [], summary });

    expect(mockPrisma.visionDuplicateCluster.create).not.toHaveBeenCalled();
    expect(lastAssetUpdate().duplicateClusterId).toBe("cluster-existing");
  });

  it("pulls the matched assets into the new cluster too, not just this one", async () => {
    mockPrisma.visionVideoAsset.findMany.mockResolvedValue([
      { id: "twin-1", duplicateClusterId: null, checksumSha256: summary.checksumSha256 },
      { id: "twin-2", duplicateClusterId: null, checksumSha256: summary.checksumSha256 },
    ]);
    mockPrisma.visionDuplicateCluster.create.mockResolvedValue({ id: "cluster-3" });

    await service().apply("fingerprint", ASSET, { artifacts: [], summary });

    expect(mockPrisma.visionVideoAsset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["twin-1", "twin-2"] } },
      data: { duplicateClusterId: "cluster-3" },
    });
  });

  it("does not search on a null perceptual hash, which would match every other null", async () => {
    await service().apply("fingerprint", ASSET, {
      artifacts: [],
      summary: { checksumSha256: summary.checksumSha256, perceptualFingerprint: null },
    });
    const where = mockPrisma.visionVideoAsset.findMany.mock.calls[0]![0].where;
    expect(where.OR).toHaveLength(1);
  });

  it("refuses without a checksum", async () => {
    const outcome = await service().apply("fingerprint", ASSET, { artifacts: [], summary: {} });
    expect(outcome.applied).toBe(false);
  });
});

describe("transcode results become variant rows", () => {
  const artifacts = [
    { key: "inference/j/1/proxy.mp4", bucket: "derived", bytes: 500, contentType: "video/mp4", role: "proxy" },
    { key: "inference/j/1/t-100.jpg", bucket: "derived", bytes: 10, contentType: "image/jpeg", role: "thumbnail" },
    { key: "inference/j/1/t-200.jpg", bucket: "derived", bytes: 11, contentType: "image/jpeg", role: "thumbnail" },
  ];
  const summary = {
    proxy: {
      key: "inference/j/1/proxy.mp4",
      fps: 25,
      height: 720,
      settingsHash: "abc123",
      durationMs: 4000,
      encoder: "ffmpeg 5.1.9-0+deb12u1",
    },
    sourceIsVariableFrameRate: true,
  };

  it("registers the proxy and every thumbnail", async () => {
    const outcome = await service().apply("transcode", ASSET, { artifacts, summary });

    expect(outcome.applied).toBe(true);
    expect(mockPrisma.visionVideoVariant.upsert).toHaveBeenCalledTimes(3);
    const kinds = mockPrisma.visionVideoVariant.upsert.mock.calls.map((c) => c[0].create.kind);
    expect(kinds).toEqual(["proxy", "thumbnail", "thumbnail"]);
  });

  it("records the proxy's frame rate and settings hash", async () => {
    await service().apply("transcode", ASSET, { artifacts, summary });
    const proxyCreate = mockPrisma.visionVideoVariant.upsert.mock.calls[0]![0].create;
    expect(proxyCreate).toMatchObject({ fps: 25, height: 720, settingsHash: "abc123", durationMs: 4000 });
  });

  // The settings hash covers the recipe, not the build that ran it, and the CPU and GPU
  // worker images ship different FFmpeg versions (5.1.9 against 4.4.2 -- measured during
  // Spike S0). Without this column two proxies that are not byte-identical look identical
  // in the database.
  it("records which FFmpeg build produced the proxy", async () => {
    await service().apply("transcode", ASSET, { artifacts, summary });
    const proxyCreate = mockPrisma.visionVideoVariant.upsert.mock.calls[0]![0].create;
    expect(proxyCreate.encoder).toBe("ffmpeg 5.1.9-0+deb12u1");
  });

  // The create branch was covered above; this is the update branch of the same upsert.
  // Mutation testing found it untested: dropping `encoder` from the update payload broke
  // nothing, which would mean a re-transcode on a different worker image left the old
  // build recorded against the new file.
  it("updates the encoder on a re-run, not just on first write", async () => {
    await service().apply("transcode", ASSET, { artifacts, summary });
    const proxyUpdate = mockPrisma.visionVideoVariant.upsert.mock.calls[0]![0].update;
    expect(proxyUpdate.encoder).toBe("ffmpeg 5.1.9-0+deb12u1");
  });

  it("leaves the encoder null for a thumbnail, which is a frame grab and not an encode", async () => {
    await service().apply("transcode", ASSET, { artifacts, summary });
    const thumbCreate = mockPrisma.visionVideoVariant.upsert.mock.calls[1]![0].create;
    expect(thumbCreate.encoder).toBeNull();
  });

  // A worker too old to report it, or an image where `ffmpeg -version` could not be read.
  // The proxy is still a usable proxy; it just cannot say what made it.
  it("accepts a proxy from a worker that reports no encoder", async () => {
    const older = { proxy: { ...summary.proxy, encoder: undefined }, sourceIsVariableFrameRate: true };
    const outcome = await service().apply("transcode", ASSET, { artifacts, summary: older });

    expect(outcome.applied).toBe(true);
    const proxyCreate = mockPrisma.visionVideoVariant.upsert.mock.calls[0]![0].create;
    expect(proxyCreate.encoder).toBeNull();
  });

  // Upsert on (asset, kind, key) is what makes a re-run safe.
  it("upserts rather than inserting, so a re-run does not duplicate variants", async () => {
    await service().apply("transcode", ASSET, { artifacts, summary });
    const where = mockPrisma.visionVideoVariant.upsert.mock.calls[0]![0].where;
    expect(where.videoAssetId_kind_objectKey).toMatchObject({
      videoAssetId: ASSET,
      kind: "proxy",
      objectKey: "inference/j/1/proxy.mp4",
    });
  });

  it("marks the asset ready, because a normalised proxy now exists", async () => {
    await service().apply("transcode", ASSET, { artifacts, summary });
    expect(lastAssetUpdate()).toMatchObject({ ingestState: "ready", ingestError: null });
  });

  it("carries the source's variable-frame-rate finding forward", async () => {
    await service().apply("transcode", ASSET, { artifacts, summary });
    expect(lastAssetUpdate().isVariableFrameRate).toBe(true);
  });

  it("does not overwrite the frame-rate flag when transcode did not report it", async () => {
    await service().apply("transcode", ASSET, {
      artifacts,
      summary: { proxy: summary.proxy },
    });
    expect(lastAssetUpdate().isVariableFrameRate).toBeUndefined();
  });

  it("refuses when no proxy was produced, rather than marking the asset ready", async () => {
    const outcome = await service().apply("transcode", ASSET, {
      artifacts: artifacts.filter((a) => a.role !== "proxy"),
      summary,
    });
    expect(outcome.applied).toBe(false);
    expect(mockPrisma.visionVideoAsset.update).not.toHaveBeenCalled();
  });
});

describe("failure handling", () => {
  it("does nothing for a job with no asset", async () => {
    const outcome = await service().apply("probe", null, { artifacts: [], summary: {} });
    expect(outcome.applied).toBe(false);
    expect(mockPrisma.visionVideoAsset.update).not.toHaveBeenCalled();
  });

  it("has no domain effect for a stage that does not produce one", async () => {
    // `calibrate` has no projection yet; detect and track gained theirs in Phases 3 and 4.
    const outcome = await service().apply("calibrate", ASSET, { artifacts: [], summary: {} });
    expect(outcome.applied).toBe(false);
    expect(outcome.detail).toMatch(/no domain effect/);
  });

  /**
   * The job genuinely succeeded and its artifacts exist. Losing the projection is
   * a problem to fix, not a reason to call the work failed — so this records the
   * error on the asset and returns, rather than throwing back at a worker that
   * has already gone.
   */
  it("records a write failure on the asset instead of throwing", async () => {
    mockPrisma.visionVideoAsset.update
      .mockRejectedValueOnce(new Error("deadlock detected"))
      .mockResolvedValueOnce({});

    const outcome = await service().apply("probe", ASSET, {
      artifacts: [],
      summary: { videoCodec: "h264", durationMs: 1000 },
    });

    expect(outcome.applied).toBe(false);
    expect(outcome.detail).toContain("deadlock");
    expect(lastAssetUpdate().ingestError).toContain("deadlock");
  });

  it("marks ingestion failed with a readable reason", async () => {
    await service().markIngestFailed(ASSET, "transcode failed: ffmpeg exited 1");
    expect(lastAssetUpdate()).toMatchObject({
      ingestState: "failed",
      ingestError: "transcode failed: ffmpeg exited 1",
    });
  });

  it("truncates a runaway error rather than blowing the column", async () => {
    await service().markIngestFailed(ASSET, "x".repeat(5000));
    expect(lastAssetUpdate().ingestError.length).toBe(2000);
  });
});

/**
 * detect writes nothing to Postgres -- the boxes live in object storage and the
 * summary on the job row -- so what the projection owes is an honest account of
 * whether the completion is the shape the job promised.
 */
describe("detect results are checked, not stored", () => {
  const MODEL_VERSION = "55556666-7777-4888-9999-aaaabbbbcccc";
  const detections = { key: "inference/j/1/detections.json", bucket: "derived", role: "detections" };
  const summary = {
    framesSampled: 11_520,
    sampleFps: 2,
    ballVisibilityPct: 37.5,
    modelVersionId: MODEL_VERSION,
    weightsSha256: "c".repeat(64),
  };

  it("accepts a completion whose summary names the job's model version", async () => {
    const outcome = await service().apply(
      "detect",
      ASSET,
      { artifacts: [detections], summary },
      { modelVersionId: MODEL_VERSION }
    );
    expect(outcome.applied).toBe(true);
    expect(outcome.detail).toContain("11520 frame(s) at 2fps");
    expect(outcome.detail).toContain("ball visible in 37.5%");
    expect(outcome.detail).toContain(MODEL_VERSION);
    expect(outcome.detail).toContain("cccccccccccc");
    // Nothing is written: the asset row has nothing to learn from a detect job.
    expect(mockPrisma.visionVideoAsset.update).not.toHaveBeenCalled();
  });

  it("refuses a completion with no detections artifact", async () => {
    const outcome = await service().apply(
      "detect",
      ASSET,
      { artifacts: [{ key: "inference/j/1/x.json", bucket: "derived", role: "other" }], summary },
      { modelVersionId: MODEL_VERSION }
    );
    expect(outcome.applied).toBe(false);
    expect(outcome.detail).toMatch(/no detections artifact/);
  });

  it("refuses a summary whose model version is not the job's", async () => {
    const outcome = await service().apply(
      "detect",
      ASSET,
      { artifacts: [detections], summary: { ...summary, modelVersionId: "someone-else" } },
      { modelVersionId: MODEL_VERSION }
    );
    expect(outcome.applied).toBe(false);
    expect(outcome.detail).toMatch(/someone-else/);
  });

  it("refuses a summary that names no model version at all", async () => {
    const { modelVersionId: _omitted, ...anonymous } = summary;
    const outcome = await service().apply(
      "detect",
      ASSET,
      { artifacts: [detections], summary: anonymous },
      { modelVersionId: MODEL_VERSION }
    );
    expect(outcome.applied).toBe(false);
  });

  it("says when the weights went unreported rather than inventing a checksum", async () => {
    const outcome = await service().apply(
      "detect",
      ASSET,
      { artifacts: [detections], summary: { ...summary, weightsSha256: null } },
      { modelVersionId: MODEL_VERSION }
    );
    expect(outcome.applied).toBe(true);
    expect(outcome.detail).toContain("weights unreported");
  });
});

/**
 * A benchmark belongs to a dataset and a model, not an asset. Its projection is
 * the ledger's, reached with the run id the job was queued with.
 */
describe("benchmark results reach the ledger", () => {
  const RUN = "44444444-4444-4444-8444-444444444444";
  const completion = {
    artifacts: [{ key: "inference/j/1/benchmark.json", bucket: "models", role: "benchmark" }],
    summary: { benchmarkRunId: RUN, metrics: [] },
  };

  beforeEach(() => {
    mockBenchmarks.complete.mockResolvedValue({ applied: true, detail: "3 metric(s)" });
    mockBenchmarks.fail.mockResolvedValue(undefined);
  });

  it("completes the run the job was queued for, with no asset involved", async () => {
    const outcome = await service().apply("benchmark", null, completion, {
      modelVersionId: "mv",
      datasetVersionId: "dv",
      inputSpec: { benchmarkRunId: RUN },
    });
    expect(outcome).toEqual({ applied: true, detail: "3 metric(s)" });
    expect(mockBenchmarks.complete).toHaveBeenCalledWith(RUN, completion.summary, completion.artifacts);
  });

  it("refuses a benchmark job that carries no run id", async () => {
    const outcome = await service().apply("benchmark", null, completion, { modelVersionId: "mv", inputSpec: {} });
    expect(outcome.applied).toBe(false);
    expect(mockBenchmarks.complete).not.toHaveBeenCalled();
  });

  it("marks the run failed rather than un-succeeding the job when the ledger throws", async () => {
    mockBenchmarks.complete.mockRejectedValue(new Error("db down"));
    const outcome = await service().apply("benchmark", null, completion, {
      modelVersionId: "mv",
      inputSpec: { benchmarkRunId: RUN },
    });
    expect(outcome.applied).toBe(false);
    expect(mockBenchmarks.fail).toHaveBeenCalledWith(RUN, expect.stringContaining("db down"));
  });

  it("marks a terminally failed benchmark job's run failed", async () => {
    await service().markBenchmarkFailed({ benchmarkRunId: RUN }, "benchmark failed: pod died");
    expect(mockBenchmarks.fail).toHaveBeenCalledWith(RUN, "benchmark failed: pod died");
    await service().markBenchmarkFailed({}, "x");
    expect(mockBenchmarks.fail).toHaveBeenCalledTimes(1);
  });

  it("still says so for an asset-less job of another type", async () => {
    const outcome = await service().apply("train", null, { artifacts: [], summary: {} });
    expect(outcome.applied).toBe(false);
    expect(outcome.detail).toMatch(/no video asset/);
  });
});

/**
 * track -> one row per confirmed track. The positions stay in the artifact; the row
 * is what a reviewer selects and names both models that made it.
 */
describe("track results become rows", () => {
  const TRACKER = "55556666-7777-4888-9999-aaaabbbbcccc";
  const DETECTOR = "55556666-7777-4888-9999-aaaabbbbdddd";
  const JOB = "66667777-8888-4999-a000-bbbbccccdddd";
  const artifacts = [{ key: "inference/j/1/tracks.json", bucket: "derived", role: "tracks" }];
  const row = (over: Record<string, unknown> = {}) => ({
    localTrackId: 1, class: "player", startFrame: 0, endFrame: 59, startMs: 9000, endMs: 11360, detectionCount: 60, confirmed: true, ...over,
  });
  const summary = (over: Record<string, unknown> = {}) => ({
    trackerVersionId: TRACKER, detectorVersionId: DETECTOR, tracks: 2, tracksByClass: { player: 1, ball: 1 },
    trackRows: [row(), row({ localTrackId: 2, class: "ball", detectionCount: 50 })], ...over,
  });
  const context = { jobId: JOB, modelVersionId: TRACKER };

  beforeEach(() => {
    mockPrisma.visionTrack.createMany.mockResolvedValue({ count: 2 });
  });

  it("writes one row per track, naming both models and the artifact", async () => {
    const outcome = await service().apply("track", ASSET, { artifacts, summary: summary() }, context);
    expect(outcome.applied).toBe(true);
    expect(outcome.detail).toContain("2 track(s) (1 player, 1 ball), 2 new");
    const call = mockPrisma.visionTrack.createMany.mock.calls[0]![0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data[1]).toEqual({
      videoAssetId: ASSET, inferenceJobId: JOB, localTrackId: 2, class: "ball", startMs: 9000, endMs: 11360, startFrame: 0, endFrame: 59,
      detectionCount: 50, confirmed: true, trackerVersionId: TRACKER, detectorVersionId: DETECTOR, artifactKey: "inference/j/1/tracks.json",
    });
  });

  it("refuses a summary whose tracker is not the job's model version", async () => {
    const outcome = await service().apply("track", ASSET, { artifacts, summary: summary({ trackerVersionId: "other" }) }, context);
    expect(outcome.applied).toBe(false);
    expect(mockPrisma.visionTrack.createMany).not.toHaveBeenCalled();
  });

  it("refuses a completion with no tracks artifact, or no rows, or a malformed row", async () => {
    expect((await service().apply("track", ASSET, { artifacts: [], summary: summary() }, context)).applied).toBe(false);
    expect((await service().apply("track", ASSET, { artifacts, summary: summary({ trackRows: undefined }) }, context)).applied).toBe(false);
    const bad = await service().apply("track", ASSET, { artifacts, summary: summary({ trackRows: [row({ startMs: "soon" })] }) }, context);
    expect(bad.applied).toBe(false);
    expect(bad.detail).toMatch(/malformed; nothing written/);
    expect(mockPrisma.visionTrack.createMany).not.toHaveBeenCalled();
  });

  it("needs the job id, which only the controller knows", async () => {
    const outcome = await service().apply("track", ASSET, { artifacts, summary: summary() }, { modelVersionId: TRACKER });
    expect(outcome.applied).toBe(false);
  });
});

/**
 * identify -> one team assignment per track the job saw, attached to the track
 * rows of the track job the artifact came from.
 */
describe("identify results become team assignments", () => {
  const IDENTIFY = "55556666-7777-4888-9999-aaaabbbbeeee";
  const JOB = "66667777-8888-4999-a000-bbbbccccdddd";
  const artifacts = [{ key: "inference/j/1/identity.json", bucket: "derived", role: "identity" }];
  const summary = (over: Record<string, unknown> = {}) => ({
    identifyVersionId: IDENTIFY, trackerVersionId: "trk", trackJobId: "job-t",
    kits: [{ team: "A", description: "red" }, { team: "B", description: "blue" }],
    teamRows: [
      { localTrackId: 1, class: "player", team: "A", nearest: "A", confidence: 0.8, method: "kit_cluster", samples: 5 },
      { localTrackId: 2, class: "player", team: null, nearest: "B", confidence: 0.05, method: "kit_cluster", samples: 5 },
      { localTrackId: 3, class: "goalkeeper", team: null, nearest: null, confidence: null, method: "not_clustered", samples: 5 },
      { localTrackId: 9, class: "player", team: "B", confidence: 0.9, method: "kit_cluster", samples: 2 },
    ],
    ...over,
  });
  const context = { jobId: JOB, modelVersionId: IDENTIFY, inputSpec: { tracks: { jobId: "job-t" } } };

  beforeEach(() => {
    mockPrisma.visionTrack.findMany.mockResolvedValue([{ id: "t1", localTrackId: 1 }, { id: "t2", localTrackId: 2 }, { id: "t3", localTrackId: 3 }]);
    mockPrisma.visionTeamAssignment.createMany.mockResolvedValue({ count: 3 });
  });

  it("writes one row per known track, with the kit named and unknown kept as null", async () => {
    const outcome = await service().apply("identify", ASSET, { artifacts, summary: summary() }, context);
    expect(outcome.applied).toBe(true);
    expect(outcome.detail).toContain("3 assignment(s), 1 with a side (A: red, B: blue), 2 unknown, 3 new, 1 for tracks not on record");
    const call = mockPrisma.visionTeamAssignment.createMany.mock.calls[0]![0];
    expect(call.skipDuplicates).toBe(true);
    expect(call.data).toEqual([
      { trackId: "t1", inferenceJobId: JOB, team: "A", nearestTeam: "A", confidence: 0.8, method: "kit_cluster", kitDescription: "red", identifyVersionId: IDENTIFY },
      // An abstention keeps the side it was nearest to, and that side's kit, so it can be judged later.
      { trackId: "t2", inferenceJobId: JOB, team: null, nearestTeam: "B", confidence: 0.05, method: "kit_cluster", kitDescription: "blue", identifyVersionId: IDENTIFY },
      { trackId: "t3", inferenceJobId: JOB, team: null, nearestTeam: null, confidence: null, method: "not_clustered", kitDescription: null, identifyVersionId: IDENTIFY },
    ]);
    expect(mockPrisma.visionTrack.findMany.mock.calls[0]![0].where).toEqual({ inferenceJobId: "job-t" });
  });

  it("refuses a summary whose version is not the job's, or with no track job, or malformed rows", async () => {
    expect((await service().apply("identify", ASSET, { artifacts, summary: summary({ identifyVersionId: "other" }) }, context)).applied).toBe(false);
    expect((await service().apply("identify", ASSET, { artifacts, summary: summary({ trackJobId: undefined }) }, context)).applied).toBe(false);
    // The track job the worker reports must be the one it was dispatched with.
    expect((await service().apply("identify", ASSET, { artifacts, summary: summary({ trackJobId: "job-other-asset" }) }, context)).applied).toBe(false);
    expect((await service().apply("identify", ASSET, { artifacts, summary: summary() }, { jobId: JOB, modelVersionId: IDENTIFY })).applied).toBe(false);
    expect((await service().apply("identify", ASSET, { artifacts, summary: summary({ teamRows: [{ localTrackId: "x" }] }) }, context)).applied).toBe(false);
    expect(mockPrisma.visionTeamAssignment.createMany).not.toHaveBeenCalled();
  });

  it("refuses a completion with no identity artifact", async () => {
    expect((await service().apply("identify", ASSET, { artifacts: [], summary: summary() }, context)).applied).toBe(false);
  });
});

/** cuts -> proposed camera segments beside a person's, never over them. */
describe("cut proposals become camera segments", () => {
  const artifacts = [{ key: "inference/j/1/cuts.json", bucket: "derived", role: "cuts" }];
  const summary = (segments: unknown[] = [{ startMs: 9000, endMs: 70200 }, { startMs: 70200, endMs: 189000 }, { startMs: 189000, endMs: 609000 }]) => ({ cuts: 2, segments });

  beforeEach(() => {
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([]);
    mockPrisma.visionCameraSegment.deleteMany.mockReturnValue("delete-op");
    mockPrisma.visionCameraSegment.createMany.mockReturnValue("create-op");
    mockPrisma.$transaction.mockResolvedValue([]);
  });

  it("writes every proposal as a scene_detect segment of kind unknown", async () => {
    const outcome = await service().apply("cuts", ASSET, { artifacts, summary: summary() });
    expect(outcome.applied).toBe(true);
    expect(outcome.detail).toContain("3 proposed segment(s): 3 new");
    expect(mockPrisma.visionCameraSegment.createMany.mock.calls[0]![0].data).toEqual([
      { videoAssetId: ASSET, startMs: 9000, endMs: 70200, kind: "unknown", source: "scene_detect" },
      { videoAssetId: ASSET, startMs: 70200, endMs: 189000, kind: "unknown", source: "scene_detect" },
      { videoAssetId: ASSET, startMs: 189000, endMs: 609000, kind: "unknown", source: "scene_detect" },
    ]);
    expect(mockPrisma.$transaction.mock.calls[0]![0]).toEqual(["create-op"]);
  });

  it("skips a proposal that overlaps a segment a person declared, and one a person calibrated", async () => {
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([
      { id: "m", startMs: 60000, endMs: 80000, source: "manual", _count: { calibrations: 0 } },
      { id: "c", startMs: 200000, endMs: 300000, source: "scene_detect", _count: { calibrations: 1 } },
    ]);
    const outcome = await service().apply("cuts", ASSET, { artifacts, summary: summary() });
    expect(outcome.detail).toContain("0 new");
    expect(outcome.detail).toContain("3 skipped");
    expect(mockPrisma.visionCameraSegment.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.visionCameraSegment.deleteMany).not.toHaveBeenCalled();
  });

  it("replaces earlier uncalibrated proposals and keeps its own on a retry", async () => {
    mockPrisma.visionCameraSegment.findMany.mockResolvedValue([
      { id: "old", startMs: 9000, endMs: 50000, source: "scene_detect", _count: { calibrations: 0 } },
      { id: "same", startMs: 9000, endMs: 70200, source: "scene_detect", _count: { calibrations: 0 } },
    ]);
    const outcome = await service().apply("cuts", ASSET, { artifacts, summary: summary() });
    expect(outcome.detail).toContain("2 new, 1 already there");
    expect(outcome.detail).toContain("1 earlier proposal(s) replaced");
    expect(mockPrisma.visionCameraSegment.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["old"] } } });
    expect(mockPrisma.visionCameraSegment.createMany.mock.calls[0]![0].data.map((d: { startMs: number }) => d.startMs)).toEqual([70200, 189000]);
  });

  it("refuses a malformed proposal, and a completion with no artifact", async () => {
    expect((await service().apply("cuts", ASSET, { artifacts, summary: summary([{ startMs: 5, endMs: 5 }]) })).applied).toBe(false);
    expect((await service().apply("cuts", ASSET, { artifacts: [], summary: summary() })).applied).toBe(false);
    expect((await service().apply("cuts", ASSET, { artifacts, summary: { cuts: 0 } })).applied).toBe(false);
    expect(mockPrisma.visionCameraSegment.createMany).not.toHaveBeenCalled();
  });
});

/** gamestate -> nothing in Postgres; the completion is checked against what it promised. */
describe("gamestate results are checked, not stored", () => {
  const index = { key: "inference/j/1/gamestate.json", bucket: "derived", role: "gamestate" };
  const chunk = (n: number) => ({ key: `inference/j/1/gamestate/chunk-0000${n}.parquet`, bucket: "derived", role: "gamestate_chunk" });
  const summary = (over: Record<string, unknown> = {}) => ({ chunks: 2, rows: 82, frames: 41, placed: 80, suppressed: 2, reasons: { beyond_horizon: 2 }, validFrameCoverage: 1, ...over });

  it("accepts an index with the chunks it names and reports the coverage", async () => {
    const outcome = await service().apply("gamestate", ASSET, { artifacts: [chunk(0), chunk(1), index], summary: summary() });
    expect(outcome.applied).toBe(true);
    expect(outcome.detail).toContain("2 chunk(s), 80 placed and 2 suppressed row(s) over 41 frame(s); valid-frame coverage 1.000");
  });

  it("refuses a completion with no index, with fewer chunks than promised, or with no counts", async () => {
    expect((await service().apply("gamestate", ASSET, { artifacts: [chunk(0)], summary: summary() })).applied).toBe(false);
    expect((await service().apply("gamestate", ASSET, { artifacts: [chunk(0), index], summary: summary() })).applied).toBe(false);
    expect((await service().apply("gamestate", ASSET, { artifacts: [chunk(0), chunk(1), index], summary: { chunks: 2 } })).applied).toBe(false);
  });
});
