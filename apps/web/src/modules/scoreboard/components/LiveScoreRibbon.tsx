import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchMatches, type SbMatchListItem } from "../../../api/scoreboard";
import { matchCenterPath } from "../utils/matchPath";

function compactTeamName(match: SbMatchListItem, side: "home" | "away") {
  const team = side === "home" ? match.homeTeam : match.awayTeam;
  return team.shortName ?? team.name;
}

function ribbonLabel(match: SbMatchListItem) {
  const status = match.status === "halftime" ? "HT" : `${match.minute ?? 0}'`;
  return `${compactTeamName(match, "home")} ${match.homeScore}-${match.awayScore} ${compactTeamName(match, "away")} ${status}`;
}

export function LiveScoreRibbon() {
  const [matches, setMatches] = useState<SbMatchListItem[]>([]);

  useEffect(() => {
    const load = () => fetchMatches({ status: "live" }).then(setMatches).catch(() => {});
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  if (matches.length === 0) return null;

  const ribbonItems = [...matches, ...matches];

  return (
    <div className="sb-live-ribbon" role="region" aria-label="Live ScoreBoard ribbon">
      <span className="sb-live-ribbon__label">Live</span>
      <div className="sb-live-ribbon__track">
        {ribbonItems.map((match, index) => (
          <Link
            key={`${match.id}-${index}`}
            to={matchCenterPath(match)}
            className="sb-live-ribbon__item"
          >
            <strong>{ribbonLabel(match)}</strong>
            <span>{match.competition.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
