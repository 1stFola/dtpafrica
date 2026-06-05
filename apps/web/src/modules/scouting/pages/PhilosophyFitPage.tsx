import { useCallback, useEffect, useState } from "react";
import { apiGet, type PlayerRow, type ScoutingMeta } from "../../../api/client";

type FitResponse = {
  formation: string;
  philosophy: string;
  rankings: {
    playerId: string;
    philosophyFitScore: number;
    positionFitScore: number;
    primaryStyleScore: number;
    confidenceScore: number;
  }[];
};

export function PhilosophyFitPage() {
  const [meta, setMeta] = useState<ScoutingMeta | null>(null);
  const [formation, setFormation] = useState("4-3-3");
  const [philosophy, setPhilosophy] = useState("Tiki-Taka");
  const [rankings, setRankings] = useState<FitResponse | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiGet<ScoutingMeta>("/scouting/meta").then(setMeta).catch(() => {});
    apiGet<PlayerRow[]>("/scouting/tactical-search?limit=100")
      .then(setPlayers)
      .catch(() => {});
  }, []);

  const run = useCallback(() => {
    setLoading(true);
    setError(null);
    const q = new URLSearchParams({ formation, philosophy, limit: "20" });
    apiGet<FitResponse>(`/scouting/philosophy-fit?${q}`)
      .then(setRankings)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [formation, philosophy]);

  const nameById = (id: string) =>
    players.find((p) => p.id === id)?.displayName ?? id.slice(0, 8);

  return (
    <div className="sip-page">
      <div className="sip-controls">
        <label>
          Formation
          <select value={formation} onChange={(e) => setFormation(e.target.value)}>
            {(meta?.formations ?? [formation]).map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label>
          Philosophy
          <select value={philosophy} onChange={(e) => setPhilosophy(e.target.value)}>
            {(meta?.philosophies ?? [philosophy]).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="dtp-btn dtp-btn--primary" onClick={run} disabled={loading}>
          {loading ? "Ranking…" : "Rank players"}
        </button>
      </div>

      {error && <p className="sip-error">{error}</p>}

      {rankings && (
        <table className="sip-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Philosophy fit</th>
              <th>Position fit</th>
              <th>Style</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {rankings.rankings.map((r) => (
              <tr key={r.playerId}>
                <td>{nameById(r.playerId)}</td>
                <td>{r.philosophyFitScore}</td>
                <td>{r.positionFitScore}</td>
                <td>{r.primaryStyleScore}</td>
                <td>{r.confidenceScore}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
