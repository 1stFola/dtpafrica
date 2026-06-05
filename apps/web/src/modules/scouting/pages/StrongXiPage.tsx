import { useCallback, useEffect, useState } from "react";
import { apiGet, type ScoutingMeta, type StrongXiResponse } from "../../../api/client";
import { TacticalPitch } from "../components/TacticalPitch";

export function StrongXiPage() {
  const [meta, setMeta] = useState<ScoutingMeta | null>(null);
  const [formation, setFormation] = useState("4-3-3");
  const [philosophy, setPhilosophy] = useState("Gegenpressing");
  const [result, setResult] = useState<StrongXiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiGet<ScoutingMeta>("/scouting/meta")
      .then(setMeta)
      .catch((e) => setError(String(e)));
  }, []);

  const generate = useCallback(() => {
    setLoading(true);
    setError(null);
    const q = new URLSearchParams({ formation, philosophy });
    apiGet<StrongXiResponse>(`/scouting/strong-xi?${q}`)
      .then(setResult)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [formation, philosophy]);

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
        <button type="button" className="dtp-btn dtp-btn--primary" onClick={generate} disabled={loading}>
          {loading ? "Generating…" : "Generate Strong XI"}
        </button>
      </div>

      {error && <p className="sip-error">{error}</p>}

      {result && (
        <>
          <ul className="insights-list">
            {result.insights.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <TacticalPitch
            markers={result.xi.map((x) => ({
              slotId: x.slotId,
              slotLabel: x.slotLabel,
              x: x.x,
              y: x.y,
              name: x.player.displayName,
              fitScore: x.fit.philosophyFitScore,
              overall: x.player.overallRating,
              photoUrl: x.player.playerPhotoUrl,
            }))}
          />
          {result.bench.length > 0 && (
            <section className="bench-section">
              <h3>Bench alternatives</h3>
              <ul className="bench-list">
                {result.bench.map((b) => (
                  <li key={`${b.slotId}-${b.player.id}`}>
                    <strong>{b.slotLabel}</strong> — {b.player.displayName} (fit {b.fit.philosophyFitScore})
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
