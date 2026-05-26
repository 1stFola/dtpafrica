import { useEffect, useState } from "react";
import { fetchMatches, type SbMatchListItem } from "../../../api/scoreboard";
import { MatchCard } from "../components/MatchCard";
import { usePageTitle } from "../../../hooks/usePageTitle";

export function LiveMatchesPage() {
  usePageTitle("Live matches");
  const [matches, setMatches] = useState<SbMatchListItem[]>([]);

  useEffect(() => {
    const load = () => fetchMatches({ status: "live" }).then(setMatches).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="sb-page">
      <p className="muted">Auto-refreshes every 15 seconds.</p>
      {matches.length === 0 ? (
        <p className="muted">No live matches right now.</p>
      ) : (
        <div className="sb-match-grid">
          {matches.map((m) => (
            <MatchCard key={m.id} match={m} />
          ))}
        </div>
      )}
    </div>
  );
}
