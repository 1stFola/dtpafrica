import { describe, expect, it } from "vitest";
import { EVENT_INFERENCE_SCHEMA_VERSION, validateEventInferenceArtifact } from "./event-inference";
import { VISION_EVENT_TAXONOMY_VERSION } from "./events";
const fixture = () => ({ schemaVersion: EVENT_INFERENCE_SCHEMA_VERSION, jobId: "job", attemptNumber: 1, videoAssetId: "asset", sourceChecksum: "a".repeat(64), modelVersionId: "model", weightsChecksum: "b".repeat(64), configKey: "config", gitCommit: "commit", workerImage: "image", taxonomyVersion: VISION_EVENT_TAXONOMY_VERSION, coverage: { startMs: 1000, endMs: 5000, complete: true }, events: [] as unknown[] });
describe("complete event inference artifact", () => {
  it("accepts an explicit completed zero-output run and strips extra fields", () => {
    const result = validateEventInferenceArtifact({ ...fixture(), secret: "discard" });
    expect(result.artifact?.events).toEqual([]);
    expect(result.artifact).not.toHaveProperty("secret");
  });
  it("rejects missing, incomplete, oversized or invalid coverage", () => {
    for (const coverage of [undefined, { startMs: 1000, endMs: 5000, complete: false }, { startMs: 0, endMs: 300001, complete: true }, { startMs: 5, endMs: 5, complete: true }])
      expect(validateEventInferenceArtifact({ ...fixture(), coverage }).artifact).toBeNull();
  });
  it("requires all provenance, supported schemas and an explicit prediction list", () => {
    for (const key of ["jobId", "attemptNumber", "videoAssetId", "sourceChecksum", "modelVersionId", "weightsChecksum", "configKey", "gitCommit", "workerImage", "taxonomyVersion", "schemaVersion", "events"]) {
      const row: Record<string, unknown> = fixture(); delete row[key];
      expect(validateEventInferenceArtifact(row).artifact).toBeNull();
    }
  });
  it("validates prediction taxonomy, bounds, actor, confidence and suppression without discarding errors", () => {
    const event = { id: "prediction", type: "shot", startMs: 1000, endMs: 1000, actorMatchSquadPlayerId: null, confidence: 0, inPlay: false };
    expect(validateEventInferenceArtifact({ ...fixture(), events: [event] }).artifact?.events[0]).toEqual(event);
    for (const patch of [{ confidence: NaN }, { confidence: 2 }, { confidence: null }, { inPlay: undefined }, { type: "fake" }, { startMs: 999 }, { startMs: 5000, endMs: 5000 }, { actorMatchSquadPlayerId: undefined }])
      expect(validateEventInferenceArtifact({ ...fixture(), events: [{ ...event, ...patch }] }).artifact).toBeNull();
    expect(validateEventInferenceArtifact({ ...fixture(), events: [event, event] }).artifact).toBeNull();
    expect(validateEventInferenceArtifact({ ...fixture(), events: Array.from({ length: 201 }, (_, id) => ({ ...event, id: String(id) })) }).artifact).toBeNull();
  });
});
