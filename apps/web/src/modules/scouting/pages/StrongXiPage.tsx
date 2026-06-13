import { useCallback, useEffect, useState } from "react";
import { apiGet, type ScoutingMeta, type StrongXiResponse } from "../../../api/client";
import {
  StrongXiPlayerModal,
  type StrongXiPlayerSelection,
} from "../components/StrongXiPlayerModal";
import { TacticalPitch } from "../components/TacticalPitch";

function toSelection(
  pick: StrongXiResponse["xi"][number] | StrongXiResponse["bench"][number]
): StrongXiPlayerSelection {
  return {
    playerId: pick.player.id,
    displayName: pick.player.displayName,
    slotLabel: pick.slotLabel,
    philosophyFitScore: pick.fit.philosophyFitScore,
    positionFitScore: pick.fit.positionFitScore,
    confidenceScore: pick.fit.confidenceScore,
    photoUrl: "playerPhotoUrl" in pick.player ? pick.player.playerPhotoUrl : null,
    positionPrimary:
      "positionPrimary" in pick.player ? pick.player.positionPrimary : undefined,
    overallRating:
      "overallRating" in pick.player ? pick.player.overallRating : undefined,
    offensiveRating:
      "offensiveRating" in pick.player ? pick.player.offensiveRating : undefined,
    defensiveRating:
      "defensiveRating" in pick.player ? pick.player.defensiveRating : undefined,
  };
}

export function StrongXiPage() {
  const [meta, setMeta] = useState<ScoutingMeta | null>(null);
  const [formation, setFormation] = useState("4-3-3");
  const [philosophy, setPhilosophy] = useState("Gegenpressing");
  const [result, setResult] = useState<StrongXiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<StrongXiPlayerSelection | null>(null);

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
            onSelect={(slotId) => {
              const pick = result.xi.find((x) => x.slotId === slotId);
              if (pick) setSelectedPlayer(toSelection(pick));
            }}
          />
          {result.bench.length > 0 && (
            <section className="bench-section">
              <h3>Bench alternatives</h3>
              <ul className="bench-list">
                {result.bench.map((b) => (
                  <li key={`${b.slotId}-${b.player.id}`}>
                    <button
                      type="button"
                      className="bench-list__item"
                      onClick={() => setSelectedPlayer(toSelection(b))}
                    >
                      <strong>{b.slotLabel}</strong> — {b.player.displayName} (fit{" "}
                      {b.fit.philosophyFitScore})
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <StrongXiPlayerModal
            open={selectedPlayer != null}
            selection={selectedPlayer}
            formation={formation}
            philosophy={philosophy}
            onClose={() => setSelectedPlayer(null)}
          />
        </>
      )}
    </div>
  );
}
