/** Synthetic artifact fixture shared only by the possession QA specifications. */
import { checksum } from "./possession-evidence";
import { InMemoryObjectStore } from "../storage/in-memory-object-store";

export function possessionFixture() {
  const asset = { id: "asset", checksumSha256: "a".repeat(64), durationMs: 400 };
  const cameras = [{ cameraSegmentId: "cam", startMs: 0, endMs: 400, kind: "live_play" }];
  const rows: any[] = [{ startMs: 0, endMs: 200, frames: 5, state: "unknown", reason: "continuity_pending", cameraSegmentId: "cam", trajectoryId: 1, localTrackId: null, evidenceConfidence: null, reviewState: "unreviewed" },
    { startMs: 200, endMs: 400, frames: 5, state: "candidate", reason: null, cameraSegmentId: "cam", trajectoryId: 1, localTrackId: 1, evidenceConfidence: .8, reviewState: "unreviewed" }];
  const input: any = { sourceChecksum: asset.checksumSha256, sourceDurationMs: 400, proxyDurationMs: 440, proxy: { fps: 25, sourceOffsetMs: 0 },
    ball: { jobId: "ball", indexChecksum: "b".repeat(64) }, tracks: { jobId: "track", checksum: "c".repeat(64), trackerVersionId: "tracker", key: "inference/track/1/tracks.json" },
    detectorJobId: "detect", detectorVersionId: "detector", detectionsChecksum: "d".repeat(64), proxyChecksum: "e".repeat(64), imageWidth: 1000, imageHeight: 500, segments: cameras };
  const index: any = { contractVersion: "1.14.0", role: "possession", videoAssetId: asset.id, calculationVersion: "possession-candidates/v1", coordinateBasis: "image_foot_proximity", reviewState: "unreviewed",
    sourceChecksum: input.sourceChecksum, proxyChecksum: input.proxyChecksum, detectionsChecksum: input.detectionsChecksum, ballJobId: "ball", ballIndexChecksum: input.ball.indexChecksum,
    trackJobId: "track", tracksChecksum: input.tracks.checksum, trackerVersionId: "tracker", detectorJobId: "detect", detectorVersionId: "detector", imageWidth: 1000, imageHeight: 500, proxy: input.proxy, cameraSegments: cameras,
    frames: 10, candidateFrames: 5, unknownFrames: 5, candidateFrameCoverage: .5, reasons: { continuity_pending: 5 }, segments: 2, windowStartMs: 0, windowEndMs: 400, config: {}, chunks: [] };
  const store = new InMemoryObjectStore();
  const job: any = { id: "job", videoAssetId: asset.id, type: "possession", state: "succeeded", modelVersionId: null, workerId: "qa-worker", idempotencyKey: "qa-complete", attemptNumber: 1, finishedAt: new Date("2026-10-05T12:00:00Z"), outputPrefix: "inference/job/1/", inputSpec: input };
  let log: any;
  async function write() {
    const chunk = Buffer.from(rows.map((s) => JSON.stringify(s)).join("\n") + "\n");
    const indexKey = `${job.outputPrefix}possession.json`;
    index.chunks = [{ key: `${job.outputPrefix}possession/000.jsonl`, checksumSha256: checksum(chunk), startMs: rows[0]!.startMs, endMs: rows.at(-1)!.endMs, frames: rows.reduce((n, s) => n + s.frames, 0), segments: rows.length }];
    const body = Buffer.from(JSON.stringify(index));
    await store.putSmallObject("derived", index.chunks[0].key, chunk, "application/x-ndjson");
    await store.putSmallObject("derived", indexKey, body, "application/json");
    const summary: any = Object.fromEntries(["calculationVersion", "frames", "candidateFrames", "unknownFrames", "candidateFrameCoverage", "reasons", "segments", "windowStartMs", "windowEndMs", "sourceChecksum", "ballJobId", "trackJobId", "ballIndexChecksum", "tracksChecksum", "coordinateBasis", "reviewState"].map((k) => [k, index[k]]));
    summary.chunks = 1; summary.indexChecksum = checksum(body);
    if (index.constraintMode === "calibrated") for (const k of ["constraintMode", "calibrationSnapshot", "footballConfig"]) summary[k] = index[k];
    job.progress = { workerImage: "qa-only-image", modelVersionIds: [], summary, artifacts: [
      { key: indexKey, bytes: body.length, bucket: "derived", contentType: "application/json", role: "possession" },
      { key: index.chunks[0].key, bytes: chunk.length, bucket: "derived", contentType: "application/x-ndjson", role: "possession_chunk" }] };
    log = { data: structuredClone(job.progress) };
  }
  return { asset, cameras, rows, input, index, store, job, write, get log() { return log; } };
}

export function calibratePossessionFixture(fixture: ReturnType<typeof possessionFixture>) {
  const snapshot = { proxyWidth: 1000, proxyHeight: 500, proxyVariantId: "proxy", proxyKey: "proxy.mp4", proxyChecksum: fixture.input.proxyChecksum,
    segments: fixture.cameras.map((s) => ({ cameraSegmentId: s.cameraSegmentId, startMs: s.startMs, endMs: s.endMs, calibrationId: "cal", quality: "good", thresholdsVersion: "provisional/v1", homography: [.1,0,0,0,.1,0,0,0,1], pitch: { lengthM: 105, widthM: 68 } })) };
  Object.assign(fixture.input, { constraintMode: "calibrated", calibrationSnapshot: snapshot });
  Object.assign(fixture.index, { contractVersion: "1.15.0", calculationVersion: "possession-candidates/v2", constraintMode: "calibrated", calibrationSnapshot: structuredClone(snapshot), footballConfig: { maxGroundDistanceM: 2, maxBallGroundSpeedMps: 35, maxPlayerSpeedMps: 12 } });
  return snapshot;
}
