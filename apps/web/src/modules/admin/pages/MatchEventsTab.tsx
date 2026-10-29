import { useEffect, useMemo, useRef, useState } from "react";
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
import { checkTypedMinute, closesTheMatch, placeChronologically } from "./correctionMinute";
import {
  UnregisteredNumberPrompt,
  parseJersey,
  type NumberToCheck,
  type UnregisteredNumber,
} from "./unregisteredNumber";
import {
  OFFICIAL_EVENT_TYPES,
  TEAM_OFFICIAL_NAME_MAX,
  TEAM_OFFICIAL_ROLES,
  TEAM_OFFICIAL_ROLE_LABELS,
  teamOfficialLabel,
  type TeamOfficial,
  type TeamOfficialRole,
} from "@dtp/engines/team-officials";

/** An official being named in the card modal or the edit form. `role` is null until picked. */
type OfficialEntry = { role: TeamOfficialRole | null; name: string };

const NO_OFFICIAL: OfficialEntry = { role: null, name: "" };

/** The official an entry names, once a role is picked. */
export function officialFromEntry(entry: OfficialEntry | null): TeamOfficial | null {
  if (!entry?.role) return null;
  const name = entry.name.replace(/\s+/g, " ").trim();
  return { role: entry.role, name: name || null };
}

/**
 * Event types that involve two players: the scorer and the assist on a goal, the players
 * coming off and on at a substitution. Both are asked for together, so a number typed
 * twice is caught while the recorder can still say which one was meant.
 */
const SECOND_PLAYER_PROMPT: Record<
  string,
  {
    title: string;
    primaryLabel: string;
    label: string;
    allowNone?: string;
    /** When both numbers are the same: the question, and the way out of it. */
    same: {
      question: (who: string) => string;
      changePrimary: string;
      changeSecondary: string;
      /** A goal can be a solo effort; a substitution cannot be undone that way. */
      solo?: string;
    };
  }
> = {
  substitution: {
    title: "Substitution",
    primaryLabel: "Player coming off — number",
    label: "Player coming on — number",
    same: {
      question: (who) => `${who} is down as both coming off and coming on. Which one is wrong?`,
      changePrimary: "Change the player coming off",
      changeSecondary: "Change the player coming on",
    },
  },
  goal: {
    title: "Goal",
    primaryLabel: "Scorer — jersey number",
    label: "Assist — jersey number",
    allowNone: "Solo Effort",
    same: {
      question: (who) =>
        `${who} is down as both the scorer and the assist. A player cannot assist their own goal. What needs correcting?`,
      changePrimary: "Change the scorer",
      changeSecondary: "Change the assist",
      solo: "It was a solo goal",
    },
  },
};

/** Where to pick up once the recorder says an unregistered number is right. */
type HeldEntry =
  | { kind: "event"; type: string; primary: number | null; secondary: number | null }
  | { kind: "edit"; solo: boolean }
  | { kind: "shootout" };

const JERSEY_RANGE = "Jersey numbers run from 1 to 99.";

/** Typed but not a shirt number. A blank is not invalid, only unanswered. */
function invalidJersey(value: string): boolean {
  return value.trim() !== "" && parseJersey(value) == null;
}

/**
 * Asked when one shirt number was given for both players of a goal or substitution: say
 * which one is wrong, or, on a goal, that nobody assisted it.
 */
function SamePlayerQuestion({
  question,
  changePrimary,
  changeSecondary,
  solo,
  onChangePrimary,
  onChangeSecondary,
  onSolo,
}: {
  question: string;
  changePrimary: string;
  changeSecondary: string;
  solo?: string;
  onChangePrimary: () => void;
  onChangeSecondary: () => void;
  onSolo: () => void;
}) {
  return (
    <div className="mcx-same" role="alert">
      <p className="mcx-same__q">{question}</p>
      <div className="mcx-same__actions">
        <button type="button" className="mcx-btn" onClick={onChangePrimary}>
          {changePrimary}
        </button>
        <button type="button" className="mcx-btn" onClick={onChangeSecondary}>
          {changeSecondary}
        </button>
        {solo && (
          <button type="button" className="mcx-btn mcx-btn--primary" onClick={onSolo}>
            {solo}
          </button>
        )}
      </div>
    </div>
  );
}

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
  officialOpen,
  onOfficialClose,
  onCapturedUsed,
  clock,
  addedInput,
  onAddedInputChange,
  onChange,
  homeName,
  awayName,
  playerLabelsByKey,
  checkNumbers,
}: {
  sheet: MatchStatsSheet;
  editable: boolean;
  events: RecordedEvent[];
  kits: KitColours;
  /** `half` is set when the minute was typed (a correction) rather than read off the clock. */
  captured: { minute: number; added: number | null; half?: 1 | 2 } | null;
  /** Null until step 2 is answered — no side is ever inherited. */
  side: Side | null;
  playerNumber: string;
  /**
   * The step-3 Official button was tapped: a card for a coach or other official is filed
   * from its own modal, which names them and ends on the Yellow or Red Card.
   */
  officialOpen: boolean;
  onOfficialClose: () => void;
  onCapturedUsed: () => void;
  clock: ReturnType<typeof useMatchClock>;
  addedInput: string;
  onAddedInputChange: (value: string) => void;
  onChange: (next: { events?: RecordedEvent[]; kits?: KitColours }) => void;
  homeName: string;
  awayName: string;
  playerLabelsByKey?: Map<string, string>;
  /** The numbers among these that nobody in the squad wears. */
  checkNumbers: (entries: NumberToCheck[]) => UnregisteredNumber[];
}) {
  /* Held while the second-player prompt is open, so the event is only written
     once that answer is given or explicitly waived. */
  const [pendingType, setPendingType] = useState<string | null>(null);
  /* The scorer (or player coming off), from step 3 but correctable in the prompt. */
  const [firstNumber, setFirstNumber] = useState("");
  const [secondNumber, setSecondNumber] = useState("");
  /* Both numbers are the same player: the prompt asks what was meant before filing. */
  const [sameAsked, setSameAsked] = useState(false);
  const firstInput = useRef<HTMLInputElement | null>(null);
  const secondInput = useRef<HTMLInputElement | null>(null);
  /* The same question, asked from the edit form. */
  const [editSameAsked, setEditSameAsked] = useState(false);
  const [editing, setEditing] = useState<RecordedEvent | null>(null);
  const [editDraft, setEditDraft] = useState({
    type: "",
    minute: "",
    addedMinute: "",
    side: "home" as Side,
    playerNumber: "",
    secondaryPlayerNumber: "",
    half: "1",
    /* "" for a player; otherwise the official the card was shown to. */
    officialRole: "" as TeamOfficialRole | "",
    officialName: "",
  });
  const [shootoutPlayerNumber, setShootoutPlayerNumber] = useState("");
  const [shootoutOutcome, setShootoutOutcome] = useState<"goal" | "miss">("goal");
  // Closing the shootout modal only hides it; the shootout itself carries on
  // and still ends automatically once it is decided.
  const [shootoutDismissed, setShootoutDismissed] = useState(false);
  /* An entry against a number nobody in the squad wears, waiting on the recorder. */
  const [numberCheck, setNumberCheck] = useState<{
    numbers: UnregisteredNumber[];
    held: HeldEntry;
  } | null>(null);

  /* The official named in the card modal, fresh each time it opens. */
  const [officialDraft, setOfficialDraft] = useState<OfficialEntry>(NO_OFFICIAL);
  useEffect(() => {
    if (officialOpen) setOfficialDraft(NO_OFFICIAL);
  }, [officialOpen]);
  /* The full-screen event picker, when that is how this recorder chose to see step 4. */
  const [pickerOpen, setPickerOpen] = useState(false);

  const { prefs, update: updatePrefs } = useFeedbackPrefs();
  const playSound = useUISound({ enabled: prefs.sound, intensity: prefs.intensity });
  const fullScreenPicker = prefs.eventPicker === "fullscreen";

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
  /** Who an event in the log was about: an official, or the player and second player. */
  const whoFor = (e: RecordedEvent) => {
    if (e.official) return ` · ${teamOfficialLabel(e.official)}`;
    const primary = e.playerNumber ? ` · ${labelForNumber(e.side, e.playerNumber)}` : "";
    const secondary = e.secondaryPlayerNumber
      ? e.type === "substitution"
        ? ` → ${labelForNumber(e.side, e.secondaryPlayerNumber)}`
        : ` · assist ${labelForNumber(e.side, e.secondaryPlayerNumber)}`
      : "";
    return primary + secondary;
  };
  const stepsEnabled = editable && clock.started;
  /* Reopened after full time: the minute is typed in step 1 and can be changed on edit. */
  const correcting = clock.correcting;
  const hasSide = Boolean(side);
  const primaryNumber = parseJersey(playerNumber);
  const hasPlayerNumber = primaryNumber != null;
  /* Every earlier step must be answered before step 4 unlocks: no event can be
     filed against the wrong minute, the wrong side, or no player at all. */
  const canLog = stepsEnabled && Boolean(captured) && hasSide && hasPlayerNumber;
  /* An official needs the minute and the side; the modal itself names them. */
  const officialReady = stepsEnabled && Boolean(captured) && hasSide;
  const chosenOfficial = officialFromEntry(officialDraft);

  /* Once the entry resets after a filed event, the picker closes with it, so it never
     pops open by itself half-way through the next shirt number. */
  useEffect(() => {
    if (!canLog) setPickerOpen(false);
  }, [canLog]);
  useEffect(() => {
    if (!pickerOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPickerOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [pickerOpen]);

  /** Step 4 — the tap. Types needing a second player open a prompt first. */
  const addEvent = (type: string) => {
    if (!canLog || !captured || !side) return;
    if (SECOND_PLAYER_PROMPT[type]) {
      setFirstNumber(primaryNumber == null ? "" : String(primaryNumber));
      setSecondNumber("");
      setSameAsked(false);
      setPendingType(type);
      // The sound belongs to the completed event, so it waits for the prompt.
      return;
    }
    writeEvent(type, null);
  };

  /**
   * Hold an entry whose number nobody in the squad wears until the recorder confirms it.
   * True when it was held; it is then filed from `confirmUnregistered`.
   */
  const holdForUnregistered = (entries: NumberToCheck[], held: HeldEntry): boolean => {
    const numbers = checkNumbers(entries);
    if (numbers.length === 0) return false;
    playSound("error");
    setNumberCheck({ numbers, held });
    return true;
  };

  /**
   * Commit the event, with the second player's number when one was given. `primary` is
   * step 3's number unless the two-player prompt corrected it.
   */
  const writeEvent = (
    type: string,
    secondary: number | null,
    confirmed = false,
    primary: number | null = primaryNumber
  ) => {
    if (!captured || !side) return;
    if (
      !confirmed &&
      holdForUnregistered(
        [
          { side, number: primary },
          { side, number: secondary },
        ],
        { kind: "event", type, primary, secondary }
      )
    ) {
      return;
    }
    // Sounded here rather than on tap, so a goal cheers when the assist lands.
    playSound(soundFor(type));
    const next: RecordedEvent = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      minute: captured.minute,
      addedMinute: captured.added,
      side,
      playerNumber: primary,
      secondaryPlayerNumber: secondary,
      half: captured.half ?? clock.half,
    };
    onChange({ events: correcting ? placeChronologically(events, next) : [...events, next] });
    setPendingType(null);
    setFirstNumber("");
    setSecondNumber("");
    setSameAsked(false);
    setPickerOpen(false);
    // Clear the entry so the next event starts from a clean step 1.
    onCapturedUsed();
  };

  /**
   * File a card for the official named in the modal. The modal is where this event ends:
   * an official has no shirt number to check, and nothing but a card can be theirs.
   */
  const writeOfficialCard = (type: "yellow_card" | "red_card") => {
    if (!officialReady || !captured || !side || !chosenOfficial) return;
    playSound(soundFor(type));
    const next: RecordedEvent = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      minute: captured.minute,
      addedMinute: captured.added,
      side,
      playerNumber: null,
      secondaryPlayerNumber: null,
      half: captured.half ?? clock.half,
      official: chosenOfficial,
    };
    onChange({ events: correcting ? placeChronologically(events, next) : [...events, next] });
    onOfficialClose();
    onCapturedUsed();
  };

  const removeEvent = (id: string) => {
    if (!editable) return;
    onChange({ events: normalizeShootoutSides(events.filter((e) => e.id !== id)) });
  };

  /* A changed number answers the same-player question, so it goes away until asked again. */
  useEffect(() => setSameAsked(false), [firstNumber, secondNumber]);
  useEffect(() => setEditSameAsked(false), [editDraft]);

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
      officialRole: event.official?.role ?? "",
      officialName: event.official?.name ?? "",
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

  /* Live, the minute, added time and half are the clock's and stay as filed. In a
     correction they are typed, held to the shape the clock would have produced. */
  const editMinute =
    correcting && editing
      ? checkTypedMinute(editDraft.minute, editDraft.addedMinute, clock.halfLength, {
          allowZero: editing.minute === 0,
        })
      : null;

  /* A card can be for an official; any other type is always a player's. */
  const editCanBeOfficial = OFFICIAL_EVENT_TYPES.has(editDraft.type);
  const editOfficial =
    editCanBeOfficial && editDraft.officialRole
      ? officialFromEntry({ role: editDraft.officialRole, name: editDraft.officialName })
      : null;

  /* A blank number clears it; anything else typed has to be a shirt number. */
  const needsSecond = Boolean(SECOND_PLAYER_PROMPT[editDraft.type]);
  const editNumberError =
    editing &&
    !editOfficial &&
    (invalidJersey(editDraft.playerNumber) ||
      (needsSecond && invalidJersey(editDraft.secondaryPlayerNumber)))
      ? JERSEY_RANGE
      : null;

  /**
   * `solo` files a goal with no assist: the recorder's answer when the assist was the
   * scorer's own number. It rides through the unregistered-number check with the edit.
   */
  const saveEdit = (confirmed = false, solo = false) => {
    if (!editable || !editing) return;
    if (editMinute && !editMinute.ok) return;
    if (editNumberError) return;
    /* Dropped from the copy, then set again only if the edit still names an official. */
    const { official: _was, ...before } = editing;
    const next: RecordedEvent = {
      ...before,
      type: editDraft.type,
      minute: editMinute?.ok ? editMinute.minute : parseMinute(editDraft.minute),
      addedMinute: editMinute?.ok ? editMinute.added : parsePositiveInt(editDraft.addedMinute),
      side: editDraft.side,
      playerNumber: editOfficial ? null : parseJersey(editDraft.playerNumber),
      secondaryPlayerNumber:
        !editOfficial && needsSecond && !solo
          ? parseJersey(editDraft.secondaryPlayerNumber)
          : null,
      half: editMinute?.ok ? editMinute.half : editDraft.half === "2" ? 2 : 1,
      ...(editOfficial ? { official: editOfficial } : {}),
    };
    /* One player in both places: ask which is wrong rather than file it. */
    if (
      needsSecond &&
      next.playerNumber != null &&
      next.playerNumber === next.secondaryPlayerNumber
    ) {
      playSound("error");
      setEditSameAsked(true);
      return;
    }
    /* Only a number this edit puts there: one already filed was confirmed when it was. */
    const moved = next.side !== editing.side;
    const entered = (number: number | null, before: number | null) =>
      moved || number !== before ? number : null;
    if (
      !confirmed &&
      holdForUnregistered(
        [
          { side: next.side, number: entered(next.playerNumber, editing.playerNumber) },
          {
            side: next.side,
            number: entered(next.secondaryPlayerNumber, editing.secondaryPlayerNumber),
          },
        ],
        { kind: "edit", solo }
      )
    ) {
      return;
    }
    /* A corrected minute moves the event to where it now happened. Full time and the
       shootout keep their place: their order is the match's ending. */
    const retimed =
      correcting && !closesTheMatch(next)
        ? placeChronologically(
            events.filter((event) => event.id !== editing.id),
            next
          )
        : events.map((event) => (event.id === editing.id ? next : event));
    onChange({ events: normalizeShootoutSides(retimed) });
    setEditing(null);
    setEditSameAsked(false);
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

  const logShootoutKick = (confirmed = false) => {
    const jersey = parseJersey(shootoutPlayerNumber);
    if (jersey == null) return;
    const kicker = nextShootoutSide(events);
    if (!confirmed && holdForUnregistered([{ side: kicker, number: jersey }], { kind: "shootout" })) {
      return;
    }
    const t = systemMinute();
    const nextEvent: RecordedEvent = {
      id: `shootout_${shootoutOutcome}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: shootoutOutcome === "goal" ? "shootout_goal" : "shootout_miss",
      minute: t.minute,
      addedMinute: t.addedMinute,
      side: kicker,
      playerNumber: jersey,
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

  /* Filed from this render rather than the one that held it, so it sees the log as it is now. */
  const confirmUnregistered = () => {
    const held = numberCheck?.held;
    setNumberCheck(null);
    if (!held) return;
    if (held.kind === "event") writeEvent(held.type, held.secondary, true, held.primary);
    else if (held.kind === "edit") saveEdit(true, held.solo);
    else logShootoutKick(true);
  };

  const shootoutKicks = events.filter((event) => SHOOTOUT_TYPES.has(event.type));
  const shootoutCurrentScore = shootoutScore(events);
  const shootoutNextSide = nextShootoutSide(events);
  const shootoutCurrentRound = shootoutRound(events);
  const shootoutStarter = shootoutStartingSide(events);

  return (
    <div className="mcx-events">
      {correcting && (
        <p className="mcx-callout mcx-callout--action">
          <span>
            <strong>Correcting a finished match.</strong> The clock is stopped at full time.
            Type the minute in step 1, then the team, the jersey number and the event as
            usual. Use <strong>Edit</strong> on any logged event to change its minute, team,
            players or type.
          </span>
        </p>
      )}

      {!clock.started && (
        <p className="mcx-callout">
          Set the half length and tap <strong>Kick Off</strong> above to start recording.
        </p>
      )}

      {clock.started && (
        <section className="mcx-step mcx-step--grid">
          <span className="mcx-step__n">4</span>
          <div className="mcx-step__body">
            <div className="mcx-step__labelrow">
              <span className="mcx-step__label">
                {fullScreenPicker ? "Choose the event to capture" : "Tap the event to capture"}
                {!captured ? (
                  <em className="mcx-step__gate">
                    {correcting
                      ? " — enter the minute first (step 1)"
                      : " — log a minute first (step 1)"}
                  </em>
                ) : !side ? (
                  <em className="mcx-step__gate"> — choose home or away first (step 2)</em>
                ) : playerNumber.trim() === "" ? (
                  <em className="mcx-step__gate">
                    {" "}
                    — enter a jersey number, or tap Official (step 3)
                  </em>
                ) : !hasPlayerNumber ? (
                  <em className="mcx-step__gate"> — jersey numbers run from 1 to 99 (step 3)</em>
                ) : null}
              </span>
              {/* The same switch as the landing page's settings, here because it is the
                  moment a recorder finds out which way they prefer. */}
              <button
                type="button"
                className="mcx-step__mode"
                onClick={() =>
                  updatePrefs({ eventPicker: fullScreenPicker ? "inline" : "fullscreen" })
                }
              >
                {fullScreenPicker ? "Show buttons here" : "Use full screen"}
              </button>
            </div>
            {fullScreenPicker ? (
              <button
                type="button"
                className={canLog ? "mcx-pickbtn" : "mcx-pickbtn is-locked"}
                aria-disabled={!canLog}
                onClick={() => (canLog ? setPickerOpen(true) : playSound("error"))}
              >
                {canLog && captured && side ? (
                  <>
                    <span className="mcx-pickbtn__main">Choose the event</span>
                    <span className="mcx-pickbtn__sub">
                      {displayMinute(captured.minute, captured.added)} · {teamFor(side)} ·{" "}
                      {labelForNumber(side, primaryNumber)}
                    </span>
                  </>
                ) : (
                  <span className="mcx-pickbtn__main">Choose the event</span>
                )}
              </button>
            ) : (
              <EventGrid
                types={sheet.eventTypes}
                locked={!canLog}
                prefs={prefs}
                captureMap={sheet.eventCapture}
                statLabels={statLabels}
                onLog={addEvent}
                onBlocked={() => playSound("error")}
              />
            )}
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
                    {whoFor(e)}
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
              {correcting
                ? "Correct the event, then submit the corrections for approval."
                : "Correct the event before the sheet is submitted or approved."}
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
                  {/* An official keeps to the cards: nothing else can be theirs. */}
                  {Array.from(new Set([editing.type, ...sheet.eventTypes]))
                    .filter((type) => !editOfficial || OFFICIAL_EVENT_TYPES.has(type))
                    .map((type) => (
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
                  onChange={(event) =>
                    setEditDraft((draft) => ({ ...draft, minute: event.target.value }))
                  }
                  disabled={!correcting}
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
                  onChange={(event) =>
                    setEditDraft((draft) => ({ ...draft, addedMinute: event.target.value }))
                  }
                  placeholder="0"
                  disabled={!correcting}
                />
              </label>
              <label>
                <span>Half</span>
                {/* Follows the minute in a correction, so the two cannot disagree. */}
                <select
                  value={editMinute?.ok ? String(editMinute.half) : editDraft.half}
                  disabled
                >
                  <option value="1">1st half</option>
                  <option value="2">2nd half</option>
                </select>
              </label>
              {editCanBeOfficial && (
                <label>
                  <span>Shown to</span>
                  <select
                    value={editDraft.officialRole}
                    onChange={(event) =>
                      setEditDraft((draft) => ({
                        ...draft,
                        officialRole: event.target.value as TeamOfficialRole | "",
                      }))
                    }
                  >
                    <option value="">A player</option>
                    {TEAM_OFFICIAL_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {TEAM_OFFICIAL_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {editOfficial ? (
                <label>
                  <span>Official's name</span>
                  <input
                    type="text"
                    maxLength={TEAM_OFFICIAL_NAME_MAX}
                    value={editDraft.officialName}
                    onChange={(event) =>
                      setEditDraft((draft) => ({ ...draft, officialName: event.target.value }))
                    }
                    placeholder="Optional"
                  />
                </label>
              ) : (
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
              )}
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
            {editMinute && !editMinute.ok && (
              <p className="mcx-error" role="alert">{editMinute.reason}</p>
            )}
            {editNumberError && (
              <p className="mcx-error" role="alert">{editNumberError}</p>
            )}
            {editSameAsked && SECOND_PLAYER_PROMPT[editDraft.type] && (
              <SamePlayerQuestion
                question={SECOND_PLAYER_PROMPT[editDraft.type].same.question(
                  labelForNumber(editDraft.side, parseJersey(editDraft.playerNumber))
                )}
                changePrimary={SECOND_PLAYER_PROMPT[editDraft.type].same.changePrimary}
                changeSecondary={SECOND_PLAYER_PROMPT[editDraft.type].same.changeSecondary}
                solo={SECOND_PLAYER_PROMPT[editDraft.type].same.solo}
                onChangePrimary={() => setEditSameAsked(false)}
                onChangeSecondary={() =>
                  setEditDraft((draft) => ({ ...draft, secondaryPlayerNumber: "" }))
                }
                onSolo={() => saveEdit(false, true)}
              />
            )}
            <div className="mcx-prompt__actions">
              <button type="button" className="mcx-btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="mcx-btn mcx-btn--primary"
                onClick={() => saveEdit()}
                disabled={Boolean((editMinute && !editMinute.ok) || editNumberError)}
              >
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Full-screen event picker: the grid with the whole screen to itself ---- */}
      {fullScreenPicker && pickerOpen && canLog && captured && side && (
        <div
          className="mcx-picker"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mcx-picker-title"
        >
          <header className="mcx-picker__head" style={{ borderBottomColor: kits[side] }}>
            <div className="mcx-picker__who">
              <h3 id="mcx-picker-title">Choose the event</h3>
              <p>
                <span className="mcx-picker__min">
                  {displayMinute(captured.minute, captured.added)}
                </span>
                <span className="mcx-kit" style={{ background: kits[side] }} aria-hidden="true" />
                {teamFor(side)} · {labelForNumber(side, primaryNumber)}
              </p>
            </div>
            <button
              type="button"
              className="mcx-picker__close"
              onClick={() => setPickerOpen(false)}
              aria-label="Close the event picker"
            >
              ×
            </button>
          </header>
          <div className="mcx-picker__body">
            <EventGrid
              types={sheet.eventTypes}
              locked={false}
              prefs={prefs}
              captureMap={sheet.eventCapture}
              statLabels={statLabels}
              onLog={addEvent}
              onBlocked={() => playSound("error")}
            />
          </div>
        </div>
      )}

      {/* ---- Card for a team official: named here, and filed from here ---- */}
      {officialOpen && officialReady && captured && side && (
        <div
          className="mcx-prompt"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mcx-official-title"
        >
          <div className="mcx-prompt__card mcx-prompt__card--wide mcx-official">
            <h3 id="mcx-official-title">Card for a team official</h3>
            <p className="muted">
              {displayMinute(captured.minute, captured.added)} · {teamFor(side)}
            </p>
            <span className="mcx-prompt__label">Who was it shown to?</span>
            <div className="mcx-official__roles">
              {TEAM_OFFICIAL_ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  className={officialDraft.role === role ? "mcx-chip is-active" : "mcx-chip"}
                  onClick={() => setOfficialDraft((draft) => ({ ...draft, role }))}
                  aria-pressed={officialDraft.role === role}
                >
                  {TEAM_OFFICIAL_ROLE_LABELS[role]}
                </button>
              ))}
            </div>
            <label className="mcx-prompt__label">
              <span>Name (optional)</span>
              <input
                type="text"
                maxLength={TEAM_OFFICIAL_NAME_MAX}
                placeholder="If you know it"
                value={officialDraft.name}
                onChange={(event) =>
                  setOfficialDraft((draft) => ({ ...draft, name: event.target.value }))
                }
              />
            </label>
            <div className="mcx-official__cards">
              <button
                type="button"
                className="mcx-cardbtn mcx-cardbtn--yellow"
                disabled={!chosenOfficial}
                onClick={() => writeOfficialCard("yellow_card")}
              >
                Yellow Card
              </button>
              <button
                type="button"
                className="mcx-cardbtn mcx-cardbtn--red"
                disabled={!chosenOfficial}
                onClick={() => writeOfficialCard("red_card")}
              >
                Red Card
              </button>
            </div>
            {!chosenOfficial && (
              <p className="mcx-official__hint muted">Choose who it was to enable the cards.</p>
            )}
            <button type="button" className="mcx-prompt__cancel" onClick={onOfficialClose}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ---- Two-player prompt: scorer and assist, or the players off and on ---- */}
      {pendingType && SECOND_PLAYER_PROMPT[pendingType] && (() => {
        const def = SECOND_PLAYER_PROMPT[pendingType];
        const first = parseJersey(firstNumber);
        const second = parseJersey(secondNumber);
        /* Filed only once the two are different players; the same number is a question. */
        const submit = () => {
          if (first == null || second == null) return;
          if (first === second) {
            playSound("error");
            setSameAsked(true);
            return;
          }
          writeEvent(pendingType, second, false, first);
        };
        const focus = (input: HTMLInputElement | null) =>
          window.setTimeout(() => {
            input?.focus();
            input?.select();
          }, 0);
        return (
          <div className="mcx-prompt" role="dialog" aria-modal="true" aria-label={def.title}>
            <div className="mcx-prompt__card">
              <h3>{def.title}</h3>
              <p className="muted">
                {displayMinute(captured?.minute ?? 0, captured?.added ?? null)} ·{" "}
                {side ? teamFor(side) : ""}
              </p>
              <label className="mcx-prompt__label">
                <span>{def.primaryLabel}</span>
                <input
                  ref={firstInput}
                  type="number"
                  min={1}
                  max={99}
                  inputMode="numeric"
                  value={firstNumber}
                  onChange={(e) => setFirstNumber(e.target.value)}
                />
                {side && first != null && (
                  <span className="mcx-prompt__who">{labelForNumber(side, first)}</span>
                )}
              </label>
              <label className="mcx-prompt__label">
                <span>{def.label}</span>
                <input
                  ref={secondInput}
                  type="number"
                  min={1}
                  max={99}
                  inputMode="numeric"
                  value={secondNumber}
                  onChange={(e) => setSecondNumber(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit();
                  }}
                  autoFocus
                />
                {side && second != null && (
                  <span className="mcx-prompt__who">{labelForNumber(side, second)}</span>
                )}
              </label>
              {(invalidJersey(firstNumber) || invalidJersey(secondNumber)) && (
                <p className="mcx-error" role="alert">{JERSEY_RANGE}</p>
              )}
              {sameAsked && side && first != null ? (
                <SamePlayerQuestion
                  question={def.same.question(labelForNumber(side, first))}
                  changePrimary={def.same.changePrimary}
                  changeSecondary={def.same.changeSecondary}
                  solo={def.same.solo}
                  onChangePrimary={() => {
                    setSameAsked(false);
                    focus(firstInput.current);
                  }}
                  onChangeSecondary={() => {
                    setSecondNumber("");
                    focus(secondInput.current);
                  }}
                  onSolo={() => writeEvent(pendingType, null, false, first)}
                />
              ) : (
                <div className="mcx-prompt__actions">
                  {def.allowNone && (
                    <button
                      type="button"
                      className="mcx-btn"
                      disabled={first == null}
                      onClick={() => writeEvent(pendingType, null, false, first)}
                    >
                      {def.allowNone}
                    </button>
                  )}
                  <button
                    type="button"
                    className="mcx-btn mcx-btn--primary"
                    disabled={first == null || second == null}
                    onClick={submit}
                  >
                    OK
                  </button>
                </div>
              )}
            <button
              type="button"
              className="mcx-prompt__cancel"
              onClick={() => setPendingType(null)}
            >
              Cancel
            </button>
            </div>
          </div>
        );
      })()}

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
                {invalidJersey(shootoutPlayerNumber) && (
                  <p className="mcx-error" role="alert">{JERSEY_RANGE}</p>
                )}
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
                    disabled={parseJersey(shootoutPlayerNumber) == null}
                    onClick={() => logShootoutKick()}
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

      {/* Last, so it sits over whichever prompt held the entry. */}
      {numberCheck && (
        <UnregisteredNumberPrompt
          numbers={numberCheck.numbers}
          onConfirm={confirmUnregistered}
          onCancel={() => setNumberCheck(null)}
        />
      )}
    </div>
  );
}
