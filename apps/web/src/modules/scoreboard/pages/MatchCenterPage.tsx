import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  fetchMatch,
  type SbMatchDetail,
} from "../../../api/scoreboard";
import { isAbortError } from "../../../api/client";
import { EventTimeline } from "../components/EventTimeline";
import { HighlightCard } from "../components/HighlightCard";
import { MatchSquadsGrid, MatchSquadsSkeleton } from "../components/MatchSquadPanel";
import { MatchStatsBars } from "../components/MatchStatsBars";
import { MatchTicker } from "../components/MatchTicker";
import { TeamCrest } from "../components/TeamCrest";
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
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<MatchTab>(
    initialTab && TAB_IDS.has(initialTab) ? (initialTab as MatchTab) : "timeline"
  );
  const [match, setMatch] = useState<SbMatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    if (!id) return;
    const controller = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const load = () =>
      fetchMatch(id, controller.signal)
        .then((data) => {
          if (cancelled) return;
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
  }, [id]);

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
  const squadsTabFromUrl = initialTab === "squads";

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
      <MatchTicker />

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
      </div>

      <AdPlacement slotKey="matchCenterInline" />

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
                  <p className="sbc-narrative__text">{gameComment}</p>
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
            <MatchSquadsGrid
              homeTeam={match.homeTeam}
              awayTeam={match.awayTeam}
              competition={compLabel}
              stats={match.stats}
            />
          </section>
        )}
      </div>
    </div>
  );
}
