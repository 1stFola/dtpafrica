import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchCompetitions,
  fetchMatches,
  type SbCompetition,
  type SbMatchListItem,
} from "../../../api/scoreboard";
import { MatchCard } from "../components/MatchCard";
import { usePageTitle } from "../../../hooks/usePageTitle";

export function ScoreboardHubPage() {
  usePageTitle("ScoreBoard");
  const [comps, setComps] = useState<SbCompetition[]>([]);
  const [live, setLive] = useState<SbMatchListItem[]>([]);

  useEffect(() => {
    fetchCompetitions().then(setComps).catch(() => {});
    fetchMatches({ status: "live" }).then(setLive).catch(() => {});
  }, []);

  return (
    <div className="sb-page">
      {live.length > 0 && (
        <section>
          <div className="section-heading">
            <h2>Live now</h2>
            <Link to="/scoreboard/live" className="text-link">
              View all
            </Link>
          </div>
          <div className="sb-match-grid">
            {live.map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </div>
        </section>
      )}

      <section className="sb-section">
        <h2>Competitions</h2>
        <div className="scouting-grid">
          {comps.map((c) => (
            <Link
              key={c.id}
              to={`/scoreboard/competition/${c.slug}`}
              className="sip-card"
            >
              <h3>{c.name}</h3>
              <p>
                {c.season}
                {c.country ? ` · ${c.country}` : ""}
              </p>
              {c._count && (
                <p className="muted">
                  {c._count.teams} teams · {c._count.matches} matches
                </p>
              )}
            </Link>
          ))}
        </div>
      </section>

      <div className="sb-quick-links">
        <Link to="/scoreboard/browse" className="sip-card">
          <h3>Browse & search</h3>
          <p>Find competitions, teams, matches, and linked players</p>
        </Link>
        <Link to="/scoreboard/highlights" className="sip-card">
          <h3>Highlights</h3>
          <p>Published match videos</p>
        </Link>
        <Link to="/scoreboard/supervisor" className="sip-card">
          <h3>Supervisor monitor</h3>
          <p>Live match control (operator)</p>
        </Link>
      </div>
    </div>
  );
}
