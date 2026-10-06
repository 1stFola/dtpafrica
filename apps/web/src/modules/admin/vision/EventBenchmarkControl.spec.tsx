import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventBenchmarkControl } from "./EventBenchmarkControl";
import { EventScoreReport } from "./EventScoreReport";
import type { VisionEventScore } from "../../../api/vision";

const callbacks = { onChange: () => undefined, onScore: () => undefined, busy: false };
describe("event benchmark scopes", () => {
  it("keeps ledger scoring separate from original model evaluation", () => {
    const html = renderToStaticMarkup(<EventBenchmarkControl {...callbacks} models={[]} selection={{ scope: "all_current_candidates" }} />);
    expect(html).toContain("not one model&#x27;s accuracy");
    expect(html).toContain("Score current event candidates");
    expect(html).not.toContain("Event model version");
  });
  it("disables model scoring without a version and explains missing inference evidence", () => {
    const html = renderToStaticMarkup(<EventBenchmarkControl {...callbacks} models={[]} selection={{ scope: "model_original_candidates" }} />);
    expect(html).toContain("No registered event model versions");
    expect(html).toContain('disabled=""');
    expect(html).toContain("including originals later corrected or rejected");
    expect(html).toContain("does not prove the model found zero events");
  });
  it("names the selected model and preserves original-output provenance in the report", () => {
    const html = renderToStaticMarkup(<EventBenchmarkControl {...callbacks} models={[{ id: "version-id", version: "v2", model: { key: "events" } }]} selection={{ scope: "model_original_candidates", modelVersionId: "version-id" }} />);
    expect(html).toContain('value="version-id" selected=""');
    expect(html).not.toContain('disabled=""');
    const metrics = { reference: 1, predictions: 0, tp: 0, fp: 0, fn: 1, precision: null, recall: 0, f1: 0, matchedKnownActors: 0, correctActors: 0, actorAccuracy: null, actorRecall: null, meanStartErrorMs: null, meanEndErrorMs: null };
    const report: VisionEventScore = { scorerVersion: "event-score/v1", toleranceMs: 500, all: metrics, byType: [], pairs: [], missedReferenceIds: ["gold"], falsePositiveIds: [], duplicatePredictionIds: [], suppressedPredictionIds: [], nonPlayErrors: [], scope: "model_original_candidates", model: { id: "version-id", version: "v2", model: { key: "events", task: "event" }, weightsChecksum: "checksum", gitCommit: "commit", datasetVersionId: null, configKey: null, workerImage: null } };
    const rendered = renderToStaticMarkup(<EventScoreReport report={report} />);
    expect(rendered).toContain("Original proposals from one model");
    expect(rendered).toContain("Registered weights checksum: checksum");
    expect(rendered).toContain("Registered commit: commit");
  });
  it("disables completed-run scoring without evidence and clearly separates evaluation from inference", () => {
    const html = renderToStaticMarkup(<EventBenchmarkControl {...callbacks} models={[]} selection={{ scope: "complete_event_run" }} />);
    expect(html).toContain("No completed model-bound event jobs");
    expect(html).toContain("evaluator does not run inference");
    expect(html).toContain("explicit empty prediction list counts as zero predictions");
    expect(html).toContain('disabled=""');
  });
  it("selects one completed job and shows complete-run provenance on a zero-output report", () => {
    const html = renderToStaticMarkup(<EventBenchmarkControl {...callbacks} models={[]} jobs={[{ id: "completed-job", modelVersionId: "model", attemptNumber: 2, finishedAt: "2026-10-05T12:00:00Z" }]} selection={{ scope: "complete_event_run", jobId: "completed-job" }} />);
    expect(html).toContain('value="completed-job" selected=""');
    expect(html).not.toContain('disabled=""');
    const metrics = { reference: 1, predictions: 0, tp: 0, fp: 0, fn: 1, precision: null, recall: 0, f1: 0, matchedKnownActors: 0, correctActors: 0, actorAccuracy: null, actorRecall: null, meanStartErrorMs: null, meanEndErrorMs: null };
    const report: VisionEventScore = { scorerVersion: "event-score/v1", toleranceMs: 100, all: metrics, byType: [], pairs: [], missedReferenceIds: ["gold"], falsePositiveIds: [], duplicatePredictionIds: [], suppressedPredictionIds: [], nonPlayErrors: [], scope: "complete_event_run",
      inference: { jobId: "completed-job", attemptNumber: 2, artifactKey: "inference/completed-job/2/events.json", artifactChecksum: "checksum", artifactSchemaVersion: "event-inference/v1", coverage: { startMs: 0, endMs: 5000, complete: true }, finishedAt: "2026-10-05T12:00:00Z", eventCount: 0 } };
    const rendered = renderToStaticMarkup(<EventScoreReport report={report} />);
    expect(rendered).toContain("One completed event inference run");
    expect(rendered).toContain("Run output: 0 event(s)");
    expect(rendered).toContain("Original inference artifact checksum: checksum");
    expect(rendered).toContain("Reported complete source coverage: 0–5s");
  });
});
