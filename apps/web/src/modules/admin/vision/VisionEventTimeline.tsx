import type { VisionEventCandidate } from "../../../api/vision";
import { timelineMarks } from "./event-review";

/**
 * The timeline strip under the player: one mark per current candidate at its
 * place in the clip, the playhead over them, and a click that seeks to a
 * candidate and selects it. Colour follows review state, never alone: the
 * mark's title carries the words, and the inspector repeats them.
 */
export function VisionEventTimeline({
  candidates,
  offsetMs,
  clipMs,
  proxyMs,
  selectedId,
  describe,
  onPick,
}: {
  candidates: readonly VisionEventCandidate[];
  offsetMs: number;
  clipMs: number;
  proxyMs: number;
  selectedId: string | null;
  describe: (c: VisionEventCandidate) => string;
  onPick: (c: VisionEventCandidate) => void;
}) {
  const marks = timelineMarks(candidates, offsetMs, clipMs);
  return (
    <div className="vision-timeline" role="list" aria-label="Event candidates on this clip">
      <div className="vision-timeline__track">
        {marks.map((m) => (
          <button
            key={m.candidate.id}
            type="button"
            role="listitem"
            className={[
              "vision-timeline__mark",
              `vision-timeline__mark--${m.candidate.promotedEventId ? "promoted" : m.candidate.reviewState}`,
              m.candidate.inPlay ? "" : "vision-timeline__mark--notplay",
              m.candidate.id === selectedId ? "is-selected" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{ left: `${m.left * 100}%`, width: `${m.width * 100}%` }}
            title={describe(m.candidate)}
            aria-label={describe(m.candidate)}
            onClick={() => onPick(m.candidate)}
          />
        ))}
        <div className="vision-timeline__playhead" style={{ left: `${clipMs > 0 ? Math.min(100, Math.max(0, (proxyMs / clipMs) * 100)) : 0}%` }} aria-hidden="true" />
      </div>
      <div className="vision-footnote">
        {marks.length} candidate(s) on this clip · click a mark to go there · [ and ] previous and next · E proposes at the playhead
      </div>
    </div>
  );
}
