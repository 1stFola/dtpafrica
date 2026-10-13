import { describe, it, expect } from "vitest";
import { EVENT_CARRY_MANIFEST_CHECKSUM } from "@dtp/vision-contracts";
import { VisionStageResultsService } from "./stage-results.service";
import { possessionFixture, calibratePossessionFixture } from "../possession/possession-fixture";

describe("carry completion has no ledger side effects", () => {
  function fixture() {
    const f = possessionFixture(); calibratePossessionFixture(f);
    const producer = { algorithm: "event-carry/v2", manifestChecksum: EVENT_CARRY_MANIFEST_CHECKSUM, possessionJobId: "possession", possessionIndexChecksum: "a".repeat(64), tracksChecksum: "c".repeat(64), calibrationSnapshot: f.index.calibrationSnapshot, cameraSegments: f.cameras };
    const summary: any = { producer, modelVersionId: "model", weightsSha256: null, sourceChecksum: "a".repeat(64), windowStartMs: 0, windowEndMs: 400, eventCount: 0, eventArtifactSha256: "f".repeat(64), reviewState: "unreviewed" };
    const context = { modelVersionId: "model", inputSpec: { eventAlgorithm: { modelVersionId: "model", configKey: "event-carry/v2", manifestChecksum: EVENT_CARRY_MANIFEST_CHECKSUM, weightsChecksum: null, gitCommit: "commit", workerImage: "image" }, sourceChecksum: "a".repeat(64), windowStartMs: 0, windowEndMs: 400, possession: { jobId: "possession", indexChecksum: "a".repeat(64) }, possessionIndex: f.index, tracks: { checksum: "c".repeat(64) } } };
    const artifacts: any[] = [{ role: "event_inference", key: "inference/events/1/events.json", bucket: "derived", contentType: "application/json", bytes: 2000 }];
    // An empty DB object would fail immediately if the producer attempted writes.
    const service = new VisionStageResultsService({} as never, {} as never);
    return { service, summary, context, artifacts };
  }
  it("accepts an explicit complete zero-output summary without making event rows", async () => {
    const { service, summary, context, artifacts } = fixture();
    expect(await service.apply("events", "asset", { summary, artifacts }, context)).toMatchObject({ applied: true, detail: expect.stringContaining("no event rows written") });
  });
  it("refuses a legacy or missing dispatch context without attempting any database writes", async () => {
    const { service, summary, artifacts } = fixture();
    expect((await service.apply("events", "asset", { summary, artifacts }, { modelVersionId: null })).applied).toBe(false);
  });
  it.each(["model", "weights", "producer", "count", "bytes", "duplicate"])("refuses inconsistent completion: %s", async (change) => {
    const { service, summary, context, artifacts } = fixture();
    if (change === "model") summary.modelVersionId = "other";
    if (change === "weights") summary.weightsSha256 = "a".repeat(64);
    if (change === "producer") summary.producer = {};
    if (change === "count") summary.eventCount = 201;
    if (change === "bytes") artifacts[0].bytes = 300000;
    if (change === "duplicate") artifacts.push({ ...artifacts[0] });
    expect((await service.apply("events", "asset", { summary, artifacts }, context)).applied).toBe(false);
  });
});
