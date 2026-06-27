import { useEffect, useId, useMemo, useState } from "react";
import type { CategoryScore } from "../../directopro/components/playerProfile/PlayerCategoryRadar";

const RADAR_AXES_DEG = [0, 72, 144, 216, 288];
const RADAR_CX = 50;
const RADAR_CY = 50;
const RADAR_MAX_R = 38;

export const COMPARE_PLAYER_COLORS = [
  { stroke: "#22d3ee", fill: "rgba(34, 211, 238, 0.22)" },
  { stroke: "#f59e0b", fill: "rgba(245, 158, 11, 0.2)" },
  { stroke: "#34d399", fill: "rgba(52, 211, 153, 0.2)" },
  { stroke: "#a78bfa", fill: "rgba(167, 139, 250, 0.2)" },
] as const;

function radarVertex(angleDeg: number, score: number, progress: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const r = (RADAR_MAX_R * score * progress) / 100;
  return {
    x: RADAR_CX + r * Math.cos(rad),
    y: RADAR_CY + r * Math.sin(rad),
  };
}

function buildSmoothClosedPath(points: { x: number; y: number }[], tension = 0.32): string {
  const n = points.length;
  if (n < 3) return "";

  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < n; i += 1) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;
    path += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return `${path} Z`;
}

export type CompareRadarSeries = {
  playerId: string;
  displayName: string;
  scores: CategoryScore[];
};

type Props = {
  series: CompareRadarSeries[];
};

export function CompareRadarOverlay({ series }: Props) {
  const [progress, setProgress] = useState(0);
  const glowId = useId().replace(/:/g, "");

  const axisLabels = series[0]?.scores ?? [];

  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      setProgress(1);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const duration = 820;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setProgress(eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [series]);

  const paths = useMemo(
    () =>
      series.map((item) => {
        const vertices = item.scores.map((score, index) =>
          radarVertex(RADAR_AXES_DEG[index] ?? 0, score.score, progress)
        );
        return {
          playerId: item.playerId,
          displayName: item.displayName,
          path: buildSmoothClosedPath(vertices),
          vertices,
        };
      }),
    [series, progress]
  );

  const gridLevels = [25, 50, 75, 100];

  return (
    <div className="scouting-compare__radar" aria-label="Category blend comparison">
      <div className="scouting-compare__radar-chart-wrap">
        <svg
          className="scouting-compare__radar-chart"
          viewBox="-14 -14 128 128"
          role="img"
          aria-hidden="true"
        >
          {gridLevels.map((level) => {
            const ring = RADAR_AXES_DEG.map((angle) => {
              const point = radarVertex(angle, level, 1);
              return `${point.x},${point.y}`;
            }).join(" ");
            return (
              <polygon
                key={level}
                points={ring}
                className="scouting-compare__radar-grid"
              />
            );
          })}

          {RADAR_AXES_DEG.map((angle) => {
            const outer = radarVertex(angle, 100, 1);
            return (
              <line
                key={angle}
                x1={RADAR_CX}
                y1={RADAR_CY}
                x2={outer.x}
                y2={outer.y}
                className="scouting-compare__radar-spoke"
              />
            );
          })}

          {paths.map((item, index) => {
            const colors = COMPARE_PLAYER_COLORS[index % COMPARE_PLAYER_COLORS.length];
            return (
              <g key={item.playerId}>
                <path
                  d={item.path}
                  className="scouting-compare__radar-fill"
                  fill={colors.fill}
                  stroke={colors.stroke}
                />
                <path
                  d={item.path}
                  className="scouting-compare__radar-glow"
                  stroke={colors.stroke}
                  filter={`url(#${glowId}-${index})`}
                />
                {item.vertices.map((vertex, vi) => (
                  <circle
                    key={`${item.playerId}-dot-${vi}`}
                    cx={vertex.x}
                    cy={vertex.y}
                    r={2.1}
                    className="scouting-compare__radar-dot"
                    fill={colors.stroke}
                  />
                ))}
              </g>
            );
          })}

          <defs>
            {paths.map((_, index) => (
              <filter
                key={`glow-${index}`}
                id={`${glowId}-${index}`}
                x="-50%"
                y="-50%"
                width="200%"
                height="200%"
              >
                <feGaussianBlur stdDeviation="1.8" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            ))}
          </defs>

          {axisLabels.map((item, index) => {
            const angle = RADAR_AXES_DEG[index] ?? 0;
            const rad = ((angle - 90) * Math.PI) / 180;
            const labelR = RADAR_MAX_R * 1.18;
            const x = RADAR_CX + labelR * Math.cos(rad);
            const y = RADAR_CY + labelR * Math.sin(rad);
            const anchor =
              angle === 0 ? "middle" : angle > 0 && angle < 180 ? "start" : "end";

            return (
              <text
                key={item.key}
                x={x}
                y={y}
                textAnchor={anchor}
                className="scouting-compare__radar-axis-label"
              >
                {item.label}
              </text>
            );
          })}
        </svg>
      </div>

      <ul className="scouting-compare__radar-legend" aria-label="Compared players">
        {series.map((item, index) => {
          const colors = COMPARE_PLAYER_COLORS[index % COMPARE_PLAYER_COLORS.length];
          return (
            <li key={item.playerId}>
              <span
                className="scouting-compare__radar-legend-swatch"
                style={{ background: colors.stroke }}
                aria-hidden="true"
              />
              {item.displayName}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
