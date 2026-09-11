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
import {
  SHOOTOUT_TYPES,
  nextShootoutSide,
  normalizeShootoutSides,
  shootoutIsDecided,
  shootoutRound,
  shootoutScore,
  shootoutStartingSide,
} from "./shootout";

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
  playerLabelsByKey,
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
  playerLabelsByKey?: Map<string, string>;
}) {
  /* Held while the second-player prompt is open, so the event is only written
     once that answer is given or explicitly waived. */
  const [pendingType, setPendingType] = useState<string | null>(null);
  const [secondNumber, setSecondNumber] = useState("");
  const [editing, setEditing] = useState<RecordedEvent | null>(null);
  const [editDraft, setEditDraft] = useState({
    type: "",
    minute: "",
    addedMinute: "",
    side: "home" as Side,
    playerNumber: "",
    secondaryPlayerNumber: "",
    half: "1",
  });
  const [shootoutPlayerNumber, setShootoutPlayerNumber] = useState("");
  const [shootoutOutcome, setShootoutOutcome] = useState<"goal" | "miss">("goal");
  // Closing the shootout modal only hides it; the shootout itself carries on
  // and still ends automatically once it is decided.
  const [shootoutDismissed, setShootoutDismissed] = useState(false);

  const { prefs } = useFeedbackPrefs();
  const playSound = useUISound({ enabled: prefs.sound, intensity: prefs.intensity });

  /* So a button can say which statistic it will also file, in the wording the
     Statistics tab uses rather than a raw key. */
  const statLabels = useMemo(
    () => Object.fromEntries(sheet.stats.map((d) => [d.key, d.label])),
    [sheet.stats]
  );

  const teamFor = (s: Side) => (s === "home" ? homeName : awayName);
  const labelForNumber = (s: Side, number: number | null) => {
    if (!number) return "";
    const teamId = s === "home" ? sheet.match.homeTeam.id : sheet.match.awayTeam.id;
    return playerLabelsByKey?.get(`${teamId}:${number}`) ?? `No. ${number}`;
  };
  const stepsEnabled = editable && clock.started;
  const hasSide = Boolean(side);
  const hasPlayerNumber = playerNumber.trim() !== "";
  /* Every earlier step must be answered before step 4 unlocks: no event can be
     filed against the wrong minute, the wrong side, or no player at all. */
  const canLog =
    stepsEnabled && Boolean(captured) && hasSide && hasPlayerNumber;

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
    onChange({ events: normalizeShootoutSides(events.filter((e) => e.id !== id)) });
  };

  const openEdit = (event: RecordedEvent) => {
    setEditing(event);
    setEditDraft({
      type: event.type,
      minute: String(event.minute),
      addedMinute: event.addedMinute == null ? "" : String(event.addedMinute),
      side: event.side,
      playerNumber: event.playerNumber == null ? "" : String(event.playerNumber),
      secondaryPlayerNumber:
        event.secondaryPlayerNumber == null ? "" : String(event.secondaryPlayerNumber),
      half: String(event.half),
    });
  };

  const parsePositiveInt = (value: string): number | null => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  };

  const parseMinute = (value: string): number => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  };

  const saveEdit = () => {
    if (!editable || !editing) return;
    const needsSecond = Boolean(SECOND_PLAYER_PROMPT[editDraft.type]);
    const next: RecordedEvent = {
      ...editing,
      type: editDraft.type,
      minute: parseMinute(editDraft.minute),
      addedMinute: parsePositiveInt(editDraft.addedMinute),
      side: editDraft.side,
      playerNumber: parsePositiveInt(editDraft.playerNumber),
      secondaryPlayerNumber: needsSecond
        ? parsePositiveInt(editDraft.secondaryPlayerNumber)
        : null,
      half: editDraft.half === "2" ? 2 : 1,
    };
    onChange({
      events: normalizeShootoutSides(
        events.map((event) => (event.id === editing.id ? next : event))
      ),
    });
    setEditing(null);
  };

  const systemMinute = () => ({
    minute: clock.liveMinute,
    addedMinute: clock.liveAdded,
    half: clock.half,
  });

  const finishWithEvents = (baseEvents: RecordedEvent[]) => {
    const t = systemMinute();
    const next: RecordedEvent = {
      id: `full_time-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: "full_time",
      minute: t.minute,
      addedMinute: t.addedMinute,
      side: "home",
      playerNumber: null,
      secondaryPlayerNumber: null,
      half: t.half,
    };
    onChange({
      events: normalizeShootoutSides([
        ...baseEvents.filter((event) => event.type !== "full_time"),
        next,
      ]),
    });
    clock.endGame();
  };

  const logFullTime = () => {
    finishWithEvents(events);
  };

  const startShootout = () => {
    setShootoutDismissed(false);
    clock.startPenaltyShootout();
  };

  /*
   * The operator names the team that kicks first. It is recorded as the side of
   * the penalty_shootout marker, and every kick after it alternates from there.
   * Previously the marker was always "home", so home silently kicked first.
   */
  const chooseShootoutStarter = (side: Side) => {
    if (shootoutStartingSide(events)) return;
    const t = systemMinute();
    const marker: RecordedEvent = {
      id: `penalty_shootout-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: "penalty_shootout",
      minute: t.minute,
      addedMinute: t.addedMinute,
      side,
      playerNumber: null,
      secondaryPlayerNumber: null,
      half: t.half,
    };
    onChange({ events: normalizeShootoutSides([...events, marker]) });
  };

  const logShootoutKick = () => {
    const jersey = Number(shootoutPlayerNumber);
    if (!Number.isFinite(jersey) || jersey < 1 || jersey > 99) return;
    const t = systemMinute();
    const nextEvent: RecordedEvent = {
      id: `shootout_${shootoutOutcome}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: shootoutOutcome === "goal" ? "shootout_goal" : "shootout_miss",
      minute: t.minute,
      addedMinute: t.addedMinute,
      side: nextShootoutSide(events),
      playerNumber: Math.floor(jersey),
      secondaryPlayerNumber: null,
      half: t.half,
    };
    const nextEvents = normalizeShootoutSides([...events, nextEvent]);
    setShootoutPlayerNumber("");
    if (shootoutIsDecided(nextEvents)) {
      finishWithEvents(nextEvents);
      return;
    }
    onChange({ events: nextEvents });
  };

  const shootoutKicks = events.filter((event) => SHOOTOUT_TYPES.has(event.type));
  const shootoutCurrentScore = shootoutScore(events);
  const shootoutNextSide = nextShootoutSide(events);
  const shootoutCurrentRound = shootoutRound(events);
  const shootoutStarter = shootoutStartingSide(events);

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
                    {e.playerNumber ? ` · ${labelForNumber(e.side, e.playerNumber)}` : ""}
                    {e.secondaryPlayerNumber
                      ? e.type === "substitution"
                        ? ` → ${labelForNumber(e.side, e.secondaryPlayerNumber)}`
                        : ` · assist ${labelForNumber(e.side, e.secondaryPlayerNumber)}`
                      : ""}
                  </span>
                </span>
                {editable && (
                  <span className="mcx-logitem__actions">
                    <button
                      type="button"
                      className="mcx-logitem__edit"
                      onClick={() => openEdit(e)}
                      aria-label={`Edit ${labelFor(e.type)} at ${e.minute} minutes`}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="mcx-logitem__del"
                      onClick={() => removeEvent(e.id)}
                      aria-label={`Remove ${labelFor(e.type)} at ${e.minute} minutes`}
                    >
                      ✕
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <div className="mcx-prompt" role="dialog" aria-modal="true">
          <div className="mcx-prompt__card mcx-prompt__card--wide">
            <h3>Edit event</h3>
            <p className="muted">
              Correct the event before the sheet is submitted or approved.
            </p>
            <div className="mcx-edit-grid">
              <label>
                <span>Event type</span>
                <select
                  value={editDraft.type}
                  onChange={(event) =>
                    setEditDraft((draft) => ({ ...draft, type: event.target.value }))
                  }
                >
                  {Array.from(new Set([editing.type, ...sheet.eventTypes])).map((type) => (
                    <option key={type} value={type}>
                      {labelFor(type)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Team</span>
                <select
                  value={editDraft.side}
                  onChange={(event) =>
                    setEditDraft((draft) => ({ ...draft, side: event.target.value as Side }))
                  }
                >
                  <option value="home">{homeName}</option>
                  <option value="away">{awayName}</option>
                </select>
              </label>
              <label>
                <span>Minute</span>
                <input
                  type="number"
                  min={0}
                  max={130}
                  inputMode="numeric"
                  value={editDraft.minute}
                  disabled
                />
              </label>
              <label>
                <span>Added time</span>
                <input
                  type="number"
                  min={0}
                  max={30}
                  inputMode="numeric"
                  value={editDraft.addedMinute}
                  placeholder="0"
                  disabled
                />
              </label>
              <label>
                <span>Half</span>
                <select
                  value={editDraft.half}
                  disabled
                >
                  <option value="1">1st half</option>
                  <option value="2">2nd half</option>
                </select>
              </label>
              <label>
                <span>Player number</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  inputMode="numeric"
                  value={editDraft.playerNumber}
                  onChange={(event) =>
                    setEditDraft((draft) => ({ ...draft, playerNumber: event.target.value }))
                  }
                />
              </label>
              {SECOND_PLAYER_PROMPT[editDraft.type] && (
                <label>
                  <span>{SECOND_PLAYER_PROMPT[editDraft.type].label}</span>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    inputMode="numeric"
                    value={editDraft.secondaryPlayerNumber}
                    onChange={(event) =>
                      setEditDraft((draft) => ({
                        ...draft,
                        secondaryPlayerNumber: event.target.value,
                      }))
                    }
                    placeholder={
                      SECOND_PLAYER_PROMPT[editDraft.type].allowNone ? "Optional" : undefined
                    }
                  />
                </label>
              )}
            </div>
            <div className="mcx-prompt__actions">
              <button type="button" className="mcx-btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className="mcx-btn mcx-btn--primary" onClick={saveEdit}>
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}

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
            <button
              type="button"
              className="mcx-btn mcx-btn--primary"
              onClick={() => {
                onCapturedUsed();
                clock.startSecondHalf();
              }}
            >
              Start Second Half
            </button>
          </div>
        </div>
      )}

      {clock.phase === "awaiting_full_time" && editable && (
        <div className="mcx-prompt" role="dialog" aria-modal="true">
          <div className="mcx-prompt__card mcx-prompt__card--wide">
            <h3>Full-time decision</h3>
            <p className="muted">
              Regulation and added time are complete. Choose what happens next.
            </p>
            <div className="mcx-prompt__actions mcx-prompt__actions--stack">
              <button
                type="button"
                className="mcx-btn mcx-btn--note"
                onClick={clock.playAdditionalMinute}
              >
                <span>More Time</span>
                <small>Adds 1 minute only</small>
              </button>
              <button type="button" className="mcx-btn" onClick={startShootout}>
                Penalty Shootout
              </button>
              <button type="button" className="mcx-btn mcx-btn--primary" onClick={logFullTime}>
                End Game
              </button>
            </div>
          </div>
        </div>
      )}

      {clock.phase === "penalty_shootout" && editable && shootoutDismissed && (
        <div className="mcx-callout mcx-callout--action">
          <span>
            Penalty shootout in progress
            {shootoutStarter ? ` · ${shootoutCurrentScore.home}–${shootoutCurrentScore.away}` : ""}
          </span>
          <button
            type="button"
            className="mcx-btn mcx-btn--primary"
            onClick={() => setShootoutDismissed(false)}
          >
            Resume penalty shootout
          </button>
        </div>
      )}

      {clock.phase === "penalty_shootout" && editable && !shootoutDismissed && (
        <div className="mcx-prompt" role="dialog" aria-modal="true" aria-labelledby="mcx-shootout-title">
          <div className="mcx-prompt__card mcx-prompt__card--wide">
            <div className="mcx-prompt__header">
              <h3 id="mcx-shootout-title">Penalty shootout</h3>
              <button
                type="button"
                className="mcx-prompt__close"
                aria-label="Close penalty shootout"
                onClick={() => setShootoutDismissed(true)}
              >
                ×
              </button>
            </div>

            {!shootoutStarter ? (
              <>
                <p className="muted">
                  Which team takes the first penalty? Kicks then alternate automatically.
                </p>
                <div className="mcx-prompt__actions mcx-prompt__actions--stack">
                  {(["home", "away"] as const).map((side) => (
                    <button
                      key={side}
                      type="button"
                      className="mcx-btn mcx-shootout-starter"
                      style={{ borderColor: kits[side] }}
                      onClick={() => chooseShootoutStarter(side)}
                    >
                      <span>{teamFor(side)}</span>
                      <small>Takes the first kick</small>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="muted">
                  {teamFor(shootoutStarter)} kicked first. Teams alternate automatically and the
                  game ends when the shootout is decided.
                </p>
                <div className="mcx-shootout-board" aria-label="Penalty shootout score">
                  <span>{teamFor("home")}</span>
                  <strong>{shootoutCurrentScore.home}</strong>
                  <span className="mcx-shootout-board__sep">–</span>
                  <strong>{shootoutCurrentScore.away}</strong>
                  <span>{teamFor("away")}</span>
                </div>
                <div
                  className="mcx-shootout-next"
                  style={{ borderColor: kits[shootoutNextSide] }}
                >
                  <span>Next penalty</span>
                  <strong>{teamFor(shootoutNextSide)}</strong>
                  <em>
                    Kick {shootoutKicks.length + 1}
                    {shootoutCurrentRound > 0 ? ` · round ${shootoutCurrentRound}` : ""}
                  </em>
                </div>
                <label className="mcx-prompt__label">
                  <span>Penalty taker jersey number</span>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    inputMode="numeric"
                    value={shootoutPlayerNumber}
                    onChange={(event) => setShootoutPlayerNumber(event.target.value)}
                    autoFocus
                  />
                </label>
                <div className="mcx-shootout-choice" role="radiogroup" aria-label="Penalty outcome">
                  <label className="mcx-shootout-choice__option is-goal">
                    <input
                      type="radio"
                      name="shootout-outcome"
                      checked={shootoutOutcome === "goal"}
                      onChange={() => setShootoutOutcome("goal")}
                    />
                    <span>Goal</span>
                  </label>
                  <label className="mcx-shootout-choice__option is-miss">
                    <input
                      type="radio"
                      name="shootout-outcome"
                      checked={shootoutOutcome === "miss"}
                      onChange={() => setShootoutOutcome("miss")}
                    />
                    <span>Miss</span>
                  </label>
                </div>
                <div className="mcx-prompt__actions">
                  <button
                    type="button"
                    className="mcx-btn mcx-btn--primary"
                    disabled={shootoutPlayerNumber.trim() === ""}
                    onClick={logShootoutKick}
                  >
                    Record penalty
                  </button>
                </div>
              </>
            )}
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
