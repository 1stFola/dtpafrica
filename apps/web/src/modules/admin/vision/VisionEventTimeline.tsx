import type { VisionEventCandidate } from "../../../api/vision";
import { timelineMarks } from "./event-review";

/**
 * The timeline strip under the player: one mark per current candidate at its
 * place in the clip, the playhead over them, and a click that seeks to a
 * candidate and selects it. Colour follows review state, never alone: each mark
 * carries the state's letter, and the key under the strip says what the letters
 * are. (It said "never alone" before and relied on a hover title, which a
 * keyboard, a touch screen and a colour-blind reader do not get.)
 */
const LETTER: Record<string, string> = { unreviewed: "U", accepted: "A", rejected: "R", promoted: "P" };
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
          >
            {LETTER[m.candidate.promotedEventId ? "promoted" : m.candidate.reviewState] ?? "?"}
          </button>
        ))}
        <div className="vision-timeline__playhead" style={{ left: `${clipMs > 0 ? Math.min(100, Math.max(0, (proxyMs / clipMs) * 100)) : 0}%` }} aria-hidden="true" />
      </div>
      <div className="vision-footnote">
        {marks.length} candidate(s) on this clip · U unreviewed · A accepted · R rejected · P in the match record · striped: not play · click a mark to go
        there · [ and ] previous and next · E proposes at the playhead
      </div>
    </div>
  );
}
