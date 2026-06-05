import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchCompetitions,
  fetchScoreboardOverview,
  type SbCompetition,
  type SbMatchListItem,
} from "../../../../api/scoreboard";
import { MatchCenterCard } from "../../../scoreboard/components/MatchCenterCard";

type CompetitionChip = {
  id: string;
  slug: string;
  name: string;
  liveCount: number;
};

function buildCompetitionChips(
  comps: SbCompetition[],
  matches: SbMatchListItem[]
): CompetitionChip[] {
  const liveByComp = new Map<string, number>();
  for (const m of matches) {
    if (m.status === "live" || m.status === "halftime") {
      liveByComp.set(
        m.competition.id,
        (liveByComp.get(m.competition.id) ?? 0) + 1
      );
    }
  }

  const recentCompIds = new Set(matches.map((m) => m.competition.id));

  return comps
    .filter((c) => recentCompIds.has(c.id) || (c._count?.matches ?? 0) > 0)
    .map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      liveCount: liveByComp.get(c.id) ?? 0,
    }))
    .sort((a, b) => b.liveCount - a.liveCount || a.name.localeCompare(b.name))
    .slice(0, 6);
}

function orderMatches(matches: SbMatchListItem[]): SbMatchListItem[] {
  const live = matches.filter(
    (m) => m.status === "live" || m.status === "halftime"
  );
  const rest = matches.filter(
    (m) => m.status !== "live" && m.status !== "halftime"
  );
  return [...live, ...rest].slice(0, 6);
}

export function HomeLiveMatchCenter() {
  const [matches, setMatches] = useState<SbMatchListItem[]>([]);
  const [comps, setComps] = useState<SbCompetition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    Promise.allSettled([
      fetchScoreboardOverview(controller.signal),
      fetchCompetitions(),
    ]).then(([overviewR, compsR]) => {
      if (!active) return;
      if (overviewR.status === "fulfilled") {
        setMatches(overviewR.value.recentMatches);
      }
      if (compsR.status === "fulfilled") setComps(compsR.value);
      setLoading(false);
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  const chips = useMemo(
    () => buildCompetitionChips(comps, matches),
    [comps, matches]
  );
  const ordered = useMemo(() => orderMatches(matches), [matches]);
  const liveCount = matches.filter(
    (m) => m.status === "live" || m.status === "halftime"
  ).length;

  return (
    <section className="home-features-block home-features-block--match" aria-labelledby="home-match-center-title">
      <div className="home-features-block__head">
        <div>
          <span className="home-features-eyebrow">
            {liveCount > 0 && <span className="home-features-eyebrow__pulse" aria-hidden="true" />}
            Live Match Center
          </span>
          <h2 id="home-match-center-title">Follow the action in real time</h2>
          <p className="home-features-lead">
            Live scores, goal timelines, and tournament coverage from Nigeria grassroots football.
          </p>
        </div>
        <Link to="/scoreboard" className="home-features-link">
          Open ScoreBoard →
        </Link>
      </div>

      {loading ? (
        <>
          <div className="home-features-chips" aria-hidden="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <span key={i} className="dtp-skeleton home-features-chip-skeleton" />
            ))}
          </div>
          <div className="home-features-mc-grid" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="dtp-skeleton dtp-skeleton--card home-features-mc-skeleton" />
            ))}
          </div>
        </>
      ) : (
        <>
          {chips.length > 0 && (
            <div className="home-features-chips" role="list" aria-label="Active tournaments">
              {chips.map((c) => (
                <Link
                  key={c.id}
                  to={`/scoreboard/competition/${c.slug}`}
                  className="home-features-chip"
                  role="listitem"
                >
                  <span>{c.name}</span>
                  {c.liveCount > 0 && (
                    <span className="home-features-chip__live">{c.liveCount} live</span>
                  )}
                </Link>
              ))}
            </div>
          )}

          {ordered.length === 0 ? (
            <div className="dtp-empty-state home-features-empty">
              <p className="dtp-empty-state__title">No matches logged yet</p>
              <p>Check back soon for live tournament coverage and match centers.</p>
              <Link to="/scoreboard" className="text-link">
                Browse ScoreBoard
              </Link>
            </div>
          ) : (
            <div className="home-features-mc-grid">
              {ordered.map((m) => (
                <MatchCenterCard key={m.id} match={m} compact />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
