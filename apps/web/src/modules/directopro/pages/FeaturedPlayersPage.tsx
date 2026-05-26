import { useEffect, useState } from "react";
import { PlayerCard } from "@dtp/ui";
import { apiGet, type FeaturedPlayer } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";

export function FeaturedPlayersPage() {
  usePageTitle("Featured players");
  const [players, setPlayers] = useState<FeaturedPlayer[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<FeaturedPlayer[]>("/home/featured-players")
      .then(setPlayers)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="home-page">
      <header className="page-header">
        <h1>Featured players</h1>
        <p className="muted">
          Verified profiles with ratings and tactical summaries from the Scouting Intelligence Platform.
        </p>
      </header>
      {error && <p className="form-error">{error}</p>}
      {players.length === 0 && !error && (
        <p className="muted">No featured players published yet.</p>
      )}
      <div className="player-grid">
        {players.map((p) => (
          <PlayerCard key={p.id} player={p} />
        ))}
      </div>
    </div>
  );
}
