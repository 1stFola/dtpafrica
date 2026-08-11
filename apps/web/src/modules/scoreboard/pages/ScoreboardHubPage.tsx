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
import { HighlightCard } from "../components/HighlightCard";
import { ScoreboardTabs } from "../components/ScoreboardTabs";
import {
  SbCompetitionRow,
  SbFixtureCard,
  type SbCompetitionRowRef,
} from "../components/SbFixtureCard";
import { usePageTitle } from "../../../hooks/usePageTitle";

/* Figma 186:139 "Group 1000001920" — four 215x98 stat cards, each on its own
   gradient, in this fixed order. The tone travels with the metric so the card
   keeps its colour no matter what the API returns. */
type MetricTone = "teams" | "players" | "competitions" | "matches";
type Metric = { value: string; label: string; tone: MetricTone };

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
    { value: teams > 0 ? String(teams) : "—", label: "Teams", tone: "teams" },
    { value: playersLabel, label: "Players Tracked", tone: "players" },
    {
      value: competitions > 0 ? String(competitions) : "—",
      label: "Competitions",
      tone: "competitions",
    },
    {
      value: matchCount > 0 ? String(matchCount) : "—",
      label: "Matches Logged",
      tone: "matches",
    },
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

  /* Figma pairs every fixture with its own competition row — column one reads
     La Liga → match, then Premier League → match — so these are cells of
     [competition row + card], not one row heading a grouped list. The full
     competition record is looked up for the country line, since a match only
     carries {id, name, slug}. */
  const fixtureCells = useMemo(
    () =>
      orderedMatches.map((match) => ({
        match,
        competition: (comps.find((c) => c.id === match.competition.id) ??
          match.competition) as SbCompetitionRowRef,
      })),
    [orderedMatches, comps]
  );

  return (
    <div className="sb-landing">
      {/* The eyebrow and the page <h1> now live in the Figma hero owned by
          ScoreboardLayout, so this block starts at the supporting copy. */}
      {/* `<dt>` carries the label and `<dd>` the figure, so the pair reads
          "Teams: 148" to a screen reader; CSS flips the visual order to put the
          number on top the way Figma draws it. */}
      <dl className="sb-stats" aria-label="ScoreBoard at a glance">
        {metrics.map((m) => (
          <div key={m.label} className={`sb-stat sb-stat--${m.tone}`}>
            <dt className="sb-stat__label">{m.label}</dt>
            <dd className="sb-stat__value">{m.value}</dd>
          </div>
        ))}
      </dl>

      <section className="sb-section">
        <div className="sb-section__head">
          <div>
            {/* Figma 186:139 titles each section with a single line — no
                eyebrow above it. Copy and emoji are the frame's own. */}
            <h2>⚽ Match Centre</h2>
            <p className="muted">
              Follow the action closely with real-time updates and detailed
              match logs.
            </p>
          </div>
          <Link to="/scoreboard/live" className="text-link">
            Watch Live →
          </Link>
        </div>

        {/* Figma 191:433 puts the section tabs directly beneath the
            "⚽ Match Centre" title, on their own rule — not up under the hero. */}
        <ScoreboardTabs />

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
          /* Figma stacks the panel as [competition row][fixture][competition
             row][fixture] across three 384px columns, so fixtures are grouped
             under the competition they belong to rather than listed flat. */
          <div className="sb-mc-grid">
            {fixtureCells.map((cell) => (
              <div key={cell.match.id} className="sb-fixture-group">
                <SbCompetitionRow competition={cell.competition} />
                <SbFixtureCard match={cell.match} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="sb-section">
        <div className="sb-section__head">
          <div>
            <h2>📺 Latest Highlights</h2>
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
            <h2>🔭 Explore</h2>
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
