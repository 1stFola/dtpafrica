import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchTeam,
  type SbMatchListItem,
  type SbTeamDetail,
} from "../../../api/scoreboard";
import { isAbortError } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { MatchCard } from "../components/MatchCard";

function resultForTeam(match: SbMatchListItem, teamId: string) {
  if (match.status !== "finished") return match.status;
  const isHome = match.homeTeam.id === teamId;
  const goalsFor = isHome ? match.homeScore : match.awayScore;
  const goalsAgainst = isHome ? match.awayScore : match.homeScore;
  if (goalsFor > goalsAgainst) return "W";
  if (goalsFor < goalsAgainst) return "L";
  return "D";
}

export function TeamPage() {
  const { id } = useParams<{ id: string }>();
  const [team, setTeam] = useState<SbTeamDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  usePageTitle(team ? team.name : "Team");

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    let cancelled = false;
    setTeam(null);
    setError(null);
    fetchTeam(id, controller.signal)
      .then((data) => {
        if (!cancelled) setTeam(data);
      })
      .catch((err) => {
        if (!cancelled && !isAbortError(err)) setError(String(err));
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id]);

  const finishedForm = useMemo(
    () =>
      team?.matches
        .filter((match) => match.status === "finished")
        .slice(0, 5)
        .map((match) => resultForTeam(match, team.id)) ?? [],
    [team]
  );

  if (error) {
    return (
      <div className="sb-page">
        <p className="dtp-error-banner" role="alert">
          {error}
        </p>
        <Link to="/scoreboard/browse" className="back-link">
          ← Back to browse
        </Link>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="sb-page" aria-busy="true">
        <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "10rem" }} />
        <span className="dtp-skeleton" style={{ height: "2.5rem", width: "16rem", margin: "1rem 0" }} />
        <div className="dtp-skeleton dtp-skeleton--card" style={{ marginTop: "1rem" }} />
        <div className="dtp-skeleton dtp-skeleton--card" style={{ marginTop: "1rem" }} />
      </div>
    );
  }

  return (
    <div className="sb-page">
      <Link to={`/scoreboard/competition/${team.competition.slug}`} className="back-link">
        Back to {team.competition.name}
      </Link>

      <header className="page-header sb-team-profile-header">
        <div>
          <p className="muted">
            {team.competition.name} {team.competition.season}
            {team.city ? ` - ${team.city}` : ""}
          </p>
          <h1>{team.name}</h1>
        </div>
        {finishedForm.length > 0 && (
          <div className="sb-form-strip" aria-label="Recent form">
            {finishedForm.map((result, index) => (
              <span key={`${result}-${index}`} className={`sb-form-strip__item ${result}`}>
                {result}
              </span>
            ))}
          </div>
        )}
      </header>

      <section className="sb-section">
        <h2>Roster</h2>
        {team.squad.length === 0 ? (
          <p className="muted">No public squad rows have been added yet.</p>
        ) : (
          <ul className="sb-roster-list">
            {team.squad.map((row) => {
              const linkedPlayer = row.player?.isPublic ? row.player : null;
              const profilePath = linkedPlayer?.slug
                ? `/player/${linkedPlayer.slug}`
                : linkedPlayer
                  ? `/player/${linkedPlayer.id}`
                  : null;

              return (
                <li key={row.id}>
                  <span className="sb-squad-number">{row.shirtNumber ?? "Squad"}</span>
                  <div>
                    {profilePath ? (
                      <Link to={profilePath} className="text-link">
                        {linkedPlayer?.displayName ?? row.displayName}
                      </Link>
                    ) : (
                      <strong>{row.displayName}</strong>
                    )}
                    <small>
                      {row.position ?? linkedPlayer?.positionPrimary ?? "Position pending"}
                      {linkedPlayer?.overallRating != null
                        ? ` - ${linkedPlayer.overallRating} OVR`
                        : ""}
                    </small>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="sb-section">
        <h2>Recent matches</h2>
        {team.matches.length === 0 ? (
          <p className="muted">No public matches yet.</p>
        ) : (
          <div className="sb-match-grid">
            {team.matches.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
