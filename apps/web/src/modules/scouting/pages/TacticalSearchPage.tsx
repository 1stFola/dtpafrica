import { useCallback, useState } from "react";
import { apiGet, type PlayerRow } from "../../../api/client";
import { AdPlacement } from "../../../components/AdPlacement";
import { useAdSlot } from "../../../context/AdConfigContext";

export function TacticalSearchPage() {
  const adInterval = 8;
  const inlineAd = useAdSlot("scoutingDirectoryInline");
  const [position, setPosition] = useState("");
  const [minGegenpress, setMinGegenpress] = useState("");
  const [rows, setRows] = useState<PlayerRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = useCallback(() => {
    setLoading(true);
    setError(null);
    setSearched(true);
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
      <form
        className="sip-controls"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
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
        <button type="submit" className="dtp-btn dtp-btn--primary" disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>
      {error && (
        <p className="dtp-error-banner" role="alert">
          {error}
        </p>
      )}
      {!searched && !error && (
        <div className="dtp-empty-state">
          <p className="dtp-empty-state__title">Search the tactical database</p>
          <p>Filter by position and pressing intensity to surface matching players.</p>
        </div>
      )}
      {searched && !loading && !error && rows.length === 0 && (
        <div className="dtp-empty-state">
          <p className="dtp-empty-state__title">No players match these filters</p>
          <p>Try widening the position or lowering the minimum gegenpress score.</p>
        </div>
      )}
      {(loading || rows.length > 0) && (
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
          {loading &&
            Array.from({ length: 6 }).map((_, idx) => (
              <tr key={`skeleton-${idx}`}>
                {Array.from({ length: 5 }).map((__, col) => (
                  <td key={col}>
                    <span className="dtp-skeleton dtp-skeleton--line" style={{ marginBottom: 0 }} />
                  </td>
                ))}
              </tr>
            ))}
          {!loading &&
            rows.flatMap((p, idx) => {
              const items = [
                <tr key={p.id}>
                  <td>{p.displayName}</td>
                  <td>{p.positionPrimary}</td>
                  <td>{p.overallRating ?? "—"}</td>
                  <td>{p.tacticalScores?.gegenpressScore ?? "—"}</td>
                  <td>{p.tacticalScores?.tikiTakaScore ?? "—"}</td>
                </tr>,
              ];
              if (inlineAd && (idx + 1) % adInterval === 0 && idx < rows.length - 1) {
                items.push(
                  <tr key={`scouting-inline-ad-${idx}`} className="sip-table-ad-row">
                    <td colSpan={5}>
                      <AdPlacement slotKey="scoutingDirectoryInline" />
                    </td>
                  </tr>
                );
              }
              return items;
            })}
        </tbody>
      </table>
      )}
    </div>
  );
}
