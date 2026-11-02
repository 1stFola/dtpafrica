import { useState } from "react";
import {
  MATCH_BREAK_NOTE_MAX,
  MATCH_BREAK_REASONS,
  MATCH_BREAK_REASON_LABELS,
  formatBreakLength,
  matchBreakSeconds,
  type MatchBreak,
  type MatchBreakReason,
} from "@dtp/engines/match-breaks";
import { serverNow } from "../../../lib/server-clock";
import { displayMinute, mmss } from "./useMatchClock";

/** What stopped play. One tap stops the clock, because that is when the whistle went. */
export function BreakReasonPrompt({
  onChoose,
  onCancel,
}: {
  onChoose: (reason: MatchBreakReason) => void;
  onCancel: () => void;
}) {
  return (
    <div className="mcx-prompt" role="dialog" aria-modal="true" aria-labelledby="mcx-break-title">
      <div className="mcx-prompt__card">
        <h3 id="mcx-break-title">Why has play stopped?</h3>
        <p className="muted">
          The match clock stops as soon as you choose, and a break timer starts.
        </p>
        <div className="mcx-prompt__actions mcx-prompt__actions--stack">
          {MATCH_BREAK_REASONS.map((reason) => (
            <button key={reason} type="button" className="mcx-btn" onClick={() => onChoose(reason)}>
              {MATCH_BREAK_REASON_LABELS[reason]}
            </button>
          ))}
        </div>
        <button type="button" className="mcx-prompt__cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * The break under way, pinned with the clock so its timer and Resume stay in reach.
 *
 * Deliberately not a modal: substitutions and cards happen during a stoppage, so the event
 * entry beneath it has to keep working, on the minute the clock stopped at.
 */
export function BreakBar({
  current,
  seconds,
  matchMinute,
  onResume,
  onChange,
  onCancel,
}: {
  current: MatchBreak;
  seconds: number;
  matchMinute: string;
  onResume: () => void;
  onChange: (patch: { reason?: MatchBreakReason; note?: string | null }) => void;
  onCancel: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <section className="mcx-breakbar" aria-label="Break in play">
      <div className="mcx-breakbar__main">
        <div className="mcx-breakbar__who">
          <strong>{MATCH_BREAK_REASON_LABELS[current.reason]}</strong>
          <span>Clock stopped at {matchMinute}</span>
        </div>
        <span className="mcx-breakbar__timer" role="timer" aria-label="Length of this break">
          {mmss(seconds)}
        </span>
        <button
          type="button"
          className="mcx-btn mcx-btn--primary mcx-breakbar__resume"
          onClick={onResume}
        >
          Resume play
        </button>
      </div>
      <button type="button" className="mcx-breakbar__more" onClick={() => setShowDetails(true)}>
        Change reason or add a note
      </button>
      {/* A pop-up rather than more of the bar: the bar is pinned, and on a small phone these
          fields would push the pinned area past the bottom of the screen. */}
      {showDetails && (
        <div className="mcx-prompt" role="dialog" aria-modal="true" aria-labelledby="mcx-break-details">
          <div className="mcx-prompt__card mcx-breakbar__details">
            <h3 id="mcx-break-details">This break</h3>
            <label>
              <span>Reason</span>
              <select
                value={current.reason}
                onChange={(e) => onChange({ reason: e.target.value as MatchBreakReason })}
              >
                {MATCH_BREAK_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {MATCH_BREAK_REASON_LABELS[reason]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Note (kept with the sheet, never shown publicly)</span>
              <input
                type="text"
                maxLength={MATCH_BREAK_NOTE_MAX}
                value={current.note ?? ""}
                onChange={(e) => onChange({ note: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="mcx-btn mcx-btn--primary"
              onClick={() => setShowDetails(false)}
            >
              Done
            </button>
            <button type="button" className="mcx-breakbar__mistake" onClick={onCancel}>
              Started by mistake: discard this break
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Every break in the match and how long it took: the log the break timer feeds. */
export function BreaksLog({ breaks }: { breaks: readonly MatchBreak[] }) {
  if (breaks.length === 0) return null;
  const now = serverNow();
  const finished = breaks.filter((b) => b.endedAt);
  const total = finished.reduce((sum, b) => sum + matchBreakSeconds(b, now), 0);
  return (
    <section className="mcx-breaks" aria-label="Breaks in play">
      <h3 className="mcx-log__head">
        Breaks in play <span className="mcx-log__count">{breaks.length}</span>
        {finished.length > 0 && (
          <span className="mcx-breaks__total">{formatBreakLength(total)} in total</span>
        )}
      </h3>
      <ul className="mcx-breaks__list">
        {breaks.map((b) => (
          <li key={b.id} className="mcx-breaks__item">
            <span className="mcx-logitem__min">{displayMinute(b.minute, b.addedMinute)}</span>
            <span className="mcx-breaks__what">
              <strong>{MATCH_BREAK_REASON_LABELS[b.reason]}</strong>
              {b.note && <span className="mcx-logitem__meta">{b.note}</span>}
            </span>
            <span className="mcx-breaks__len">
              {b.endedAt ? formatBreakLength(matchBreakSeconds(b, now)) : "In progress"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
