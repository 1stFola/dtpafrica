import type { CSSProperties } from "react";

export function ConfidenceGauge({ score, label }: { score: number; label: string }) {
  const pct = Math.min(100, Math.max(0, score));
  return (
    <div className="mvce-gauge">
      <div className="mvce-gauge__ring" style={{ "--pct": `${pct}%` } as CSSProperties}>
        <span className="mvce-gauge__score">{Math.round(score)}</span>
      </div>
      <p className="mvce-gauge__label">{label}</p>
    </div>
  );
}
