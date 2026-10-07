import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { VisionAssetRow, VisionEventGoldListSet } from "../../../api/vision";
import { EventPilotHandoff } from "./EventPilotHandoff";

const asset = { id: "asset-a", durationMs: 49706, sbMatchId: "match", hasProxy: true, sourceVideoRecord: { id: "source" }, stages: [{ type: "events", state: "succeeded" }] } as VisionAssetRow;
const reference = { id: "gold", videoAssetId: "asset-a", label: "Held-out window", submissions: [], frozenAt: null } as unknown as VisionEventGoldListSet;
const imports = { videoAssetId: "asset-a", canImport: true, jobs: [], runs: [] };
const html = (over: Partial<Parameters<typeof EventPilotHandoff>[0]> = {}) => renderToStaticMarkup(<MemoryRouter><EventPilotHandoff asset={asset} imports={imports} references={[]} referenceError={null} canReview {...over} /></MemoryRouter>);

describe("pilot prerequisite and evaluation handoff", () => {
  it("links the selected footage through pipeline, possession, calibration and gold without claiming a completed gate", () => {
    const value = html();
    for (const href of ["sources/source", "calibration/asset-a", "possession?asset=asset-a", "event-gold?asset=asset-a"]) expect(value).toContain(href);
    expect(value).toContain("Phase 6 accuracy gate remains open");
    expect(value).toContain("A succeeded job alone does not verify licensing");
    expect(value).toContain("current dimensions, checksum and source-clock provenance");
    expect(value).toContain("0 completed carry run(s)");
  });
  it("reports actual blocked rights, missing proxy/match and an unbounded carry source", () => {
    const value = html({ asset: { ...asset, durationMs: 300001, hasProxy: false, sbMatchId: null }, imports: { ...imports, canImport: false } });
    for (const text of ["analysis rights blocked", "link a match", "known positive duration", "Review proxy: missing"]) expect(value).toContain(text);
    expect(html({ asset: { ...asset, durationMs: null }, imports: null })).toContain("rights status loading");
  });
  it("reports only accessible references for this footage and preserves independent review stages", () => {
    expect(html({ references: [reference, { ...reference, id: "other", videoAssetId: "asset-b", label: "Other footage" }] })).not.toContain("Other footage");
    expect(html({ references: [reference] })).toContain("0/2 independent submissions");
    const submissions = [{ reviewerId: "one", createdAt: "now" }, { reviewerId: "two", createdAt: "now" }];
    expect(html({ references: [{ ...reference, submissions }] })).toContain("independent freeze approval still required");
    expect(html({ references: [{ ...reference, submissions, frozenAt: "now" }] })).toContain("original-run scoring available");
    expect(html()).toContain("confirm assignments before creating another");
  });
  it("does not fetch/display gold status as success when permission, loading or availability prevents it", () => {
    expect(html({ references: null })).toContain("Loading your gold reference status");
    expect(html({ referenceError: "Unavailable", references: null })).toContain('role="alert"');
    const value = html({ canReview: false, references: [reference] });
    expect(value).not.toContain("Held-out window");
    expect(value).not.toContain("event-gold?");
    expect(value).toContain("vision.review permission");
  });
});
