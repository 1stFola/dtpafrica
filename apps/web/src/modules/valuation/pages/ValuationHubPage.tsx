import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchValuedPlayers, type ValuedPlayerRow } from "../../../api/mvce";
import { usePageTitle } from "../../../hooks/usePageTitle";

export function ValuationHubPage() {
  usePageTitle("Valuation");
  const [players, setPlayers] = useState<ValuedPlayerRow[]>([]);

  useEffect(() => {
    fetchValuedPlayers().then(setPlayers).catch(() => {});
  }, []);

  return (
    <div className="sb-page">
      <div className="sb-quick-links">
        <Link to="/valuation/generate" className="sip-card">
          <h3>Generate valuation</h3>
          <p>Run MVCE for a DTP player (pulls SIP metrics when available)</p>
        </Link>
        <Link to="/valuation/compare" className="sip-card">
          <h3>Compare players</h3>
          <p>Side-by-side confidence and value bands</p>
        </Link>
      </div>

      <section className="sb-section">
        <h2>Recent valuations</h2>
        {players.length === 0 ? (
          <p className="muted">No valuations yet. Generate one for a seed player.</p>
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
