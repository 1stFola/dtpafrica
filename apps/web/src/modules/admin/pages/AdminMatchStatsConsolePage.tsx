import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type SheetLogEntry,
  type SheetStatus,
  type SidePair,
  type Side,
  type SplitTally,
  type TallyValue,
} from "../../../api/adminMatchStats";
import { MatchEventsTab } from "./MatchEventsTab";
import { capturedFromEvents } from "./eventStatCapture";
import { MatchSheetHistory, latestActionBanner } from "./MatchSheetHistory";
import { EventTimeline } from "../../scoreboard/components/EventTimeline";
import { MatchStatsBars } from "../../scoreboard/components/MatchStatsBars";
import { clearDraft, draftIsAhead, markSynced, readDraft, writeDraft } from "./matchSheetDraft";
import {
  HALF_LENGTH_CHOICES,
  TRAINING_HALF_LENGTH_CHOICES,
  displayMinute,
  mmss,
  useMatchClock,
} from "./useMatchClock";
import { usePageTitle } from "../../../hooks/usePageTitle";
import {
  EVENT_LABELS,
  type SbMatchEvent,
  type SbMatchStats,
  type SbTeamRef,
} from "../../../api/scoreboard";

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

type TrainingPreviewTab = "timeline" | "statistics";

function teamRef(team: MatchStatsSheet["match"]["homeTeam"]): SbTeamRef {
  return {
    id: team.id,
    name: team.name,
    shortName: team.shortName,
    logoUrl: team.logoUrl,
  };
}

function playerLookupKey(teamId: string, jerseyNumber: number | null): string | null {
  return jerseyNumber ? `${teamId}:${jerseyNumber}` : null;
}

function matchSquadLookup(match: MatchStatsSheet["match"]) {
  return new Map(
    (match.squadPlayers ?? [])
      .filter((player) => player.jerseyNumber != null)
      .map((player) => [`${player.teamId}:${player.jerseyNumber}`, player])
  );
}

function playerLabelForNumber(
  match: MatchStatsSheet["match"],
  teamId: string,
  jerseyNumber: number | null
): string | null {
  const key = playerLookupKey(teamId, jerseyNumber);
  const player = key ? matchSquadLookup(match).get(key) : undefined;
  if (player?.playerName && jerseyNumber) return `No. ${jerseyNumber} ${player.playerName}`;
  if (player?.playerName) return player.playerName;
  return jerseyNumber ? `No. ${jerseyNumber}` : null;
}

function formatEventMinute(minute: number, addedMinute: number | null): string {
  return addedMinute && addedMinute > 0 ? `${minute}+${addedMinute}'` : `${minute}'`;
}

function eventActor(teamName: string, playerLabel: string | null): string {
  return playerLabel ? `${teamName} ${playerLabel}` : teamName;
}

function previewEventComment(
  event: RecordedEvent,
  team: MatchStatsSheet["match"]["homeTeam"],
  opponent: MatchStatsSheet["match"]["awayTeam"],
  primary: string | null,
  secondary: string | null
): string {
  const teamName = team.name;
  const opponentName = opponent.name;
  const actor = eventActor(teamName, primary);
  const prefix = formatEventMinute(event.minute, event.addedMinute);

  const body = (() => {
    switch (event.type) {
      case "kick_off":
        return `Kick-Off! ${teamName} get the match underway against ${opponentName}.`;
      case "yellow_card":
        return `Yellow Card! ${actor} goes into the book after the referee signals a caution.`;
      case "red_card":
        return `Red Card! ${actor} is sent off, leaving ${teamName} to finish with fewer players.`;
      case "foul":
        return `Foul Committed! ${actor} concedes a free-kick and ${opponentName} can reset play.`;
      case "goal":
        return secondary
          ? `GOAL! ${teamName.toUpperCase()} - ${primary ?? "the striker"} finds the back of the net, set up by ${secondary}.`
          : `GOAL! ${teamName.toUpperCase()} - ${primary ?? "the striker"} finds the back of the net.`;
      case "goal_penalty":
        return `GOAL! ${teamName.toUpperCase()} - ${primary ?? "the taker"} converts from the penalty spot.`;
      case "substitution":
        if (primary && secondary) return `Substitution! ${teamName} bring on ${secondary} for ${primary}.`;
        if (secondary) return `Substitution! ${teamName} bring on ${secondary}.`;
        if (primary) return `Substitution! ${teamName} withdraw ${primary}.`;
        return `Substitution! ${teamName} make a change.`;
      case "save":
        return `Save! ${actor} makes an important stop to deny ${opponentName}.`;
      case "shot":
        return `Shot On Target! ${actor} tests the goalkeeper with an effort on goal.`;
      case "shot_off_target":
        return `Shot Off Target! ${actor} sends the effort wide.`;
      case "corner_kick":
        return `Corner Kick! ${actor} delivers the set piece.`;
      case "freekick":
        return `Free-Kick! ${actor} takes the resulting set piece.`;
      case "offside":
        return `Offside! ${teamName} are caught beyond the ${opponentName} defensive line.`;
      case "full_time":
        return `Full-Time! The referee ends the match between ${teamName} and ${opponentName}.`;
      case "penalty_shootout":
        return `Penalty Shootout! The match goes to spot-kicks between ${teamName} and ${opponentName}.`;
      case "shootout_goal":
        return `Penalty Scored! ${actor} converts from the spot for ${teamName}.`;
      case "shootout_miss":
        return `Penalty Missed! ${actor} cannot convert for ${teamName}.`;
      default: {
        const label = EVENT_LABELS[event.type] ?? event.type.replace(/_/g, " ");
        return `${label}! ${actor}.`;
      }
    }
  })();

  return `${prefix} - ${body}`;
}

function previewEvents(
  events: RecordedEvent[],
  match: MatchStatsSheet["match"]
): SbMatchEvent[] {
  return events.map((event, index) => {
    const team = event.side === "home" ? match.homeTeam : match.awayTeam;
    const opponent = event.side === "home" ? match.awayTeam : match.homeTeam;
    const primary = playerLabelForNumber(match, team.id, event.playerNumber);
    const secondary = playerLabelForNumber(match, team.id, event.secondaryPlayerNumber);
    return {
      id: `training-live-${event.id}`,
      type: event.type,
      minute: event.minute,
      teamId: team.id,
      playerId: null,
      playerLabel: primary,
      playerLabel2: secondary,
      assistPlayerId: null,
      assistLabel: event.type === "goal" ? secondary : null,
      detail: previewEventComment(event, team, opponent, primary, secondary),
      metadata: {
        source: "training_live_preview",
        addedMinute: event.addedMinute,
        half: event.half,
        recorderSequence: index,
      },
    };
  });
}

function TrainingLivePreviewModal({
  sheet,
  totals,
  score,
  events,
  onClose,
}: {
  sheet: MatchStatsSheet;
  totals: Record<string, SidePair>;
  score: { home: number; away: number };
  events: RecordedEvent[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TrainingPreviewTab>("timeline");
  const stats: SbMatchStats = { ...totals, goals: score };
  const homeTeam = teamRef(sheet.match.homeTeam);
  const awayTeam = teamRef(sheet.match.awayTeam);
  const timeline = previewEvents(events, sheet.match);

  return (
    <div className="mcx-live-preview" role="dialog" aria-modal="true" aria-label="Training live preview">
      <button type="button" className="mcx-live-preview__scrim" onClick={onClose} aria-label="Close preview" />
      <section className="mcx-live-preview__panel">
        <header className="mcx-live-preview__head">
          <div>
            <span className="mcx-live-preview__kicker">
              <span className="mcx-live-dot" />
              Training live view
            </span>
            <h2>
              {sheet.match.homeTeam.name} {score.home}-{score.away} {sheet.match.awayTeam.name}
            </h2>
            <p>Preview of the live timeline and statistics from this practice sheet.</p>
          </div>
          <button type="button" className="mcx-live-preview__close" onClick={onClose} aria-label="Close preview">
            ×
          </button>
        </header>
        <div className="mcx-live-preview__tabs" role="tablist" aria-label="Training live preview sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "timeline"}
            className={tab === "timeline" ? "is-active" : undefined}
            onClick={() => setTab("timeline")}
          >
            Timeline <span>{timeline.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "statistics"}
            className={tab === "statistics" ? "is-active" : undefined}
            onClick={() => setTab("statistics")}
          >
            Statistics
          </button>
        </div>
        <TrainingLiveAudioPreview />
        <div className="mcx-live-preview__body">
          {tab === "timeline" ? (
            <EventTimeline
              events={timeline}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              competition={sheet.match.competition.name}
              order="latest"
            />
          ) : (
            <div className="sbm-stats-card sbm-stats-card--live">
              <MatchStatsBars stats={stats} homeTeam={homeTeam} awayTeam={awayTeam} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read audio chunk"));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      resolve(value.split(",", 2)[1] ?? "");
    };
    reader.readAsDataURL(blob);
  });
}

function liveAudioSocketUrl(path: string): string {
  const url = new URL(path, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function playTrainingAudioSample(onDone: () => void): () => void {
  const text =
    "Live audio preview. The recorder's voice would stream here during the match, without being saved after full time.";
  let completed = false;
  let timeout: number | null = null;
  const done = () => {
    if (completed) return;
    completed = true;
    if (timeout != null) window.clearTimeout(timeout);
    timeout = null;
    onDone();
  };
  timeout = window.setTimeout(done, 6500);

  if ("speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined") {
    window.speechSynthesis.cancel();
    const sample = new SpeechSynthesisUtterance(text);
    sample.rate = 0.95;
    sample.pitch = 0.92;
    sample.volume = 0.9;
    sample.onend = done;
    sample.onerror = done;
    window.speechSynthesis.speak(sample);
    return () => {
      window.speechSynthesis.cancel();
      done();
    };
  }

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    done();
    return () => undefined;
  }
  const ctx = new Ctor();
  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.5);
  gain.connect(ctx.destination);
  [220, 277, 330, 392].forEach((freq, index) => {
    const tone = ctx.createOscillator();
    tone.type = "sine";
    tone.frequency.setValueAtTime(freq, now + index * 0.45);
    tone.connect(gain);
    tone.start(now + index * 0.45);
    tone.stop(now + 3.5);
  });
  timeout = window.setTimeout(() => {
    void ctx.close();
    done();
  }, 3600);
  return () => {
    void ctx.close();
    done();
  };
}

function TrainingLiveAudioPreview() {
  const [playing, setPlaying] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setPlaying(false);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const toggle = () => {
    if (playing) {
      stop();
      return;
    }
    setPlaying(true);
    stopRef.current = playTrainingAudioSample(() => {
      stopRef.current = null;
      setPlaying(false);
    });
  };

  return (
    <div className="mcx-training-audio-preview">
      <button
        type="button"
        className={playing ? "sbm-live-audio__btn is-listening" : "sbm-live-audio__btn"}
        onClick={toggle}
      >
        <span className={playing ? "sbm-live-dot" : "sbm-live-audio__idle"} aria-hidden="true" />
        {playing ? "Stop sample" : "Listen live audio"}
      </button>
      <span className="mcx-training-audio-preview__note">
        This is how the public live audio control appears on match day.
      </span>
    </div>
  );
}

function LiveAudioCommentaryControl({
  matchId,
  disabled,
  trainingPreview = false,
}: {
  matchId: string;
  disabled: boolean;
  trainingPreview?: boolean;
}) {
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const pendingChunksRef = useRef(0);
  const stopAfterFlushRef = useRef(false);
  const sampleStopRef = useRef<(() => void) | null>(null);

  const closeSocket = useCallback(() => {
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "stop" }));
      socket.close(1000, "Recorder stopped live audio");
    } else {
      socket?.close();
    }
  }, []);

  const finishStop = useCallback(() => {
    if (pendingChunksRef.current === 0) closeSocket();
  }, [closeSocket]);

  const stop = useCallback(() => {
    sampleStopRef.current?.();
    sampleStopRef.current = null;
    stopAfterFlushRef.current = true;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.requestData();
      } catch {
        /* Some browsers throw if no chunk is currently buffered. */
      }
      recorder.stop();
      window.setTimeout(finishStop, 1000);
    } else {
      finishStop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setActive(false);
  }, [finishStop]);

  useEffect(() => () => void stop(), [stop]);

  useEffect(() => {
    if (disabled && active) void stop();
  }, [active, disabled, stop]);

  const start = async () => {
    if (trainingPreview) {
      setMessage("Playing a short public live audio sample.");
      setActive(true);
      sampleStopRef.current = playTrainingAudioSample(() => {
        sampleStopRef.current = null;
        setActive(false);
        setMessage(null);
      });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMessage("Live audio is not supported in this browser.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = preferredType
        ? new MediaRecorder(stream, { mimeType: preferredType })
        : new MediaRecorder(stream);
      const mimeType = recorder.mimeType || preferredType || "audio/webm";
      const ticket = await matchStatsApi.createLiveAudioTicket(matchId);
      const socket = new WebSocket(liveAudioSocketUrl(ticket.wsPath));
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new Error("Could not connect live audio stream."));
        socket.onclose = (event) => {
          if (!event.wasClean) reject(new Error(event.reason || "Live audio stream closed."));
        };
      });
      socket.send(JSON.stringify({ type: "start", mimeType }));
      socket.onclose = () => {
        setActive(false);
        recorderRef.current?.stop();
        recorderRef.current = null;
      };
      socketRef.current = socket;
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (!event.data.size || socket.readyState !== WebSocket.OPEN) return;
        pendingChunksRef.current += 1;
        void blobToBase64(event.data)
          .then((data) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "chunk", mimeType, data }));
            }
          })
          .catch(() => setMessage("Audio stream is having trouble sending."))
          .finally(() => {
            pendingChunksRef.current = Math.max(0, pendingChunksRef.current - 1);
            if (stopAfterFlushRef.current) finishStop();
          });
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (stopAfterFlushRef.current) finishStop();
      };
      recorder.start(700);
      stopAfterFlushRef.current = false;
      setActive(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start live audio.");
      setActive(false);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      socketRef.current?.close();
      socketRef.current = null;
      pendingChunksRef.current = 0;
      stopAfterFlushRef.current = false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mcx-audio-live">
      <button
        type="button"
        className={active ? "mcx-audio-live__btn is-active" : "mcx-audio-live__btn"}
        disabled={disabled || busy}
        onClick={() => (active ? void stop() : void start())}
      >
        <span className="mcx-live-dot" aria-hidden="true" />
        {active ? "Stop live audio" : "Live audio"}
      </button>
      {message && <span className="mcx-audio-live__msg">{message}</span>}
    </div>
  );
}

/** Submit / approve / send-back controls for one track. */
/**
 * Submit, approve and send-back for the whole sheet.
 *
 * One set of controls rather than one per tab: the event log feeds the
 * statistics, so the two are signed off as a single record.
 */
function SheetActions({
  status,
  permissions,
  audit,
  busy,
  onSubmit,
  onApprove,
  onSendBack,
}: {
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

  return (
    <footer className="mcx-actions">
      {permissions.canSubmit && status === "live" && (
        <button type="button" className="mcx-btn mcx-btn--primary" disabled={busy} onClick={onSubmit}>
          Submit statistics &amp; events for approval
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
          {audit.approvedAt ? ` · ${new Date(audit.approvedAt).toLocaleString()}` : ""}. Final
          statistics are published.
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
  const [history, setHistory] = useState<SheetLogEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showTrainingLive, setShowTrainingLive] = useState(false);
  const [correctionNote, setCorrectionNote] = useState("");
  const [askCorrection, setAskCorrection] = useState(false);
  /* Entry controls live here rather than in the Events tab so they can sit in
     the frozen header — they are needed constantly while the grid scrolls. */
  const [side, setSide] = useState<Side | null>(null);
  const [playerNumber, setPlayerNumber] = useState("");
  const [kitPicker, setKitPicker] = useState<Side | null>(null);
  const [showKickoffStarter, setShowKickoffStarter] = useState(false);
  const [kickoffSide, setKickoffSide] = useState<Side | null>(null);
  const [kickoffNumber, setKickoffNumber] = useState("");

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

  const loadHistory = useCallback(() => {
    if (!matchId) return;
    matchStatsApi
      .history(matchId)
      .then(setHistory)
      .catch(() => {
        /* History is supporting detail: failing to load it must not take the
           console down mid-match. */
      });
  }, [matchId]);

  useEffect(() => loadHistory(), [loadHistory]);

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

  const perms = sheet?.permissions;
  /* One permission set for the whole sheet — statistics and events are
     submitted and approved together, so they lock and unlock together too. */
  const editable = Boolean(perms?.canEdit);

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

  const openKickoffStarter = () => {
    setKickoffSide(side);
    setKickoffNumber(playerNumber);
    setShowKickoffStarter(true);
  };

  const confirmKickoffStarter = () => {
    if (!kickoffSide) {
      setError("Choose the team that played the kick-off.");
      return;
    }
    const jersey = Number(kickoffNumber);
    if (!Number.isFinite(jersey) || jersey < 1 || jersey > 99) {
      setError("Enter the jersey number of the player who played the kick-off.");
      return;
    }
    const nextKickoff: RecordedEvent = {
      id: `kick_off-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: "kick_off",
      minute: 0,
      addedMinute: null,
      side: kickoffSide,
      playerNumber: Math.floor(jersey),
      secondaryPlayerNumber: null,
      half: 1,
    };
    const nextEvents = [...events.filter((event) => event.type !== "kick_off"), nextKickoff];
    setError(null);
    setShowKickoffStarter(false);
    setCaptured(null);
    setSide(null);
    setPlayerNumber("");
    setTab("events");
    matchClock.kickOff(pendingHalfLength);
    handleEventsChange({ events: nextEvents });
  };

  const bump = (key: string, side: Side, delta: number) => {
    if (!editable) return;
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
      loadHistory();
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

  const splitKeys = useMemo(
    () => new Set((sheet?.stats ?? []).filter((d) => d.split).map((d) => d.key)),
    [sheet]
  );

  /* Recomputed from the events held here rather than read from the sheet, so a
     tap on the Events tab moves these counters before the save lands. */
  const capturedStats = useMemo(
    () => capturedFromEvents(sheet?.eventCapture ?? {}, events, splitKeys),
    [sheet, events, splitKeys]
  );
  const playerLabelsByKey = useMemo(() => {
    if (!sheet) return new Map<string, string>();
    return new Map(
      (sheet.match.squadPlayers ?? [])
        .filter((player) => player.jerseyNumber != null)
        .map((player) => [
          `${player.teamId}:${player.jerseyNumber}`,
          `No. ${player.jerseyNumber} ${player.playerName}`,
        ])
    );
  }, [sheet]);

  const totals = useMemo(() => {
    const out: Record<string, SidePair> = {};
    for (const def of sheet?.stats ?? []) {
      const manual = totalOf(tallies[def.key]);
      const auto = totalOf(capturedStats[def.key]);
      out[def.key] = { home: manual.home + auto.home, away: manual.away + auto.away };
    }
    /* Total shots is derived, never tapped: on target plus off target. */
    const on = out.shotsOnTarget ?? { home: 0, away: 0 };
    const off = out.shotsOffTarget ?? { home: 0, away: 0 };
    out.shots = { home: on.home + off.home, away: on.away + off.away };
    return out;
  }, [sheet, tallies, capturedStats]);

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

  const { match, audit, status } = sheet;
  const banner = latestActionBanner(history);
  const halfLengthChoices = match.competition.isTraining
    ? TRAINING_HALF_LENGTH_CHOICES
    : HALF_LENGTH_CHOICES;
  const approved = status === "approved";
  const activeStatus = status;
  const liveFeatureEnabled = Boolean(match.liveFeature?.enabled);

  return (
    <div className="mcx-page">
      {/* Everything down to the tab bar stays pinned while the sheet scrolls. */}
      <div className="mcx-sticky">
        <div className="mcx-sticky__bar">
          <Link to="/admin/match-stats" className="mcx-backlink">← Back</Link>
          {match.competition.isTraining && <span className="mcx-training">Training</span>}
          {match.competition.isTraining && (
            <button
              type="button"
              className="mcx-live-link"
              onClick={() => setShowTrainingLive(true)}
            >
              View Live
            </button>
          )}
          <span className={liveFeatureEnabled ? "mcx-live-indicator is-on" : "mcx-live-indicator"}>
            <span className="mcx-live-dot" />
            {liveFeatureEnabled ? "Public live approved" : "Public live off"}
          </span>
          <LiveAudioCommentaryControl
            matchId={matchId}
            disabled={
              !editable ||
              matchClock.phase === "finished" ||
              (!match.competition.isTraining && !liveFeatureEnabled)
            }
            trainingPreview={Boolean(match.competition.isTraining)}
          />
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
              disabled={!editable}
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
            editable && (
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
                  onClick={openKickoffStarter}
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
            {status !== "live" && (
              <span className={`mcx-tab__pip mcx-tab__pip--${status}`} />
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
                      disabled={!editable}
                    >
                      <span
                        className={`mcx-step__n mcx-step__n--inline${side ? "" : " is-locked"}`}
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
                      disabled={!editable}
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
                className={`mcx-step__n mcx-step__n--inline${
                  side && playerNumber.trim() !== "" ? "" : " is-locked"
                }`}
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
                disabled={!editable || !side}
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

      {/* The banner always reflects the most recent action, not a stale note. */}
      {banner && (
        <div className={`mcx-banner mcx-banner--${banner.tone}`}>
          <span className="mcx-banner__text">{banner.text}</span>
          {banner.note && <span className="mcx-banner__note">“{banner.note}”</span>}
        </div>
      )}

      {sheet.lockedAtFullTime && (
        <div className="mcx-callout mcx-callout--warn">
          <strong>Locked at full time.</strong> This record can no longer be edited.
          {sheet.correctionRequest
            ? " A correction request is with the ScoreBoard admin."
            : " Request a correction if something needs changing."}
        </div>
      )}

      {/* Recorder: ask for a locked record back. */}
      {sheet.lockedAtFullTime &&
        !sheet.correctionRequest &&
        (perms?.canRecord ?? false) && (
          <div className="mcx-review">
            {askCorrection && (
              <textarea
                className="mcx-note"
                value={correctionNote}
                onChange={(e) => setCorrectionNote(e.target.value)}
                placeholder="What needs correcting? (shown to the admin)"
                rows={2}
                maxLength={500}
              />
            )}
            <button
              type="button"
              className="mcx-btn"
              disabled={busy}
              onClick={() =>
                askCorrection
                  ? act(() =>
                      matchStatsApi.requestCorrection(matchId, correctionNote)
                    ).then(() => {
                      setAskCorrection(false);
                      setCorrectionNote("");
                    })
                  : setAskCorrection(true)
              }
            >
              {askCorrection ? "Send correction request" : "Request a correction"}
            </button>
          </div>
        )}

      {/* Admin: decide on a pending request. Approving is a send-back. */}
      {sheet.correctionRequest && (perms?.canApprove ?? false) && (
        <div className="mcx-callout mcx-callout--warn">
          <strong>
            Correction requested by {sheet.correctionRequest.byName ?? "the recorder"}
          </strong>
          {sheet.correctionRequest.note ? ` — “${sheet.correctionRequest.note}”` : ""}
          <div className="mcx-review__buttons">
            <button
              type="button"
              className="mcx-btn"
              disabled={busy}
              onClick={() => act(() => matchStatsApi.declineCorrection(matchId))}
            >
              Decline
            </button>
            <button
              type="button"
              className="mcx-btn mcx-btn--approve"
              disabled={busy}
              onClick={() =>
                act(() =>
                  matchStatsApi.sendBack(matchId, "Correction approved")
                )
              }
            >
              Approve &amp; reopen
            </button>
          </div>
        </div>
      )}

      {status !== "live" && (
        <Link to={`/admin/match-stats/${matchId}/preview`} className="mcx-previewlink">
          View match summary — screenshot it for your records →
        </Link>
      )}

      {tab === "stats" ? (
        <>
          {approved ? (
            <section className="mcx-card">
              <div className="mcx-card__head">
                <h2>Match statistics</h2>
                <span className="mcx-approved-flag">Approved · live on the public site</span>
              </div>
              {/* Display list, so the derived Total shots appears here even
                  though it is never tapped. */}
              {sheet.displayStats.map((def) => (
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
                {sheet.stats.map((def, index) => {
                  const pair = pairOf(tallies[def.key], half);
                  const total = totals[def.key] ?? { home: 0, away: 0 };
                  /* Split stats tally per half, so the chip shows this half's
                     contribution beside the counter it belongs to. */
                  const auto = def.split
                    ? pairOf(capturedStats[def.key], half)
                    : totalOf(capturedStats[def.key]);
                  /* The stats arrive manual-first; this is where that changes. */
                  const opensAutoGroup =
                    def.autoCaptured && !sheet.stats[index - 1]?.autoCaptured;

                  return (
                    <Fragment key={def.key}>
                      {opensAutoGroup && (
                        <p className="mcx-sheet__divider">
                          Filled in from the event log
                          <span>
                            Tap these in the Events tab and they count here automatically. The
                            counters stay open for anything the log does not cover.
                          </span>
                        </p>
                      )}
                      <div className={`mcx-row${def.autoCaptured ? " mcx-row--auto" : ""}`}>
                        <div className="mcx-row__label">
                          {def.label}
                          {def.split && <span className="mcx-row__half">{half} half</span>}
                        </div>
                        <div className="mcx-row__counters">
                          <div className="mcx-row__side">
                            <Counter
                              value={pair.home}
                              side="home"
                              disabled={!editable}
                              onBump={(d) => bump(def.key, "home", d)}
                              label={`${def.label}, ${match.homeTeam.name}`}
                            />
                            {auto.home > 0 && (
                              <span className="mcx-row__auto">+{auto.home} from events</span>
                            )}
                            {def.split && (
                              <span className="mcx-row__total">match total {total.home}</span>
                            )}
                          </div>
                          <div className="mcx-row__side mcx-row__side--away">
                            <Counter
                              value={pair.away}
                              side="away"
                              disabled={!editable}
                              onBump={(d) => bump(def.key, "away", d)}
                              label={`${def.label}, ${match.awayTeam.name}`}
                            />
                            {auto.away > 0 && (
                              <span className="mcx-row__auto">+{auto.away} from events</span>
                            )}
                            {def.split && (
                              <span className="mcx-row__total">match total {total.away}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Fragment>
                  );
                })}
              </section>
            </>
          )}

        </>
      ) : (
        <>
          <MatchEventsTab
            sheet={sheet}
            editable={editable}
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
            playerLabelsByKey={playerLabelsByKey}
          />
        </>
      )}

      {/* One set of actions for the sheet, below whichever tab is open. */}
      {perms && (
        <SheetActions
          status={status}
          permissions={perms}
          audit={audit}
          busy={busy}
          onSubmit={() => act(() => matchStatsApi.submit(matchId))}
          onApprove={() => act(() => matchStatsApi.approve(matchId))}
          onSendBack={(note) => act(() => matchStatsApi.sendBack(matchId, note))}
        />
      )}

      <section className="mcx-historywrap">
        <button
          type="button"
          className="mcx-historytoggle"
          onClick={() => setShowHistory((v) => !v)}
          aria-expanded={showHistory}
        >
          {showHistory ? "Hide" : "Show"} submission history
          {history.length > 0 && <span className="mcx-log__count">{history.length}</span>}
        </button>
        {showHistory && <MatchSheetHistory entries={history} />}
      </section>

      <dl className="mcx-audit">
        {audit.recorderName && (
          <div><dt>Recorded by</dt><dd>{audit.recorderName}</dd></div>
        )}
        <div><dt>Statistics &amp; events</dt><dd>{STATUS_COPY[status]}</dd></div>
      </dl>

      {showKickoffStarter && (
        <div className="mcx-prompt" role="dialog" aria-modal="true">
          <div className="mcx-prompt__card mcx-prompt__card--wide mcx-kickoff-prompt">
            <h3>Kick Off</h3>
            <p className="muted">
              Select the team and jersey number of the player who starts the game.
            </p>
            <div className="mcx-entrybar__sides">
              {(["home", "away"] as Side[]).map((target) => {
                const colour = kits[target];
                const active = kickoffSide === target;
                const name = target === "home" ? match.homeTeam.name : match.awayTeam.name;
                return (
                  <button
                    key={target}
                    type="button"
                    className={active ? "mcx-sidebtn is-active" : "mcx-sidebtn"}
                    style={
                      active
                        ? { background: colour, color: readableOn(colour), borderColor: colour }
                        : undefined
                    }
                    onClick={() => setKickoffSide(target)}
                  >
                    <span className="mcx-kit" style={{ background: colour }} aria-hidden="true" />
                    <span className="mcx-sidebtn__name">{name}</span>
                  </button>
                );
              })}
            </div>
            <label className="mcx-prompt__label">
              <span>Starter jersey number</span>
              <input
                type="number"
                min={1}
                max={99}
                inputMode="numeric"
                value={kickoffNumber}
                onChange={(event) => setKickoffNumber(event.target.value)}
                autoFocus
              />
            </label>
            <div className="mcx-prompt__actions">
              <button
                type="button"
                className="mcx-prompt__cancel"
                onClick={() => setShowKickoffStarter(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="mcx-btn mcx-btn--primary"
                onClick={confirmKickoffStarter}
              >
                Start match
              </button>
            </div>
          </div>
        </div>
      )}

      {showTrainingLive && (
        <TrainingLivePreviewModal
          sheet={sheet}
          totals={totals}
          score={liveScore}
          events={events}
          onClose={() => setShowTrainingLive(false)}
        />
      )}
    </div>
  );
}
