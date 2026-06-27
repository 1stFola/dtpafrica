import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchMatches, type SbMatchListItem } from "../../../api/scoreboard";
import { matchCenterPath } from "../utils/matchPath";

/** Human, high-contrast state label for the marquee (COMPLETED, LIVE, …). */
function tickerState(status: string): string {
  switch (status) {
    case "finished":
      return "COMPLETED";
    case "live":
      return "LIVE";
    case "halftime":
      return "HALFTIME";
    case "postponed":
      return "POSTPONED";
    case "scheduled":
      return "UPCOMING";
    default:
      return status.toUpperCase();
  }
}

/**
 * Full-width auto-scrolling ticker of recent/finished matches. Club names
 * arrive already normalized from the API (normalizeClubName), so we render
 * `match.homeTeam.name` / `match.awayTeam.name` verbatim.
 *
 * Reduced motion is respected via CSS (`prefers-reduced-motion`) which swaps
 * the marquee animation for a horizontally scrollable track.
 */
export function MatchTicker() {
  const [matches, setMatches] = useState<SbMatchListItem[]>([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        // Prefer finished/recent matches; fall back to the full feed so the
        // ticker still has content before any match is completed.
        const finished = await fetchMatches({ status: "finished", limit: 10 });
        let rows = finished;
        if (rows.length === 0) {
          rows = await fetchMatches({ limit: 10 });
        }
        if (active) setMatches(rows.slice(0, 10));
      } catch {
        /* ticker is non-critical chrome — fail silently */
      }
    };
    load();
    const timer = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  if (matches.length === 0) return null;

  // Duplicate the run so the marquee loops seamlessly (translateX(-50%)).
  const loop = [...matches, ...matches];

  return (
    <div className="dbx-ticker" role="region" aria-label="Recent match results ticker">
      <span className="dbx-ticker__badge">Match Ticker</span>
      <div className="dbx-ticker__viewport">
        <div className="dbx-ticker__track">
          {loop.map((match, index) => (
            <Link
              key={`${match.id}-${index}`}
              to={matchCenterPath(match)}
              className="dbx-ticker__item"
              aria-hidden={index >= matches.length ? true : undefined}
              tabIndex={index >= matches.length ? -1 : undefined}
            >
              <span className="dbx-ticker__state">{tickerState(match.status)}</span>
              <span className="dbx-ticker__dot" aria-hidden="true">
                ·
              </span>
              <span className="dbx-ticker__teams">
                {match.homeTeam.name} vs {match.awayTeam.name}
              </span>
              <span className="dbx-ticker__score">
                ({match.homeScore}-{match.awayScore})
              </span>
              <span className="dbx-ticker__divider" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
