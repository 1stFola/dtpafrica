import { useEffect, useState } from "react";
import { PlayerCard } from "@dtp/ui";
import { fetchFeaturedPlayers, type FeaturedPlayer } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";
import { AdPlacement } from "../../../components/AdPlacement";
import { useAdSlot } from "../../../context/AdConfigContext";

export function FeaturedPlayersPage() {
  const adInterval = 8;
  const inlineAd = useAdSlot("featuredPlayersInline");
  usePageTitle("Featured players");
  const [players, setPlayers] = useState<FeaturedPlayer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    fetchFeaturedPlayers(undefined, controller.signal)
      .then((data) => {
        if (active) setPlayers(data);
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return (
    <div className="home-page">
      <header className="page-header">
        <h1>Featured players</h1>
        <p className="muted">
          Verified profiles with ratings and tactical summaries from the Scouting Intelligence Platform.
        </p>
      </header>
      {error && (
        <p className="dtp-error-banner" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <div className="player-grid" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div key={idx} className="dtp-player-card" style={{ padding: "1rem" }}>
              <span className="dtp-skeleton" style={{ width: 64, height: 64, borderRadius: "50%", marginBottom: "0.75rem" }} />
              <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "70%" }} />
              <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "45%" }} />
            </div>
          ))}
        </div>
      )}
      {!loading && players.length === 0 && !error && (
        <div className="dtp-empty-state">
          <p className="dtp-empty-state__title">No featured players yet</p>
          <p>Verified player profiles will appear here once published.</p>
        </div>
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
