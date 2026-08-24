import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  matchStatsApi,
  type ClockState,
  type Half,
  type KitColours,
  type MatchStatsSheet,
  type RecordedEvent,
  type SectionAudit,
  type SectionPermissions,
  type SheetSection,
  type SheetStatus,
  type SidePair,
  type Side,
  type SplitTally,
  type TallyValue,
} from "../../../api/adminMatchStats";
import { MatchEventsTab } from "./MatchEventsTab";
import { clearDraft, draftIsAhead, markSynced, readDraft, writeDraft } from "./matchSheetDraft";
import {
  HALF_LENGTH_CHOICES,
  TRAINING_HALF_LENGTH_CHOICES,
  displayMinute,
  mmss,
  useMatchClock,
} from "./useMatchClock";
import { usePageTitle } from "../../../hooks/usePageTitle";

const HALVES: Half[] = ["1st", "2nd"];

/* Tapping must feel instant pitch-side, so counts update locally and the sheet
   is flushed to the API on a short debounce rather than per tap. */
const AUTOSAVE_DELAY_MS = 700;
/* How often to retry a failed sync while the network is down. */
const RETRY_DELAY_MS = 8000;

function isSplit(value: TallyValue | undefined): value is SplitTally {
  return Boolean(value && "1st" in (value as SplitTally));
}

function pairOf(value: TallyValue | undefined, half: Half): SidePair {
  if (!value) return { home: 0, away: 0 };
  return isSplit(value) ? value[half] : value;
}

function totalOf(value: TallyValue | undefined): SidePair {
  if (!value) return { home: 0, away: 0 };
  if (!isSplit(value)) return value;
  return {
    home: value["1st"].home + value["2nd"].home,
    away: value["1st"].away + value["2nd"].away,
  };
}

/**
 * Five-bar gate tally. Counting in bundles of five is how a paper sheet is kept,
 * and it stays readable at a glance when you are not looking at the screen.
 */
function TallyBundle({ count }: { count: number }) {
  const width = count === 5 ? 30 : Math.max(count, 1) * 7 + 3;
  return (
    <svg width={width} height="24" viewBox={`0 0 ${width} 24`} aria-hidden="true">
      {Array.from({ length: Math.min(count, 4) }).map((_, i) => (
        <line
          key={i}
          x1={4 + i * 7}
          y1={2}
          x2={4 + i * 7}
          y2={22}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ))}
      {count === 5 && (
        <line x1={2} y1={22} x2={26} y2={2} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

function Tally({ count }: { count: number }) {
  const bundles: number[] = [];
  let remaining = count;
  while (remaining > 0) {
    const n = Math.min(remaining, 5);
    bundles.push(n);
    remaining -= n;
  }
  return (
    <span className="mcx-tally">
      {bundles.length === 0 ? (
        <span className="mcx-tally__zero">–</span>
      ) : (
        bundles.map((n, i) => <TallyBundle key={i} count={n} />)
      )}
      <span className="mcx-tally__count">{count}</span>
    </span>
  );
}

function Counter({
  value,
  side,
  disabled,
  onBump,
  label,
}: {
  value: number;
  side: Side;
  disabled: boolean;
  onBump: (delta: number) => void;
  label: string;
}) {
  return (
    <div className={`mcx-counter mcx-counter--${side}`}>
      <button
        type="button"
        className="mcx-counter__btn mcx-counter__btn--minus"
        onClick={() => onBump(-1)}
        disabled={disabled || value === 0}
        aria-label={`Decrease ${label}`}
      >
        −
      </button>
      <Tally count={value} />
      <button
        type="button"
        className="mcx-counter__btn mcx-counter__btn--plus"
        onClick={() => onBump(1)}
        disabled={disabled}
        aria-label={`Increase ${label}`}
      >
        +
      </button>
    </div>
  );
}

/** Approved view: the comparison bars the public Statistics tab mirrors. */
function StatBar({ label, home, away }: { label: string; home: number; away: number }) {
  const total = home + away || 1;
  return (
    <div className="mcx-bar">
      <div className="mcx-bar__head">
        <span className="mcx-bar__home">{home}</span>
        <span className="mcx-bar__label">{label}</span>
        <span className="mcx-bar__away">{away}</span>
      </div>
      <div className="mcx-bar__track">
        <span className="mcx-bar__fill mcx-bar__fill--home" style={{ width: `${(home / total) * 100}%` }} />
        <span className="mcx-bar__fill mcx-bar__fill--away" />
      </div>
    </div>
  );
}

/** Common kit colours, enough to tell two sides apart at a glance. */
const KIT_SWATCHES = [
  "#e11d48", "#f97316", "#facc15", "#22c55e", "#0ea5e9",
  "#4c9ffe", "#6366f1", "#a855f7", "#f8fafc", "#111827",
];

/** A dark kit needs light text on it, and vice versa. */
function readableOn(hex: string): string {
  const v = hex.replace("#", "");
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  // Rec. 601 luma — good enough to pick black or white text.
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? "#0b1220" : "#ffffff";
}

const STATUS_COPY: Record<SheetStatus, string> = {
  live: "Recording",
  submitted: "Awaiting approval",
  approved: "Approved",
};

/** Submit / approve / send-back controls for one track. */
function SectionActions({
  section,
  status,
  permissions,
  audit,
  busy,
  onSubmit,
  onApprove,
  onSendBack,
}: {
  section: SheetSection;
  status: SheetStatus;
  permissions: SectionPermissions;
  audit: SectionAudit;
  busy: boolean;
  onSubmit: () => void;
  onApprove: () => void;
  onSendBack: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const label = section === "stats" ? "statistics" : "event log";

  return (
    <footer className="mcx-actions">
      {permissions.canSubmit && status === "live" && (
        <button type="button" className="mcx-btn mcx-btn--primary" disabled={busy} onClick={onSubmit}>
          Submit {label} for approval
        </button>
      )}

      {status === "submitted" && (
        <div className="mcx-submitted">
          <p className="mcx-submitted__note">
            Submitted{audit.submittedByName ? ` by ${audit.submittedByName}` : ""}
            {audit.submittedAt ? ` · ${new Date(audit.submittedAt).toLocaleString()}` : ""}.
            {permissions.canEdit && " You can still correct a mis-tap until it is approved."}
          </p>
          {permissions.canEdit && (
            <button type="button" className="mcx-btn" disabled={busy} onClick={onSubmit}>
              Re-submit corrections
            </button>
          )}
        </div>
      )}

      {status === "approved" && (
        <p className="mcx-submitted__note">
          Approved{audit.approvedByName ? ` by ${audit.approvedByName}` : ""}
          {audit.approvedAt ? ` · ${new Date(audit.approvedAt).toLocaleString()}` : ""}. Live on
          the public site.
        </p>
      )}

      {permissions.canApprove && status === "approved" && (
        <div className="mcx-review">
          {showNote && (
            <textarea
              className="mcx-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What needs fixing? (optional, shown to the recorder)"
              rows={2}
              maxLength={500}
            />
          )}
          <button
            type="button"
            className="mcx-btn"
            disabled={busy}
            onClick={() => (showNote ? onSendBack(note) : setShowNote(true))}
          >
            {showNote ? "Confirm reopen" : "Reopen for corrections"}
          </button>
        </div>
      )}

      {permissions.canApproveThis && (
        <div className="mcx-review">
          {showNote && (
            <textarea
              className="mcx-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What needs fixing? (optional, shown to the recorder)"
              rows={2}
              maxLength={500}
            />
          )}
          <div className="mcx-review__buttons">
            <button
              type="button"
              className="mcx-btn"
              disabled={busy}
              onClick={() => (showNote ? onSendBack(note) : setShowNote(true))}
            >
              {showNote ? "Confirm send back" : "Send back for edits"}
            </button>
            <button type="button" className="mcx-btn mcx-btn--approve" disabled={busy} onClick={onApprove}>
              Approve &amp; publish
            </button>
          </div>
        </div>
      )}
    </footer>
  );
}

export function AdminMatchStatsConsolePage() {
  const { matchId = "" } = useParams();
  const [sheet, setSheet] = useState<MatchStatsSheet | null>(null);
  const [tallies, setTallies] = useState<Record<string, TallyValue>>({});
  const [events, setEvents] = useState<RecordedEvent[]>([]);
  const [clock, setClock] = useState<ClockState | null>(null);
  const [kits, setKits] = useState<KitColours>({ home: "#4c9ffe", away: "#f5a524" });
  const [tab, setTab] = useState<SheetSection>("stats");
  const [half, setHalf] = useState<Half>("1st");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "pending">("idle");
  const [online, setOnline] = useState(() => navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [pendingHalfLength, setPendingHalfLength] = useState(45);
  const [halfLengthTouched, setHalfLengthTouched] = useState(false);
  const [addedInput, setAddedInput] = useState("2");
  /** Minute captured by step 1, held until an event is logged. */
  const [captured, setCaptured] = useState<{ minute: number; added: number | null } | null>(null);
  /* Entry controls live here rather than in the Events tab so they can sit in
     the frozen header — they are needed constantly while the grid scrolls. */
  const [side, setSide] = useState<Side | null>(null);
  const [playerNumber, setPlayerNumber] = useState("");
  const [kitPicker, setKitPicker] = useState<Side | null>(null);

  usePageTitle(sheet ? `${sheet.match.homeTeam.name} vs ${sheet.match.awayTeam.name}` : "Match console");

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Held in a ref so the debounced flush always sends the latest data even
     though the timer closes over an older render. */
  const pending = useRef<{
    tallies: Record<string, TallyValue>;
    events: RecordedEvent[];
    clock: ClockState | null;
    kits: KitColours;
  } | null>(null);

  /* Competitions can declare their own half length; the training cup uses 5. */
  const suggestedHalfLength = sheet?.match.competition.halfLengthMinutes ?? null;
  useEffect(() => {
    if (suggestedHalfLength && !halfLengthTouched) setPendingHalfLength(suggestedHalfLength);
  }, [suggestedHalfLength, halfLengthTouched]);

  const applySheet = useCallback((next: MatchStatsSheet) => {
    setSheet(next);
    setTallies(next.tallies);
    setEvents(next.events ?? []);
    setClock(next.clock ?? null);
    if (next.kits) setKits(next.kits);
  }, []);

  useEffect(() => {
    if (!matchId) return;
    let active = true;
    setLoading(true);
    matchStatsApi
      .open(matchId)
      .then((data) => {
        if (!active) return;
        applySheet(data);
        /* A draft this device never managed to sync outranks the server copy —
           those taps exist nowhere else. */
        const draft = readDraft(matchId);
        if (draftIsAhead(draft) && draft) {
          setTallies(draft.tallies);
          setEvents(draft.events);
          setClock(draft.clock);
          setKits(draft.kits);
          pending.current = {
            tallies: draft.tallies,
            events: draft.events,
            clock: draft.clock,
            kits: draft.kits,
          };
          setSaveState("pending");
        }
        setError(null);
      })
      .catch((e) => {
        if (!active) return;
        /* Offline on open: fall back to whatever this device holds so the
           recorder can keep working regardless of signal. */
        const draft = readDraft(matchId);
        if (draft) {
          setTallies(draft.tallies);
          setEvents(draft.events);
          setClock(draft.clock);
          setKits(draft.kits);
          setSaveState("pending");
        }
        setError(String(e instanceof Error ? e.message : e));
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [matchId, applySheet]);

  const flush = useCallback(async () => {
    if (!pending.current || !matchId) return;
    const payload = pending.current;
    setSaveState("saving");
    try {
      const next = await matchStatsApi.save(matchId, payload.tallies, {
        events: payload.events,
        clock: payload.clock,
        kits: payload.kits,
      });
      // Only clear the queue once the API has actually accepted this payload.
      pending.current = null;
      markSynced(matchId);
      // Keep the server's status/audit but not the recorded data: the recorder
      // may have tapped again while this request was in flight.
      setSheet((prev) => (prev ? { ...next, tallies: prev.tallies, events: prev.events } : next));
      setSaveState("saved");
    } catch {
      /* Keep the payload queued. The draft is already on the device, so
         nothing is lost — this just retries until the network returns. */
      setSaveState("pending");
    }
  }, [matchId]);

  /* Retry loop and online listener: the sync catches up by itself. */
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void flush();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const id = setInterval(() => {
      if (pending.current && navigator.onLine) void flush();
    }, RETRY_DELAY_MS);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearInterval(id);
    };
  }, [flush]);

  // Flush anything outstanding when leaving the page.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      void flush();
    };
  }, [flush]);

  const statsPerms = sheet?.permissions;
  const eventsPerms = sheet?.eventsPermissions;
  const statsEditable = Boolean(statsPerms?.canEdit);
  const eventsEditable = Boolean(eventsPerms?.canEdit);

  /** Queue a debounced save, and mirror to the device immediately. */
  const queueSave = useCallback(
    (patch: {
      tallies?: Record<string, TallyValue>;
      events?: RecordedEvent[];
      clock?: ClockState | null;
      kits?: KitColours;
    }) => {
      const next = {
        tallies: patch.tallies ?? pending.current?.tallies ?? tallies,
        events: patch.events ?? pending.current?.events ?? events,
        clock: patch.clock !== undefined ? patch.clock : pending.current?.clock ?? clock,
        kits: patch.kits ?? pending.current?.kits ?? kits,
      };
      pending.current = next;
      // Written before the network is even attempted — this is the real copy.
      writeDraft(matchId, { ...next, synced: false });
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    },
    [tallies, events, clock, kits, matchId, flush]
  );

  const handleClockChange = useCallback(
    (next: ClockState) => {
      setClock(next);
      queueSave({ clock: next });
    },
    [queueSave]
  );

  const matchClock = useMatchClock(clock, handleClockChange);

  const handleEventsChange = useCallback(
    (next: { events?: RecordedEvent[]; kits?: KitColours }) => {
      if (next.events) setEvents(next.events);
      if (next.kits) setKits(next.kits);
      queueSave(next);
    },
    [queueSave]
  );

  const bump = (key: string, side: Side, delta: number) => {
    if (!statsEditable) return;
    setTallies((prev) => {
      const current = prev[key];
      let next: TallyValue;
      if (isSplit(current)) {
        const pair = current[half];
        next = { ...current, [half]: { ...pair, [side]: Math.max(0, pair[side] + delta) } };
      } else {
        const pair = current ?? { home: 0, away: 0 };
        next = { ...pair, [side]: Math.max(0, pair[side] + delta) };
      }
      const updated = { ...prev, [key]: next };
      queueSave({ tallies: updated });
      return updated;
    });
  };

  const act = async (fn: () => Promise<MatchStatsSheet>) => {
    setBusy(true);
    setError(null);
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await flush();
      applySheet(await fn());
      clearDraft(matchId);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  /* Mirrors the server's rule so the header score updates the moment a goal is
     tapped, rather than waiting for the next save to come back. */
  const liveScore = useMemo(() => {
    let home = 0;
    let away = 0;
    for (const e of events) {
      const scoring =
        e.type === "own_goal"
          ? e.side === "home"
            ? "away"
            : "home"
          : e.type === "goal" || e.type === "goal_penalty"
            ? e.side
            : null;
      if (scoring === "home") home += 1;
      else if (scoring === "away") away += 1;
    }
    return { home, away };
  }, [events]);

  const totals = useMemo(() => {
    const out: Record<string, SidePair> = {};
    for (const def of sheet?.stats ?? []) out[def.key] = totalOf(tallies[def.key]);
    return out;
  }, [sheet, tallies]);

  /* The stats half toggle follows the match clock: the other half is not in
     play, so it must not be tallyable. */
  const clockHalf: Half = matchClock.half === 2 ? "2nd" : "1st";
  useEffect(() => setHalf(clockHalf), [clockHalf]);

  if (loading) return <div className="mcx-page mcx-page--center">Loading match console…</div>;
  if (!sheet) {
    return (
      <div className="mcx-page mcx-page--center">
        <p className="mcx-error">{error ?? "Match console unavailable."}</p>
        <Link to="/admin/match-stats" className="mcx-backlink">← Back to match statistics</Link>
      </div>
    );
  }

  const { match, audit, eventsAudit, status, eventsStatus } = sheet;
  const halfLengthChoices = match.competition.isTraining
    ? TRAINING_HALF_LENGTH_CHOICES
    : HALF_LENGTH_CHOICES;
  const approved = status === "approved";
  const activeStatus = tab === "stats" ? status : eventsStatus;

  return (
    <div className="mcx-page">
      {/* Everything down to the tab bar stays pinned while the sheet scrolls. */}
      <div className="mcx-sticky">
        <div className="mcx-sticky__bar">
          <Link to="/admin/match-stats" className="mcx-backlink">← All sheets</Link>
          {match.competition.isTraining && <span className="mcx-training">Training</span>}
          <span className={`mcx-status mcx-status--${activeStatus}`}>
            <span className="mcx-status__dot" />
            {STATUS_COPY[activeStatus]}
          </span>
        </div>

        <div className="mcx-fixture mcx-fixture--compact">
          <span className="mcx-fixture__team mcx-fixture__team--home">
            <span className="mcx-dot" style={{ background: kits.home }} />
            {match.homeTeam.name}
          </span>
          {/* Score comes from the logged goal events, so the two can't disagree. */}
          <span className="mcx-score" title="From the goals logged on the Events tab">
            {liveScore.home}<span className="mcx-score__sep">–</span>{liveScore.away}
          </span>
          <span className="mcx-fixture__team mcx-fixture__team--away">
            {match.awayTeam.name}
            <span className="mcx-dot" style={{ background: kits.away }} />
          </span>
        </div>

        {/* Clock and the minute capture sit side by side, always reachable. */}
        <div className="mcx-clockrow">
          <div className="mcx-clockrow__clock">
            <span className="mcx-clock__time">
              {matchClock.started ? mmss(matchClock.displayElapsed) : "--:--"}
            </span>
            <span className="mcx-clock__meta">
              {matchClock.started
                ? `${matchClock.half === 1 ? "1st" : "2nd"} half · ${displayMinute(
                    matchClock.liveMinute,
                    matchClock.liveAdded
                  )}`
                : "Not started"}
            </span>
          </div>

          {matchClock.started ? (
            <button
              type="button"
              className={captured ? "mcx-capture is-set" : "mcx-capture"}
              onClick={() =>
                setCaptured(
                  captured
                    ? null
                    : { minute: matchClock.liveMinute, added: matchClock.liveAdded }
                )
              }
              disabled={!eventsEditable}
            >
              <span className="mcx-capture__value">
                {captured
                  ? displayMinute(captured.minute, captured.added)
                  : displayMinute(matchClock.liveMinute, matchClock.liveAdded)}
              </span>
              <span className="mcx-capture__hint">
                {captured ? "tap to clear" : "tap to log minute"}
              </span>
            </button>
          ) : (
            eventsEditable && (
              <div className="mcx-kickoff mcx-kickoff--inline">
                <div className="mcx-kickoff__choices">
                  {halfLengthChoices.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={n === pendingHalfLength ? "mcx-chip is-active" : "mcx-chip"}
                      onClick={() => {
                        setPendingHalfLength(n);
                        setHalfLengthTouched(true);
                      }}
                    >
                      {n}′
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="mcx-btn mcx-btn--primary"
                  onClick={() => matchClock.kickOff(pendingHalfLength)}
                >
                  Kick Off
                </button>
              </div>
            )
          )}
        </div>

        <div className="mcx-tabs" role="tablist" aria-label="Match sheet sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "stats"}
            className={tab === "stats" ? "mcx-tab is-active" : "mcx-tab"}
            onClick={() => setTab("stats")}
          >
            Statistics
            {status !== "live" && <span className={`mcx-tab__pip mcx-tab__pip--${status}`} />}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "events"}
            className={tab === "events" ? "mcx-tab is-active" : "mcx-tab"}
            onClick={() => setTab("events")}
          >
            Events
            {events.length > 0 && <span className="mcx-tab__count">{events.length}</span>}
            {eventsStatus !== "live" && (
              <span className={`mcx-tab__pip mcx-tab__pip--${eventsStatus}`} />
            )}
          </button>
        </div>

        {/* Steps 2 and 3 stay pinned with the clock: everything needed to log
            an event is reachable while the grid and log scroll beneath. */}
        {tab === "events" && matchClock.started && (
          <div className="mcx-entrybar">
            <div className="mcx-entrybar__sides">
              {(["home", "away"] as Side[]).map((target) => {
                const colour = kits[target];
                const active = side === target;
                const name = target === "home" ? match.homeTeam.name : match.awayTeam.name;
                return (
                  <div className="mcx-sidewrap" key={target}>
                    <button
                      type="button"
                      className={active ? "mcx-sidebtn is-active" : "mcx-sidebtn"}
                      style={
                        active
                          ? { background: colour, color: readableOn(colour), borderColor: colour }
                          : undefined
                      }
                      onClick={() => setSide(target)}
                      /* Step 2 unlocks only once step 1 has captured a minute. */
                      disabled={!eventsEditable || !captured}
                    >
                      <span
                        className={`mcx-step__n mcx-step__n--inline${captured ? "" : " is-locked"}`}
                      >
                        2
                      </span>
                      <span className="mcx-kit" style={{ background: colour }} aria-hidden="true" />
                      <span className="mcx-sidebtn__name">{name}</span>
                    </button>
                    <button
                      type="button"
                      className="mcx-kitedit"
                      onClick={() => setKitPicker(kitPicker === target ? null : target)}
                      disabled={!eventsEditable}
                      aria-label={`Choose ${name} jersey colour`}
                    >
                      Kit
                    </button>
                  </div>
                );
              })}
            </div>

            <label className="mcx-jersey">
              <span
                className={`mcx-step__n mcx-step__n--inline${side ? "" : " is-locked"}`}
              >
                3
              </span>
              <input
                type="number"
                min={1}
                max={99}
                inputMode="numeric"
                placeholder="No."
                value={playerNumber}
                onChange={(e) => setPlayerNumber(e.target.value)}
                /* Step 3 unlocks only once a side is chosen. */
                disabled={!eventsEditable || !captured || !side}
                aria-label="Jersey number"
              />
            </label>

            {kitPicker && (
              <div className="mcx-kitpicker">
                <span className="mcx-kitpicker__label">
                  {kitPicker === "home" ? match.homeTeam.name : match.awayTeam.name} jersey colour
                </span>
                <div className="mcx-kitpicker__row">
                  {KIT_SWATCHES.map((colour) => (
                    <button
                      key={colour}
                      type="button"
                      className={kits[kitPicker] === colour ? "mcx-swatch is-active" : "mcx-swatch"}
                      style={{ background: colour }}
                      onClick={() => {
                        handleEventsChange({ kits: { ...kits, [kitPicker]: colour } });
                        setKitPicker(null);
                      }}
                      aria-label={`Set kit to ${colour}`}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <span className={`mcx-savestate mcx-savestate--${online ? saveState : "offline"}`}>
          {!online && "Offline — saved on this device, will sync automatically"}
          {online && saveState === "saving" && "Saving…"}
          {online && saveState === "saved" && "All changes saved"}
          {online && saveState === "pending" && "Saved on this device — retrying sync…"}
        </span>
      </div>

      {error && <p className="mcx-error" role="alert">{error}</p>}

      {(status !== "live" || eventsStatus !== "live") && (
        <Link to={`/admin/match-stats/${matchId}/preview`} className="mcx-previewlink">
          View match summary — screenshot it for your records →
        </Link>
      )}

      {tab === "stats" ? (
        <>
          {audit.sentBackNote && status === "live" && (
            <div className="mcx-callout mcx-callout--warn">
              <strong>Sent back by {audit.sentBackByName ?? "a supervisor"}:</strong>{" "}
              {audit.sentBackNote}
            </div>
          )}

          {approved ? (
            <section className="mcx-card">
              <div className="mcx-card__head">
                <h2>Match statistics</h2>
                <span className="mcx-approved-flag">Approved · live on the public site</span>
              </div>
              {sheet.stats.map((def) => (
                <StatBar
                  key={def.key}
                  label={def.label}
                  home={totals[def.key]?.home ?? 0}
                  away={totals[def.key]?.away ?? 0}
                />
              ))}
            </section>
          ) : (
            <>
              <div className="mcx-halves" role="group" aria-label="Half being recorded">
                {HALVES.map((h) => {
                  // Locked to the clock: the other half is not in play.
                  const allowed = h === clockHalf;
                  return (
                    <button
                      key={h}
                      type="button"
                      className={h === half ? "mcx-half is-active" : "mcx-half"}
                      onClick={() => setHalf(h)}
                      disabled={!allowed}
                      title={allowed ? undefined : `The ${h} half is not in play`}
                    >
                      {h} half
                    </button>
                  );
                })}
              </div>

              <section className="mcx-sheet">
                {sheet.stats.map((def) => {
                  const pair = pairOf(tallies[def.key], half);
                  const total = totals[def.key] ?? { home: 0, away: 0 };
                  return (
                    <div key={def.key} className="mcx-row">
                      <div className="mcx-row__label">
                        {def.label}
                        {def.split && <span className="mcx-row__half">{half} half</span>}
                      </div>
                      <div className="mcx-row__counters">
                        <div className="mcx-row__side">
                          <Counter
                            value={pair.home}
                            side="home"
                            disabled={!statsEditable}
                            onBump={(d) => bump(def.key, "home", d)}
                            label={`${def.label}, ${match.homeTeam.name}`}
                          />
                          {def.split && <span className="mcx-row__total">match total {total.home}</span>}
                        </div>
                        <div className="mcx-row__side mcx-row__side--away">
                          <Counter
                            value={pair.away}
                            side="away"
                            disabled={!statsEditable}
                            onBump={(d) => bump(def.key, "away", d)}
                            label={`${def.label}, ${match.awayTeam.name}`}
                          />
                          {def.split && <span className="mcx-row__total">match total {total.away}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </section>
            </>
          )}

          {statsPerms && (
            <SectionActions
              section="stats"
              status={status}
              permissions={statsPerms}
              audit={audit}
              busy={busy}
              onSubmit={() => act(() => matchStatsApi.submit(matchId, "stats"))}
              onApprove={() => act(() => matchStatsApi.approve(matchId, "stats"))}
              onSendBack={(note) => act(() => matchStatsApi.sendBack(matchId, "stats", note))}
            />
          )}
        </>
      ) : (
        <>
          {eventsAudit.sentBackNote && eventsStatus === "live" && (
            <div className="mcx-callout mcx-callout--warn">
              <strong>Sent back by {eventsAudit.sentBackByName ?? "a supervisor"}:</strong>{" "}
              {eventsAudit.sentBackNote}
            </div>
          )}

          <MatchEventsTab
            sheet={sheet}
            editable={eventsEditable}
            events={events}
            kits={kits}
            captured={captured}
            side={side}
            playerNumber={playerNumber}
            onCapturedUsed={() => {
              // Reset the whole entry: the next event starts at step 1 with no
              // side pre-selected, so a side is never inherited by accident.
              setCaptured(null);
              setSide(null);
              setPlayerNumber("");
            }}
            clock={matchClock}
            addedInput={addedInput}
            onAddedInputChange={setAddedInput}
            onChange={handleEventsChange}
            homeName={match.homeTeam.name}
            awayName={match.awayTeam.name}
          />

          {eventsPerms && (
            <SectionActions
              section="events"
              status={eventsStatus}
              permissions={eventsPerms}
              audit={eventsAudit}
              busy={busy}
              onSubmit={() => act(() => matchStatsApi.submit(matchId, "events"))}
              onApprove={() => act(() => matchStatsApi.approve(matchId, "events"))}
              onSendBack={(note) => act(() => matchStatsApi.sendBack(matchId, "events", note))}
            />
          )}
        </>
      )}

      <dl className="mcx-audit">
        {audit.recorderName && (
          <div><dt>Recorded by</dt><dd>{audit.recorderName}</dd></div>
        )}
        <div><dt>Statistics</dt><dd>{STATUS_COPY[status]}</dd></div>
        <div><dt>Event log</dt><dd>{STATUS_COPY[eventsStatus]}</dd></div>
      </dl>
    </div>
  );
}
