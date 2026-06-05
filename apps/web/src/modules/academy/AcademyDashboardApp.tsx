import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation, useParams } from "react-router-dom";
import {
  fetchAcademyDashboard,
  type AcademyDashboard,
  type AcademyFixture,
  type AcademyMediaItem,
  type AcademySquadPlayer,
} from "../../api/academy";
import { isAbortError } from "../../api/client";
import { usePageTitle } from "../../hooks/usePageTitle";

const navItems = [
  { id: "overview", label: "Dashboard" },
  { id: "squad", label: "Squad" },
  { id: "fixtures", label: "Fixtures" },
  { id: "development", label: "Development" },
  { id: "philosophy", label: "Playing Philosophy" },
  { id: "valuation", label: "Market Valuation" },
  { id: "media", label: "Media Library" },
  { id: "settings", label: "Settings" },
] as const;

type DashboardSection = (typeof navItems)[number]["id"];

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

function uniqueOptions(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort();
}

function fixtureTitle(fixture: AcademyFixture) {
  return `${fixture.homeTeam.shortName ?? fixture.homeTeam.name} ${fixture.score.home}-${fixture.score.away} ${fixture.awayTeam.shortName ?? fixture.awayTeam.name}`;
}

function mediaHref(item: AcademyMediaItem) {
  return item.url;
}

export function AcademyDashboardApp() {
  const { slug = "dtp-lagos-hub" } = useParams<{ slug: string }>();
  const location = useLocation();
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

  const section = useMemo<DashboardSection>(() => {
    const tail = location.pathname.split(`/academy/${slug}/dashboard`)[1] ?? "";
    const segment = tail.split("/").filter(Boolean)[0];
    return navItems.find((item) => item.id === segment)?.id ?? "overview";
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

  return (
    <div className="academy-dashboard">
      <aside className="academy-sidebar">
        <Link to="/academy" className="academy-sidebar__brand">
          <span className="academy-sidebar__crest">
            {data.academy.logoUrl ? <img src={data.academy.logoUrl} alt="" /> : "DTP"}
          </span>
          <span>
            <strong>{data.academy.name}</strong>
            <small>{[data.academy.city, data.academy.country].filter(Boolean).join(", ")}</small>
          </span>
        </Link>
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
        <section className="academy-hero">
          <div>
            <p className="eyebrow">Academy command centre</p>
            <h1>{data.academy.name}</h1>
            <p>
              Which players are improving, valuable, tactically useful, and ready for
              exposure?
            </p>
          </div>
          <div className="academy-hero__meta">
            <span>{data.scope.mode.replace(/_/g, " ")}</span>
            <strong>{data.squad.length} players</strong>
          </div>
        </section>

        {section === "overview" && <OverviewSection data={data} />}
        {section === "squad" && <SquadSection players={data.squad} />}
        {section === "fixtures" && <FixturesSection fixtures={data.fixtures} />}
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
            <Link to="squad" className="text-link">
              View squad
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
            detail="Aggregated from latest MVCE valuation runs."
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
        <span className={scoreClass(player.developmentIndex)}>
          {player.developmentIndex}
          <small>DEV</small>
        </span>
        <span className={scoreClass(player.tacticalFit)}>
          {player.tacticalFit ?? "N/A"}
          <small>FIT</small>
        </span>
        <span className={scoreClass(player.exposureReadiness)}>
          {player.exposureReadiness}
          <small>EXP</small>
        </span>
      </div>
      <p>{player.valuation?.marketValueLabel ?? "MVCE pending"}</p>
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

function SquadSection({ players }: { players: AcademySquadPlayer[] }) {
  const [ageGroup, setAgeGroup] = useState("all");
  const [position, setPosition] = useState("all");
  const [foot, setFoot] = useState("all");
  const [status, setStatus] = useState("all");

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

  return (
    <section className="academy-panel academy-panel--wide">
      <div className="academy-panel__header">
        <div>
          <h2>Squad intelligence</h2>
          <p>Filter by football traits and jump into the unified player profile.</p>
        </div>
      </div>
      <div className="academy-filters">
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
              <th>Age</th>
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
                <td>{player.ageGroup ?? player.age ?? "Pending"}</td>
                <td>{player.dominantFoot ?? "Pending"}</td>
                <td>
                  <span className="academy-pill">{player.status}</span>
                </td>
                <td>
                  <span className={scoreClass(player.developmentIndex)}>{player.developmentIndex}</span>
                </td>
                <td>
                  <span className={scoreClass(player.tacticalFit)}>{player.tacticalFit ?? "N/A"}</span>
                  <small>{player.tacticalTags.join(", ") || "SIP pending"}</small>
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

function FixturesSection({ fixtures }: { fixtures: AcademyFixture[] }) {
  return (
    <section className="academy-panel academy-panel--wide">
      <div className="academy-panel__header">
        <div>
          <h2>Fixtures and match history</h2>
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
            <Link to={`/scoreboard/match/${fixture.id}`} className="text-link">
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
          <p className="academy-empty">Run SIP recalculation to populate philosophy fit rows.</p>
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
          <p>Latest MVCE valuations, confidence labels, and score trends.</p>
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
            <Link to={`/valuation/player/${player.id}`}>{player.displayName}</Link>
            <span>{player.valuation?.confidenceLabel}</span>
            <strong>{player.valuation?.marketValueLabel}</strong>
            <small>
              MVCE {player.valuation?.adjustedScore} · {player.valuation?.trend}
            </small>
          </article>
        ))}
        {data.valuation.latest.length === 0 && (
          <p className="academy-empty">No MVCE valuation runs yet.</p>
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
          <p>Existing profile media and ScoreBoard highlights. Uploads and AI tagging are deferred.</p>
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
  return (
    <section className="academy-panel academy-panel--wide">
      <div className="academy-panel__header">
        <div>
          <h2>Settings</h2>
          <p>Read-only implementation notes for the academy workspace.</p>
        </div>
      </div>
      <div className="academy-settings-grid">
        <InsightCard
          label="Access"
          value="Demo read-only"
          detail={data.scope.authNote}
        />
        <InsightCard
          label="Data source"
          value={`${data.scope.linkedScoreboardTeamIds.length} ScoreBoard teams`}
          detail="Fixtures are inferred from teams containing academy-linked players."
        />
        <InsightCard
          label="Next controls"
          value="Academy auth"
          detail="Per-academy users, attendance import, and development assessments should be added after the data model is finalized."
        />
      </div>
    </section>
  );
}
