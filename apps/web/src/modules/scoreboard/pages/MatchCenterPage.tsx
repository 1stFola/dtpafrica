import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
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

type StatusKind = "live" | "ht" | "ft" | "scheduled" | "other";

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

function isGoalEvent(type: string): boolean {
  return type === "goal" || type === "goal_penalty" || type === "own_goal";
}

function playGoalWhistle(ctxRef: MutableRefObject<AudioContext | null>) {
  if (typeof window === "undefined") return;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  try {
    const ctx = ctxRef.current ?? new Ctor();
    ctxRef.current = ctx;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.28, now + 0.02);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.15);
    master.connect(ctx.destination);

    [0, 0.34].forEach((offset) => {
      const whistle = ctx.createOscillator();
      const gain = ctx.createGain();
      whistle.type = "sine";
      whistle.frequency.setValueAtTime(1560, now + offset);
      whistle.frequency.exponentialRampToValueAtTime(1180, now + offset + 0.24);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.9, now + offset + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.28);
      whistle.connect(gain).connect(master);
      whistle.start(now + offset);
      whistle.stop(now + offset + 0.32);
    });
  } catch {
    /* Browser audio is best-effort: notifications still carry the alert. */
  }
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
            </span>
            <h2 id="sbm-live-title">
              {match.homeTeam.shortName ?? match.homeTeam.name} {liveSheet.score.home}
              <span> - </span>
              {liveSheet.score.away} {match.awayTeam.shortName ?? match.awayTeam.name}
            </h2>
            <p>
              {formatLiveUpdate(liveSheet.updatedAt)}
              {liveSheet.recorderName ? ` by ${liveSheet.recorderName}` : ""}
            </p>
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
  const [goalAlert, setGoalAlert] = useState<string | null>(null);
  const seenLiveEventIds = useRef<Set<string> | null>(null);
  const goalAudioContext = useRef<AudioContext | null>(null);

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
          setError(String(e));
          setLoading(false);
        });

    setMatch(null);
    setError(null);
    setLoading(true);
    load();
    timer = setInterval(load, 15000);

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
        if (!isAbortError(e)) setError(String(e));
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
    const scoringTeam =
      latest.teamId === match?.homeTeam.id
        ? match.homeTeam.shortName ?? match.homeTeam.name
        : latest.teamId === match?.awayTeam.id
          ? match.awayTeam.shortName ?? match.awayTeam.name
          : "Goal";
    const player = latest.player?.displayName ?? latest.playerLabel;
    const title = `${scoringTeam} goal`;
    const body = [
      player ? `${player} scored` : "A goal has been recorded",
      `${liveSheet.score.home}-${liveSheet.score.away}`,
      `${latest.minute}'`,
    ].join(" · ");

    playGoalWhistle(goalAudioContext);
    setGoalAlert(`${title}: ${body}`);
    window.setTimeout(() => setGoalAlert(null), 7000);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, {
        body,
        tag: `dtp-goal-${match?.id ?? matchSlug}`,
      });
    }
  }, [goalAlertsEnabled, liveSheet, match, matchSlug]);

  const enableGoalAlerts = async () => {
    playGoalWhistle(goalAudioContext);
    let allowed = true;
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      allowed = (await Notification.requestPermission()) === "granted";
    } else if (typeof Notification !== "undefined") {
      allowed = Notification.permission === "granted";
    }
    setGoalAlertsEnabled(allowed);
    try {
      localStorage.setItem(GOAL_ALERTS_KEY, allowed ? "on" : "off");
    } catch {
      /* Non-persistent storage just means the user can enable again next time. */
    }
    setGoalAlert(
      allowed
        ? "Goal alerts enabled for this browser."
        : "Browser notifications are blocked, but this tab can still show live updates."
    );
    window.setTimeout(() => setGoalAlert(null), 6000);
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
  const live = kind === "live" || kind === "ht";
  const hasScore = match.status !== "scheduled";
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
          {statusLabel(match.status, match.minute)}
        </span>
      </div>

      <header className={`sbm-hero${live ? " sbm-hero--live" : ""}`}>
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
                <span className="sbm-hero__score-num">{match.homeScore}</span>
                <span className="sbm-hero__score-dash">–</span>
                <span className="sbm-hero__score-num">{match.awayScore}</span>
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

      <AdPlacement slotKey="matchCenterInline" />

      {liveSheet && (
        <section className="sbm-live-callout" aria-label="Live match feed">
          <div>
            <span className="sbm-live-kicker">
              <span className="sbm-live-dot" aria-hidden="true" />
              Live Feed
            </span>
            <strong>
              {match.homeTeam.shortName ?? match.homeTeam.name} {liveSheet.score.home}
              <span> - </span>
              {liveSheet.score.away} {match.awayTeam.shortName ?? match.awayTeam.name}
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

      {goalAlert && (
        <div className="sbm-goal-toast" role="status" aria-live="polite">
          {goalAlert}
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
