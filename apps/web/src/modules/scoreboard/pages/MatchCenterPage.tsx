import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchMatch, type SbMatchDetail, type SbTeamWithSquad } from "../../../api/scoreboard";
import { EventTimeline } from "../components/EventTimeline";
import { MatchStatsBars } from "../components/MatchStatsBars";
import { usePageTitle } from "../../../hooks/usePageTitle";

function TeamRoster({ team }: { team: SbTeamWithSquad }) {
  return (
    <article className="sb-lineup-card">
      <h3>
        <Link to={`/scoreboard/team/${team.id}`} className="text-link">
          {team.name}
        </Link>
      </h3>
      {team.squad.length === 0 ? (
        <p className="muted">No roster rows added yet.</p>
      ) : (
        <ul className="sb-lineup-list">
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
                  <small>{row.position ?? linkedPlayer?.positionPrimary ?? "Position pending"}</small>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

export function MatchCenterPage() {
  const { id } = useParams<{ id: string }>();
  const [match, setMatch] = useState<SbMatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  usePageTitle(
    match ? `${match.homeTeam.shortName ?? match.homeTeam.name} vs ${match.awayTeam.shortName ?? match.awayTeam.name}` : "Match"
  );

  useEffect(() => {
    if (!id) return;
    const load = () =>
      fetchMatch(id)
        .then(setMatch)
        .catch((e) => setError(String(e)));
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [id]);

  if (error) {
    return (
      <div className="sb-page">
        <p className="form-error">{error}</p>
        <Link to="/scoreboard">Back</Link>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="sb-page">
        <p className="muted">Loading match…</p>
      </div>
    );
  }

  const live = match.status === "live" || match.status === "halftime";

  return (
    <div className="sb-page">
      <Link to="/scoreboard" className="back-link">
        ← ScoreBoard
      </Link>
      <p className="muted">
        {match.competition.name} · {match.roundLabel}
      </p>

      <div className="sb-match-center-score">
        <div className="sb-match-center-team">
          <span>{match.homeTeam.name}</span>
          <strong>{match.homeScore}</strong>
        </div>
        <div className="sb-match-center-status">
          {live && <span className="sb-live-badge">LIVE {match.minute}&apos;</span>}
          {match.status === "finished" && <span>Full time</span>}
          {match.status === "scheduled" && match.kickoffAt && (
            <span>{new Date(match.kickoffAt).toLocaleString()}</span>
          )}
        </div>
        <div className="sb-match-center-team">
          <span>{match.awayTeam.name}</span>
          <strong>{match.awayScore}</strong>
        </div>
      </div>

      {match.venue && <p className="muted">{match.venue}</p>}

      <section className="sb-section">
        <h2>Match timeline</h2>
        <EventTimeline events={match.events} />
      </section>

      <section className="sb-section">
        <h2>Team stats</h2>
        <MatchStatsBars stats={match.stats} homeTeam={match.homeTeam} awayTeam={match.awayTeam} />
      </section>

      <section className="sb-section">
        <h2>Rosters</h2>
        <div className="sb-lineup-grid">
          <TeamRoster team={match.homeTeam} />
          <TeamRoster team={match.awayTeam} />
        </div>
      </section>

      {match.highlights.length > 0 && (
        <section className="sb-section">
          <h2>Highlights</h2>
          <ul className="sb-highlight-list">
            {match.highlights.map((highlight) => (
              <li key={highlight.id} className="sb-highlight-item">
                <h3>{highlight.title}</h3>
                {highlight.event && (
                  <p className="muted">
                    Linked to {highlight.event.minute}&apos;{" "}
                    {highlight.event.playerLabel ?? highlight.event.type}
                  </p>
                )}
                <a
                  href={highlight.youtubeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-link"
                >
                  Watch clip
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
