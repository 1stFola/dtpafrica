import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { VisionEventCandidate } from "../../../api/vision";
import { allowedActions } from "./event-review";
import { VisionEventTimeline } from "./VisionEventTimeline";

const candidate = { id: "event", startMs: 10000, endMs: 12000, type: "shot", reviewState: "accepted", inPlay: true, supersededBy: null, promotedEventId: null } as VisionEventCandidate;
function render(over: Partial<VisionEventCandidate> = {}, review = true, busy = false, sourceDurationMs: number | null = null) {
  return renderToStaticMarkup(<VisionEventTimeline candidates={[{ ...candidate, ...over }]} offsetMs={9000} clipMs={10000} proxyMs={1000} selectedId="event" fps={25} describe={() => "Shot"} onPick={() => {}}
    canCorrect={(c) => !busy && allowedActions(c, "reviewer", { review, publish: false }).correct} sourceDurationMs={sourceDurationMs} onCorrect={() => {}} />);
}

describe("event boundary controls", () => {
  it("limits the range to source duration even when the clip is padded", () => {
    expect(render({}, true, false, 18050)).toContain('max="9050"');
  });
  it("renders named, frame-stepped controls in proxy time, with source times for the reviewer", () => {
    const html = render();
    expect(html).toContain('aria-label="Event start boundary"');
    expect(html).toContain('aria-label="Event end boundary"');
    expect(html).toContain('step="40"');
    expect(html).toContain('value="1000"');
    expect(html).toContain('value="3000"');
    expect(html).toContain('aria-valuetext="00:10.000 in source footage"');
    expect(html).toContain('type="submit" disabled=""');
  });
  it("offers no correction for promoted, superseded, unauthorized or busy candidates", () => {
    for (const html of [render({ promotedEventId: "goal" }), render({ supersededBy: "new" }), render({}, false), render({}, true, true)]) {
      expect(html).not.toContain('aria-label="Correct event boundaries"');
    }
  });
});
