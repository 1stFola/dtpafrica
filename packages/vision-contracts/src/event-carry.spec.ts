import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { EVENT_CARRY_MANIFEST, EVENT_CARRY_MANIFEST_CHECKSUM, validCarryProducer } from "./event-carry";
import { validateEventInferenceArtifact } from "./event-inference";
import { VISION_EVENT_TAXONOMY_VERSION } from "./events";

export function carryArtifactFixture() {
  return { schemaVersion: "event-inference/v2", jobId: "job", attemptNumber: 1, videoAssetId: "asset", sourceChecksum: "a".repeat(64), modelVersionId: "model", weightsChecksum: null,
    configKey: "event-carry/v1", gitCommit: "commit", workerImage: "image", taxonomyVersion: VISION_EVENT_TAXONOMY_VERSION, coverage: { startMs: 0, endMs: 2000, complete: true },
    producer: { algorithm: "event-carry/v1", manifestChecksum: EVENT_CARRY_MANIFEST_CHECKSUM, possessionJobId: "possession", possessionIndexChecksum: "c".repeat(64), tracksChecksum: "d".repeat(64),
      cameraSegments: [{ cameraSegmentId: "cam", startMs: 0, endMs: 2000, kind: "live_play" }], calibrationSnapshot: { proxyWidth: 1000, proxyHeight: 500, proxyVariantId: "proxy", proxyKey: "proxy.mp4", proxyChecksum: "b".repeat(64),
      segments: [{ cameraSegmentId: "cam", startMs: 0, endMs: 2000, quality: "good", calibrationId: "cal", thresholdsVersion: "test", homography: [.1,0,0,0,.1,0,0,0,1], pitch: { lengthM: 105, widthM: 68 } }] } },
    events: [{ id: "carry-1", type: "carry", startMs: 200, endMs: 1960, actorMatchSquadPlayerId: null, localTrackId: 1, trajectoryId: 1, cameraSegmentId: "cam", confidence: .8, inPlay: true, displacementM: 4.4 }] };
}

describe("weight-free carry inference contract", () => {
  it("hashes the canonical manifest consistently and preserves local original evidence", () => {
    const canonical = JSON.stringify(EVENT_CARRY_MANIFEST, Object.keys(EVENT_CARRY_MANIFEST).sort());
    expect(createHash("sha256").update(canonical).digest("hex")).toBe(EVENT_CARRY_MANIFEST_CHECKSUM);
    expect(validateEventInferenceArtifact(carryArtifactFixture()).artifact).toEqual(carryArtifactFixture());
    expect(validateEventInferenceArtifact({ ...carryArtifactFixture(), events: [] }).artifact?.events).toEqual([]);
  });
  it.each(["type", "named actor", "short", "distance", "track", "trajectory", "camera", "not live", "confidence"])("refuses false carry claims: %s", (change) => {
    const f: any = carryArtifactFixture(), e = f.events[0];
    if (change === "type") e.type = "pass";
    if (change === "named actor") e.actorMatchSquadPlayerId = "guessed";
    if (change === "short") e.endMs = 1199;
    if (change === "distance") e.displacementM = 1.99;
    if (change === "track") e.localTrackId = -1;
    if (change === "trajectory") e.trajectoryId = null;
    if (change === "camera") e.cameraSegmentId = "other";
    if (change === "not live") e.inPlay = false;
    if (change === "confidence") e.confidence = NaN;
    expect(validateEventInferenceArtifact(f).artifact).toBeNull();
  });
  it.each(["weights", "manifest", "checksum", "geometry", "camera null", "calibration null", "pitch", "matrix", "failed", "superseded camera"])("rejects malformed provenance without throwing: %s", (change) => {
    const f: any = carryArtifactFixture(), p = f.producer;
    if (change === "weights") f.weightsChecksum = "a".repeat(64);
    if (change === "manifest") p.manifestChecksum = "f".repeat(64);
    if (change === "checksum") p.tracksChecksum = "";
    if (change === "geometry") p.calibrationSnapshot.proxyWidth = null;
    if (change === "camera null") p.cameraSegments[0] = null;
    if (change === "calibration null") p.calibrationSnapshot.segments[0] = null;
    if (change === "pitch") p.calibrationSnapshot.segments[0].pitch.lengthM = 0;
    if (change === "matrix") p.calibrationSnapshot.segments[0].homography = [0,0,0,0,0,0,0,0,1];
    if (change === "failed") Object.assign(p.calibrationSnapshot.segments[0], { quality: "failed", homography: null, pitch: null });
    if (change === "superseded camera") p.calibrationSnapshot.segments[0].cameraSegmentId = "other";
    expect(validateEventInferenceArtifact(f).artifact).toBeNull();
  });
  it("allows wholly Unknown cameras without numerical evidence in an explicit zero-output run", () => {
    const f: any = carryArtifactFixture(); f.events = [];
    Object.assign(f.producer.calibrationSnapshot.segments[0], { calibrationId: null, quality: null, thresholdsVersion: null, homography: null, pitch: null });
    expect(validCarryProducer(f.producer)).toBe(true);
    expect(validateEventInferenceArtifact(f).artifact?.events).toEqual([]);
  });
});
