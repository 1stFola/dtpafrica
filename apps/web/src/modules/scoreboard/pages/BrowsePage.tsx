import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  searchScoreboard,
  type SbSearchResult,
} from "../../../api/scoreboard";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { MatchCard } from "../components/MatchCard";

export function BrowsePage() {
  usePageTitle("ScoreBoard browse");
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<SbSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debouncedQuery = useDebouncedValue(query, 350);

  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    // Keep the URL in sync (replace, so typing doesn't flood history).
    setSearchParams(trimmed ? { q: trimmed } : {}, { replace: true });

    if (trimmed.length < 2) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    searchScoreboard(trimmed)
      .then((data) => {
        if (active) setResult(data);
      })
      .catch((e) => {
        if (active) {
          setResult(null);
          setError(String(e));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // setSearchParams identity is stable from react-router.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
  };

  return (
    <div className="sb-page">
      <header className="page-header">
        <h1>Browse ScoreBoard</h1>
        <p className="muted">Search competitions, teams, matches, and linked public players.</p>
      </header>

      <form className="sb-search-form" onSubmit={onSubmit} role="search">
        <label>
          Search
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Jagaban, Lagos, midfielder..."
            aria-label="Search competitions, teams, matches, and players"
          />
        </label>
        <button type="submit" className="dtp-btn dtp-btn--primary" disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && (
        <p className="dtp-error-banner" role="alert">
          {error}
        </p>
      )}

      {!result && !error ? (
        <div className="dtp-empty-state">
          <p className="dtp-empty-state__title">Search the ScoreBoard graph</p>
          <p>Enter at least two characters to find competitions, teams, matches, and players.</p>
        </div>
      ) : !result ? null : (
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
