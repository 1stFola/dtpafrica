import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchCompetitions,
  fetchHighlights,
  fetchScoreboardOverview,
  type SbCompetition,
  type SbHighlight,
  type SbMatchListItem,
  type SbStats,
} from "../../../api/scoreboard";
import { MatchCenterCard } from "../components/MatchCenterCard";
import { HighlightCard } from "../components/HighlightCard";
import { usePageTitle } from "../../../hooks/usePageTitle";

type Metric = { value: string; label: string };

function buildMetrics(
  stats: SbStats | null,
  comps: SbCompetition[],
  matches: SbMatchListItem[]
): Metric[] {
  const teams =
    stats?.teams ?? comps.reduce((sum, c) => sum + (c._count?.teams ?? 0), 0);
  const competitions = stats?.competitions ?? comps.length;
  const compMatchCount = comps.reduce(
    (sum, c) => sum + (c._count?.matches ?? 0),
    0
  );
  const matchCount = stats?.matches ?? (compMatchCount || matches.length);
  const players = stats?.playersTracked ?? 0;

  const playersLabel = players >= 100 ? "100+" : players > 0 ? String(players) : "—";

  return [
    { value: teams > 0 ? String(teams) : "—", label: "Teams" },
    { value: playersLabel, label: "Players Tracked" },
    { value: competitions > 0 ? String(competitions) : "—", label: "Competitions" },
    { value: matchCount > 0 ? String(matchCount) : "—", label: "Matches Logged" },
  ];
}

export function ScoreboardHubPage() {
  usePageTitle("ScoreBoard");
  const [comps, setComps] = useState<SbCompetition[]>([]);
  const [matches, setMatches] = useState<SbMatchListItem[]>([]);
  const [stats, setStats] = useState<SbStats | null>(null);
  const [highlights, setHighlights] = useState<SbHighlight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    Promise.allSettled([
      fetchScoreboardOverview(controller.signal),
      fetchCompetitions(),
      fetchHighlights(),
    ]).then((results) => {
      if (!active) return;
      const [overviewR, compsR, hlR] = results;
      if (overviewR.status === "fulfilled") {
        setStats(overviewR.value.stats);
        setMatches(overviewR.value.recentMatches);
      }
      if (compsR.status === "fulfilled") setComps(compsR.value);
      if (hlR.status === "fulfilled") setHighlights(hlR.value);
      setLoading(false);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const metrics = useMemo(
    () => buildMetrics(stats, comps, matches),
    [stats, comps, matches]
  );

  const liveMatches = matches.filter(
    (m) => m.status === "live" || m.status === "halftime"
  );
  // Live first, then everything else by recency (already kickoff desc from API).
  const orderedMatches = [
    ...liveMatches,
    ...matches.filter((m) => !liveMatches.includes(m)),
  ].slice(0, 9);

  return (
    <div className="sb-landing">
      <section className="sb-hero">
        <span className="sb-hero__eyebrow">
          <span className="sb-hero__pulse" aria-hidden="true" />
          Nigeria Grassroots Football
        </span>
        <h1 className="sb-hero__title">The Ultimate Match Experience</h1>
        <p className="sb-hero__subtitle">
          Explore premium match stats, video highlights and historical player
          profiles from Nigeria Grassroots Football.
        </p>
        <div className="sb-hero__actions">
          <Link to="/scoreboard/live" className="dtp-btn dtp-btn--primary">
            Watch Live
          </Link>
          <Link to="/scoreboard/browse" className="dtp-btn dtp-btn--secondary">
            Browse Competitions
          </Link>
        </div>

        <dl className="sb-metrics" aria-label="ScoreBoard at a glance">
          {metrics.map((m) => (
            <div key={m.label} className="sb-metric">
              <dt className="sb-metric__value">{m.value}</dt>
              <dd className="sb-metric__label">{m.label}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="sb-section">
        <div className="sb-section__head">
          <div>
            <span className="sb-section__eyebrow">Live &amp; Recent</span>
            <h2>Match Center</h2>
            <p className="muted">
              Follow the action closely with real-time updates and detailed
              match logs.
            </p>
          </div>
          <Link to="/scoreboard/live" className="text-link">
            View all live →
          </Link>
        </div>

        {loading ? (
          <div className="sb-mc-grid" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="dtp-skeleton dtp-skeleton--card sb-mc-skeleton" />
            ))}
          </div>
        ) : orderedMatches.length === 0 ? (
          <div className="dtp-empty-state">
            <p className="dtp-empty-state__title">No matches logged yet</p>
            <p>
              We couldn&apos;t find any matches linked to published
              competitions. Check back soon for live coverage.
            </p>
          </div>
        ) : (
          <div className="sb-mc-grid">
            {orderedMatches.map((m) => (
              <MatchCenterCard key={m.id} match={m} />
            ))}
          </div>
        )}
      </section>

      <section className="sb-section">
        <div className="sb-section__head">
          <div>
            <span className="sb-section__eyebrow">Video</span>
            <h2>Latest Highlights</h2>
            <p className="muted">Curated video moments from ongoing tournaments.</p>
          </div>
          <Link to="/scoreboard/highlights" className="text-link">
            All highlights →
          </Link>
        </div>

        {loading ? (
          <div className="sb-hl-grid" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="dtp-skeleton dtp-skeleton--card sb-hl-skeleton" />
            ))}
          </div>
        ) : highlights.length === 0 ? (
          <div className="dtp-empty-state">
            <p className="dtp-empty-state__title">No highlights published yet</p>
            <p>
              Video moments will appear here as soon as our spotters publish
              clips from upcoming fixtures.
            </p>
          </div>
        ) : (
          <div className="sb-hl-grid">
            {highlights.slice(0, 6).map((h) => (
              <HighlightCard key={h.id} highlight={h} />
            ))}
          </div>
        )}
      </section>

      <section className="sb-section">
        <div className="sb-section__head">
          <div>
            <span className="sb-section__eyebrow">Explore</span>
            <h2>Competitions</h2>
          </div>
        </div>
        <div className="sb-comp-grid">
          {comps.map((c) => (
            <Link
              key={c.id}
              to={`/scoreboard/competition/${c.slug}`}
              className="sb-comp-card"
            >
              <h3>{c.name}</h3>
              <p className="muted">
                {c.season}
                {c.country ? ` · ${c.country}` : ""}
              </p>
              {c._count && (
                <p className="sb-comp-card__meta">
                  {c._count.teams} teams · {c._count.matches} matches
                </p>
              )}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
