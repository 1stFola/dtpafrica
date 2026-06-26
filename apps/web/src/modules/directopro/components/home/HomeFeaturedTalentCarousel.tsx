import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchFeaturedPlayers, type FeaturedPlayer } from "../../../../api/client";
import { HomeFeaturedTalentCard } from "./HomeFeaturedTalentCard";

const TALENT_SKELETON_COUNT = 8;

export function HomeFeaturedTalentCarousel() {
  const [players, setPlayers] = useState<FeaturedPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    fetchFeaturedPlayers(12, controller.signal)
      .then((data) => {
        if (active) setPlayers(data);
      })
      .catch(() => {
        if (active) setError(true);
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
    <section
      className="home-features-block home-features-block--talent"
      aria-labelledby="home-featured-talent-title"
    >
      <div className="home-features-block__head">
        <div>
          <span className="home-features-eyebrow">Featured Talent</span>
          <h2 id="home-featured-talent-title">Discover verified prospects</h2>
          <p className="home-features-lead">
            Scout-rated profiles with position fit, ratings, and match-verified career stats.
          </p>
        </div>
        <div className="home-features-block__actions">
          <Link
            to="/featured-players"
            className="dtp-btn dtp-btn--primary home-features-cta home-features-cta--talent"
          >
            View all talent →
          </Link>
        </div>
      </div>

      {loading && (
        <div className="home-features-talent-grid" aria-busy="true" aria-hidden="true">
          {Array.from({ length: TALENT_SKELETON_COUNT }).map((_, i) => (
            <div key={i} className="dtp-skeleton home-talent-card-skeleton" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="dtp-empty-state home-features-empty">
          <p className="dtp-empty-state__title">Could not load featured players</p>
          <p>Please refresh or browse the full talent directory.</p>
          <Link to="/featured-players" className="text-link">
            Featured players
          </Link>
        </div>
      )}

      {!loading && !error && players.length === 0 && (
        <div className="dtp-empty-state home-features-empty">
          <p className="dtp-empty-state__title">No featured players yet</p>
          <p>Verified profiles will appear here once published by the scouting team.</p>
        </div>
      )}

      {!loading && !error && players.length > 0 && (
        <div className="home-features-talent-grid">
          {players.map((p) => (
            <HomeFeaturedTalentCard key={p.id} player={p} />
          ))}
        </div>
      )}
    </section>
  );
}
