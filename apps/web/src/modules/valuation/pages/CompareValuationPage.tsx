import { useCallback, useEffect, useState } from "react";
import { compareValuations } from "../../../api/mvce";
import { apiGet } from "../../../api/client";
import { usePageTitle } from "../../../hooks/usePageTitle";

type PlayerOption = { id: string; displayName: string; positionPrimary: string };

export function CompareValuationPage() {
  usePageTitle("Compare valuations");
  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<Awaited<ReturnType<typeof compareValuations>> | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<PlayerOption[]>("/mvce/players")
      .then((rows) => {
        if (rows.length > 0) {
          setPlayers(rows);
          return;
        }
        return apiGet<{ id: string; displayName: string; positionPrimary: string }[]>(
          "/home/featured-players"
        ).then((featured) =>
          setPlayers(
            featured.map((r) => ({
              id: r.id,
              displayName: r.displayName,
              positionPrimary: r.positionPrimary,
            }))
          )
        );
      })
      .catch(() => {});
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  };

  const run = useCallback(() => {
    if (selected.length < 2) {
      setError("Select at least 2 players with valuations");
      return;
    }
    setError(null);
    compareValuations(selected)
      .then(setResult)
      .catch((e) => setError(String(e)));
  }, [selected]);

  return (
    <div className="sb-page">
      <p className="muted">Compare up to 4 players (must have a valuation report each).</p>
      <ul className="compare-pick-list">
        {players.map((p) => (
          <li key={p.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.includes(p.id)}
                onChange={() => toggle(p.id)}
                disabled={!selected.includes(p.id) && selected.length >= 4}
              />
              {p.displayName} ({p.positionPrimary})
            </label>
          </li>
        ))}
      </ul>
      <button type="button" className="dtp-btn dtp-btn--primary" onClick={run}>
        Compare
      </button>
      {error && <p className="form-error">{error}</p>}
      {result && (
        <table className="sip-table compare-table">
          <thead>
            <tr>
              <th>Metric</th>
              {result.players.map((p) => (
                <th key={p.playerId}>{p.displayName}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Confidence score</td>
              {(result.values.adjustedScore as number[]).map((v, i) => (
                <td key={i}>{v}</td>
              ))}
            </tr>
            <tr>
              <td>Band</td>
              {(result.values.confidenceLabel as string[]).map((v, i) => (
                <td key={i}>{v}</td>
              ))}
            </tr>
            <tr>
              <td>Market value</td>
              {(result.values.marketValueLabel as string[]).map((v, i) => (
                <td key={i}>{v}</td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}
