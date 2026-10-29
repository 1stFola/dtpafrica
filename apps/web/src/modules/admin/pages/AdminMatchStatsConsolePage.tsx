import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  buildNumberLookup,
  type NumberResolution,
} from "@dtp/engines/squad-number-lookup";
import {
  matchStatsApi,
  type ClockState,
  type Half,
  type KitColours,
  type MatchStatsSheet,
  type RecordedEvent,
  type SectionAudit,
  type AutoApproval,
  type AutoApproveBlock,
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
import {
  OFFICIAL_EVENT_TYPES,
  teamOfficialPhrase,
} from "@dtp/engines/team-officials";
import { capturedFromEvents } from "./eventStatCapture";
import { MatchSheetHistory, latestActionBanner } from "./MatchSheetHistory";
import { EventTimeline } from "../../scoreboard/components/EventTimeline";
import { MatchStatsBars } from "../../scoreboard/components/MatchStatsBars";
import {
  clearDraft,
  draftIsAhead,
  eventsNotOnServer,
  markSynced,
  pruneStoredSheets,
  readDraft,
  readServerCopy,
  removedSince,
  writeDraft,
  writeServerCopy,
} from "./matchSheetDraft";
import { isNetworkFailure } from "../../../api/admin";
import {
  HALF_LENGTH_CHOICES,
  TRAINING_HALF_LENGTH_CHOICES,
  displayMinute,
  mmss,
  useMatchClock,
} from "./useMatchClock";
import { checkTypedMinute } from "./correctionMinute";
import {
  UnregisteredNumberPrompt,
  findUnregistered,
  parseJersey,
  type NumberToCheck,
  type UnregisteredNumber,
} from "./unregisteredNumber";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { formatQuiet } from "../components/StoppedRecordingsPanel";
import {
  EVENT_LABELS,
  type SbMatchEvent,
  type SbMatchStats,
  type SbTeamRef,
} from "../../../api/scoreboard";
import { liveAudioSocketUrl } from "../../../api/liveAudio";

const HALVES: Half[] = ["1st", "2nd"];

/* Tapping must feel instant pitch-side, so counts update locally and the sheet
   is flushed to the API on a short debounce rather than per tap. */
const AUTOSAVE_DELAY_MS = 700;
/* How often to retry a failed sync while the network is down. */
const RETRY_DELAY_MS = 8000;
/* How often to try again when the server answered and refused -- a locked sheet. Each try
   is cheap, and the first one after an admin lifts the lock sends everything. */
const REFUSED_RETRY_MS = 30_000;
const LIVE_AUDIO_CHUNK_MS = 700;

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

/**
 * Shirt number -> player, through the API's own lookup (`buildNumberLookup` in
 * `@dtp/engines`), so the recorder sees exactly the name that will be published.
 *
 * The console used to keep its own copy that let the last row win. When two players in a
 * squad shared a number it showed one of them, while the API -- refusing to guess --
 * published a bare `No. 9` and held the sheet back from auto-approval for a missing name
 * nobody could see was missing. A shared number now says so.
 */
function matchNumberLookup(match: MatchStatsSheet["match"]) {
  const rows = (source: MatchStatsSheet["match"]["squadPlayers"]) =>
    (source ?? []).map((p) => ({
      teamId: p.teamId,
      number: p.jerseyNumber,
      playerName: p.playerName,
      playerId: p.playerId,
    }));
  return buildNumberLookup({
    teamSquad: rows(match.teamSquad),
    matchSquad: rows(match.squadPlayers),
  });
}

/** The label a number reads as, naming who shares it when nobody can be chosen. */
function numberLabel(resolution: NumberResolution, jerseyNumber: number): string {
  if (resolution.kind === "named") return `No. ${jerseyNumber} ${resolution.player.playerName}`;
  if (resolution.kind === "shared") {
    return `No. ${jerseyNumber} (shared by ${resolution.names.join(" and ")}, so no name is published)`;
  }
  return `No. ${jerseyNumber}`;
}

function playerLabelForNumber(
  match: MatchStatsSheet["match"],
  teamId: string,
  jerseyNumber: number | null
): string | null {
  if (!jerseyNumber) return null;
  return numberLabel(matchNumberLookup(match).resolve(teamId, jerseyNumber), jerseyNumber);
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

/** A card for someone on the bench, in the first wording the API publishes it with. */
function previewOfficialComment(
  event: RecordedEvent & { official: NonNullable<RecordedEvent["official"]> },
  teamName: string
): string {
  const who = `the ${teamName} ${teamOfficialPhrase(event.official)}`;
  const body =
    event.type === "red_card"
      ? `Red Card! ${who.charAt(0).toUpperCase()}${who.slice(1)} is sent to the stands by the referee.`
      : `Yellow Card! The referee cautions ${who} on the touchline.`;
  return `${formatEventMinute(event.minute, event.addedMinute)} - ${body}`;
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
    const official =
      event.official && OFFICIAL_EVENT_TYPES.has(event.type) ? event.official : null;
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
      detail: official
        ? previewOfficialComment({ ...event, official }, team.name)
        : previewEventComment(event, team, opponent, primary, secondary),
      metadata: {
        source: "training_live_preview",
        addedMinute: event.addedMinute,
        half: event.half,
        recorderSequence: index,
        ...(official ? { official } : {}),
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
  const httpSessionRef = useRef<string | null>(null);
  const pendingChunksRef = useRef(0);
  const stopAfterFlushRef = useRef(false);
  const sampleStopRef = useRef<(() => void) | null>(null);
  const segmentTimerRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const sendingRef = useRef(Promise.resolve());
  const recorderStoppedRef = useRef(true);

  const friendlyLiveAudioError = (error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    if (/public live must be approved|public live is not enabled/i.test(message)) {
      return "Ask a scoreboard admin to approve public live before starting audio.";
    }
    if (/live audio commentary must be approved|live audio commentary is not enabled/i.test(message)) {
      return "Ask a scoreboard admin to approve live commentary before starting audio.";
    }
    if (/ticket expired/i.test(message)) {
      return "The live audio start window expired. Tap Live audio and try again.";
    }
    if (/microphone|permission|notallowed|denied/i.test(message)) {
      return "Microphone access is needed to start live audio.";
    }
    if (/network|websocket|socket|server|failed to fetch|closed before it could start/i.test(message)) {
      return "Could not connect live audio. Check your connection and try again.";
    }
    return message || "Could not start live audio.";
  };

  const closeTransport = useCallback(() => {
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "stop" }));
      socket.close(1000, "Recorder stopped live audio");
    } else {
      socket?.close();
    }
    const httpSessionId = httpSessionRef.current;
    httpSessionRef.current = null;
    if (httpSessionId) {
      void matchStatsApi.stopLiveAudioHttp(matchId, httpSessionId).catch(() => undefined);
    }
    setBusy(false);
  }, [matchId]);

  const finishStop = useCallback(() => {
    if (recorderStoppedRef.current && pendingChunksRef.current === 0) closeTransport();
  }, [closeTransport]);

  const stop = useCallback(() => {
    generationRef.current += 1;
    if (segmentTimerRef.current != null) window.clearInterval(segmentTimerRef.current);
    segmentTimerRef.current = null;
    sampleStopRef.current?.();
    sampleStopRef.current = null;
    stopAfterFlushRef.current = true;
    setBusy(true);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      // stop() emits the final complete audio segment.
      recorder.stop();
    } else if (!recorder) {
      recorderStoppedRef.current = true;
      finishStop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setActive(false);
  }, [finishStop]);

  useEffect(() => () => void stop(), [stop]);

  useEffect(() => {
    if (disabled) stop();
  }, [disabled, stop]);

  const start = async () => {
    const generation = ++generationRef.current;
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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (generation !== generationRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      const preferredType =
        [
          "audio/webm;codecs=opus",
          "audio/webm",
          "audio/mp4;codecs=mp4a.40.2",
          "audio/mp4",
          "audio/ogg;codecs=opus",
          "audio/ogg",
        ].find((type) => MediaRecorder.isTypeSupported(type)) || "";
      const recorder = preferredType
        ? new MediaRecorder(stream, { mimeType: preferredType, audioBitsPerSecond: 24_000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 24_000 });
      const mimeType = recorder.mimeType || preferredType || "audio/webm";
      const ticket = await matchStatsApi.createLiveAudioTicket(matchId);
      const openSocket = () => {
        const socket = new WebSocket(liveAudioSocketUrl(ticket.wsPath));
        return new Promise<WebSocket>((resolve, reject) => {
          let opened = false;
          const timeout = window.setTimeout(() => {
            if (!opened) {
              socket.close();
              reject(new Error("Live audio WebSocket timed out."));
            }
          }, 6000);
          socket.onopen = () => {
            // Wait for the server's authorized status before recording.
          };
          socket.onmessage = (event) => {
            try {
              if (JSON.parse(String(event.data)).type !== "status") return;
              opened = true;
              window.clearTimeout(timeout);
              resolve(socket);
            } catch { /* Ignore non-status messages during the handshake. */ }
          };
          socket.onerror = () => {
            if (!opened) {
              window.clearTimeout(timeout);
              socket.close();
              reject(new Error("Could not connect live audio."));
            }
          };
          socket.onclose = (event) => {
            if (!opened) {
              window.clearTimeout(timeout);
              reject(new Error(event.reason || "Live audio stream closed before it could start."));
            } else if (!event.wasClean) {
              reject(new Error(event.reason || "Live audio stream closed."));
            }
          };
        });
      };

      try {
        const socket = await openSocket();
        if (generation !== generationRef.current) { socket.close(); return; }
        socket.send(JSON.stringify({ type: "start", mimeType }));
        socket.onclose = () => {
          if (socketRef.current === socket) {
            setMessage("Live audio disconnected. Start it again to reconnect.");
            stop();
          }
        };
        socketRef.current = socket;
      } catch {
        // The WebSocket may already have consumed its single-use ticket.
        const fallbackTicket = await matchStatsApi.createLiveAudioTicket(matchId);
        const session = await matchStatsApi.startLiveAudioHttp(matchId, {
          ticket: fallbackTicket.ticket,
          mimeType,
        });
        if (generation !== generationRef.current) { void matchStatsApi.stopLiveAudioHttp(matchId, session.sessionId); return; }
        httpSessionRef.current = session.sessionId;
        setMessage("Live audio is running in network-safe mode.");
      }
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        const currentSocket = socketRef.current;
        const currentHttpSession = httpSessionRef.current;
        if (
          !event.data.size ||
          (!currentHttpSession && currentSocket?.readyState !== WebSocket.OPEN)
        ) {
          return;
        }
        pendingChunksRef.current += 1;
        sendingRef.current = sendingRef.current.then(() => blobToBase64(event.data))
          .then((data) => {
            const latestSocket = socketRef.current;
            const latestHttpSession = httpSessionRef.current;
            if (latestSocket?.readyState === WebSocket.OPEN) {
              latestSocket.send(JSON.stringify({ type: "chunk", mimeType, data }));
              return undefined;
            }
            if (latestHttpSession) {
              return matchStatsApi.sendLiveAudioHttpChunk(matchId, {
                sessionId: latestHttpSession,
                mimeType,
                data,
              }).then(() => undefined);
            }
            return undefined;
          })
          .catch(() => {
            setMessage("Audio could not be sent. Start live audio again to reconnect.");
            stop();
          })
          .finally(() => {
            pendingChunksRef.current = Math.max(0, pendingChunksRef.current - 1);
            if (stopAfterFlushRef.current) finishStop();
          });
      };
      recorder.onstop = () => {
        if (stopAfterFlushRef.current || generation !== generationRef.current) {
          recorderStoppedRef.current = true;
          stream.getTracks().forEach((track) => track.stop());
          finishStop();
        } else {
          recorder.start();
        }
      };
      stopAfterFlushRef.current = false;
      recorderStoppedRef.current = false;
      // Each segment includes its own container header, so late listeners and
      // browsers without MediaSource can decode it independently.
      recorder.start();
      segmentTimerRef.current = window.setInterval(() => {
        if (recorder.state === "recording") recorder.stop();
      }, LIVE_AUDIO_CHUNK_MS);
      recorder.onerror = () => { setMessage("Microphone recording failed. Try starting live audio again."); stop(); };
      setActive(true);
    } catch (error) {
      setMessage(friendlyLiveAudioError(error));
      setActive(false);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      closeTransport();
      if (segmentTimerRef.current != null) window.clearInterval(segmentTimerRef.current);
      segmentTimerRef.current = null;
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

/** What each hold on auto-approval means, in the words the console shows. */
const AUTO_APPROVE_BLOCK_TEXT: Record<Exclude<AutoApproveBlock, "not_submitted" | "dangling_numbers">, string> = {
  training: "practice matches are approved by hand",
  submitted_by_clock: "it was submitted automatically at full time, not by the recorder",
  not_submitted_by_recorder: "it was not submitted by the recorder who kicked it off",
  idle_locked: "the recording was stopped for having no events for twenty minutes",
  correction_requested: "a correction request is pending",
  correcting: "corrections to a finished match are approved by hand",
};

/**
 * Whether this submitted sheet will approve and publish itself, and if not, why not.
 *
 * The server decides (`sheet-auto-approve.ts`); this only says what it decided, so an
 * approver knows whether the sheet is waiting on them and a recorder knows which shirt
 * numbers need a name.
 */
function AutoApprovalNote({
  autoApproval,
  homeName,
  awayName,
}: {
  autoApproval: AutoApproval | undefined;
  homeName: string;
  awayName: string;
}) {
  if (!autoApproval?.dueAt || autoApproval.blocks.includes("not_submitted")) return null;
  const due = new Date(autoApproval.dueAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (autoApproval.blocks.length === 0) {
    return (
      <p className="mcx-submitted__note">
        Approves and publishes itself at about {due}, ten minutes after submission, unless it
        is approved or sent back first.
      </p>
    );
  }

  const reasons = autoApproval.blocks
    .filter((b): b is keyof typeof AUTO_APPROVE_BLOCK_TEXT => b in AUTO_APPROVE_BLOCK_TEXT)
    .map((b) => AUTO_APPROVE_BLOCK_TEXT[b]);
  /* Two different fixes, so two lists: a number nobody wears needs the player added to
     the squad; a number two players wear needs it taken off all but one of them. */
  const teamName = (side: "home" | "away") => (side === "home" ? homeName : awayName);
  const where = (d: AutoApproval["dangling"][number]) =>
    `${d.eventType.replace(/_/g, " ")}, ${d.minute}′`;
  const missing = autoApproval.dangling.filter((d) => !d.sharedBy?.length);
  const shared = autoApproval.dangling.filter((d) => d.sharedBy?.length);
  return (
    <div className="mcx-submitted__note">
      <p className="mcx-submitted__note">
        Will not approve itself
        {reasons.length ? `: ${reasons.join("; ")}.` : "."} It needs an approver.
      </p>
      {missing.length > 0 && (
        <>
          <p className="mcx-submitted__note">
            No player in the squad wears {missing.length === 1 ? "this number" : "these numbers"}.
            Add {missing.length === 1 ? "the player" : "the players"} to the squad:
          </p>
          <ul className="mcx-submitted__note">
            {missing.map((d) => (
              <li key={`${d.side}:${d.number}`}>
                {teamName(d.side)} No. {d.number} ({where(d)})
              </li>
            ))}
          </ul>
        </>
      )}
      {shared.length > 0 && (
        <>
          <p className="mcx-submitted__note">
            More than one player in the squad wears{" "}
            {shared.length === 1 ? "this number" : "each of these numbers"}, so no name can be
            published for it. Keep the number on the player who wore it and change or remove it
            for the others:
          </p>
          <ul className="mcx-submitted__note">
            {shared.map((d) => (
              <li key={`${d.side}:${d.number}`}>
                {teamName(d.side)} No. {d.number}: {d.sharedBy.join(", ")} ({where(d)})
              </li>
            ))}
          </ul>
        </>
      )}
      {autoApproval.dangling.length > 0 && (
        <p className="mcx-submitted__note">
          Once every number names one player, the sheet approves itself at the next check
          after {due}.
        </p>
      )}
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
  autoApproval,
  homeName,
  awayName,
  busy,
  clock,
  correcting,
  onSubmit,
  onApprove,
  onSendBack,
}: {
  status: SheetStatus;
  permissions: SectionPermissions;
  audit: SectionAudit;
  autoApproval: AutoApproval | undefined;
  homeName: string;
  awayName: string;
  busy: boolean;
  /** The clock, so the submit button knows whether the second half is under way. */
  clock: ClockState | null;
  /** Reopened after full time; the corrections can be sent whichever half the clock was in. */
  correcting: boolean;
  onSubmit: () => void;
  onApprove: () => void;
  onSendBack: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  /* Not before the second half: a sheet submitted at half-time is half a match, and the
     approver sees a plausible record with forty-five minutes missing. The server refuses
     it too -- a disabled button is a suggestion, not a rule -- so this is here to explain
     rather than to enforce. */
  const secondHalfStarted = clock?.half === 2 || correcting;

  return (
    <footer className="mcx-actions">
      {permissions.canSubmit && status === "live" && (
        <>
          <button
            type="button"
            className="mcx-btn mcx-btn--primary"
            disabled={busy || !secondHalfStarted}
            onClick={onSubmit}
            title={
              secondHalfStarted
                ? undefined
                : "Available once the second half is under way"
            }
          >
            {correcting
              ? "Submit corrections for approval"
              : "Submit statistics & events for approval"}
          </button>
          {correcting && (
            <p className="mcx-hint muted">
              Corrections to a finished match are never approved automatically. Nothing changed
              here reaches the public site until a ScoreBoard admin reviews and approves it.
            </p>
          )}
          {!secondHalfStarted && (
            <p className="mcx-hint muted">
              This can be sent for approval once the second half is under way. At full time
              it is submitted for you after five minutes if you have not.
            </p>
          )}
        </>
      )}

      {status === "submitted" && (
        <div className="mcx-submitted">
          <p className="mcx-submitted__note">
            Submitted{audit.submittedByName ? ` by ${audit.submittedByName}` : ""}
            {audit.submittedAt ? ` · ${new Date(audit.submittedAt).toLocaleString()}` : ""}.
            {permissions.canEdit && " You can still correct a mis-tap until it is approved."}
          </p>
          <AutoApprovalNote autoApproval={autoApproval} homeName={homeName} awayName={awayName} />
          {permissions.canEdit && (
            <button type="button" className="mcx-btn" disabled={busy} onClick={onSubmit}>
              Re-submit corrections
            </button>
          )}
        </div>
      )}

      {status === "approved" && (
        <p className="mcx-submitted__note">
          {audit.autoApprovedAt
            ? "Approved automatically, ten minutes after submission"
            : `Approved${audit.approvedByName ? ` by ${audit.approvedByName}` : ""}`}
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
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "pending" | "refused">(
    "idle"
  );
  /* Opened from the copy on this device because the server could not be reached. */
  const [fromDevice, setFromDevice] = useState(false);
  /* The device would not store the draft: the taps exist only in this open page. */
  const [storageFull, setStorageFull] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  /* Bumped to try opening the sheet again after the first attempt found no signal. */
  const [openAttempt, setOpenAttempt] = useState(0);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [pendingHalfLength, setPendingHalfLength] = useState(45);
  const [halfLengthTouched, setHalfLengthTouched] = useState(false);
  const [addedInput, setAddedInput] = useState("2");
  /** Minute captured by step 1, held until an event is logged. */
  const [captured, setCaptured] = useState<{ minute: number; added: number | null } | null>(null);
  /* Step 1 for a match reopened after full time: there is no running clock to read a
     minute from, so it is typed. */
  const [typedMinute, setTypedMinute] = useState("");
  const [typedAdded, setTypedAdded] = useState("");
  const [history, setHistory] = useState<SheetLogEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showTrainingLive, setShowTrainingLive] = useState(false);
  const [correctionNote, setCorrectionNote] = useState("");
  const [askCorrection, setAskCorrection] = useState(false);
  const [releaseNote, setReleaseNote] = useState("");
  /* Entry controls live here rather than in the Events tab so they can sit in
     the frozen header — they are needed constantly while the grid scrolls. */
  const [side, setSide] = useState<Side | null>(null);
  const [playerNumber, setPlayerNumber] = useState("");
  /* The step-3 Official button: a card for a coach or other official, filed in its own modal. */
  const [officialOpen, setOfficialOpen] = useState(false);
  const [kitPicker, setKitPicker] = useState<Side | null>(null);
  const [showKickoffStarter, setShowKickoffStarter] = useState(false);
  const [kickoffSide, setKickoffSide] = useState<Side | null>(null);
  const [kickoffNumber, setKickoffNumber] = useState("");
  /* Said inside the kick-off prompt: the page's error line is hidden behind it. */
  const [kickoffError, setKickoffError] = useState<string | null>(null);
  const [kickoffUnregistered, setKickoffUnregistered] = useState<UnregisteredNumber[] | null>(
    null
  );

  usePageTitle(sheet ? `${sheet.match.homeTeam.name} vs ${sheet.match.awayTeam.name}` : "Match console");

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Held in a ref so the debounced flush always sends the latest data even
     though the timer closes over an older render. */
  const pending = useRef<{
    tallies: Record<string, TallyValue>;
    events: RecordedEvent[];
    /** Deleted here, not yet sent: the server keeps whatever a save leaves out. */
    removedEventIds: string[];
    clock: ClockState | null;
    kits: KitColours;
  } | null>(null);
  /* The log as the server last confirmed it, to count what has not reached it yet. */
  const serverEvents = useRef<RecordedEvent[]>([]);
  const fromDeviceRef = useRef(false);
  const lastFailure = useRef<{ refused: boolean; at: number } | null>(null);

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
    serverEvents.current = next.events ?? [];
  }, []);

  /**
   * Put back what this device recorded and never got onto the server.
   *
   * Those taps exist nowhere else, so they outrank the server's copy -- and they are put
   * back whatever state the sheet is in. They used to be left out when the sheet could
   * not be edited (stopped by the idle sweep during an outage, or locked at full time),
   * and the next action on the page, a correction request say, then deleted them.
   */
  const restoreUnsent = useCallback(
    (server: MatchStatsSheet) => {
      const draft = readDraft(matchId);
      if (!draft || !draftIsAhead(draft)) return;
      /* Except the clock of a reopened record, which is the server's: a draft from match
         day would put the running clock back. The API keeps its own either way. */
      const draftClock = server.clock?.phase === "correction" ? server.clock : draft.clock;
      setTallies(draft.tallies);
      setEvents(draft.events);
      setClock(draftClock);
      setKits(draft.kits);
      pending.current = {
        tallies: draft.tallies,
        events: draft.events,
        removedEventIds: draft.removedEventIds,
        clock: draftClock,
        kits: draft.kits,
      };
      setSaveState("pending");
    },
    [matchId]
  );

  const markFromDevice = (value: boolean) => {
    fromDeviceRef.current = value;
    setFromDevice(value);
  };

  useEffect(() => {
    if (!matchId) return;
    let active = true;
    setLoading(true);
    matchStatsApi
      .open(matchId)
      .then((data) => {
        if (!active) return;
        writeServerCopy(matchId, data);
        pruneStoredSheets(matchId);
        applySheet(data);
        restoreUnsent(data);
        markFromDevice(false);
        setError(null);
      })
      .catch((e) => {
        if (!active) return;
        /* No signal on open: carry on from the last copy the server sent this device, with
           whatever was recorded here since on top. Recording does not wait for the network. */
        const copy = readServerCopy(matchId);
        if (copy) {
          applySheet(copy);
          restoreUnsent(copy);
          markFromDevice(true);
          setError(isNetworkFailure(e) ? null : String(e instanceof Error ? e.message : e));
          return;
        }
        setError(
          isNetworkFailure(e)
            ? "No connection to the server."
            : String(e instanceof Error ? e.message : e)
        );
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [matchId, applySheet, restoreUnsent, openAttempt]);

  /* Opened with no signal and no copy on the device: keep trying rather than leave the
     recorder on an error page. */
  useEffect(() => {
    if (sheet || loading) return;
    const id = setInterval(() => setOpenAttempt((n) => n + 1), RETRY_DELAY_MS);
    return () => clearInterval(id);
  }, [sheet, loading]);

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

  /**
   * Take the server's status, audit and permissions without its recorded data, which this
   * device may be ahead of. Used whenever the server is read while changes are outstanding.
   */
  const takeServerState = useCallback(
    (next: MatchStatsSheet) => {
      writeServerCopy(matchId, next);
      setSheet((prev) => (prev ? { ...next, tallies: prev.tallies, events: prev.events } : next));
      /* Except the clock when the server has reopened the match for corrections: that phase
         is the server's to set, and a page left open with its running clock would go on
         reading the match as live. */
      if (next.clock?.phase === "correction") {
        setClock(next.clock);
        if (pending.current) pending.current = { ...pending.current, clock: next.clock };
      }
    },
    [matchId]
  );

  /* Back in signal after opening from the device's copy: read the server again so the
     console stops working from a copy that may be out of date. */
  const refreshFromServer = useCallback(async () => {
    if (!matchId) return;
    try {
      const next = await matchStatsApi.open(matchId);
      markFromDevice(false);
      if (pending.current) takeServerState(next);
      else {
        writeServerCopy(matchId, next);
        applySheet(next);
      }
      setError(null);
    } catch {
      /* Still no signal; the next retry tries again. */
    }
  }, [matchId, applySheet, takeServerState]);

  const savingRef = useRef<Promise<boolean> | null>(null);
  const flush = useCallback(async (): Promise<void> => {
    if (savingRef.current) {
      await savingRef.current;
      return;
    }
    if (!pending.current || !matchId) return;
    const payload = pending.current;
    setSaveState("saving");
    const save = async (): Promise<boolean> => {
    try {
      const next = await matchStatsApi.save(matchId, payload.tallies, {
        events: payload.events,
        removedEventIds: payload.removedEventIds,
        clock: payload.clock,
        kits: payload.kits,
      });
      lastFailure.current = null;
      setLastSyncedAt(Date.now());
      serverEvents.current = next.events ?? [];
      // Only clear the queue once the API has actually accepted this payload.
      if (pending.current === payload) {
        pending.current = null;
        /* The server merges the log by id, so its copy can hold events another device
           filed. Nothing newer was tapped here meanwhile, so take it. */
        markSynced(matchId, next.events);
        setEvents(next.events ?? payload.events);
      }
      // Keep the server's status/audit but not the recorded data: the recorder
      // may have tapped again while this request was in flight.
      takeServerState(next);
      setSaveState(pending.current ? "pending" : "saved");
      setError(null);
      if (fromDeviceRef.current) void refreshFromServer();
      return true;
    } catch (e) {
      /* Keep the payload queued. The draft is already on the device, so
         nothing is lost — this just retries until the network returns. */
      const refused = !isNetworkFailure(e);
      lastFailure.current = { refused, at: Date.now() };
      setSaveState(refused ? "refused" : "pending");
      /* No signal is said by the save line, which keeps counting what is waiting. The
         message itself is a gateway's error page, not something to show a recorder. */
      setError(refused ? (e instanceof Error ? e.message : String(e)) : null);
      /* A refusal usually means the sheet was locked meanwhile -- the idle sweep stops a
         recording whose events stopped arriving, which is what an outage looks like.
         Read it again so the console shows the lock instead of a bare error. */
      if (refused) {
        matchStatsApi.open(matchId).then(takeServerState).catch(() => undefined);
      }
      return false;
    }
    };
    savingRef.current = save();
    let saved = false;
    try {
      saved = await savingRef.current;
    } finally {
      savingRef.current = null;
    }
    /* Taps made while that request was out were queued behind it, and their own timer
       found it busy. Send them now rather than at the next retry. */
    if (saved && pending.current) void flush();
  }, [matchId, takeServerState, refreshFromServer]);

  /* Retry loop and online listener: the sync catches up by itself. */
  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      if (pending.current) void flush();
      else if (fromDeviceRef.current) void refreshFromServer();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const id = setInterval(() => {
      if (!navigator.onLine) return;
      if (pending.current) {
        const failure = lastFailure.current;
        if (failure?.refused && Date.now() - failure.at < REFUSED_RETRY_MS) return;
        void flush();
      } else if (fromDeviceRef.current) {
        void refreshFromServer();
      }
    }, RETRY_DELAY_MS);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearInterval(id);
    };
  }, [flush, refreshFromServer]);

  /* Leaving with changes the server has not got: they are safe on this device, but only
     this device, so a recorder about to switch phones should know. */
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!pending.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  /* A submitted sheet can be approved by the clock, or by an approver elsewhere, while
     this console sits open. Re-read it every thirty seconds until it is decided, taking
     the server's status and audit but keeping the recorder's own tallies and events, as
     a save does, so a correction being typed is never overwritten. */
  const sheetStatusNow = sheet?.status;
  useEffect(() => {
    if (!matchId || sheetStatusNow !== "submitted") return;
    const id = setInterval(() => {
      if (pending.current) return;
      matchStatsApi.open(matchId).then(takeServerState).catch(() => undefined);
    }, 30_000);
    return () => clearInterval(id);
  }, [matchId, sheetStatusNow, takeServerState]);

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
  const serverEditable = Boolean(perms?.canEdit);
  /* Except an idle lock, which happened *to* the recorder -- and a phone that loses signal
     for twenty minutes is exactly what trips it. The server still refuses every save until a
     ScoreBoard admin releases the sheet, but the recorder keeps recording onto the phone
     meanwhile, and it is all sent the moment the lock is lifted. Locking the page here lost
     the rest of the match. Full time and approval still lock it: those are decisions. */
  const recordsThroughIdleLock = Boolean(
    sheet?.idleLock && perms?.canSubmit && !sheet.lockedAtFullTime && sheet.status === "live"
  );
  const editable = serverEditable || recordsThroughIdleLock;

  /** Queue a debounced save, and mirror to the device immediately. */
  const queueSave = useCallback(
    (patch: {
      tallies?: Record<string, TallyValue>;
      events?: RecordedEvent[];
      clock?: ClockState | null;
      kits?: KitColours;
    }) => {
      const before = pending.current?.events ?? events;
      const waiting = pending.current?.removedEventIds ?? [];
      const next = {
        tallies: patch.tallies ?? pending.current?.tallies ?? tallies,
        events: patch.events ?? before,
        /* The server keeps any event a save leaves out, so what was deleted here is sent
           by id -- worked out from the change itself, whichever control made it. */
        removedEventIds: patch.events ? removedSince(before, patch.events, waiting) : waiting,
        clock: patch.clock !== undefined ? patch.clock : pending.current?.clock ?? clock,
        kits: patch.kits ?? pending.current?.kits ?? kits,
      };
      pending.current = next;
      // Written before the network is even attempted — this is the real copy.
      setStorageFull(!writeDraft(matchId, { ...next, synced: false }));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    },
    [tallies, events, clock, kits, matchId, flush]
  );

  const handleClockChange = useCallback(
    (next: ClockState) => {
      setClock(next);
      if (editable) queueSave({ clock: next });
    },
    [queueSave, editable]
  );

  const matchClock = useMatchClock(clock, handleClockChange);
  const previousClockHalf = useRef(matchClock.half);
  const correcting = matchClock.correcting;
  const typedCheck = correcting
    ? checkTypedMinute(typedMinute, typedAdded, matchClock.halfLength)
    : null;
  /* What step 1 hands the events tab: the tapped minute live, the typed one in a correction. */
  const entryMinute = correcting
    ? typedCheck?.ok
      ? { minute: typedCheck.minute, added: typedCheck.added, half: typedCheck.half }
      : null
    : captured;

  useEffect(() => {
    if (previousClockHalf.current === matchClock.half) return;
    previousClockHalf.current = matchClock.half;
    setCaptured(null);
    setSide(null);
    setPlayerNumber("");
    setOfficialOpen(false);
  }, [matchClock.half]);

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
    setKickoffError(null);
    setShowKickoffStarter(true);
  };

  const confirmKickoffStarter = (confirmed = false) => {
    if (!kickoffSide) {
      setKickoffError("Choose the team that played the kick-off.");
      return;
    }
    const jersey = parseJersey(kickoffNumber);
    if (jersey == null) {
      setKickoffError(
        "Enter the jersey number, 1 to 99, of the player who played the kick-off."
      );
      return;
    }
    setKickoffError(null);
    if (!confirmed) {
      const unregistered = checkNumbers([{ side: kickoffSide, number: jersey }]);
      if (unregistered.length > 0) {
        setKickoffUnregistered(unregistered);
        return;
      }
    }
    const nextKickoff: RecordedEvent = {
      id: `kick_off-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: "kick_off",
      minute: 0,
      addedMinute: null,
      side: kickoffSide,
      playerNumber: jersey,
      secondaryPlayerNumber: null,
      half: 1,
    };
    const nextEvents = [...events.filter((event) => event.type !== "kick_off"), nextKickoff];
    setError(null);
    setShowKickoffStarter(false);
    setCaptured(null);
    setSide(null);
    setPlayerNumber("");
    setOfficialOpen(false);
    setTab("events");
    matchClock.kickOff(pendingHalfLength);
    handleEventsChange({ events: nextEvents });
    // Claim on confirmation without waiting for the autosave debounce.
    void flush();
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

  /**
   * Run a sheet action. `needsSync` for the ones that act on the recorded data -- submit and
   * approve -- which must not go ahead without what this device has not sent yet.
   *
   * The others (asking for a correction, releasing a lock, sending back) do not wait for a
   * sync that a locked sheet would refuse, and never discard what is still unsent: they used
   * to clear the device's draft whatever it held.
   *
   * Resolves to whether it worked, so a caller clears a typed note only when it was sent:
   * the error is caught here, and a bare `.then` used to wipe the note on a failure too.
   */
  const act = async (
    fn: () => Promise<MatchStatsSheet>,
    options: { needsSync?: boolean } = {}
  ): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await flush();
      if (pending.current && options.needsSync) {
        throw new Error(
          "Your latest changes have not reached the server yet. They are kept on this device; wait for them to sync before continuing."
        );
      }
      const next = await fn();
      if (pending.current) {
        takeServerState(next);
      } else {
        writeServerCopy(matchId, next);
        applySheet(next);
        clearDraft(matchId);
      }
      loadHistory();
      return true;
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      return false;
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
  const numberLookup = useMemo(() => (sheet ? matchNumberLookup(sheet.match) : null), [sheet]);
  /* The same lookup again, so "not registered" is exactly a number published with no name. */
  const checkNumbers = useCallback(
    (entries: NumberToCheck[]) =>
      sheet && numberLookup ? findUnregistered(numberLookup, sheet.match, entries) : [],
    [sheet, numberLookup]
  );
  const playerLabelsByKey = useMemo(() => {
    const lookup = numberLookup;
    if (!sheet || !lookup) return new Map<string, string>();
    /* Built from the same lookup as everything else, so this list and the event
       rows can never disagree about who wears a number. */
    const labels = new Map<string, string>();
    for (const p of [...(sheet.match.squadPlayers ?? []), ...(sheet.match.teamSquad ?? [])]) {
      if (p.jerseyNumber == null || p.jerseyNumber <= 0) continue;
      const key = `${p.teamId}:${p.jerseyNumber}`;
      if (!labels.has(key)) {
        labels.set(key, numberLabel(lookup.resolve(p.teamId, p.jerseyNumber), p.jerseyNumber));
      }
    }
    return labels;
  }, [sheet, numberLookup]);

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
    const held = readDraft(matchId);
    return (
      <div className="mcx-page mcx-page--center">
        <p className="mcx-error">{error ?? "Match console unavailable."}</p>
        <p className="muted">
          This phone has no saved copy of this match to open without a connection. Trying again
          every few seconds.
          {held && draftIsAhead(held)
            ? ` The ${held.events.length} event(s) recorded on this phone are kept and will be sent once it opens.`
            : ""}
        </p>
        <button type="button" className="mcx-btn" onClick={() => setOpenAttempt((n) => n + 1)}>
          Try again now
        </button>
        <Link to="/admin/match-stats" className="mcx-backlink">← Back to match statistics</Link>
      </div>
    );
  }

  const notOnServer = pending.current ? eventsNotOnServer(events, serverEvents.current) : 0;
  const syncedLabel = lastSyncedAt
    ? ` · last synced ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "";
  const unsentLabel = notOnServer > 0 ? ` · ${notOnServer} event(s) not on the server yet` : "";

  const { match, audit, status } = sheet;
  const banner = latestActionBanner(history);
  const halfLengthChoices = match.competition.isTraining
    ? TRAINING_HALF_LENGTH_CHOICES
    : HALF_LENGTH_CHOICES;
  const approved = status === "approved";
  const activeStatus = status;
  const liveFeatureEnabled = Boolean(match.liveFeature?.enabled);
  const liveAudioEnabled = Boolean(match.liveFeature?.audioEnabled);

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
          {!match.competition.isTraining && (
            <span className={liveAudioEnabled ? "mcx-live-indicator is-on" : "mcx-live-indicator"}>
              <span className="mcx-live-dot" />
              {liveAudioEnabled ? "Commentary approved" : "Commentary off"}
            </span>
          )}
          <LiveAudioCommentaryControl
            matchId={matchId}
            disabled={
              !serverEditable ||
              matchClock.phase === "finished" ||
              correcting ||
              (!match.competition.isTraining && (!liveFeatureEnabled || !liveAudioEnabled))
            }
            trainingPreview={Boolean(match.competition.isTraining)}
          />
          <span className={`mcx-status mcx-status--${activeStatus}${correcting ? " mcx-status--correcting" : ""}`}>
            <span className="mcx-status__dot" />
            {correcting && activeStatus === "live" ? "Correcting" : STATUS_COPY[activeStatus]}
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
              {correcting
                ? "Full time · clock stopped"
                : matchClock.started
                  ? `${matchClock.half === 1 ? "1st" : "2nd"} half · ${displayMinute(
                      matchClock.liveMinute,
                      matchClock.liveAdded
                    )}`
                  : "Not started"}
            </span>
          </div>

          {correcting ? (
            <div
              className={`mcx-capture mcx-capture--typed${typedCheck?.ok ? " is-set" : ""}`}
              aria-disabled={!editable}
            >
              <div className="mcx-capture__inputs">
                <span className="mcx-step__n mcx-step__n--inline">1</span>
                <input
                  type="number"
                  min={1}
                  max={matchClock.halfLength * 2}
                  inputMode="numeric"
                  placeholder="Min"
                  value={typedMinute}
                  onChange={(e) => setTypedMinute(e.target.value)}
                  disabled={!editable}
                  aria-label="Minute of the event"
                />
                <span className="mcx-capture__plus" aria-hidden="true">+</span>
                <input
                  type="number"
                  min={0}
                  max={30}
                  inputMode="numeric"
                  placeholder="0"
                  value={typedAdded}
                  onChange={(e) => setTypedAdded(e.target.value)}
                  disabled={!editable}
                  aria-label="Added time, in minutes"
                />
              </div>
              <span className="mcx-capture__hint" role={typedCheck && !typedCheck.ok && typedMinute ? "alert" : undefined}>
                {typedCheck?.ok
                  ? `${typedCheck.half === 1 ? "1st" : "2nd"} half · ${displayMinute(typedCheck.minute, typedCheck.added)}`
                  : typedMinute.trim() !== "" && typedCheck && !typedCheck.ok
                    ? typedCheck.reason
                    : "type the minute of the event"}
              </span>
            </div>
          ) : matchClock.started ? (
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

            <div className="mcx-who">
              <label className="mcx-jersey">
                <span
                  className={`mcx-step__n mcx-step__n--inline${
                    side && parseJersey(playerNumber) != null ? "" : " is-locked"
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
              {/* A coach, manager or physio has no shirt number: their card is named and
                  filed in its own modal, so it needs the minute and the side first. */}
              <button
                type="button"
                className="mcx-officialbtn"
                onClick={() => setOfficialOpen(true)}
                disabled={!editable || !side || !entryMinute}
                title={
                  entryMinute && side
                    ? "A card for a coach or other team official"
                    : "Log the minute and choose the team first"
                }
              >
                Official
              </button>
            </div>

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

        <span
          className={`mcx-savestate mcx-savestate--${online ? saveState : "offline"}`}
          role="status"
        >
          {!online && `Offline — saved on this device, will sync automatically${unsentLabel}`}
          {online && saveState === "saving" && `Saving…${unsentLabel}`}
          {online && saveState === "saved" && `All changes saved${syncedLabel}`}
          {online && saveState === "pending" && `Saved on this device — retrying sync…${unsentLabel}`}
          {online && saveState === "refused" && `Saved on this device — the server is not accepting changes${unsentLabel}`}
        </span>
      </div>

      {storageFull && (
        <div className="mcx-callout mcx-callout--danger" role="alert">
          <strong>This phone's storage is full.</strong> New taps are only in this open page until
          they reach the server. Do not close or reload it until it says “All changes saved”.
        </div>
      )}

      {fromDevice && (
        <div className="mcx-callout mcx-callout--warn">
          <strong>No connection.</strong> Showing the copy saved on this phone. Keep recording:
          everything is kept here and sent as soon as the signal returns.
        </div>
      )}

      {saveState === "refused" && !editable && notOnServer > 0 && (
        <div className="mcx-callout mcx-callout--warn">
          <strong>
            {notOnServer} event(s) recorded on this phone have not reached the server.
          </strong>{" "}
          The sheet is locked, so the server is not taking them yet. They are kept here and sent
          automatically once it is open for editing again — keep this page or this phone.
        </div>
      )}

      {/* The idle-lock refusal is the callout below, said once. */}
      {error && !(recordsThroughIdleLock && saveState === "refused") && (
        <p className="mcx-error" role="alert">{error}</p>
      )}

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

      {/* Stopped by the idle sweep. The recorder can only wait; an approver can release
          it here, with the same required note as the dashboard panel. */}
      {sheet.idleLock && (
        <div className="mcx-callout mcx-callout--warn">
          <strong>Recording stopped.</strong> No event was filed for{" "}
          {formatQuiet(sheet.idleLock.quietMinutes)}, so the live broadcast was ended and this
          sheet is locked.
          {perms?.canReleaseIdleLock
            ? " Release it to let the recorder carry on."
            : " A ScoreBoard admin can release it."}
          {recordsThroughIdleLock &&
            " Keep recording: everything is saved on this phone and sent once it is released."}
          {perms?.canReleaseIdleLock && (
            <div className="mcx-review">
              <textarea
                className="mcx-note"
                value={releaseNote}
                onChange={(e) => setReleaseNote(e.target.value)}
                placeholder="Why release it? (kept with the sheet's history)"
                aria-label="Why are you releasing this recording?"
                rows={2}
                maxLength={500}
              />
              <div className="mcx-review__buttons">
                <button
                  type="button"
                  className="mcx-btn mcx-btn--approve"
                  disabled={busy || !releaseNote.trim()}
                  onClick={() =>
                    act(() => matchStatsApi.releaseIdleLock(matchId, releaseNote.trim())).then(
                      (ok) => ok && setReleaseNote("")
                    )
                  }
                >
                  Release recording
                </button>
              </div>
            </div>
          )}
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
                    ).then((ok) => {
                      if (!ok) return;
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
                  /* Locked to the clock: the other half is not in play. Once the match is
                     over and reopened, both halves are history and either can be fixed. */
                  const allowed = correcting || h === clockHalf;
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
            captured={entryMinute}
            side={side}
            playerNumber={playerNumber}
            officialOpen={officialOpen}
            onOfficialClose={() => setOfficialOpen(false)}
            onCapturedUsed={() => {
              // Reset the whole entry: the next event starts at step 1 with no
              // side pre-selected, so a side is never inherited by accident.
              setCaptured(null);
              setTypedMinute("");
              setTypedAdded("");
              setSide(null);
              setPlayerNumber("");
              setOfficialOpen(false);
            }}
            clock={matchClock}
            addedInput={addedInput}
            onAddedInputChange={setAddedInput}
            onChange={handleEventsChange}
            homeName={match.homeTeam.name}
            awayName={match.awayTeam.name}
            playerLabelsByKey={playerLabelsByKey}
            checkNumbers={checkNumbers}
          />
        </>
      )}

      {/* One set of actions for the sheet, below whichever tab is open. */}
      {perms && (
        <SheetActions
          status={status}
          permissions={perms}
          audit={audit}
          autoApproval={sheet.autoApproval}
          homeName={sheet.match.homeTeam.name}
          awayName={sheet.match.awayTeam.name}
          clock={clock}
          correcting={correcting}
          busy={busy}
          onSubmit={() => act(() => matchStatsApi.submit(matchId), { needsSync: true })}
          onApprove={() => act(() => matchStatsApi.approve(matchId), { needsSync: true })}
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
        <div>
          <dt>Statistics &amp; events</dt>
          <dd>{correcting && status === "live" ? "Correcting" : STATUS_COPY[status]}</dd>
        </div>
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
            {kickoffError && (
              <p className="mcx-error" role="alert">{kickoffError}</p>
            )}
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
                onClick={() => confirmKickoffStarter()}
              >
                Start match
              </button>
            </div>
          </div>
        </div>
      )}

      {kickoffUnregistered && (
        <UnregisteredNumberPrompt
          numbers={kickoffUnregistered}
          onConfirm={() => {
            setKickoffUnregistered(null);
            confirmKickoffStarter(true);
          }}
          onCancel={() => setKickoffUnregistered(null)}
        />
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
