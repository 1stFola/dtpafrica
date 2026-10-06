import type { VisionEventCandidate } from "../../../api/vision";
import { useState } from "react";
import { draggedEventBoundary, timelineMarks } from "./event-review";
import { formatClock } from "./annotation-time";

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
  fps,
  canCorrect,
  onCorrect,
  sourceDurationMs = null,
}: {
  candidates: readonly VisionEventCandidate[];
  offsetMs: number;
  clipMs: number;
  proxyMs: number;
  selectedId: string | null;
  describe: (c: VisionEventCandidate) => string;
  onPick: (c: VisionEventCandidate) => void;
  fps: number | null;
  canCorrect: (c: VisionEventCandidate) => boolean;
  onCorrect: (c: VisionEventCandidate, window: { startMs: number; endMs: number }) => void;
  sourceDurationMs?: number | null;
}) {
  const marks = timelineMarks(candidates, offsetMs, clipMs);
  const selected = marks.find((m) => m.candidate.id === selectedId)?.candidate;
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
      {selected && canCorrect(selected) && (
        <EventBoundaryEditor key={`${selected.id}:${selected.startMs}:${selected.endMs}`} candidate={selected} offsetMs={offsetMs} clipMs={clipMs} fps={fps} sourceDurationMs={sourceDurationMs} onCorrect={onCorrect} />
      )}
    </div>
  );
}

function EventBoundaryEditor({ candidate, offsetMs, clipMs, fps, sourceDurationMs, onCorrect }: {
  candidate: VisionEventCandidate;
  offsetMs: number;
  clipMs: number;
  fps: number | null;
  sourceDurationMs: number | null;
  onCorrect: (c: VisionEventCandidate, window: { startMs: number; endMs: number }) => void;
}) {
  const [window, setWindow] = useState({ startMs: candidate.startMs, endMs: candidate.endMs });
  const changed = window.startMs !== candidate.startMs || window.endMs !== candidate.endMs;
  const proxyEnd = Math.max(0, Math.min(clipMs, (sourceDurationMs ?? Infinity) - offsetMs));
  return (
    <form className="vision-boundaries" aria-label="Correct event boundaries" onSubmit={(e) => { e.preventDefault(); if (changed) onCorrect(candidate, window); }}>
      {(["startMs", "endMs"] as const).map((boundary) => (
        <label className="vision-boundaries__row" key={boundary}>
          <span>{boundary === "startMs" ? "Start" : "End"} <output>{formatClock(window[boundary])}</output></span>
          <input type="range" aria-label={`Event ${boundary === "startMs" ? "start" : "end"} boundary`} min={0} max={proxyEnd} step={fps && fps > 0 ? 1000 / fps : 1}
            value={Math.min(proxyEnd, Math.max(0, window[boundary] - offsetMs))}
            aria-valuetext={`${formatClock(window[boundary])} in source footage`}
            onChange={(e) => setWindow((current) => ({ ...current, [boundary]: draggedEventBoundary(boundary, Number(e.target.value), current, offsetMs, clipMs, fps, sourceDurationMs) }))} />
        </label>
      ))}
      <div className="vision-actions">
        <button type="submit" disabled={!changed}>Apply boundaries</button>
        <button type="button" disabled={!changed} onClick={() => setWindow({ startMs: candidate.startMs, endMs: candidate.endMs })}>Reset</button>
      </div>
      <p className="vision-footnote">Drag either boundary or use the arrow keys. Apply creates a new candidate and starts review again.{!fps ? " Frame rate unavailable; boundaries use milliseconds." : ""}</p>
    </form>
  );
}
