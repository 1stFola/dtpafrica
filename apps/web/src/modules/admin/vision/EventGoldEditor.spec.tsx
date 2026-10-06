import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VisionEventGoldDetail, VisionEventScore } from "../../../api/vision";
import { EventGoldEditor } from "./EventGoldEditor";
import { EventScoreReport } from "./EventScoreReport";
describe("event gold reviewer UI", () => {
  it("asks for complete independent review, uses source seconds, and offers unknown actors", () => {
    const reference = { windowStartMs: 0, windowEndMs: 5000, roster: [{ id: "slot", playerName: "Nine", jerseyNumber: 9 }] } as unknown as VisionEventGoldDetail;
    const html = renderToStaticMarkup(<EventGoldEditor reference={reference} sourceMs={1000} busy={false} initial={{ events: [{ id: "label", type: "shot", startMs: 1040, endMs: 2480, actorMatchSquadPlayerId: null }], nonPlayWindows: [] }} onSubmit={async () => undefined} />);
    expect(html).toContain('step="0.001"');
    expect(html).toContain('value="1.04"');
    expect(html).toContain("Unknown");
    expect(html).toContain("reviewed the entire window");
    expect(html).toContain('type="submit" disabled=""');
    expect(html).not.toContain("Propose at");
  });
  it("shows missing support as unmeasurable and separates actor / temporal errors", () => {
    const metrics = { reference: 0, predictions: 0, tp: 0, fp: 0, fn: 0, precision: null, recall: null, f1: null, actorAccuracy: null, actorRecall: null, meanStartErrorMs: null, meanEndErrorMs: null };
    const report = { scorerVersion: "event-score/v1", toleranceMs: 500, all: metrics, byType: [], missedReferenceIds: [], falsePositiveIds: [], duplicatePredictionIds: [], suppressedPredictionIds: [], nonPlayErrors: [] } as unknown as VisionEventScore;
    const html = renderToStaticMarkup(<EventScoreReport report={report} />);
    expect(html).toContain("Not measurable");
    expect(html).not.toContain("100.0%");
    expect(html).toContain("Actor recall");
    expect(html).toContain("before actor accuracy is measured");
  });
});
