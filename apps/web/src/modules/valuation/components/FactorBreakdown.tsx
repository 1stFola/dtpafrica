import type { ValuationReport } from "../../../api/mvce";

export function FactorBreakdown({
  factors,
}: {
  factors: ValuationReport["result"]["factors"];
}) {
  const maxWeight = Math.max(
    ...factors.map((f) => Math.abs(f.weightedContribution)),
    1
  );

  return (
    <ul className="mvce-factors">
      {factors.map((f) => (
        <li key={f.key} className="mvce-factor">
          <div className="mvce-factor__head">
            <span>{f.label}</span>
            <span className="muted">
              {f.rawScore.toFixed(0)} → {f.weightedContribution >= 0 ? "+" : ""}
              {f.weightedContribution.toFixed(1)}
            </span>
          </div>
          <div className="mvce-factor__bar">
            <div
              className={`mvce-factor__fill ${f.key === "risk" ? "mvce-factor__fill--risk" : ""}`}
              style={{
                width: `${(Math.abs(f.weightedContribution) / maxWeight) * 100}%`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
