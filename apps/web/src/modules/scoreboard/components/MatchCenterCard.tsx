import { Link } from "react-router-dom";
import type { SbMatchGoal, SbMatchListItem } from "../../../api/scoreboard";
import { TeamCrest } from "./TeamCrest";

type StatusKind = "live" | "ht" | "ft" | "scheduled" | "other";

function statusKind(status: string): StatusKind {
  if (status === "live") return "live";
  if (status === "halftime") return "ht";
  if (status === "finished") return "ft";
  if (status === "scheduled") return "scheduled";
  return "other";
}

function statusLabel(match: SbMatchListItem): string {
  switch (statusKind(match.status)) {
    case "live":
      return match.minute != null ? `LIVE ${match.minute}'` : "LIVE";
    case "ht":
      return "HT";
    case "ft":
      return "FT";
    case "scheduled":
      return "UPCOMING";
    default:
      return match.status.toUpperCase();
  }
}

function scorerName(goal: SbMatchGoal): string {
  return goal.player?.displayName ?? goal.playerLabel ?? "Unknown";
}

export function MatchCenterCard({
  match,
  compact = false,
}: {
  match: SbMatchListItem;
  compact?: boolean;
}) {
  const kind = statusKind(match.status);
  const live = kind === "live" || kind === "ht";
  const goals = match.events ?? [];
  const homeGoals = goals.filter((g) => g.teamId === match.homeTeam.id);
  const awayGoals = goals.filter((g) => g.teamId === match.awayTeam.id);
  const hasScore = match.status !== "scheduled";

  return (
    <Link
      to={`/scoreboard/match/${match.id}`}
      className={`sb-mc-card${compact ? " sb-mc-card--compact" : ""}`}
      data-status={kind}
    >
      <div className="sb-mc-card__head">
        <span className="sb-mc-tag">{match.competition.name}</span>
        <span className={`sb-mc-status sb-mc-status--${kind}`}>
          {live && <span className="sb-mc-status__dot" aria-hidden="true" />}
          {statusLabel(match)}
        </span>
      </div>

      <div className="sb-mc-card__body">
        <div className="sb-mc-team">
          <TeamCrest team={match.homeTeam} />
          <span className="sb-mc-team__name">{match.homeTeam.name}</span>
        </div>

        <div className="sb-mc-score" aria-label="Scoreline">
          {hasScore ? (
            <>
              <span>{match.homeScore}</span>
              <span className="sb-mc-score__dash">-</span>
              <span>{match.awayScore}</span>
            </>
          ) : (
            <span className="sb-mc-score__vs">vs</span>
          )}
        </div>

        <div className="sb-mc-team sb-mc-team--away">
          <TeamCrest team={match.awayTeam} />
          <span className="sb-mc-team__name">{match.awayTeam.name}</span>
        </div>
      </div>

      {!compact && (homeGoals.length > 0 || awayGoals.length > 0) && (
        <div className="sb-mc-card__timeline">
          <ul className="sb-mc-scorers">
            {homeGoals.map((g) => (
              <li key={g.id}>
                <span className="sb-mc-scorers__ball" aria-hidden="true">⚽</span>
                {scorerName(g)} <span className="sb-mc-scorers__min">{g.minute}&apos;</span>
                {g.type === "own_goal" && <span className="sb-mc-scorers__og">OG</span>}
              </li>
            ))}
          </ul>
          <ul className="sb-mc-scorers sb-mc-scorers--away">
            {awayGoals.map((g) => (
              <li key={g.id}>
                {g.type === "own_goal" && <span className="sb-mc-scorers__og">OG</span>}
                <span className="sb-mc-scorers__min">{g.minute}&apos;</span> {scorerName(g)}
                <span className="sb-mc-scorers__ball" aria-hidden="true">⚽</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {compact && (homeGoals.length > 0 || awayGoals.length > 0) && (
        <div className="sb-mc-card__mini-timeline" aria-label="Goal scorers">
          {[...goals]
            .sort((a, b) => a.minute - b.minute)
            .slice(0, 4)
            .map((g) => (
              <span key={g.id} className="sb-mc-card__mini-goal">
                {g.minute}&apos; {scorerName(g)}
              </span>
            ))}
          {goals.length > 4 && (
            <span className="sb-mc-card__mini-more">+{goals.length - 4}</span>
          )}
        </div>
      )}

      <div className="sb-mc-card__foot">
        {match.roundLabel && <span>{match.roundLabel}</span>}
        {!compact && match.venue && <span>{match.venue}</span>}
        {kind === "scheduled" && match.kickoffAt && (
          <span>
            {new Date(match.kickoffAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        )}
      </div>
    </Link>
  );
}
