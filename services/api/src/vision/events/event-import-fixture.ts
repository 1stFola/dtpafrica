/** Synthetic-only immutable event artifact; no real footage or inference. */
import { createHash } from "node:crypto";
import { EVENT_CARRY_MANIFEST_CHECKSUM, VISION_EVENT_TAXONOMY_VERSION } from "@dtp/vision-contracts";
import { InMemoryObjectStore } from "../storage/in-memory-object-store";

export function eventImportFixture() {
  const asset: any = { id: "asset", checksumSha256: "a".repeat(64), durationMs: 2000, sbMatchId: "match" };
  const calibration: any = { id: "cal", quality: "good", thresholdsVersion: "qa-only/v1", createdAt: new Date("2026-10-02"), points: [], homography: [.1,0,0,0,.1,0,0,0,1], pitchLengthM: 105, pitchWidthM: 68 };
  const camera: any = { id: "cam", startMs: 0, endMs: 2000, kind: "live_play", calibrations: [calibration] };
  const proxy: any = { id: "proxy", objectKey: "proxy.mp4", width: 1000, height: 500, fps: 25, sourceOffsetMs: 0, createdAt: new Date("2026-10-01") };
  const model: any = { id: "model", version: "qa-only", datasetVersionId: null, weightsKey: null, weightsChecksum: null, configKey: "event-carry/v2", gitCommit: "qa-only", workerImage: "qa-only-image", model: { key: "qa-only", task: "event" } };
  const track: any = { id: "track-row", videoAssetId: "asset", inferenceJobId: "track-job", localTrackId: 1, class: "player", confirmed: true, startMs: 0, endMs: 1960, artifactKey: "inference/track-job/1/tracks.json", trackerVersionId: "tracker", detectorVersionId: "detector" };
  const snapshot: any = { proxyWidth: proxy.width, proxyHeight: proxy.height, proxyVariantId: proxy.id, proxyKey: proxy.objectKey, proxyChecksum: "b".repeat(64), segments: [{ cameraSegmentId: camera.id, startMs: 0, endMs: 2000, calibrationId: calibration.id, quality: "good", thresholdsVersion: calibration.thresholdsVersion, homography: calibration.homography, pitch: { lengthM: 105, widthM: 68 } }] };
  const cameras = [{ cameraSegmentId: camera.id, startMs: 0, endMs: 2000, kind: "live_play" }];
  const producer: any = { algorithm: "event-carry/v2", manifestChecksum: EVENT_CARRY_MANIFEST_CHECKSUM, possessionJobId: "possession", possessionIndexChecksum: "c".repeat(64), tracksChecksum: "d".repeat(64), calibrationSnapshot: snapshot, cameraSegments: cameras };
  const input: any = { sourceChecksum: asset.checksumSha256, windowStartMs: 0, windowEndMs: 2000, eventAlgorithm: { modelVersionId: model.id, configKey: model.configKey, weightsChecksum: null, manifestChecksum: EVENT_CARRY_MANIFEST_CHECKSUM, gitCommit: model.gitCommit, workerImage: model.workerImage },
    possession: { jobId: producer.possessionJobId, indexChecksum: producer.possessionIndexChecksum }, tracks: { jobId: track.inferenceJobId, key: track.artifactKey, checksum: producer.tracksChecksum },
    possessionIndex: { role: "possession", calculationVersion: "possession-candidates/v2", videoAssetId: asset.id, sourceChecksum: asset.checksumSha256, proxy: { fps: 25, sourceOffsetMs: 0 }, trackJobId: track.inferenceJobId, trackerVersionId: track.trackerVersionId, detectorVersionId: track.detectorVersionId, calibrationSnapshot: snapshot, cameraSegments: cameras } };
  const artifact: any = { schemaVersion: "event-inference/v2", jobId: "job", attemptNumber: 1, videoAssetId: asset.id, sourceChecksum: asset.checksumSha256, modelVersionId: model.id, weightsChecksum: null,
    configKey: model.configKey, gitCommit: model.gitCommit, workerImage: model.workerImage, taxonomyVersion: VISION_EVENT_TAXONOMY_VERSION, coverage: { startMs: 0, endMs: 2000, complete: true }, producer,
    events: [{ id: "carry-1", type: "carry", startMs: 200, endMs: 1960, actorMatchSquadPlayerId: null, localTrackId: 1, trajectoryId: 1, cameraSegmentId: camera.id, confidence: .8, inPlay: true, displacementM: 4.4 }] };
  const job: any = { id: "job", type: "events", state: "succeeded", videoAssetId: asset.id, modelVersionId: model.id, workerId: "qa-only-synthetic", idempotencyKey: "qa-only", attemptNumber: 1, finishedAt: new Date("2026-10-06"), outputPrefix: "inference/job/1/", inputSpec: input };
  const transcode: any = { progress: { summary: { proxy: { key: proxy.objectKey, checksumSha256: snapshot.proxyChecksum } }, artifacts: [{ role: "proxy", key: proxy.objectKey }] } };
  const store = new InMemoryObjectStore(); let log: any;
  async function write() {
    const key = `${job.outputPrefix}events.json`, body = JSON.stringify(artifact);
    await store.putSmallObject("derived", key, body, "application/json");
    job.progress = { workerImage: model.workerImage, modelVersionIds: [model.id], artifacts: [{ role: "event_inference", bucket: "derived", contentType: "application/json", key, bytes: Buffer.byteLength(body) }],
      summary: { modelVersionId: model.id, weightsSha256: null, sourceChecksum: asset.checksumSha256, windowStartMs: 0, windowEndMs: 2000, eventCount: artifact.events.length, eventArtifactSha256: createHash("sha256").update(body).digest("hex"), producer } };
    log = { data: structuredClone(job.progress) };
  }
  return { asset, camera, calibration, proxy, model, track, snapshot, producer, input, artifact, job, transcode, store, write, get log() { return log; } };
}
