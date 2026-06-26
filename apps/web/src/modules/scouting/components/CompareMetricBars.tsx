import { COMPARE_PLAYER_COLORS } from "./CompareRadarOverlay";

export type CompareMetricRow = {
  key: string;
  label: string;
  values: (number | null)[];
};

type Props = {
  title: string;
  metrics: CompareMetricRow[];
  playerNames: string[];
};

function barWidth(value: number | null): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function CompareMetricBars({ title, metrics, playerNames }: Props) {
  return (
    <section className="scouting-compare__bars" aria-label={title}>
      <h3 className="scouting-compare__section-title">{title}</h3>
      <div className="scouting-compare__bars-grid">
        {metrics.map((metric) => (
          <article key={metric.key} className="scouting-compare__bar-row">
            <div className="scouting-compare__bar-label">{metric.label}</div>
            <div className="scouting-compare__bar-tracks">
              {metric.values.map((value, index) => {
                const colors = COMPARE_PLAYER_COLORS[index % COMPARE_PLAYER_COLORS.length];
                const width = barWidth(value);
                return (
                  <div key={`${metric.key}-${index}`} className="scouting-compare__bar-track-wrap">
                    <div className="scouting-compare__bar-track-meta">
                      <span className="scouting-compare__bar-player" style={{ color: colors.stroke }}>
                        {playerNames[index] ?? `Player ${index + 1}`}
                      </span>
                      <span className="scouting-compare__bar-value">
                        {value != null && Number.isFinite(value) ? Math.round(value) : "—"}
                      </span>
                    </div>
                    <div className="scouting-compare__bar-track" aria-hidden="true">
                      <span
                        className="scouting-compare__bar-fill"
                        style={{
                          width: `${width}%`,
                          background: `linear-gradient(90deg, ${colors.fill}, ${colors.stroke})`,
                          boxShadow: `0 0 12px ${colors.fill}`,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
