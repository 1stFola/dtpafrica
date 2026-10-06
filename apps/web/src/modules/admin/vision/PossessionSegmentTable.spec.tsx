import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PossessionSegmentTable, possessionReviewAllowed, possessionSeekTime } from "./PossessionSegmentTable";
import type { VisionPossessionCorrection, VisionPossessionSegment } from "../../../api/vision";

const row: VisionPossessionSegment = { id: "s", runId: "r", ordinal: 0, startMs: 9200, endMs: 9400, frames: 5, sourceState: "unknown", reason: "ball_lost", cameraSegmentId: null, trajectoryId: null, localTrackId: null, actorTrackId: null, evidenceConfidence: null, decision: null };
function render(patch: Partial<VisionPossessionSegment> = {}, other = {}) {
  return renderToStaticMarkup(<MemoryRouter><PossessionSegmentTable segments={[{ ...row, ...patch }]} assetId="asset" importedBy="alice" me="bob" canReview stale={false} busy={false} reasons={{}}
    onReason={() => undefined} onDecide={() => undefined} onSeek={() => undefined} canSeek={() => true} {...other} /></MemoryRouter>);
}
describe("possession reviewer decisions", () => {
  it("retains Unknown and labels confirmation without inventing a possessor", () => { const html = render(); expect(html).toContain("Unknown"); expect(html).toContain("Confirm Unknown"); expect(html).not.toContain("Candidate track"); expect(html).not.toContain("Inspect original track"); });
  it("shows candidates as local tracks with original evidence links", () => { const html = render({ sourceState: "candidate", localTrackId: 7, actorTrackId: "track", reason: null, evidenceConfidence: .8 }); expect(html).toContain("Candidate track #7"); expect(html).toContain("Minimum detection confidence: 0.800"); expect(html).toContain("Accept candidate"); expect(html).toContain("track=track"); });
  it("prevents self-review and stale evidence decisions", () => { expect(render({}, { me: "alice" })).toContain("Other reviewer decides"); expect(render({}, { me: "alice" })).not.toContain("Confirm Unknown"); expect(render({}, { stale: true })).toContain("Evidence changed"); expect(possessionReviewAllowed("alice", "bob", true, false, false)).toBe(true); expect(possessionReviewAllowed("alice", "bob", false, false, false)).toBe(false); });
  it("renders immutable decisions and does not offer an overwrite", () => { const html = render({ decision: { id: "d", decision: "accepted", reviewedBy: "bob", reason: null, createdAt: "2026-10-05" } }); expect(html).toContain("Unknown confirmed"); expect(html).toContain("Decision recorded"); expect(html).not.toContain("Confirm Unknown"); });
  it("seeks by source offset and refuses unplayable moments", () => { expect(possessionSeekTime(9200, 9000, 1000)).toBe(.2); expect(possessionSeekTime(8999, 9000, 1000)).toBeNull(); expect(possessionSeekTime(10000, 9000, 1000)).toBeNull(); });
});

const correction: VisionPossessionCorrection = { id: "c", segmentId: "s", parentKey: "s", startMs: 9240, endMs: 9400, state: "candidate", actorTrackId: "track2", localTrackId: 2, proposedBy: "alice", reason: "Reviewed actor", createdAt: "2026-10-05", decision: null };
const correctionActions = { onCorrect: () => undefined, onDecideCorrection: () => undefined };
describe("possession correction reviewer UI", () => {
  it("shows original Unknown beside a manual proposal with trim gaps still unresolved", () => {
    const html = render({ corrections: [correction] }, correctionActions);
    expect(html).toContain("Manual candidate track #2"); expect(html).toContain("Unknown");
    expect(html).toContain("Trimmed portions remain unresolved Unknown"); expect(html).toContain("Accept correction");
    expect(html).toContain("Correction history (1)");
  });
  it("prevents the correction author deciding and allows a different author to propose again", () => {
    const html = render({ corrections: [correction] }, { ...correctionActions, me: "alice" });
    expect(html).toContain("Other reviewer decides your correction"); expect(html).not.toContain("Accept correction"); expect(html).toContain("Correct interval 1");
  });
  it("disables mutation for stale evidence or missing permissions", () => {
    for (const flags of [{ stale: true }, { canReview: false }]) {
      const html = render({ corrections: [correction] }, { ...correctionActions, ...flags });
      expect(html).not.toContain("Accept correction"); expect(html).not.toContain("Correct interval 1");
    }
  });
  it("retains an immutable correction decision without an overwrite control", () => {
    const html = render({ corrections: [{ ...correction, decision: { id: "d", decision: "rejected", reviewedBy: "bob", reason: "Wrong actor", createdAt: "2026-10-05" } }] }, correctionActions);
    expect(html).toContain("Latest correction: rejected"); expect(html).toContain("Wrong actor"); expect(html).not.toContain("Accept correction");
  });
  it("keeps superseded history and caps proposals at 20 versions", () => {
    const html = render({ corrections: Array.from({ length: 20 }, (_, i) => ({ ...correction, id: `c${i}` })) }, correctionActions);
    expect(html).toContain("superseded"); expect(html).toContain("Correction history (20)"); expect(html).not.toContain("Correct interval 1");
  });
});
