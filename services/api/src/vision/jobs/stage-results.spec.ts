import { beforeEach, describe, expect, it, vi } from "vitest";
import { VisionStageResultsService } from "./stage-results.service";

const ASSET = "aaaa1111-2222-3333-4444-555566667777";

const mockPrisma = {
  visionVideoAsset: { update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  visionVideoVariant: { upsert: vi.fn() },
  visionDuplicateCluster: { create: vi.fn() },
  $transaction: vi.fn(),
};

function service() {
  return new VisionStageResultsService(mockPrisma as never);
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
    // `track` has no projection yet; `detect` gained one in Phase 3 Increment 1.
    const outcome = await service().apply("track", ASSET, { artifacts: [], summary: {} });
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
