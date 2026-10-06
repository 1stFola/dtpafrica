import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VISION_EVENT_TAXONOMY_VERSION, EVENT_CARRY_MANIFEST_CHECKSUM } from "@dtp/vision-contracts";
import { readEventRunEvidence } from "./event-run-evidence";
import { InMemoryObjectStore } from "../storage/in-memory-object-store";

let job: any, model: any, log: any, artifact: any, store: InMemoryObjectStore;
const set = { videoAssetId: "asset", sourceChecksum: "a".repeat(64), windowStartMs: 1000, windowEndMs: 4000, taxonomyVersion: VISION_EVENT_TAXONOMY_VERSION } as never;
const db = { visionJob: { findFirst: vi.fn() }, visionModelVersion: { findUnique: vi.fn() }, visionJobEvent: { findFirst: vi.fn() } };
const read = () => readEventRunEvidence(db as never, store, set, "job", 5000);
async function writeArtifact() {
  const body = JSON.stringify(artifact), key = "inference/job/2/events.json";
  await store.putSmallObject("derived", key, body, "application/json");
  job.progress = { modelVersionIds: ["model"], workerImage: "image", artifacts: [{ key, bucket: "derived", role: "event_inference", contentType: "application/json", bytes: Buffer.byteLength(body) }],
    summary: { modelVersionId: "model", weightsSha256: "b".repeat(64), sourceChecksum: "a".repeat(64), windowStartMs: 0, windowEndMs: 5000, eventCount: artifact.events.length, eventArtifactSha256: createHash("sha256").update(body).digest("hex") } };
  log = { data: structuredClone(job.progress) };
}
beforeEach(async () => {
  vi.resetAllMocks(); store = new InMemoryObjectStore();
  model = { id: "model", model: { key: "events", task: "event" }, version: "v1", weightsChecksum: "b".repeat(64), configKey: "config", gitCommit: "commit", workerImage: "image" };
  artifact = { schemaVersion: "event-inference/v1", jobId: "job", attemptNumber: 2, videoAssetId: "asset", sourceChecksum: "a".repeat(64), modelVersionId: "model", weightsChecksum: "b".repeat(64), configKey: "config", gitCommit: "commit", workerImage: "image", taxonomyVersion: VISION_EVENT_TAXONOMY_VERSION,
    coverage: { startMs: 0, endMs: 5000, complete: true }, events: [] };
  job = { id: "job", type: "events", state: "succeeded", videoAssetId: "asset", modelVersionId: "model", workerId: "worker", idempotencyKey: "complete-once", attemptNumber: 2, finishedAt: new Date(), outputPrefix: "inference/job/2/",
    inputSpec: { sourceChecksum: "a".repeat(64), windowStartMs: 0, windowEndMs: 5000 } };
  await writeArtifact();
  db.visionJob.findFirst.mockImplementation(async () => job);
  db.visionModelVersion.findUnique.mockImplementation(async () => model);
  db.visionJobEvent.findFirst.mockImplementation(async () => log);
});
describe("event run evidence", () => {
  async function carry() {
    model.weightsChecksum = null; model.weightsKey = null; model.configKey = "event-carry/v1";
    artifact.schemaVersion = "event-inference/v2"; artifact.weightsChecksum = null; artifact.configKey = "event-carry/v1";
    const snapshot = { proxyWidth: 1000, proxyHeight: 500, proxyVariantId: "proxy", proxyKey: "proxy.mp4", proxyChecksum: "e".repeat(64),
      segments: [{ cameraSegmentId: "cam", startMs: 0, endMs: 5000, calibrationId: "cal", thresholdsVersion: "test", quality: "good", homography: [.1,0,0,0,.1,0,0,0,1], pitch: { lengthM: 105, widthM: 68 } }] };
    const cameras = [{ cameraSegmentId: "cam", startMs: 0, endMs: 5000, kind: "live_play" }];
    artifact.producer = { algorithm: "event-carry/v1", manifestChecksum: EVENT_CARRY_MANIFEST_CHECKSUM, possessionJobId: "possession", possessionIndexChecksum: "c".repeat(64), tracksChecksum: "d".repeat(64), calibrationSnapshot: snapshot, cameraSegments: cameras };
    Object.assign(job.inputSpec, { eventAlgorithm: { modelVersionId: "model", configKey: "event-carry/v1", manifestChecksum: EVENT_CARRY_MANIFEST_CHECKSUM, weightsChecksum: null, gitCommit: "commit", workerImage: "image" },
      possession: { jobId: "possession", indexChecksum: "c".repeat(64) }, tracks: { checksum: "d".repeat(64) }, possessionIndex: { calibrationSnapshot: snapshot, cameraSegments: cameras } });
    artifact.events = [{ id: "carry-1", type: "carry", startMs: 1000, endMs: 3000, actorMatchSquadPlayerId: null, localTrackId: 1, trajectoryId: 1, cameraSegmentId: "cam", inPlay: true, confidence: .8, displacementM: 3 }];
    await writeArtifact();
    job.progress.summary.weightsSha256 = null; job.progress.summary.producer = structuredClone(artifact.producer); log = { data: structuredClone(job.progress) };
  }
  it("reads a registered weight-free carry artifact with pinned original producer evidence", async () => {
    await carry();
    const result = await read();
    expect(result.artifact.events[0]).toMatchObject({ type: "carry", localTrackId: 1, actorMatchSquadPlayerId: null });
    expect(result.provenance.producer).toEqual(artifact.producer);
    expect(result.model.weightsChecksum).toBeNull();
  });
  it.each(["queued possession", "queued calibration", "logged producer", "weighted version", "queued manifest", "queued image"])("refuses inconsistent carry provenance: %s", async (change) => {
    await carry();
    if (change === "queued possession") job.inputSpec.possession.indexChecksum = "f".repeat(64);
    if (change === "queued calibration") job.inputSpec.possessionIndex.calibrationSnapshot = {};
    if (change === "logged producer") log.data.summary.producer.tracksChecksum = "f".repeat(64);
    if (change === "weighted version") model.weightsChecksum = "a".repeat(64);
    if (change === "queued manifest") job.inputSpec.eventAlgorithm.manifestChecksum = "f".repeat(64);
    if (change === "queued image") job.inputSpec.eventAlgorithm.workerImage = "different";
    await expect(read()).rejects.toMatchObject({ response: { error: "EventRunEvidenceInvalid" } });
  });
  it("pins a complete zero-output run to one attempt, source, model and logged checksum", async () => {
    const result = await read();
    expect(result.artifact.events).toEqual([]);
    expect(result.provenance).toMatchObject({ jobId: "job", attemptNumber: 2, eventCount: 0, coverage: { startMs: 0, endMs: 5000, complete: true } });
    expect(db.visionJob.findFirst).toHaveBeenCalledWith({ where: { id: "job", videoAssetId: "asset", type: "events", state: "succeeded" } });
  });
  it.each(["state", "asset", "type", "model", "completion", "worker", "task", "weights", "config"])("refuses missing or wrong run provenance: %s", async (condition) => {
    if (condition === "state") job.state = "failed";
    if (condition === "asset") job.videoAssetId = "other";
    if (condition === "type") job.type = "detect";
    if (condition === "model") job.modelVersionId = null;
    if (condition === "completion") job.idempotencyKey = null;
    if (condition === "worker") job.workerId = null;
    if (condition === "task") model.model.task = "detect";
    if (condition === "weights") model.weightsChecksum = null;
    if (condition === "config") model.configKey = null;
    await expect(read()).rejects.toMatchObject({ response: { error: "EventRunEvidenceInvalid" } });
  });
  it.each(["missing log", "log checksum", "mixed versions", "wrong image", "wrong bucket", "wrong attempt", "duplicate artifact"])("refuses mismatched completion evidence: %s", async (condition) => {
    if (condition === "missing log") log = null;
    if (condition === "log checksum") log.data.summary.eventArtifactSha256 = "f".repeat(64);
    if (condition === "mixed versions") job.progress.modelVersionIds.push("other-model");
    if (condition === "wrong image") job.progress.workerImage = "other-image";
    if (condition === "wrong bucket") job.progress.artifacts[0].bucket = "master";
    if (condition === "wrong attempt") job.outputPrefix = "inference/job/1/";
    if (condition === "duplicate artifact") job.progress.artifacts.push(job.progress.artifacts[0]);
    await expect(read()).rejects.toMatchObject({ response: { error: "EventRunEvidenceInvalid" } });
  });
  it("checks object size before reading and refuses a missing or corrupt object", async () => {
    const get = vi.spyOn(store, "getSmallObject");
    const head = vi.spyOn(store, "head").mockResolvedValueOnce({ bytes: 300000, contentType: "application/json" } as never);
    await expect(read()).rejects.toMatchObject({ response: { error: "EventRunEvidenceInvalid" } });
    expect(get).not.toHaveBeenCalled(); head.mockRestore();
    await store.delete("derived", "inference/job/2/events.json");
    await expect(read()).rejects.toMatchObject({ response: { error: "EventRunEvidenceInvalid" } });
    await writeArtifact();
    const body = JSON.stringify({ ...artifact, gitCommit: "tamper" });
    await store.putSmallObject("derived", "inference/job/2/events.json", body, "application/json");
    job.progress.artifacts[0].bytes = Buffer.byteLength(body); log.data.artifacts[0].bytes = Buffer.byteLength(body);
    await expect(read()).rejects.toMatchObject({ response: { error: "EventRunEvidenceInvalid" } });
  });
  it("bounds the actual read even if the object grows after HEAD", async () => {
    const meta = await store.head("derived", "inference/job/2/events.json");
    await store.putSmallObject("derived", "inference/job/2/events.json", "x".repeat(300000), "application/json");
    vi.spyOn(store, "head").mockResolvedValue(meta);
    await expect(read()).rejects.toMatchObject({ response: { error: "EventRunEvidenceInvalid" } });
  });
  it.each(["source", "weights", "job", "attempt", "incomplete", "partial", "queued window", "source duration", "taxonomy", "count"])("refuses an artifact that disagrees with the reference/run: %s", async (condition) => {
    if (condition === "source") artifact.sourceChecksum = "c".repeat(64);
    if (condition === "weights") artifact.weightsChecksum = "c".repeat(64);
    if (condition === "job") artifact.jobId = "other-job";
    if (condition === "attempt") artifact.attemptNumber = 1;
    if (condition === "incomplete") artifact.coverage.complete = false;
    if (condition === "partial") artifact.coverage.endMs = 3999;
    if (condition === "queued window") job.inputSpec.windowEndMs = 4999;
    if (condition === "source duration") artifact.coverage.endMs = 5001;
    if (condition === "taxonomy") artifact.taxonomyVersion = "other";
    await writeArtifact();
    if (condition === "count") job.progress.summary.eventCount = 1;
    await expect(read()).rejects.toMatchObject({ response: { error: "EventRunEvidenceInvalid" } });
  });
});
