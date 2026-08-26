import { useMemo, useState } from "react";
import { EVENT_LABELS } from "../../../api/scoreboard";
import type {
  KitColours,
  MatchStatsSheet,
  RecordedEvent,
  Side,
} from "../../../api/adminMatchStats";
import { displayMinute, type useMatchClock } from "./useMatchClock";
import { EventGrid } from "./EventGrid";
import { soundFor, useFeedbackPrefs } from "./useFeedbackPrefs";
import { useUISound } from "./useUISound";

/**
 * Event types that need a second player before they can be logged: the incoming
 * player on a substitution, and the assist provider on a goal.
 */
const SECOND_PLAYER_PROMPT: Record<string, { title: string; label: string; allowNone?: string }> = {
  substitution: { title: "Substitution", label: "Incoming player's number" },
  goal: { title: "Goal", label: "Assist — jersey number", allowNone: "Solo Effort" },
};

function labelFor(type: string): string {
  return EVENT_LABELS[type] ?? type.replace(/_/g, " ");
}

/**
 * Step 4 of the entry flow, plus the log and the half-time prompts.
 *
 * Steps 1 to 3 — the clock, the minute capture, the side toggle and the jersey
 * number — live in the page's frozen header so they stay reachable while this
 * grid and the log scroll beneath them.
 */
export function MatchEventsTab({
  sheet,
  editable,
  events,
  kits,
  captured,
  side,
  playerNumber,
  onCapturedUsed,
  clock,
  addedInput,
  onAddedInputChange,
  onChange,
  homeName,
  awayName,
}: {
  sheet: MatchStatsSheet;
  editable: boolean;
  events: RecordedEvent[];
  kits: KitColours;
  captured: { minute: number; added: number | null } | null;
  /** Null until step 2 is answered — no side is ever inherited. */
  side: Side | null;
  playerNumber: string;
  onCapturedUsed: () => void;
  clock: ReturnType<typeof useMatchClock>;
  addedInput: string;
  onAddedInputChange: (value: string) => void;
  onChange: (next: { events?: RecordedEvent[]; kits?: KitColours }) => void;
  homeName: string;
  awayName: string;
}) {
  /* Held while the second-player prompt is open, so the event is only written
     once that answer is given or explicitly waived. */
  const [pendingType, setPendingType] = useState<string | null>(null);
  const [secondNumber, setSecondNumber] = useState("");

  const { prefs } = useFeedbackPrefs();
  const playSound = useUISound({ enabled: prefs.sound, intensity: prefs.intensity });

  /* So a button can say which statistic it will also file, in the wording the
     Statistics tab uses rather than a raw key. */
  const statLabels = useMemo(
    () => Object.fromEntries(sheet.stats.map((d) => [d.key, d.label])),
    [sheet.stats]
  );

  const teamFor = (s: Side) => (s === "home" ? homeName : awayName);
  const stepsEnabled = editable && clock.started;
  /* Every earlier step must be answered before step 4 unlocks: no event can be
     filed against the wrong minute, the wrong side, or no player at all. */
  const canLog =
    stepsEnabled && Boolean(captured) && Boolean(side) && playerNumber.trim() !== "";

  /** Step 4 — the tap. Types needing a second player open a prompt first. */
  const addEvent = (type: string) => {
    if (!canLog || !captured || !side) return;
    if (SECOND_PLAYER_PROMPT[type]) {
      setSecondNumber("");
      setPendingType(type);
      // The sound belongs to the completed event, so it waits for the prompt.
      return;
    }
    writeEvent(type, null);
  };

  /** Commit the event, with the second player's number when one was given. */
  const writeEvent = (type: string, secondary: number | null) => {
    if (!captured || !side) return;
    // Sounded here rather than on tap, so a goal cheers when the assist lands.
    playSound(soundFor(type));
    const next: RecordedEvent = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      minute: captured.minute,
      addedMinute: captured.added,
      side,
      playerNumber: playerNumber ? Number(playerNumber) : null,
      secondaryPlayerNumber: secondary,
      half: clock.half,
    };
    onChange({ events: [...events, next] });
    setPendingType(null);
    setSecondNumber("");
    // Clear the entry so the next event starts from a clean step 1.
    onCapturedUsed();
  };

  const removeEvent = (id: string) => {
    if (!editable) return;
    onChange({ events: events.filter((e) => e.id !== id) });
  };

  return (
    <div className="mcx-events">
      {!clock.started && (
        <p className="mcx-callout">
          Set the half length and tap <strong>Kick Off</strong> above to start recording.
        </p>
      )}

      {clock.started && (
        <section className="mcx-step mcx-step--grid">
          <span className="mcx-step__n">4</span>
          <div className="mcx-step__body">
            <span className="mcx-step__label">
              Tap the event to capture
              {!captured ? (
                <em className="mcx-step__gate"> — log a minute first (step 1)</em>
              ) : !side ? (
                <em className="mcx-step__gate"> — choose home or away first (step 2)</em>
              ) : playerNumber.trim() === "" ? (
                <em className="mcx-step__gate"> — enter a jersey number first (step 3)</em>
              ) : null}
            </span>
            <EventGrid
              types={sheet.eventTypes}
              locked={!canLog}
              prefs={prefs}
              captureMap={sheet.eventCapture}
              statLabels={statLabels}
              onLog={addEvent}
              onBlocked={() => playSound("error")}
            />
          </div>
        </section>
      )}

      {/* ---- Log ---- */}
      <section className="mcx-log">
        <h3 className="mcx-log__head">
          Recorded events <span className="mcx-log__count">{events.length}</span>
        </h3>
        {events.length === 0 ? (
          <p className="mcx-callout">
            No events yet. Work through the four steps and each entry lands here.
          </p>
        ) : (
          <ul className="mcx-log__list">
            {[...events].reverse().map((e) => (
              <li key={e.id} className="mcx-logitem" style={{ borderLeftColor: kits[e.side] }}>
                <span className="mcx-logitem__min">{displayMinute(e.minute, e.addedMinute)}</span>
                <span className="mcx-logitem__body">
                  <strong>{labelFor(e.type)}</strong>
                  <span className="mcx-logitem__meta">
                    {teamFor(e.side)}
                    {e.playerNumber ? ` · No. ${e.playerNumber}` : ""}
                    {e.secondaryPlayerNumber
                      ? e.type === "substitution"
                        ? ` → No. ${e.secondaryPlayerNumber}`
                        : ` · assist No. ${e.secondaryPlayerNumber}`
                      : ""}
                  </span>
                </span>
                {editable && (
                  <button
                    type="button"
                    className="mcx-logitem__del"
                    onClick={() => removeEvent(e.id)}
                    aria-label={`Remove ${labelFor(e.type)} at ${e.minute} minutes`}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Second player prompt: substitution in, or the assist ---- */}
      {pendingType && SECOND_PLAYER_PROMPT[pendingType] && (
        <div className="mcx-prompt" role="dialog" aria-modal="true">
          <div className="mcx-prompt__card">
            <h3>{SECOND_PLAYER_PROMPT[pendingType].title}</h3>
            <p className="muted">
              {displayMinute(captured?.minute ?? 0, captured?.added ?? null)} ·{" "}
              {side ? teamFor(side) : ""}
              {playerNumber ? ` · No. ${playerNumber}` : ""}
            </p>
            <label className="mcx-prompt__label">
              {SECOND_PLAYER_PROMPT[pendingType].label}
            </label>
            <div className="mcx-prompt__row">
              <input
                type="number"
                min={1}
                max={99}
                inputMode="numeric"
                value={secondNumber}
                onChange={(e) => setSecondNumber(e.target.value)}
                autoFocus
              />
            </div>
            <div className="mcx-prompt__actions">
              {SECOND_PLAYER_PROMPT[pendingType].allowNone && (
                <button
                  type="button"
                  className="mcx-btn"
                  onClick={() => writeEvent(pendingType, null)}
                >
                  {SECOND_PLAYER_PROMPT[pendingType].allowNone}
                </button>
              )}
              <button
                type="button"
                className="mcx-btn mcx-btn--primary"
                disabled={secondNumber.trim() === ""}
                onClick={() => writeEvent(pendingType, Number(secondNumber) || null)}
              >
                OK
              </button>
            </div>
            <button
              type="button"
              className="mcx-prompt__cancel"
              onClick={() => setPendingType(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ---- Added time prompt ---- */}
      {clock.phase === "awaiting_added" && editable && (
        <div className="mcx-prompt" role="dialog" aria-modal="true">
          <div className="mcx-prompt__card">
            <h3>{clock.half === 1 ? "First" : "Second"} half complete</h3>
            <p className="muted">
              {clock.halfLength} minutes played. How much added time is being played?
            </p>
            <div className="mcx-prompt__row">
              <input
                type="number"
                min={0}
                max={15}
                inputMode="numeric"
                value={addedInput}
                onChange={(e) => onAddedInputChange(e.target.value)}
                autoFocus
              />
              <span className="muted">minutes</span>
            </div>
            <button
              type="button"
              className="mcx-btn mcx-btn--primary"
              onClick={() => clock.confirmAddedTime(Number(addedInput) || 0)}
            >
              Play added time
            </button>
          </div>
        </div>
      )}

      {/* ---- Second-half prompt: stays put until tapped ---- */}
      {clock.phase === "awaiting_second_half" && editable && (
        <div className="mcx-prompt" role="dialog" aria-modal="true">
          <div className="mcx-prompt__card">
            <h3>Half-time</h3>
            <p className="muted">
              The first half and its added time are complete. Start the clock again when the second
              half kicks off.
            </p>
            <button type="button" className="mcx-btn mcx-btn--primary" onClick={clock.startSecondHalf}>
              Start Second Half
            </button>
          </div>
        </div>
      )}

      {clock.phase === "finished" && (
        <p className="mcx-callout">
          Full time. Check the log and the score, then submit the event log for approval.
        </p>
      )}
    </div>
  );
}
