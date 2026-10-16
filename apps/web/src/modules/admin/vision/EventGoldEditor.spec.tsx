import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VisionEventGoldDetail, VisionEventScore } from "../../../api/vision";
import { EventGoldEditor } from "./EventGoldEditor";
import { EventScoreReport } from "./EventScoreReport";
describe("event gold reviewer UI", () => {
  it("asks for complete independent review, uses source seconds, and offers unknown actors", () => {
    const reference = { windowStartMs: 0, windowEndMs: 5000, roster: [{ id: "slot", playerName: "Nine", jerseyNumber: 9 }] } as unknown as VisionEventGoldDetail;
    const html = renderToStaticMarkup(<EventGoldEditor reference={reference} sourceMs={1000} busy={false} initial={{ events: [{ id: "label", type: "shot", startMs: 1040, endMs: 2480, actorMatchSquadPlayerId: null }], nonPlayWindows: [] }} onSubmit={async () => undefined} />);
    // Times read as minutes:seconds, with the playhead one click away (docs/vision/97).
    expect(html).toContain('value="00:01.040"');
    expect(html).toContain("= 00:02.480 into the clip");
    expect(html).toContain("Start = playhead");
    expect(html).toContain("Unknown");
    expect(html).toContain("reviewed the entire window");
    expect(html).toContain('type="submit" disabled=""');
    expect(html).not.toContain("Propose at");
  });
  it("puts Add event below the last event, with the playhead it will use, so a long list needs no scrolling back", () => {
    const reference = { windowStartMs: 0, windowEndMs: 5000, roster: [] } as unknown as VisionEventGoldDetail;
    const events = [1, 2, 3].map((n) => ({ id: `e${n}`, type: "pass" as const, startMs: n * 1000, endMs: n * 1000, actorMatchSquadPlayerId: null }));
    const html = renderToStaticMarkup(<EventGoldEditor reference={reference} sourceMs={2345} busy={false} initial={{ events, nonPlayWindows: [] }} onSubmit={async () => undefined} />);
    expect(html.indexOf("Add event at playhead")).toBeGreaterThan(html.indexOf("Remove event 3"));
    expect(html.match(/Add event at playhead/g)).toHaveLength(1);
    expect(html).toContain("vision-gold-addbar");
    expect(html).toContain("Playhead 00:02.345 · 3 events");
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
