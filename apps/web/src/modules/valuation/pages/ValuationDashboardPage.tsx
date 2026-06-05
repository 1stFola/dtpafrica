import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchValuationReport, type ValuationReport } from "../../../api/mvce";
import { ConfidenceGauge } from "../components/ConfidenceGauge";
import { FactorBreakdown } from "../components/FactorBreakdown";
import { usePageTitle } from "../../../hooks/usePageTitle";

export function ValuationDashboardPage() {
  const { playerId } = useParams<{ playerId: string }>();
  const [report, setReport] = useState<ValuationReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  usePageTitle(report?.player.displayName ?? "Valuation");

  useEffect(() => {
    if (!playerId) return;
    fetchValuationReport(playerId)
      .then(setReport)
      .catch((e) => setError(String(e)));
  }, [playerId]);

  if (error) {
    return (
      <div className="sb-page">
        <p className="form-error">{error}</p>
        <Link to="/valuation/generate">Generate valuation</Link>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="sb-page">
        <p className="muted">Loading report…</p>
      </div>
    );
  }

  const { result, player } = report;
  const mult = result.multipliers;

  return (
    <div className="sb-page mvce-dashboard">
      <Link to="/valuation" className="back-link">
        ← Valuation
      </Link>

      <div className="mvce-dashboard-grid">
        <aside className="mvce-panel">
          <h2>{player.displayName}</h2>
          <p className="muted">
            {player.positionPrimary}
            {player.age != null ? ` · ${player.age} yrs` : ""}
            {player.nationality ? ` · ${player.nationality}` : ""}
          </p>
          <p className="muted">
            Run {new Date(report.createdAt).toLocaleString()}
          </p>
        </aside>

        <section className="mvce-panel mvce-panel--center">
          <ConfidenceGauge
            score={result.adjustedScore}
            label={result.confidenceLabel}
          />
          <p className="mvce-value-band">{result.marketValueLabel}</p>
          {result.marketValueMinEur != null && (
            <p className="muted">
              €{result.marketValueMinEur.toLocaleString()} – €
              {result.marketValueMaxEur?.toLocaleString()}
            </p>
          )}
          <p className="muted">Base score {result.baseScore} before multipliers</p>
        </section>

        <aside className="mvce-panel">
          <h3>Strengths</h3>
          <ul className="mvce-bullets mvce-bullets--pos">
            {result.strengths.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <h3>Weaknesses</h3>
          <ul className="mvce-bullets mvce-bullets--neg">
            {result.weaknesses.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </aside>
      </div>

      <section className="sb-section">
        <h2>Factor breakdown</h2>
        <FactorBreakdown factors={result.factors} />
      </section>

      <section className="sb-section">
        <h2>Multipliers</h2>
        <div className="mvce-mult-grid">
          <div>
            <span className="label">Verification</span>
            <strong>
              {mult.verification.level} × {mult.verification.value}
            </strong>
          </div>
          <div>
            <span className="label">Market demand</span>
            <strong>
              {mult.marketDemand.level} × {mult.marketDemand.value}
            </strong>
          </div>
          <div>
            <span className="label">Position</span>
            <strong>
              {mult.position.position} × {mult.position.value}
            </strong>
          </div>
          <div>
            <span className="label">Combined</span>
            <strong>× {mult.combined}</strong>
          </div>
        </div>
      </section>

      <section className="sb-section">
        <h2>Scout notes</h2>
        <p className="mvce-scout-notes">{result.scoutNotes}</p>
      </section>
    </div>
  );
}
