import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  searchScoreboard,
  type SbSearchResult,
} from "../../../api/scoreboard";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { MatchCard } from "../components/MatchCard";

export function BrowsePage() {
  usePageTitle("ScoreBoard browse");
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<SbSearchResult | null>(null);

  useEffect(() => {
    if (initialQuery.trim().length < 2) {
      setResult(null);
      return;
    }
    searchScoreboard(initialQuery).then(setResult).catch(() => setResult(null));
  }, [initialQuery]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = query.trim();
    setSearchParams(next ? { q: next } : {});
  };

  return (
    <div className="sb-page">
      <header className="page-header">
        <h1>Browse ScoreBoard</h1>
        <p className="muted">Search competitions, teams, matches, and linked public players.</p>
      </header>

      <form className="sb-search-form" onSubmit={onSubmit}>
        <label>
          Search
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jagaban, Lagos, midfielder..."
          />
        </label>
        <button type="submit" className="dtp-btn dtp-btn--primary">
          Search
        </button>
      </form>

      {!result ? (
        <p className="muted">Enter at least two characters to search the ScoreBoard graph.</p>
      ) : (
        <div className="sb-browse-results">
          <section className="sb-section">
            <h2>Competitions</h2>
            {result.competitions.length === 0 ? (
              <p className="muted">No competitions found.</p>
            ) : (
              <div className="scouting-grid">
                {result.competitions.map((competition) => (
                  <Link
                    key={competition.id}
                    to={`/scoreboard/competition/${competition.slug}`}
                    className="sip-card"
                  >
                    <h3>{competition.name}</h3>
                    <p>
                      {competition.season}
                      {competition.country ? ` - ${competition.country}` : ""}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="sb-section">
            <h2>Teams</h2>
            {result.teams.length === 0 ? (
              <p className="muted">No teams found.</p>
            ) : (
              <div className="sb-team-grid">
                {result.teams.map((team) => (
                  <Link key={team.id} to={`/scoreboard/team/${team.id}`} className="sb-team-card">
                    <div className="sb-team-card__header">
                      <div>
                        <h3>{team.name}</h3>
                        <span>{team.competition.name}</span>
                      </div>
                      <strong>{team._count?.squad ?? 0}</strong>
                    </div>
                    <p className="muted">{team.city ?? "City pending"}</p>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="sb-section">
            <h2>Matches</h2>
            {result.matches.length === 0 ? (
              <p className="muted">No matches found.</p>
            ) : (
              <div className="sb-match-grid">
                {result.matches.map((match) => (
                  <MatchCard key={match.id} match={match} />
                ))}
              </div>
            )}
          </section>

          <section className="sb-section">
            <h2>Players</h2>
            {result.players.length === 0 ? (
              <p className="muted">No linked public players found.</p>
            ) : (
              <ul className="sb-player-result-list">
                {result.players.map((player) => (
                  <li key={player.id}>
                    <Link to={`/player/${player.slug ?? player.id}`} className="text-link">
                      {player.displayName}
                    </Link>
                    <span>
                      {player.positionPrimary}
                      {player.overallRating != null ? ` - ${player.overallRating} OVR` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
