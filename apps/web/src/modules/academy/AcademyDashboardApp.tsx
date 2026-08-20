import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  fetchAcademyDashboard,
  submitAcademyPlayerChangeRequest,
  submitAcademyProfileChangeRequest,
  type AcademyDashboard,
  type AcademyFixture,
  type AcademyMediaItem,
  type AcademySquadPlayer,
} from "../../api/academy";
import { isAbortError } from "../../api/client";
import { usePageTitle } from "../../hooks/usePageTitle";
import { InfoTip } from "../../components/InfoTip";
import { useAcademyAuth } from "./AcademyAuthContext";
import { matchCenterPath } from "../scoreboard/utils/matchPath";

const navItems = [
  { id: "overview", label: "Dashboard" },
  { id: "players", label: "Players" },
  { id: "development", label: "Development" },
  { id: "matches", label: "Matches" },
  { id: "philosophy", label: "Playing Philosophy" },
  { id: "valuation", label: "Market Valuation" },
  { id: "media", label: "Media Library" },
  { id: "settings", label: "Settings" },
] as const;

type DashboardSection = (typeof navItems)[number]["id"];

const legacySectionRedirects: Record<string, DashboardSection> = {
  squad: "players",
  fixtures: "matches",
};

function formatDate(value?: string | null) {
  if (!value) return "Date pending";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatCurrencyRange(min?: number | null, max?: number | null) {
  if (!min && !max) return "Pending";
  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
  if (min && max) return `${formatter.format(min)} - ${formatter.format(max)}`;
  return formatter.format(min ?? max ?? 0);
}

function scoreClass(value?: number | null) {
  if (value == null) return "academy-score academy-score--muted";
  if (value >= 75) return "academy-score academy-score--high";
  if (value >= 60) return "academy-score academy-score--mid";
  return "academy-score academy-score--low";
}

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function academyInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "AC";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function uniqueOptions(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort();
}

function fixtureTitle(fixture: AcademyFixture) {
  return `${fixture.homeTeam.shortName ?? fixture.homeTeam.name} ${fixture.score.home}-${fixture.score.away} ${fixture.awayTeam.shortName ?? fixture.awayTeam.name}`;
}

function mediaHref(item: AcademyMediaItem) {
  return item.url;
}

function splitLines(value: string) {
  return value
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isYouTubeUrl(value: string) {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}

function AcademyHeroBanner({
  academy,
  playerCount,
}: {
  academy: AcademyDashboard["academy"];
  playerCount: number;
}) {
  const initials = academyInitials(academy.name);
  const hasLogo = Boolean(academy.logoUrl?.trim());

  return (
    <section
      className={`academy-hero${hasLogo ? " academy-hero--branded" : " academy-hero--initials"}`}
      style={
        hasLogo
          ? ({ ["--academy-hero-bg" as string]: `url("${academy.logoUrl}")` })
          : undefined
      }
      aria-label={`${academy.name} command centre`}
    >
      <div className="academy-hero__backdrop" aria-hidden="true">
        {!hasLogo && <span className="academy-hero__initials">{initials}</span>}
      </div>
      <div className="academy-hero__overlay" aria-hidden="true" />
      <div className="academy-hero__body">
        <div className="academy-hero__content">
          {hasLogo && (
            <span className="academy-hero__crest" aria-hidden="true">
              <img src={academy.logoUrl!} alt="" />
            </span>
          )}
          <div className="academy-hero__heading">
            <p className="eyebrow">Academy command centre</p>
            <h1>{academy.name}</h1>
            <p className="academy-hero__lede">
              Which players are improving, valuable, tactically useful, and ready for
              exposure?
            </p>
          </div>
        </div>
        <div className="academy-hero__meta">
          <span className="academy-metric-chip">
            <span className="academy-metric-chip__label">Squad size</span>
            <strong className="academy-metric-chip__value">
              {playerCount}
              <small>{playerCount === 1 ? "player" : "players"}</small>
            </strong>
          </span>
        </div>
      </div>
    </section>
  );
}

export function AcademyDashboardApp() {
  const { slug = "dtp-lagos-hub" } = useParams<{ slug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAcademyAuth();
  const [data, setData] = useState<AcademyDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  usePageTitle(data ? `${data.academy.name} Dashboard` : "Academy Dashboard");

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setData(null);
    setError(null);
    fetchAcademyDashboard(slug, controller.signal)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled && !isAbortError(err)) setError(String(err));
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [slug]);

  useEffect(() => {
    const tail = location.pathname.split(`/academy/${slug}/dashboard`)[1] ?? "";
    const segment = tail.split("/").filter(Boolean)[0];
    const target = legacySectionRedirects[segment];
    if (target) {
      navigate(`/academy/${slug}/dashboard/${target}`, { replace: true });
    }
  }, [location.pathname, slug, navigate]);

  const section = useMemo<DashboardSection>(() => {
    const tail = location.pathname.split(`/academy/${slug}/dashboard`)[1] ?? "";
    const segment = tail.split("/").filter(Boolean)[0];
    const resolved = legacySectionRedirects[segment] ?? segment;
    return navItems.find((item) => item.id === resolved)?.id ?? "overview";
  }, [location.pathname, slug]);

  if (error) {
    return (
      <div className="academy-dashboard">
        <div>
          <p className="dtp-error-banner" role="alert">
            {error}
          </p>
          <Link to="/academy" className="text-link">
            ← Back to academies
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="academy-dashboard" aria-busy="true">
        <aside className="academy-sidebar">
          <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "70%" }} />
          <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "90%" }} />
          <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "80%" }} />
        </aside>
        <main className="academy-main">
          <div className="dtp-skeleton" style={{ height: "9rem", borderRadius: "28px" }} />
          <div className="academy-kpi-grid" style={{ marginTop: "1.25rem" }}>
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="dtp-skeleton" style={{ height: "8rem", borderRadius: "22px" }} />
            ))}
          </div>
        </main>
      </div>
    );
  }

  const basePath = `/academy/${data.academy.slug}/dashboard`;

  const handleLogout = () => {
    logout();
    navigate("/academy/login", { replace: true });
  };

  return (
    <div className="academy-dashboard">
      <aside className="academy-sidebar">
        <div className="academy-sidebar__top">
          <Link to="/academy" className="academy-sidebar__brand">
            <span className="academy-sidebar__crest">
              {data.academy.logoUrl ? <img src={data.academy.logoUrl} alt="" /> : "DTP"}
            </span>
            <span>
              <strong>{data.academy.name}</strong>
              <small>{[data.academy.city, data.academy.country].filter(Boolean).join(", ")}</small>
            </span>
          </Link>
          <button
            type="button"
            className="academy-sidebar__logout"
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>
        <nav className="academy-sidebar__nav" aria-label="Academy dashboard">
          {navItems.map((item) => {
            const to = item.id === "overview" ? basePath : `${basePath}/${item.id}`;
            return (
              <NavLink
                key={item.id}
                to={to}
                end={item.id === "overview"}
                className={({ isActive }) =>
                  isActive || section === item.id ? "active" : undefined
                }
              >
                {item.label}
              </NavLink>
            );
          })}
        </nav>
      </aside>

      <main className="academy-main">
        <AcademyHeroBanner academy={data.academy} playerCount={data.squad.length} />

        {section === "overview" && <OverviewSection data={data} />}
        {section === "players" && <PlayersSection slug={data.academy.slug} players={data.squad} />}
        {section === "matches" && <MatchesSection fixtures={data.fixtures} />}
        {section === "development" && <DevelopmentSection data={data} />}
        {section === "philosophy" && <PhilosophySection data={data} />}
        {section === "valuation" && <ValuationSection data={data} />}
        {section === "media" && <MediaSection media={data.media} />}
        {section === "settings" && <SettingsSection data={data} />}
      </main>
    </div>
  );
}

function OverviewSection({ data }: { data: AcademyDashboard }) {
  return (
    <>
      <div className="academy-kpi-grid">
        {data.overview.kpis.map((kpi) => (
          <article key={kpi.id} className="academy-kpi">
            <span>{kpi.label}</span>
            <strong>{kpi.value ?? "Pending"}</strong>
            <small>{kpi.detail}</small>
          </article>
        ))}
      </div>

      <div className="academy-dashboard-grid">
        <section className="academy-panel">
          <div className="academy-panel__header">
            <h2>High-potential watchlist</h2>
            <Link to="players" className="text-link">
              View players
            </Link>
          </div>
          <div className="academy-player-card-grid">
            {data.overview.watchlist.map((player) => (
              <PlayerCard key={player.id} player={player} />
            ))}
            {data.overview.watchlist.length === 0 && (
              <p className="academy-empty">Link academy players to unlock the watchlist.</p>
            )}
          </div>
        </section>

        <section className="academy-panel">
          <div className="academy-panel__header">
            <h2>Activity feed</h2>
          </div>
          <ol className="academy-feed">
            {data.overview.activityFeed.map((item) => (
              <li key={item.id}>
                <span>{titleCase(item.type)}</span>
                {item.href.startsWith("/") ? (
                  <Link to={item.href}>{item.title}</Link>
                ) : (
                  <a href={item.href} target="_blank" rel="noreferrer">
                    {item.title}
                  </a>
                )}
                <small>
                  {item.detail} · {formatDate(item.at)}
                </small>
              </li>
            ))}
            {data.overview.activityFeed.length === 0 && (
              <li className="academy-empty">No activity yet.</li>
            )}
          </ol>
        </section>
      </div>

      <section className="academy-panel academy-panel--wide">
        <div className="academy-panel__header">
          <h2>Intelligence snapshot</h2>
        </div>
        <div className="academy-insight-grid">
          <InsightCard
            label="Development"
            value={data.development.leaders[0]?.displayName ?? "Needs data"}
            detail={data.development.indexMethod}
          />
          <InsightCard
            label="Playing philosophy"
            value={`${data.philosophy.defaultFormation} / ${data.philosophy.defaultPhilosophy}`}
            detail={data.philosophy.note}
          />
          <InsightCard
            label="Market valuation"
            value={formatCurrencyRange(
              data.valuation.totalValueRangeEur.min,
              data.valuation.totalValueRangeEur.max
            )}
            detail="Aggregated from latest market valuation runs."
          />
        </div>
      </section>
    </>
  );
}

function PlayerCard({ player }: { player: AcademySquadPlayer }) {
  return (
    <article className="academy-player-card">
      <div className="academy-player-card__top">
        <div className="academy-avatar">
          {player.playerPhotoUrl ? <img src={player.playerPhotoUrl} alt="" /> : player.displayName[0]}
        </div>
        <div>
          <Link to={player.profilePath}>{player.displayName}</Link>
          <small>
            {player.positionPrimary}
            {player.ageGroup ? ` · ${player.ageGroup}` : ""}
          </small>
        </div>
      </div>
      <div className="academy-score-row">
        <span className={scoreClass(player.developmentIndex)} title="Development index">
          {player.developmentIndex}
          <small>DEV</small>
        </span>
        <span className={scoreClass(player.tacticalFit)} title="Tactical fit">
          {player.tacticalFit ?? "N/A"}
          <small>FIT</small>
        </span>
        <span className={scoreClass(player.exposureReadiness)} title="Exposure readiness">
          {player.exposureReadiness}
          <small>EXP</small>
        </span>
      </div>
      <p>{player.valuation?.marketValueLabel ?? "Valuation pending"}</p>
    </article>
  );
}

function InsightCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="academy-insight-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function PlayersSection({ slug, players }: { slug: string; players: AcademySquadPlayer[] }) {
  const [ageGroup, setAgeGroup] = useState("all");
  const [position, setPosition] = useState("all");
  const [foot, setFoot] = useState("all");
  const [status, setStatus] = useState("all");
  const [selectedPlayerId, setSelectedPlayerId] = useState(players[0]?.id ?? "");
  const [displayName, setDisplayName] = useState("");
  const [photoUrls, setPhotoUrls] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [publicationUrls, setPublicationUrls] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const ageGroups = uniqueOptions(players.map((player) => player.ageGroup));
  const positions = uniqueOptions(players.map((player) => player.positionPrimary));
  const feet = uniqueOptions(players.map((player) => player.dominantFoot));
  const statuses = uniqueOptions(players.map((player) => player.status));

  const filtered = players.filter((player) => {
    if (ageGroup !== "all" && player.ageGroup !== ageGroup) return false;
    if (position !== "all" && player.positionPrimary !== position) return false;
    if (foot !== "all" && player.dominantFoot !== foot) return false;
    if (status !== "all" && player.status !== status) return false;
    return true;
  });

  const selectedPlayer = players.find((player) => player.id === selectedPlayerId) ?? players[0];

  useEffect(() => {
    if (!selectedPlayerId && players[0]?.id) {
      setSelectedPlayerId(players[0].id);
    }
  }, [players, selectedPlayerId]);

  const submitPlayerChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedPlayer) return;
    if (!isYouTubeUrl(videoUrl)) {
      setMessage({ type: "error", text: "Video Highlights URL must be a YouTube link." });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const photoList = splitLines(photoUrls);
      const publicationList = splitLines(publicationUrls);
      await submitAcademyPlayerChangeRequest(slug, selectedPlayer.id, {
        displayName: displayName.trim() || undefined,
        photoUrls: photoList.length ? photoList : undefined,
        videoUrl: videoUrl.trim() || undefined,
        publicationUrls: publicationList.length ? publicationList : undefined,
      });
      setDisplayName("");
      setPhotoUrls("");
      setVideoUrl("");
      setPublicationUrls("");
      setMessage({
        type: "success",
        text: "Player update sent for DTP review.",
      });
    } catch (err) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="academy-panel academy-panel--wide">
      <div className="academy-panel__header academy-panel__header--stacked">
        <div>
          <h2>Player intelligence</h2>
          <p>Filter by football traits and jump into the unified player profile.</p>
        </div>
      </div>
      <div className="academy-filters academy-filters--row">
        <FilterSelect label="Age group" value={ageGroup} options={ageGroups} onChange={setAgeGroup} />
        <FilterSelect label="Position" value={position} options={positions} onChange={setPosition} />
        <FilterSelect label="Foot" value={foot} options={feet} onChange={setFoot} />
        <FilterSelect label="Status" value={status} options={statuses} onChange={setStatus} />
      </div>
      <div className="academy-table-wrap">
        <table className="academy-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Category</th>
              <th>Foot</th>
              <th>Status</th>
              <th>Development</th>
              <th>Tactical fit</th>
              <th>Valuation</th>
              <th>ScoreBoard</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((player) => (
              <tr key={player.id}>
                <td>
                  <Link to={player.profilePath} className="text-link">
                    {player.displayName}
                  </Link>
                  <small>
                    {player.positionPrimary}
                    {player.positionSecondary ? ` / ${player.positionSecondary}` : ""}
                  </small>
                </td>
                <td>{player.ageGroup ?? "Pending"}</td>
                <td>{player.dominantFoot ?? "Pending"}</td>
                <td>
                  <span className="academy-pill">{player.status}</span>
                </td>
                <td>
                  <span className={scoreClass(player.developmentIndex)}>{player.developmentIndex}</span>
                </td>
                <td>
                  <span className={scoreClass(player.tacticalFit)}>{player.tacticalFit ?? "N/A"}</span>
                  <small>{player.tacticalTags.join(", ") || "Scouting data pending"}</small>
                </td>
                <td>{player.valuation?.marketValueLabel ?? "Pending"}</td>
                <td>
                  {player.scoreboard.matchesPlayed} apps
                  <small>{player.scoreboard.teams[0]?.teamName ?? "No team link"}</small>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="academy-empty">
                  No players match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form className="academy-change-form academy-change-form--player" onSubmit={submitPlayerChange}>
        <div className="academy-change-form__header">
          <div>
            <h3>Request player profile update</h3>
            <p>Name corrections and media updates are sent to DTP admin for approval.</p>
          </div>
          <span className="academy-pill">Review required</span>
        </div>
        <label>
          Player
          <select
            value={selectedPlayer?.id ?? ""}
            onChange={(event) => setSelectedPlayerId(event.target.value)}
          >
            {players.map((player) => (
              <option key={player.id} value={player.id}>
                {player.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name spelling correction
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={selectedPlayer?.displayName ?? "Correct display name"}
          />
        </label>
        <label>
          Profile picture and other photo URLs
          <textarea
            rows={4}
            value={photoUrls}
            onChange={(event) => setPhotoUrls(event.target.value)}
            placeholder="One image URL per line"
          />
        </label>
        <label>
          Video Highlights URL
          <input
            value={videoUrl}
            onChange={(event) => setVideoUrl(event.target.value)}
            placeholder="YouTube link only"
          />
        </label>
        <label>
          Publications URL
          <textarea
            rows={3}
            value={publicationUrls}
            onChange={(event) => setPublicationUrls(event.target.value)}
            placeholder="One publication URL per line"
          />
        </label>
        {message && (
          <p className={`academy-form-alert academy-form-alert--${message.type}`} role="status">
            {message.text}
          </p>
        )}
        <button type="submit" className="academy-submit-btn" disabled={submitting || !selectedPlayer}>
          {submitting ? "Sending..." : "Send for review"}
        </button>
      </form>
    </section>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function MatchesSection({ fixtures }: { fixtures: AcademyFixture[] }) {
  return (
    <section className="academy-panel academy-panel--wide">
      <div className="academy-panel__header">
        <div>
          <h2>Matches and match history</h2>
          <p>Derived from linked ScoreBoard teams.</p>
        </div>
      </div>
      <div className="academy-fixture-grid">
        {fixtures.map((fixture) => (
          <article key={fixture.id} className="academy-fixture-card">
            <div className="academy-fixture-card__top">
              <span className={`academy-result academy-result--${fixture.result.toLowerCase()}`}>
                {fixture.result}
              </span>
              <small>{formatDate(fixture.kickoffAt)}</small>
            </div>
            <h3>{fixtureTitle(fixture)}</h3>
            <p>
              {fixture.competition.name} · {fixture.roundLabel ?? "Round pending"}
              {fixture.venue ? ` · ${fixture.venue}` : ""}
            </p>
            <ul>
              {fixture.events.slice(0, 3).map((event) => (
                <li key={event.id}>
                  {event.minute}' {titleCase(event.type)}
                  {event.playerLabel ? ` · ${event.playerLabel}` : ""}
                </li>
              ))}
            </ul>
            <Link to={matchCenterPath(fixture)} className="text-link">
              Open match centre
            </Link>
          </article>
        ))}
        {fixtures.length === 0 && (
          <p className="academy-empty">No linked ScoreBoard fixtures yet.</p>
        )}
      </div>
    </section>
  );
}

function DevelopmentSection({ data }: { data: AcademyDashboard }) {
  return (
    <section className="academy-panel academy-panel--wide">
      <div className="academy-panel__header">
        <div>
          <h2>Development engine</h2>
          <p>{data.development.indexMethod}</p>
        </div>
      </div>
      <div className="academy-lane-grid">
        <PlayerLane title="Improving / high index" players={data.development.leaders} />
        <PlayerLane title="Needs more data" players={data.development.needsData} muted />
      </div>
    </section>
  );
}

function PlayerLane({
  title,
  players,
  muted,
}: {
  title: string;
  players: AcademySquadPlayer[];
  muted?: boolean;
}) {
  return (
    <div className="academy-lane">
      <h3>{title}</h3>
      {players.map((player) => (
        <Link key={player.id} to={player.profilePath} className="academy-lane-row">
          <span>{player.displayName}</span>
          <strong className={muted ? "academy-muted-score" : undefined}>
            {player.developmentIndex}
          </strong>
        </Link>
      ))}
      {players.length === 0 && <p className="academy-empty">No players in this lane.</p>}
    </div>
  );
}

function PhilosophySection({ data }: { data: AcademyDashboard }) {
  return (
    <section className="academy-panel academy-panel--wide">
      <div className="academy-panel__header">
        <div>
          <h2>Playing philosophy</h2>
          <p>{data.philosophy.note}</p>
        </div>
        <span className="academy-pill">
          {data.philosophy.defaultFormation} · {data.philosophy.defaultPhilosophy}
        </span>
      </div>
      <div className="academy-philosophy-board">
        {data.philosophy.players.map((player) => (
          <Link key={player.id} to={player.profilePath} className="academy-philosophy-row">
            <span>{player.displayName}</span>
            <em>{player.positionPrimary}</em>
            <strong>{player.tacticalFit}%</strong>
          </Link>
        ))}
        {data.philosophy.players.length === 0 && (
          <p className="academy-empty">Style-fit rows will appear once enough verified player data is available.</p>
        )}
      </div>
    </section>
  );
}

function ValuationSection({ data }: { data: AcademyDashboard }) {
  return (
    <section className="academy-panel academy-panel--wide">
      <div className="academy-panel__header">
        <div>
          <h2>Market valuation</h2>
          <p>
            Latest market valuations, confidence labels, and score trends.
            <InfoTip text="Valuations estimate transfer value from performance, age, competition level, and market signals." />
          </p>
        </div>
        <strong>
          {formatCurrencyRange(
            data.valuation.totalValueRangeEur.min,
            data.valuation.totalValueRangeEur.max
          )}
        </strong>
      </div>
      <div className="academy-valuation-grid">
        {data.valuation.latest.map((player) => (
          <article key={player.id} className="academy-valuation-card">
            <Link to={`/scouting/valuation/${player.id}`}>{player.displayName}</Link>
            <span>{player.valuation?.confidenceLabel}</span>
            <strong>{player.valuation?.marketValueLabel}</strong>
            <small>
              Score {player.valuation?.adjustedScore} · {player.valuation?.trend}
            </small>
          </article>
        ))}
        {data.valuation.latest.length === 0 && (
          <p className="academy-empty">No valuation runs yet.</p>
        )}
      </div>
    </section>
  );
}

function MediaSection({ media }: { media: AcademyMediaItem[] }) {
  return (
    <section className="academy-panel academy-panel--wide">
      <div className="academy-panel__header">
        <div>
          <h2>Media library</h2>
          <p>Profile media, published highlights, and player evidence from DTP records.</p>
        </div>
      </div>
      <div className="academy-media-grid">
        {media.map((item) => (
          <a
            key={item.id}
            className="academy-media-card"
            href={mediaHref(item)}
            target={item.url.startsWith("http") ? "_blank" : undefined}
            rel={item.url.startsWith("http") ? "noreferrer" : undefined}
          >
            {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : <span>{titleCase(item.type)}</span>}
            <strong>{item.title}</strong>
            <small>
              {item.playerName ?? item.source} · {formatDate(item.publishedAt)}
            </small>
          </a>
        ))}
        {media.length === 0 && <p className="academy-empty">No media attached yet.</p>}
      </div>
    </section>
  );
}

function SettingsSection({ data }: { data: AcademyDashboard }) {
  const [description, setDescription] = useState(data.academy.description ?? "");
  const [foundedYear, setFoundedYear] = useState<string>(
    data.academy.foundedYear ? String(data.academy.foundedYear) : ""
  );
  const [city, setCity] = useState(data.academy.city ?? "");
  const [country, setCountry] = useState(data.academy.country ?? "");
  const [logoUrl, setLogoUrl] = useState(data.academy.logoUrl ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(data.academy.websiteUrl ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const submitAcademyChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      await submitAcademyProfileChangeRequest(data.academy.slug, {
        description,
        foundedYear: foundedYear.trim() ? Number(foundedYear) : null,
        city,
        country,
        logoUrl,
        websiteUrl,
      });
      setMessage({
        type: "success",
        text: "Club profile update sent for DTP review.",
      });
    } catch (err) {
      setMessage({ type: "error", text: String(err) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="academy-panel academy-panel--wide">
      <div className="academy-panel__header">
        <div>
          <h2>Settings</h2>
          <p>Submit club profile details for DTP admin review and publication.</p>
        </div>
      </div>
      <div className="academy-settings-grid">
        <InsightCard
          label="Access"
          value="Review-gated"
          detail={data.scope.authNote}
        />
        <InsightCard
          label="Data source"
          value={`${data.scope.linkedScoreboardTeamIds.length} ScoreBoard teams`}
          detail="Matches are inferred from teams containing academy-linked players."
        />
        <InsightCard
          label="Review workflow"
          value="DTP approval"
          detail="Submitted club and player updates are reviewed before they appear publicly."
        />
      </div>
      {data.pendingChangeRequests?.length ? (
        <div className="academy-pending-review">
          <h3>Pending review</h3>
          <ul>
            {data.pendingChangeRequests.map((request) => (
              <li key={request.id}>
                <strong>{titleCase(request.kind)}</strong>
                <span>
                  {request.player?.displayName ? ` · ${request.player.displayName}` : ""}
                </span>
                <small>{formatDate(request.submittedAt)}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <form className="academy-change-form" onSubmit={submitAcademyChange}>
        <div className="academy-change-form__header">
          <div>
            <h3>Club profile update</h3>
            <p>These changes remain unpublished until approved by DTP admin.</p>
          </div>
          <span className="academy-pill">Send for review</span>
        </div>
        <label>
          Detail / description
          <textarea
            rows={5}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <div className="academy-change-form__grid">
          <label>
            Year founded
            <input
              type="number"
              min={1800}
              max={2100}
              value={foundedYear}
              onChange={(event) => setFoundedYear(event.target.value)}
            />
          </label>
          <label>
            City
            <input value={city} onChange={(event) => setCity(event.target.value)} />
          </label>
          <label>
            Country
            <input value={country} onChange={(event) => setCountry(event.target.value)} />
          </label>
        </div>
        <label>
          Logo URL
          <input value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} />
        </label>
        <label>
          Website URL
          <input value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} />
        </label>
        {message && (
          <p className={`academy-form-alert academy-form-alert--${message.type}`} role="status">
            {message.text}
          </p>
        )}
        <button type="submit" className="academy-submit-btn" disabled={submitting}>
          {submitting ? "Sending..." : "Send for review"}
        </button>
      </form>
    </section>
  );
}
