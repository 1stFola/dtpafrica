import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  fetchLiveAudioPoll,
  fetchMatch,
  fetchMatchSquads,
  type SbMatchDetail,
  type SbMatchSquadsResponse,
} from "../../../api/scoreboard";
import { isAbortError } from "../../../api/client";
import { EventTimeline } from "../components/EventTimeline";
import { HighlightCard } from "../components/HighlightCard";
import { MatchSquadsGrid, MatchSquadsSkeleton } from "../components/MatchSquadPanel";
import { MatchStatsBars } from "../components/MatchStatsBars";
import { TeamCrest } from "../components/TeamCrest";
import { isMatchUuid, matchCenterPath } from "../utils/matchPath";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { AdPlacement } from "../../../components/AdPlacement";
import { liveAudioSocketUrl } from "../../../api/liveAudio";
import { serverNow, syncServerClock } from "../../../lib/server-clock";

type MatchTab = "timeline" | "stats" | "video" | "photos" | "squads";

const TABS: { id: MatchTab; label: string }[] = [
  { id: "timeline", label: "Timeline" },
  { id: "stats", label: "Statistics" },
  { id: "video", label: "Video Highlight" },
  { id: "photos", label: "Match Photos" },
  { id: "squads", label: "Squads" },
];

const TAB_IDS = new Set<string>(TABS.map((tab) => tab.id));

type MatchPhoto = { url: string; caption?: string | null };

const GOAL_ALERTS_KEY = "dtp_scoreboard_goal_alerts";
const GOAL_WHISTLE_SRC = "/audio/mixkit-police-short-whistle-615.wav";

type StatusKind = "live" | "ht" | "ft" | "scheduled" | "other";
type GoalAlertState = { title: string; body: string; score: string };

function statusKind(status: string): StatusKind {
  if (status === "live") return "live";
  if (status === "halftime") return "ht";
  if (status === "finished") return "ft";
  if (status === "scheduled") return "scheduled";
  return "other";
}

function statusLabel(status: string, minute: number | null): string {
  switch (statusKind(status)) {
    case "live":
      return minute != null ? `LIVE ${minute}'` : "LIVE";
    case "ht":
      return "HALFTIME";
    case "ft":
      return "FULL TIME";
    case "scheduled":
      return "UPCOMING";
    default:
      return status.toUpperCase();
  }
}

function matchdayLabel(match: SbMatchDetail): string {
  const stage = match.stageKey ?? "";
  if (stage === "third_place") return "Third-Place Playoff";
  if (stage === "grand_final") return "Grand Finale";
  if (match.matchday != null) return `Day ${match.matchday}`;
  const dayMatch = match.roundLabel?.match(/DAY\s*(\d+)/i);
  if (dayMatch) return `Day ${dayMatch[1]}`;
  if (match.roundLabel) return match.roundLabel;
  return "Matchday";
}

function competitionLabel(name: string, season?: string): string {
  const seasonYear = season?.match(/\d{4}/)?.[0];
  if (seasonYear && !name.includes(seasonYear)) return `${name} ${seasonYear}`;
  return name;
}

function formatKickoff(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderInlineReportText(text: string) {
  const parts: Array<string | JSX.Element> = [];
  const pattern = /(\*\*[^*]+\*\*|_[^_]+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const content = token.startsWith("**") ? token.slice(2, -2) : token.slice(1, -1);
    parts.push(
      token.startsWith("**") ? (
        <strong key={`${match.index}-b`}>{content}</strong>
      ) : (
        <em key={`${match.index}-i`}>{content}</em>
      )
    );
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function renderMatchReport(comment: string) {
  const blocks = comment.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);

  return blocks.map((block, index) => {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return null;

    if (lines.every((line) => line.startsWith("- "))) {
      return (
        <ul key={`list-${index}`} className="sbc-narrative__list">
          {lines.map((line, lineIndex) => (
            <li key={lineIndex}>{renderInlineReportText(line.slice(2).trim())}</li>
          ))}
        </ul>
      );
    }

    if (lines.every((line) => line.startsWith("> "))) {
      return (
        <blockquote key={`quote-${index}`} className="sbc-narrative__quote">
          {lines.map((line, lineIndex) => (
            <p key={lineIndex}>{renderInlineReportText(line.slice(2).trim())}</p>
          ))}
        </blockquote>
      );
    }

    if (lines.length === 1 && lines[0].startsWith("## ")) {
      return (
        <h3 key={`heading-${index}`} className="sbc-narrative__heading">
          {renderInlineReportText(lines[0].slice(3).trim())}
        </h3>
      );
    }

    return (
      <p key={`paragraph-${index}`} className="sbc-narrative__text">
        {renderInlineReportText(lines.join(" "))}
      </p>
    );
  });
}

function parseMatchPhotos(meta: SbMatchDetail["meta"]): MatchPhoto[] {
  if (!meta || typeof meta !== "object" || !("photos" in meta)) return [];
  const photos = (meta as { photos?: unknown }).photos;
  if (!Array.isArray(photos)) return [];
  return photos.flatMap((item) => {
    if (!item || typeof item !== "object" || !("url" in item)) return [];
    const url = (item as { url?: unknown }).url;
    if (typeof url !== "string" || !url.trim()) return [];
    const caption = (item as { caption?: unknown }).caption;
    return [{ url: url.trim(), caption: typeof caption === "string" ? caption : null }];
  });
}

function MatchPhotosEmpty() {
  return (
    <div className="dtp-empty-state sbm-empty-premium">
      <div className="sbm-empty-premium__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 7h3l2-2h6l2 2h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
      </div>
      <p className="dtp-empty-state__title">No match photos yet</p>
      <p>Official gallery shots from the ground will appear here when published.</p>
    </div>
  );
}

function MatchPhotosGrid({ photos }: { photos: MatchPhoto[] }) {
  return (
    <div className="sbm-photo-grid">
      {photos.map((photo, index) => (
        <figure key={`${photo.url}-${index}`} className="sbm-photo-card">
          <img
            src={photo.url}
            alt={photo.caption ?? "Match photo"}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          {photo.caption && <figcaption>{photo.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

function formatLiveUpdate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Updated now";
  return `Updated ${date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}`;
}

function formatClockSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function liveClockSeconds(
  clock: NonNullable<SbMatchDetail["liveSheet"]>["clock"] | null | undefined
): number | null {
  if (!clock || clock.phase === "pre_kickoff") return null;
  const halfLengthSeconds = clock.halfLength * 60;
  const addedFirstSeconds = (clock.addedFirst ?? 0) * 60;
  const addedSecondSeconds = (clock.addedSecond ?? 0) * 60;
  const firstStarted = clock.firstHalfStartedAt
    ? new Date(clock.firstHalfStartedAt).getTime()
    : NaN;
  const secondStarted = clock.secondHalfStartedAt
    ? new Date(clock.secondHalfStartedAt).getTime()
    : NaN;

  if (clock.phase === "awaiting_second_half") {
    return halfLengthSeconds + addedFirstSeconds;
  }
  if (
    clock.phase === "finished" ||
    clock.phase === "penalty_shootout" ||
    (clock.half === 2 && !Number.isFinite(secondStarted))
  ) {
    return halfLengthSeconds * 2 + addedSecondSeconds;
  }
  if (clock.half === 2 && Number.isFinite(secondStarted)) {
    return halfLengthSeconds + Math.max(0, Math.floor((serverNow() - secondStarted) / 1000));
  }
  if (!Number.isFinite(firstStarted)) return null;
  return Math.max(0, Math.floor((serverNow() - firstStarted) / 1000));
}

function useLiveClockLabel(
  clock: NonNullable<SbMatchDetail["liveSheet"]>["clock"] | null | undefined
): string | null {
  const [tick, setTick] = useState(0);
  // The anchors were stamped on the server's clock; count from them on it too.
  useEffect(() => {
    void syncServerClock();
  }, []);
  useEffect(() => {
    if (!clock || clock.phase === "finished" || clock.phase === "penalty_shootout") return;
    const id = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [clock?.phase, clock?.firstHalfStartedAt, clock?.secondHalfStartedAt]);

  return useMemo(() => {
    void tick;
    const seconds = liveClockSeconds(clock);
    return seconds == null ? null : formatClockSeconds(seconds);
  }, [clock, tick]);
}

function isGoalEvent(type: string): boolean {
  return type === "goal" || type === "goal_penalty" || type === "own_goal";
}

function playGoalWhistle(audioRef: MutableRefObject<HTMLAudioElement | null>) {
  if (typeof window === "undefined") return;
  try {
    const unlocked = audioRef.current;
    const audio = unlocked?.cloneNode(true) as HTMLAudioElement | null;
    const playable = audio ?? new Audio(GOAL_WHISTLE_SRC);
    if (!audioRef.current) audioRef.current = playable;
    playable.preload = "auto";
    playable.src = GOAL_WHISTLE_SRC;
    playable.volume = 1;
    playable.muted = false;
    playable.currentTime = 0;
    void playable.play();
  } catch {
    try {
      const audio = new Audio(GOAL_WHISTLE_SRC);
      audio.volume = 1;
      void audio.play();
    } catch {
      /* Browser audio is best-effort: notifications still carry the alert. */
    }
  }
}

function primeGoalWhistle(audioRef: MutableRefObject<HTMLAudioElement | null>) {
  if (typeof window === "undefined") return;
  try {
    const audio = audioRef.current ?? new Audio(GOAL_WHISTLE_SRC);
    audioRef.current = audio;
    audio.preload = "auto";
    audio.src = GOAL_WHISTLE_SRC;
    audio.volume = 1;
    audio.muted = false;
  } catch {
    /* Preloading is opportunistic. */
  }
}

function unlockGoalAudio(audioRef: MutableRefObject<HTMLAudioElement | null>) {
  if (typeof window === "undefined") return;
  try {
    const audio = audioRef.current ?? new Audio(GOAL_WHISTLE_SRC);
    audioRef.current = audio;
    audio.preload = "auto";
    audio.src = GOAL_WHISTLE_SRC;
    audio.volume = 1;
    audio.muted = true;
    void audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        primeGoalWhistle(audioRef);
      })
      .catch(() => {
        audio.muted = false;
        primeGoalWhistle(audioRef);
      });
  } catch {
    /* Browsers may still block audio until a later gesture. */
  }
}

function vibrateGoalAlert() {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([240, 90, 240, 90, 420]);
    }
  } catch {
    /* Vibration support varies by browser and device. */
  }
}

function showGoalNotification(title: string, body: string, tag: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, {
      body,
      tag,
      requireInteraction: true,
      silent: false,
    });
  } catch {
    /* Some mobile browsers expose Notification but refuse page-created alerts. */
  }
}

function publicFixtureErrorMessage(error: unknown): string {
  if (isAbortError(error)) return "";
  const message = error instanceof Error ? error.message : String(error);
  if (/match not found/i.test(message)) return "We could not find this fixture.";
  if (/failed to fetch|network|request failed|api|server|websocket|socket/i.test(message)) {
    return "We could not load this fixture right now. Please refresh the page.";
  }
  return message.trim() || "We could not load this fixture right now. Please refresh the page.";
}

function scoringTeamIdForLiveEvent(
  event: { type: string; teamId: string | null },
  match: SbMatchDetail
) {
  if (event.type === "own_goal") {
    if (event.teamId === match.homeTeam.id) return match.awayTeam.id;
    if (event.teamId === match.awayTeam.id) return match.homeTeam.id;
  }
  return event.teamId;
}

function base64ToBlob(data: string, mimeType: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function base64ToArrayBuffer(data: string): ArrayBuffer {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function LiveAudioListener({ matchId }: { matchId: string }) {
  const [listening, setListening] = useState(false);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const playbackRef = useRef(Promise.resolve());
  const urlsRef = useRef<string[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const pendingBuffersRef = useRef<ArrayBuffer[]>([]);
  const streamMimeTypeRef = useRef<string | null>(null);
  const streamingUnavailableRef = useRef(false);
  const playbackBlockedRef = useRef(false);
  const playbackAllowedRef = useRef(false);
  const playbackGenerationRef = useRef(0);
  const finishPlaybackRef = useRef<(() => void) | null>(null);

  const clearAudioStream = () => {
    playbackGenerationRef.current += 1;
    finishPlaybackRef.current?.();
    finishPlaybackRef.current = null;
    playbackRef.current = Promise.resolve();
    playbackAllowedRef.current = false;
    const sourceBuffer = sourceBufferRef.current;
    if (sourceBuffer) sourceBuffer.onupdateend = null;
    sourceBufferRef.current = null;
    mediaSourceRef.current = null;
    pendingBuffersRef.current = [];
    streamMimeTypeRef.current = null;
    streamingUnavailableRef.current = false;
    playbackBlockedRef.current = false;

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.onended = null;
      audio.onerror = null;
      audio.removeAttribute("src");
      audio.load();
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
  };

  const requestPlayback = () => {
    const audio = audioRef.current;
    if (!audio || !playbackAllowedRef.current) return;
    void audio.play().catch(() => {
      if (playbackAllowedRef.current && !playbackBlockedRef.current) {
        playbackBlockedRef.current = true;
        setMessage("Tap Listen live audio again if your browser paused playback.");
      }
    });
  };

  const appendPendingBuffer = () => {
    const sourceBuffer = sourceBufferRef.current;
    if (!sourceBuffer || sourceBuffer.updating || pendingBuffersRef.current.length === 0) return;
    const audio = audioRef.current;
    if (audio && sourceBuffer.buffered.length && audio.currentTime - sourceBuffer.buffered.start(0) > 60) {
      sourceBuffer.remove(sourceBuffer.buffered.start(0), audio.currentTime - 20);
      return;
    }
    const nextBuffer = pendingBuffersRef.current.shift();
    if (!nextBuffer) return;
    try {
      sourceBuffer.appendBuffer(nextBuffer);
      requestPlayback();
    } catch (error) {
      streamingUnavailableRef.current = true;
      pendingBuffersRef.current = [];
      if (playbackAllowedRef.current) {
        setMessage("Live audio playback needs a restart. Tap Listen live audio again.");
      }
    }
  };

  const ensureSourceBuffer = (mimeType: string) => {
    const mediaSource = mediaSourceRef.current;
    if (!mediaSource || streamingUnavailableRef.current || sourceBufferRef.current) {
      return Boolean(sourceBufferRef.current);
    }
    if (!MediaSource.isTypeSupported(mimeType)) {
      streamingUnavailableRef.current = true;
      return false;
    }
    streamMimeTypeRef.current = mimeType;
    if (mediaSource.readyState !== "open") return true;
    try {
      const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
      sourceBuffer.mode = "sequence";
      sourceBuffer.onupdateend = appendPendingBuffer;
      sourceBufferRef.current = sourceBuffer;
      appendPendingBuffer();
      return true;
    } catch (error) {
      streamingUnavailableRef.current = true;
      return false;
    }
  };

  const prepareAudioStream = () => {
    clearAudioStream();
    playbackAllowedRef.current = true;
    const audio = audioRef.current;
    if (!audio || typeof MediaSource === "undefined") return;
    const mediaSource = new MediaSource();
    mediaSourceRef.current = mediaSource;
    mediaSource.addEventListener("sourceopen", () => {
      const mimeType = streamMimeTypeRef.current;
      if (mimeType) ensureSourceBuffer(mimeType);
      appendPendingBuffer();
    });
    const objectUrl = URL.createObjectURL(mediaSource);
    objectUrlRef.current = objectUrl;
    audio.src = objectUrl;
    audio.muted = false;
    audio.volume = 1;
    audio.setAttribute("playsinline", "true");
    requestPlayback();
  };

  const playFallbackChunk = (data: string, mimeType: string) => {
    const audio = audioRef.current;
    if (!audio) return;
    const generation = playbackGenerationRef.current;
    playbackRef.current = playbackRef.current
      .then(
        () =>
          new Promise<void>((resolve) => {
            if (generation !== playbackGenerationRef.current || !playbackAllowedRef.current) { resolve(); return; }
            const url = URL.createObjectURL(base64ToBlob(data, mimeType));
            urlsRef.current.push(url);
            const cleanup = () => {
              if (finishPlaybackRef.current === cleanup) finishPlaybackRef.current = null;
              URL.revokeObjectURL(url);
              urlsRef.current = urlsRef.current.filter((item) => item !== url);
              resolve();
            };
            finishPlaybackRef.current = cleanup;
            audio.onended = cleanup;
            audio.onerror = cleanup;
            audio.src = url;
            requestPlayback();
          })
      )
      .catch(() => undefined);
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlaying = () => {
      playbackBlockedRef.current = false;
      setMessage(null);
    };
    audio.addEventListener("playing", onPlaying);
    return () => audio.removeEventListener("playing", onPlaying);
  }, []);

  useEffect(() => {
    if (!listening) return;
    let closedByClient = false;
    let usingHttpFallback = false;
    let pollTimer: number | null = null;
    let pollController: AbortController | null = null;
    let lastSequence = 0;
    let startedAt: string | null = null;

    const handleAudioPayload = (data:
      | {
          type: "status";
          active: boolean;
          sequence: number;
          startedAt: string | null;
          mimeType: string | null;
        }
      | { type: "chunk"; sequence: number; mimeType: string; data: string; createdAt: number }) => {
      if (data.type === "status") {
        if (data.active && data.startedAt !== startedAt) {
          startedAt = data.startedAt;
          lastSequence = 0;
          prepareAudioStream();
        }
        setActive(data.active);
        setMessage(data.active ? null : "Waiting for live audio commentary.");
        if (!data.active) {
          pendingBuffersRef.current = [];
          playbackBlockedRef.current = false;
        }
        return;
      }
      if (data.type === "chunk") {
        if (data.sequence <= lastSequence) return;
        lastSequence = Math.max(lastSequence, data.sequence);
        setActive(true);
        if (ensureSourceBuffer(data.mimeType)) {
          if (!playbackBlockedRef.current) setMessage(null);
          pendingBuffersRef.current.push(base64ToArrayBuffer(data.data));
          if (pendingBuffersRef.current.length > 48) pendingBuffersRef.current.splice(0, pendingBuffersRef.current.length - 48);
          appendPendingBuffer();
        } else {
          if (!playbackBlockedRef.current) setMessage(null);
          playFallbackChunk(data.data, data.mimeType);
        }
      }
    };

    const startHttpFallback = () => {
      if (usingHttpFallback || closedByClient) return;
      usingHttpFallback = true;
      setMessage("Using network-safe live audio mode.");
      const poll = async () => {
        if (closedByClient) return;
        pollController?.abort();
        pollController = new AbortController();
        try {
          const data = await fetchLiveAudioPoll(matchId, lastSequence, pollController.signal);
          if (closedByClient) return;
          handleAudioPayload({ type: "status", ...data });
          if (!data.active && !data.chunks.length) {
            setMessage("Waiting for live audio commentary.");
          }
          data.chunks
            .slice()
            .sort((a, b) => a.sequence - b.sequence)
            .forEach((chunk) => handleAudioPayload(chunk));
          pollTimer = window.setTimeout(poll, data.active ? 900 : 2000);
        } catch (error) {
          if (!closedByClient && !isAbortError(error)) {
            setMessage("Live audio is unavailable right now.");
            pollTimer = window.setTimeout(poll, 3000);
          }
        }
      };
      void poll();
    };

    const socket = new WebSocket(
      liveAudioSocketUrl(`/api/v1/live-audio/listen/${encodeURIComponent(matchId)}`)
    );
    const connectTimeout = window.setTimeout(() => {
      if (socket.readyState !== WebSocket.OPEN) { startHttpFallback(); socket.close(); }
    }, 6000);

    socket.onopen = () => {
      window.clearTimeout(connectTimeout);
      setMessage("Waiting for live audio commentary.");
    };
    socket.onmessage = (event) => {
      if (closedByClient || usingHttpFallback) return;
      try {
        const data = JSON.parse(String(event.data)) as
          | {
              type: "status";
              active: boolean;
              sequence: number;
              startedAt: string | null;
              mimeType: string | null;
            }
          | { type: "chunk"; sequence: number; mimeType: string; data: string; createdAt: number };
        handleAudioPayload(data);
      } catch (error) {
        setMessage("Live audio is having trouble playing.");
      }
    };
    socket.onerror = () => {
      if (!closedByClient) startHttpFallback();
    };
    socket.onclose = (event) => {
      window.clearTimeout(connectTimeout);
      setActive(false);
      if (!closedByClient && !usingHttpFallback && event.code !== 1000 && event.code !== 1008) {
        startHttpFallback();
      } else if (event.code === 1008) {
        setMessage("Live audio is not available for this match yet.");
      } else if (event.code === 1000 || closedByClient) {
        setMessage(null);
        playbackBlockedRef.current = false;
      } else if (!closedByClient && !usingHttpFallback) {
        setMessage("Live audio was interrupted. Tap Listen live to try again.");
      }
    };
    return () => {
      closedByClient = true;
      window.clearTimeout(connectTimeout);
      if (pollTimer) window.clearTimeout(pollTimer);
      pollController?.abort();
      socket.close(1000, "Listener stopped live audio");
      clearAudioStream();
    };
  }, [listening, matchId]);

  useEffect(
    () => () => {
      clearAudioStream();
    },
    []
  );

  return (
    <div className="sbm-live-audio">
      <button
        type="button"
        className={listening ? "sbm-live-audio__btn is-listening" : "sbm-live-audio__btn"}
        onClick={() => {
          if (!listening) prepareAudioStream();
          else clearAudioStream();
          setListening((value) => !value);
          setMessage(null);
        }}
      >
        <span className={active ? "sbm-live-dot" : "sbm-live-audio__idle"} aria-hidden="true" />
        {listening ? "Stop listening" : "Listen live audio"}
      </button>
      <audio ref={audioRef} className="sbm-live-audio__element" aria-hidden="true" />
      {message && <span className="sbm-live-audio__msg">{message}</span>}
    </div>
  );
}

function LiveMatchModal({
  match,
  onClose,
}: {
  match: SbMatchDetail;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"timeline" | "stats">("timeline");
  const liveSheet = match.liveSheet;
  const liveClockLabel = useLiveClockLabel(liveSheet?.clock);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!liveSheet) return null;

  return (
    <div className="sbm-live-modal" role="dialog" aria-modal="true" aria-labelledby="sbm-live-title">
      <button className="sbm-live-modal__scrim" type="button" onClick={onClose} aria-label="Close live match view" />
      <section className="sbm-live-modal__panel">
        <header className="sbm-live-modal__head">
          <div>
            <span className="sbm-live-kicker">
              <span className="sbm-live-dot" aria-hidden="true" />
              Live Match Feed
              {liveClockLabel && <strong className="sbm-live-clock">{liveClockLabel}</strong>}
            </span>
            <h2 id="sbm-live-title">
              {match.homeTeam.shortName ?? match.homeTeam.name} {liveSheet.score.home}
              <span> - </span>
              {liveSheet.score.away} {match.awayTeam.shortName ?? match.awayTeam.name}
            </h2>
            <p>{formatLiveUpdate(liveSheet.updatedAt)}</p>
          </div>
          <button type="button" className="sbm-live-modal__close" onClick={onClose} aria-label="Close live match view">
            ×
          </button>
        </header>

        <div className="sbm-live-switch" role="tablist" aria-label="Live match view">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "timeline"}
            className={mode === "timeline" ? "is-active" : undefined}
            onClick={() => setMode("timeline")}
          >
            Timeline
            <span>{liveSheet.events.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "stats"}
            className={mode === "stats" ? "is-active" : undefined}
            onClick={() => setMode("stats")}
          >
            Statistics
          </button>
        </div>
        {match.stats?.liveFeature?.audioEnabled && <LiveAudioListener matchId={match.id} />}

        <div className="sbm-live-modal__body">
          {mode === "timeline" ? (
            <EventTimeline
              events={liveSheet.events}
              homeTeam={match.homeTeam}
              awayTeam={match.awayTeam}
              competition={match.competition.name}
              order="latest"
            />
          ) : (
            <div className="sbm-stats-card sbm-stats-card--live">
              <MatchStatsBars
                stats={liveSheet.stats}
                homeTeam={match.homeTeam}
                awayTeam={match.awayTeam}
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function MatchCenterSkeleton({ squadsTab }: { squadsTab?: boolean }) {
  return (
    <div className="sb-page dbx-page sbm-page" aria-busy="true">
      <span className="dtp-skeleton" style={{ height: "2.5rem", width: "100%", borderRadius: "var(--radius-md)" }} />
      <div className="sbm-meta">
        <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "8rem" }} />
        <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "5rem" }} />
        <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "6rem" }} />
      </div>
      <div className="sbm-hero sbm-hero--skeleton">
        <span className="dtp-skeleton" style={{ height: "4rem", width: "100%" }} />
        <span className="dtp-skeleton" style={{ height: "3.5rem", width: "40%", margin: "0 auto" }} />
        <span className="dtp-skeleton" style={{ height: "4rem", width: "100%" }} />
      </div>
      <div className="sbc-overview">
        {squadsTab ? (
          <section className="sbc-block">
            <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "20%" }} />
            <MatchSquadsSkeleton />
          </section>
        ) : (
          <>
            <section className="sbc-block">
              <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "30%" }} />
              <span className="dtp-skeleton" style={{ height: "12rem", width: "100%", borderRadius: "var(--radius-md)" }} />
            </section>
            <section className="sbc-block">
              <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "25%" }} />
              <span className="dtp-skeleton" style={{ height: "10rem", width: "100%", borderRadius: "var(--radius-md)" }} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export function MatchCenterPage() {
  const { matchSlug } = useParams<{ matchSlug: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<MatchTab>(
    initialTab && TAB_IDS.has(initialTab) ? (initialTab as MatchTab) : "timeline"
  );
  const [match, setMatch] = useState<SbMatchDetail | null>(null);
  const [matchSquads, setMatchSquads] = useState<SbMatchSquadsResponse | null>(null);
  const [squadsLoading, setSquadsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveModalOpen, setLiveModalOpen] = useState(false);
  const [goalAlertsEnabled, setGoalAlertsEnabled] = useState(() => {
    try {
      return localStorage.getItem(GOAL_ALERTS_KEY) === "on";
    } catch {
      return false;
    }
  });
  const [goalAlert, setGoalAlert] = useState<GoalAlertState | null>(null);
  const seenLiveEventIds = useRef<Set<string> | null>(null);
  const goalWhistleAudio = useRef<HTMLAudioElement | null>(null);
  // `number`, not `ReturnType<typeof setTimeout>`: this holds the handle from
  // `window.setTimeout`, which is a number in a browser. The generic form resolves
  // to Node's `Timeout` whenever @types/node is in scope, so the two disagreed as
  // soon as a dependency pulled those types in.
  const goalAlertTimer = useRef<number | null>(null);

  const selectTab = (tab: MatchTab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    if (tab === "timeline") next.delete("tab");
    else next.set("tab", tab);
    setSearchParams(next, { replace: true });
  };

  usePageTitle(
    match
      ? `${match.homeTeam.shortName ?? match.homeTeam.name} vs ${match.awayTeam.shortName ?? match.awayTeam.name}`
      : "Match"
  );

  useEffect(() => {
    if (!matchSlug) return;
    const controller = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const load = () =>
      fetchMatch(matchSlug, controller.signal)
        .then((data) => {
          if (cancelled) return;
          if (isMatchUuid(matchSlug) && data.slug && data.slug !== matchSlug) {
            const qs = searchParams.toString();
            navigate(`${matchCenterPath(data)}${qs ? `?${qs}` : ""}`, { replace: true });
            return;
          }
          setMatch(data);
          setLoading(false);
          if (data.status === "finished" && timer) {
            clearInterval(timer);
            timer = undefined;
          }
        })
        .catch((e) => {
          if (cancelled || isAbortError(e)) return;
          setError(publicFixtureErrorMessage(e));
          setLoading(false);
        });

    setMatch(null);
    setError(null);
    setLoading(true);
    load();
    timer = setInterval(load, 5000);

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [matchSlug, navigate, searchParams]);

  useEffect(() => {
    if (!matchSlug || activeTab !== "squads") return;
    const controller = new AbortController();
    setSquadsLoading(true);
    fetchMatchSquads(matchSlug, controller.signal)
      .then((data) => setMatchSquads(data))
      .catch((e) => {
        const message = publicFixtureErrorMessage(e);
        if (message) setError(message);
      })
      .finally(() => setSquadsLoading(false));

    return () => controller.abort();
  }, [matchSlug, activeTab]);

  const compLabel = useMemo(
    () => (match ? competitionLabel(match.competition.name) : ""),
    [match]
  );
  const gameComment = useMemo(() => {
    const text = match?.matchComment;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  }, [match]);
  const matchPhotos = useMemo(() => {
    if (!match) return [];
    if (match.photos?.length) return match.photos;
    return parseMatchPhotos(match.meta);
  }, [match]);
  const liveSheet = match?.liveSheet ?? null;
  const liveClockLabel = useLiveClockLabel(liveSheet?.clock);
  const squadsTabFromUrl = initialTab === "squads";

  useEffect(() => {
    if (!liveSheet) setLiveModalOpen(false);
  }, [liveSheet]);

  useEffect(() => {
    if (!liveSheet) {
      seenLiveEventIds.current = null;
      return;
    }
    const currentIds = new Set(liveSheet.events.map((event) => event.id));
    if (!seenLiveEventIds.current) {
      seenLiveEventIds.current = currentIds;
      return;
    }
    const newGoals = liveSheet.events.filter(
      (event) => !seenLiveEventIds.current?.has(event.id) && isGoalEvent(event.type)
    );
    seenLiveEventIds.current = currentIds;
    if (!goalAlertsEnabled || newGoals.length === 0) return;

    const latest = newGoals[newGoals.length - 1];
    const scoringTeamId = match ? scoringTeamIdForLiveEvent(latest, match) : latest.teamId;
    const scoringTeam =
      scoringTeamId === match?.homeTeam.id
        ? match.homeTeam.shortName ?? match.homeTeam.name
        : scoringTeamId === match?.awayTeam.id
          ? match.awayTeam.shortName ?? match.awayTeam.name
          : "Goal";
    const player = latest.player?.displayName ?? latest.playerLabel;
    const title = "GOAL";
    const body = [
      scoringTeam,
      latest.type === "own_goal"
        ? player
          ? `Own goal by ${player}`
          : "Own goal recorded"
        : player
          ? `${player} scored`
          : "A goal has been recorded",
      `${latest.minute}'`,
    ].join(" · ");

    playGoalWhistle(goalWhistleAudio);
    vibrateGoalAlert();
    setGoalAlert({
      title,
      body,
      score: `${liveSheet.score.home}-${liveSheet.score.away}`,
    });
    if (goalAlertTimer.current) window.clearTimeout(goalAlertTimer.current);
    goalAlertTimer.current = window.setTimeout(() => setGoalAlert(null), 8500);
    showGoalNotification(title, body, `dtp-goal-${match?.id ?? matchSlug}`);
  }, [goalAlertsEnabled, liveSheet, match, matchSlug]);

  const enableGoalAlerts = async () => {
    unlockGoalAudio(goalWhistleAudio);
    let notificationStatus: NotificationPermission | "unsupported" = "unsupported";
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      notificationStatus = await Notification.requestPermission();
    } else if (typeof Notification !== "undefined") {
      notificationStatus = Notification.permission;
    }
    setGoalAlertsEnabled(true);
    try {
      localStorage.setItem(GOAL_ALERTS_KEY, "on");
    } catch {
      /* Non-persistent storage just means the user can enable again next time. */
    }
    if (goalAlertTimer.current) window.clearTimeout(goalAlertTimer.current);
    setGoalAlert({
      title: "Goal Alerts Ready",
      body:
        notificationStatus === "granted"
          ? "This browser will alert you when a goal is recorded."
          : "In-tab alerts are on. Phone notifications need browser permission support.",
      score: "DTP",
    });
    goalAlertTimer.current = window.setTimeout(() => setGoalAlert(null), 6500);
  };

  if (error) {
    return (
      <div className="sb-page dbx-page sbm-page">
        <p className="dtp-error-banner" role="alert">
          {error}
        </p>
        <Link to="/scoreboard" className="sbm-back text-link">
          ← Back to ScoreBoard
        </Link>
      </div>
    );
  }

  if (loading || !match) {
    return <MatchCenterSkeleton squadsTab={squadsTabFromUrl || activeTab === "squads"} />;
  }

  const kind = statusKind(match.status);
  const displayStatus =
    liveSheet?.status === "submitted" || liveSheet?.clock?.phase === "finished"
      ? "finished"
      : liveSheet?.clock?.phase === "awaiting_second_half"
        ? "halftime"
        : liveSheet
          ? "live"
          : match.status;
  const displayMinute =
    liveSheet?.clock && liveSheet.clock.phase !== "pre_kickoff"
      ? Math.max(1, Math.floor((liveClockSeconds(liveSheet.clock) ?? 0) / 60) + 1)
      : match.minute;
  const live = kind === "live" || kind === "ht" || Boolean(liveSheet);
  const displayScore = liveSheet?.score ?? { home: match.homeScore, away: match.awayScore };
  const hasScore = match.status !== "scheduled" || Boolean(liveSheet);
  const kickoff = formatKickoff(match.kickoffAt);
  const dayLabel = matchdayLabel(match);

  return (
    <div className={`sb-page dbx-page sbm-page${live ? " sbm-page--live" : ""}`}>

      <nav className="sbm-nav" aria-label="Match navigation">
        <Link to={`/scoreboard/competition/${match.competition.slug}`} className="sbm-back text-link">
          ← {match.competition.name}
        </Link>
        <Link to="/scoreboard" className="sbm-back text-link">
          ScoreBoard home
        </Link>
      </nav>

      <div className="sbm-meta" aria-label="Match meta">
        <span className="sbc-pill sbc-pill--official">{compLabel.toUpperCase()}</span>
        <span className="sbc-pill sbc-pill--year">{dayLabel}</span>
        <span
          className={`sbc-pill ${
            live
              ? "sbc-pill--live"
              : kind === "ft"
                ? "sbc-pill--done"
                : kind === "scheduled"
                  ? "sbc-pill--scheduled"
                  : ""
          }`}
        >
          {statusLabel(displayStatus, displayMinute)}
        </span>
      </div>

      {liveSheet && (
        <section className="sbm-live-callout sbm-live-callout--attached" aria-label="Live match feed">
          <div>
            <span className="sbm-live-kicker">
              <span className="sbm-live-dot" aria-hidden="true" />
              Live Feed
              {liveClockLabel && <strong className="sbm-live-clock">{liveClockLabel}</strong>}
            </span>
            <strong>
              {match.homeTeam.name} {liveSheet.score.home}
              <span> - </span>
              {liveSheet.score.away} {match.awayTeam.name}
            </strong>
            <p>
              {liveSheet.events.length} event{liveSheet.events.length === 1 ? "" : "s"} logged ·{" "}
              {formatLiveUpdate(liveSheet.updatedAt)}
            </p>
          </div>
          <div className="sbm-live-callout__actions">
            <button type="button" className="sbm-live-callout__button" onClick={() => setLiveModalOpen(true)}>
              Open Live
            </button>
            <button
              type="button"
              className="sbm-live-callout__button sbm-live-callout__button--ghost"
              onClick={() => void enableGoalAlerts()}
            >
              {goalAlertsEnabled ? "Goal Alerts On" : "Enable Goal Alerts"}
            </button>
          </div>
        </section>
      )}

      <header className={`sbm-hero${live ? " sbm-hero--live" : ""}${liveSheet ? " sbm-hero--attached-live" : ""}`}>
        <div className="sbm-hero__team sbm-hero__team--home">
          <Link to={`/scoreboard/team/${match.homeTeam.id}`} className="sbm-hero__team-link">
            <TeamCrest team={match.homeTeam} />
            <span className="sbm-hero__name">{match.homeTeam.name}</span>
          </Link>
        </div>

        <div className="sbm-hero__center">
          <div className="sbm-hero__score" aria-label="Scoreline">
            {hasScore ? (
              <>
                <span className="sbm-hero__score-num">{displayScore.home}</span>
                <span className="sbm-hero__score-dash">–</span>
                <span className="sbm-hero__score-num">{displayScore.away}</span>
              </>
            ) : (
              <span className="sbm-hero__vs">vs</span>
            )}
          </div>
          {!hasScore && kickoff && <span className="sbm-hero__kickoff">{kickoff}</span>}
          {match.meta?.penaltyShootout && (
            <span className="sbm-hero__penalties">
              Pens {match.meta.penaltyShootout.home}–{match.meta.penaltyShootout.away}
            </span>
          )}
        </div>

        <div className="sbm-hero__team sbm-hero__team--away">
          <Link to={`/scoreboard/team/${match.awayTeam.id}`} className="sbm-hero__team-link">
            <TeamCrest team={match.awayTeam} />
            <span className="sbm-hero__name">{match.awayTeam.name}</span>
          </Link>
        </div>
      </header>

      <div className="sbm-pills">
        {match.roundLabel && <span className="sbm-pill">{match.roundLabel}</span>}
        {match.venue && <span className="sbm-pill">{match.venue}</span>}
        {kickoff && hasScore && <span className="sbm-pill">{kickoff}</span>}
        {match.meta?.goalScorers && (
          <span className="sbm-pill">Scorers: {match.meta.goalScorers}</span>
        )}
      </div>

      {match.recordedVideo && (
        <div className="sbm-recorded">
          <a
            className="sbm-recorded__button"
            href={match.recordedVideo.youtubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={match.recordedVideo.title}
          >
            <span className="sbm-recorded__icon" aria-hidden="true">
              ▶
            </span>
            Watch Recorded Video
          </a>
        </div>
      )}

      <AdPlacement slotKey="matchCenterInline" />

      {goalAlert && (
        <div className="sbm-goal-toast" role="alert" aria-live="assertive">
          <img src="/brand/favicon-white.png" alt="" aria-hidden="true" />
          <span>
            <strong>{goalAlert.title}</strong>
            <em>{goalAlert.body}</em>
          </span>
          <b>{goalAlert.score}</b>
        </div>
      )}

      <div className="dbx-segmented sbc-tabs sbm-tabs" role="tablist" aria-label="Match sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`sbm-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`sbm-panel-${tab.id}`}
            className={activeTab === tab.id ? "dbx-segmented__btn active" : "dbx-segmented__btn"}
            onClick={() => selectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="sbc-overview">
        {activeTab === "timeline" && (
          <section
            className="sbc-block"
            role="tabpanel"
            id="sbm-panel-timeline"
            aria-labelledby="sbm-tab-timeline"
          >
            <h2 className="sbc-block__title">Match Timeline</h2>
            <EventTimeline
              events={match.events}
              homeTeam={match.homeTeam}
              awayTeam={match.awayTeam}
              competition={compLabel}
            />
          </section>
        )}

        {activeTab === "stats" && (
          <section
            className="sbc-block"
            role="tabpanel"
            id="sbm-panel-stats"
            aria-labelledby="sbm-tab-stats"
          >
            {gameComment && (
              <>
                <h2 className="sbc-block__title">Match Report</h2>
                <article className="sbc-narrative sbm-narrative">
                  {renderMatchReport(gameComment)}
                </article>
              </>
            )}
            <h2 className="sbc-block__title">Match Statistics</h2>
            <div className="sbm-stats-card">
              <MatchStatsBars stats={match.stats} homeTeam={match.homeTeam} awayTeam={match.awayTeam} />
            </div>
          </section>
        )}

        {activeTab === "video" && (
          <section
            className="sbc-block"
            role="tabpanel"
            id="sbm-panel-video"
            aria-labelledby="sbm-tab-video"
          >
            <h2 className="sbc-block__title">Video Highlight</h2>
            {match.highlights.length > 0 ? (
              <div className="sb-hl-grid">
                {match.highlights.map((highlight) => (
                  <HighlightCard key={highlight.id} highlight={highlight} inlinePlayer />
                ))}
              </div>
            ) : (
              <div className="dtp-empty-state">
                <p className="dtp-empty-state__title">No video highlights yet</p>
                <p>Published clips and reels linked to this match will show here.</p>
              </div>
            )}
          </section>
        )}

        {activeTab === "photos" && (
          <section
            className="sbc-block"
            role="tabpanel"
            id="sbm-panel-photos"
            aria-labelledby="sbm-tab-photos"
          >
            <h2 className="sbc-block__title">Match Photos</h2>
            {matchPhotos.length > 0 ? (
              <MatchPhotosGrid photos={matchPhotos} />
            ) : (
              <MatchPhotosEmpty />
            )}
          </section>
        )}

        {activeTab === "squads" && (
          <section
            className="sbc-block"
            role="tabpanel"
            id="sbm-panel-squads"
            aria-labelledby="sbm-tab-squads"
          >
            <h2 className="sbc-block__title">Squads</h2>
            {squadsLoading ? (
              <MatchSquadsSkeleton />
            ) : (
              <MatchSquadsGrid
                homeTeam={match.homeTeam}
                awayTeam={match.awayTeam}
                competition={compLabel}
                stats={match.stats}
                matchSquads={matchSquads}
              />
            )}
          </section>
        )}
      </div>

      {liveModalOpen && <LiveMatchModal match={match} onClose={() => setLiveModalOpen(false)} />}
    </div>
  );
}
