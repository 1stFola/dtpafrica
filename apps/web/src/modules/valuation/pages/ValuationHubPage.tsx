import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchValuedPlayers, type ValuedPlayerRow } from "../../../api/mvce";
import { isAbortError } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";

export function ValuationHubPage() {
  usePageTitle("Valuation");
  const [players, setPlayers] = useState<ValuedPlayerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    fetchValuedPlayers(controller.signal)
      .then((rows) => {
        if (!cancelled) setPlayers(rows);
      })
      .catch((e) => {
        if (!cancelled && !isAbortError(e)) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return (
    <div className="sb-page">
      <div className="sb-quick-links">
        <Link to="/valuation/generate" className="sip-card">
          <h3>Generate valuation</h3>
          <p>Run a market valuation for a player (uses scouting metrics when available)</p>
        </Link>
        <Link to="/valuation/compare" className="sip-card">
          <h3>Compare players</h3>
          <p>Side-by-side confidence and value bands</p>
        </Link>
      </div>

      <section className="sb-section">
        <h2>Recent valuations</h2>
        {error && (
          <p className="dtp-error-banner" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <ul className="mvce-player-list" aria-busy="true">
            {Array.from({ length: 5 }).map((_, idx) => (
              <li key={idx} style={{ padding: "1rem", borderBottom: "1px solid var(--color-border)" }}>
                <span className="dtp-skeleton dtp-skeleton--line" style={{ width: "40%", marginBottom: 0 }} />
              </li>
            ))}
          </ul>
        ) : players.length === 0 ? (
          <div className="dtp-empty-state">
            <p className="dtp-empty-state__title">No valuations yet</p>
            <p>Generate an MVCE valuation for a seed player to populate this list.</p>
            <Link to="/valuation/generate" className="text-link">
              Generate a valuation
            </Link>
          </div>
        ) : (
          <ul className="mvce-player-list">
            {players.map((p) => {
              const v = p.mvceValuations[0];
              return (
                <li key={p.id}>
                  <Link to={`/valuation/player/${p.id}`} className="mvce-player-row">
                    <span className="mvce-player-row__name">{p.displayName}</span>
                    <span className="muted">{p.positionPrimary}</span>
                    {v && (
                      <span className="mvce-player-row__band">
                        {v.confidenceLabel} · {v.marketValueLabel}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
