import { useEffect, useId, useMemo, useState } from "react";

export type CategoryScore = { key: string; label: string; score: number };

const RADAR_AXES_DEG = [0, 72, 144, 216, 288];
const RADAR_CX = 50;
const RADAR_CY = 50;
const RADAR_MAX_R = 38;
const LABEL_RADIUS_PCT = 118;

const LABEL_LAYOUT: {
  anchor: "middle" | "start" | "end";
  dx: number;
  dy: number;
}[] = [
  { anchor: "middle", dx: 0, dy: -4.2 },
  { anchor: "start", dx: 3.4, dy: -1.6 },
  { anchor: "start", dx: 3.4, dy: 1.8 },
  { anchor: "end", dx: -3.4, dy: 1.8 },
  { anchor: "end", dx: -3.4, dy: -1.6 },
];

function radarVertex(angleDeg: number, radiusPct: number, progress: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const r = (RADAR_MAX_R * radiusPct * progress) / 100;
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

/** Per-axis tier for radar labels, nodes, and gradient stops. */
export function categoryRadarTierClass(score: number): string {
  if (score >= 80) return "player-profile-cat-radar__tier--elite";
  if (score >= 70) return "player-profile-cat-radar__tier--strong";
  if (score >= 60) return "player-profile-cat-radar__tier--developing";
  return "player-profile-cat-radar__tier--low";
}

export function categoryPillClass(score: number): string {
  if (score >= 80) return "player-profile-cat-pill--elite";
  if (score >= 70) return "player-profile-cat-pill--strong";
  if (score >= 55) return "player-profile-cat-pill--mid";
  return "player-profile-cat-pill--low";
}

function tierGradientStopColor(score: number): string {
  if (score >= 80) return "#34d399";
  if (score >= 70) return "#22d3ee";
  if (score >= 60) return "#f59e0b";
  return "#64748b";
}

type Props = {
  scores: CategoryScore[];
};

export function PlayerCategoryRadar({ scores }: Props) {
  const [progress, setProgress] = useState(0);
  const fillGradId = useId().replace(/:/g, "");

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
  }, [scores]);

  const dataVertices = useMemo(
    () =>
      scores.map((item, index) =>
        radarVertex(RADAR_AXES_DEG[index] ?? 0, item.score, progress)
      ),
    [scores, progress]
  );

  const dataPath = useMemo(
    () => buildSmoothClosedPath(dataVertices),
    [dataVertices]
  );

  const gridLevels = [25, 50, 75, 100];
  const gradStops = scores.length > 1 ? scores.length - 1 : 1;

  return (
    <div className="player-profile-cat-radar" aria-label="Attribute category overview">
      <svg
        className="player-profile-cat-radar__chart"
        viewBox="-12 -12 124 124"
        role="img"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id={fillGradId}
            x1={RADAR_CX}
            y1="6"
            x2={RADAR_CX}
            y2="94"
            gradientUnits="userSpaceOnUse"
          >
            {scores.map((item, index) => (
              <stop
                key={item.key}
                offset={`${(index / gradStops) * 100}%`}
                stopColor={tierGradientStopColor(item.score)}
              />
            ))}
          </linearGradient>
        </defs>

        {gridLevels.map((level) => {
          const ring = RADAR_AXES_DEG.map((angle) => {
            const point = radarVertex(angle, level, 1);
            return `${point.x},${point.y}`;
          }).join(" ");
          return (
            <polygon
              key={level}
              points={ring}
              className="player-profile-cat-radar__grid"
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
              className="player-profile-cat-radar__spoke"
            />
          );
        })}

        <path
          d={dataPath}
          className="player-profile-cat-radar__fill"
          fill={`url(#${fillGradId})`}
        />
        <path d={dataPath} className="player-profile-cat-radar__glow" />

        {dataVertices.map((vertex, index) => {
          const item = scores[index];
          if (!item) return null;
          return (
            <circle
              key={`dot-${item.key}`}
              cx={vertex.x}
              cy={vertex.y}
              r={2.35}
              className={`player-profile-cat-radar__dot ${categoryRadarTierClass(item.score)}`}
            />
          );
        })}

        {scores.map((item, index) => {
          const angle = RADAR_AXES_DEG[index] ?? 0;
          const anchor = radarVertex(angle, LABEL_RADIUS_PCT, 1);
          const layout = LABEL_LAYOUT[index] ?? LABEL_LAYOUT[0];
          const tierClass = categoryRadarTierClass(item.score);
          const x = anchor.x + layout.dx;
          const y = anchor.y + layout.dy;

          return (
            <text
              key={`label-${item.key}`}
              x={x}
              y={y}
              textAnchor={layout.anchor}
              className={`player-profile-cat-radar__label ${tierClass}`}
            >
              <tspan className="player-profile-cat-radar__label-name">{item.label}</tspan>
              <tspan
                x={x}
                dy="1.12em"
                className="player-profile-cat-radar__label-score"
              >
                {item.score}
              </tspan>
            </text>
          );
        })}
      </svg>
    </div>
  );
}
