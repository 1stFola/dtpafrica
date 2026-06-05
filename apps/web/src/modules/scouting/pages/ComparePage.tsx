import { useCallback, useEffect, useState } from "react";
import { apiGet, type ComparisonResponse, type PlayerRow } from "../../../api/client";

const LABELS: Record<string, string> = {
  gegenpressScore: "Gegenpress",
  tikiTakaScore: "Tiki-taka",
  counterAttackScore: "Counter",
  wingerScore: "Winger",
  overallRating: "Overall",
  offensiveRating: "Offensive",
  defensiveRating: "Defensive",
};

export function ComparePage() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<ComparisonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<PlayerRow[]>("/scouting/tactical-search?limit=100")
      .then(setPlayers)
      .catch(() => {});
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  };

  const compare = useCallback(() => {
    if (selected.length < 2) {
      setError("Select at least 2 players");
      return;
    }
    setError(null);
    apiGet<ComparisonResponse>(`/scouting/player-comparison?ids=${selected.join(",")}`)
      .then(setResult)
      .catch((e) => setError(String(e)));
  }, [selected]);

  const displayMetrics = result?.metrics.filter((m) => LABELS[m]) ?? [];

  return (
    <div className="sip-page">
      <p className="muted">Select up to 4 players with tactical scores.</p>
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
      <button
        type="button"
        className="dtp-btn dtp-btn--primary"
        onClick={compare}
        disabled={selected.length < 2}
      >
        Compare
      </button>
      {error && <p className="sip-error">{error}</p>}
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
            {displayMetrics.map((metric) => (
              <tr key={metric}>
                <td>{LABELS[metric] ?? metric}</td>
                {(result.values[metric] ?? []).map((val, i) => (
                  <td key={i}>{Math.round(val)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
