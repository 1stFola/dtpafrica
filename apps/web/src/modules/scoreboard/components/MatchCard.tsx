import { Link } from "react-router-dom";
import type { SbMatchListItem } from "../../../api/scoreboard";

function statusLabel(status: string) {
  if (status === "live") return "LIVE";
  if (status === "halftime") return "HT";
  if (status === "finished") return "FT";
  return status;
}

export function MatchCard({ match }: { match: SbMatchListItem }) {
  const live = match.status === "live" || match.status === "halftime";

  return (
    <Link to={`/scoreboard/match/${match.id}`} className="sb-match-card">
      <div className="sb-match-card__top">
        <span className="muted">{match.competition.name}</span>
        {match.roundLabel && <span className="muted">{match.roundLabel}</span>}
        {live && <span className="sb-live-badge">{statusLabel(match.status)}</span>}
      </div>
      <div className="sb-match-card__teams">
        <div className="sb-team-line">
          <span className="sb-team-name">{match.homeTeam.name}</span>
          <strong className="sb-score">{match.homeScore}</strong>
        </div>
        <div className="sb-team-line">
          <span className="sb-team-name">{match.awayTeam.name}</span>
          <strong className="sb-score">{match.awayScore}</strong>
        </div>
      </div>
      <div className="sb-match-card__meta">
        {live && match.minute != null && <span>{match.minute}&apos;</span>}
        {match.venue && <span>{match.venue}</span>}
        {match.status === "scheduled" && match.kickoffAt && (
          <span>{new Date(match.kickoffAt).toLocaleString()}</span>
        )}
      </div>
    </Link>
  );
}
