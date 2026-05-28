import { useEffect, useState } from "react";
import { PlayerCard } from "@dtp/ui";
import { apiGet, type FeaturedPlayer } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { AdPlacement } from "../../../components/AdPlacement";
import { useAdSlot } from "../../../context/AdConfigContext";

export function FeaturedPlayersPage() {
  const adInterval = 8;
  const inlineAd = useAdSlot("featuredPlayersInline");
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
        {players.flatMap((p, idx) => {
          const items = [<PlayerCard key={p.id} player={p} />];
          if (inlineAd && (idx + 1) % adInterval === 0 && idx < players.length - 1) {
            items.push(
              <div key={`featured-inline-ad-${idx}`} className="player-grid-ad">
                <AdPlacement slotKey="featuredPlayersInline" />
              </div>
            );
          }
          return items;
        })}
      </div>
    </div>
  );
}
