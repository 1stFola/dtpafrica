import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EventImportControl } from "./EventImportControl";

describe("original carry import controls", () => {
  const base = { selected: "job", onSelect: () => {}, onImport: () => {}, canReview: true, busy: false };
  it("does not suggest an empty pipeline proves no football events", () => {
    const html = renderToStaticMarkup(<EventImportControl {...base} data={{ videoAssetId: "asset", canImport: true, runs: [], jobs: [] }} />);
    expect(html).toContain("No completed carry run is available");
    expect(html).not.toContain("<button");
    expect(html).toContain("a different person accepts");
  });
  it("preserves explicit zero output and disables import without current rights", () => {
    const data = { videoAssetId: "asset", canImport: false, runs: [{ id: "run", inferenceJobId: "job", attemptNumber: 1, eventCount: 0, artifactChecksum: "hash", createdBy: "alice", createdAt: "2026-10-06" }], jobs: [{ id: "job", attemptNumber: 1, finishedAt: null }] };
    const html = renderToStaticMarkup(<EventImportControl {...base} data={data} />);
    expect(html).toContain("explicit zero output");
    expect(html).toContain("disabled");
    expect(html).toContain("already imported");
    expect(renderToStaticMarkup(<EventImportControl {...base} canReview={false} data={data} />)).not.toContain("<button");
  });
});
