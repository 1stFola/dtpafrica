import { useCallback, useState } from "react";
import { apiGet, type PlayerRow } from "../../../api/client";

export function TacticalSearchPage() {
  const [position, setPosition] = useState("");
  const [minGegenpress, setMinGegenpress] = useState("");
  const [rows, setRows] = useState<PlayerRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const search = useCallback(() => {
    setLoading(true);
    setError(null);
    const q = new URLSearchParams();
    if (position) q.set("position", position);
    if (minGegenpress) q.set("minGegenpress", minGegenpress);
    q.set("limit", "25");
    apiGet<PlayerRow[]>(`/scouting/tactical-search?${q}`)
      .then(setRows)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [position, minGegenpress]);

  return (
    <div className="sip-page">
      <div className="sip-controls">
        <label>
          Position
          <input
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            placeholder="e.g. AM, ST"
          />
        </label>
        <label>
          Min gegenpress
          <input
            type="number"
            value={minGegenpress}
            onChange={(e) => setMinGegenpress(e.target.value)}
            placeholder="0–100"
          />
        </label>
        <button type="button" className="dtp-btn dtp-btn--primary" onClick={search} disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </div>
      {error && <p className="sip-error">{error}</p>}
      <table className="sip-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Pos</th>
            <th>Overall</th>
            <th>Gegenpress</th>
            <th>Tiki-taka</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>{p.displayName}</td>
              <td>{p.positionPrimary}</td>
              <td>{p.overallRating ?? "—"}</td>
              <td>{p.tacticalScores?.gegenpressScore ?? "—"}</td>
              <td>{p.tacticalScores?.tikiTakaScore ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
