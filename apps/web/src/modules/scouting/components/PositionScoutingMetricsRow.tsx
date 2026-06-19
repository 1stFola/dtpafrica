import type { PublicPlayerProfile } from "../../../api/client";
import { InfoTip } from "../../../components/InfoTip";
import {
  buildPositionScoutingMetrics,
  type ScoutingMetricKey,
} from "../utils/positionScoutingMetrics";

type Props = {
  player: Pick<
    PublicPlayerProfile,
    "positionPrimary" | "role" | "metrics" | "scoutingIntelligence"
  >;
  className?: string;
  compact?: boolean;
  /** 2-column grid for the scouting summary strip. */
  variant?: "row" | "strip";
};

function ScoutingMetricIcon({ metricKey }: { metricKey: ScoutingMetricKey }) {
  const common = {
    className: "position-scouting-metrics__icon",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (metricKey) {
    case "work_rate":
      return (
        <svg {...common}>
          <path d="M5 17l3-6 2.5 4 2-5 2.5 3 2-4 3.5 8" />
          <circle cx="5" cy="17" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "first_step_accelerations":
      return (
        <svg {...common}>
          <path d="M4 18h4l3-8 3 4 3-10 3 6" />
          <circle cx="6" cy="18" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "foot_kicking_power_mph":
    case "kicking_power":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" />
          <path d="M12 5v14M8 9l4-2 4 2M8 15l4 2 4-2" />
        </svg>
      );
    case "one_touch_possessions_percentage":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="6.5" />
          <path d="M12 5.5v6.5l4.5 2.5" />
        </svg>
      );
    case "multi_touch_possessions_percentage":
      return (
        <svg {...common}>
          <path d="M8 6.5h8M8 12h8M8 17.5h8" />
          <path d="M5.5 6.5v11M18.5 6.5v11" strokeWidth="1.25" />
        </svg>
      );
    case "top_speed_with_ball":
    case "top_speed":
      return (
        <svg {...common}>
          <path d="M5 17h14" />
          <path d="M7 17l2.5-6 3 3 2.5-7 2 10" />
          <circle cx="7" cy="17" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "release_laces_percentage":
      return (
        <svg {...common}>
          <path d="M6 18l6-12 6 12" />
          <path d="M9.5 12h5" />
        </svg>
      );
    case "distance_with_ball":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="6.5" />
          <path d="M8.5 14.5c1.5-3 5.5-3 7 0" />
          <path d="M10 10.5h4" />
        </svg>
      );
    case "sprints":
      return (
        <svg {...common}>
          <path d="M4 16h3l2-5 2.5 3 2-6 2.5 4H20" />
        </svg>
      );
    case "foot_touch_percentage":
    case "foot_release_percentage":
    case "foot_receive_percentage":
      return (
        <svg {...common}>
          <path d="M9 5.5c0 2 1.5 3.5 3 3.5s3-1.5 3-3.5" />
          <path d="M7.5 9.5c1 3 2.5 5 4.5 6.5s4 1.5 5.5 0" />
          <path d="M12 16v3.5" />
        </svg>
      );
    case "turn_efficiency":
      return (
        <svg {...common}>
          <path d="M7 17a7 7 0 1 1 2.5-5.3" />
          <path d="M7 9.5V6H3.5" />
        </svg>
      );
    case "quick_release_score":
      return (
        <svg {...common}>
          <path d="M5 12h9" />
          <path d="M11 8l4 4-4 4" />
          <circle cx="18" cy="12" r="2" />
        </svg>
      );
    case "possession_duration_seconds":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" />
          <path d="M12 8v4l3 2" />
        </svg>
      );
    case "intense_turns_with_ball":
    case "intense_turns":
      return (
        <svg {...common}>
          <path d="M8 16c2-4 6-4 8 0" />
          <path d="M10 10l2-3 2 3" />
          <circle cx="12" cy="17" r="2.5" />
        </svg>
      );
    case "sprint_distance":
      return (
        <svg {...common}>
          <path d="M4 18h16" />
          <path d="M6 18l3-7 2.5 3.5L14 7l4 11" />
        </svg>
      );
    case "intense_accelerations":
      return (
        <svg {...common}>
          <path d="M5 17l4-9 3 5 2-7 3 6 2 5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="5" y="5" width="14" height="14" rx="2" />
          <path d="M9 12h6M12 9v6" />
        </svg>
      );
  }
}

function MetricValue({
  displayValue,
  unit,
}: {
  displayValue: string;
  unit?: string;
}) {
  return (
    <span className="position-scouting-metrics__value">
      <span className="position-scouting-metrics__value-num">{displayValue}</span>
      {unit ? <span className="position-scouting-metrics__value-unit">{unit}</span> : null}
    </span>
  );
}

function MetricBar({
  barPercent,
  barStyle,
}: {
  barPercent: number;
  barStyle: "subtle" | "tier";
}) {
  return (
    <div
      className={[
        "position-scouting-metrics__bar",
        barStyle === "subtle" ? "position-scouting-metrics__bar--subtle" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
    >
      <span
        className="position-scouting-metrics__bar-fill"
        style={{ width: `${barPercent}%` }}
      />
    </div>
  );
}

export function PositionScoutingMetricsRow({
  player,
  className = "",
  compact = false,
  variant = "row",
}: Props) {
  const metrics = buildPositionScoutingMetrics(player);
  const isStrip = variant === "strip";

  return (
    <div
      className={[
        "position-scouting-metrics",
        compact ? "position-scouting-metrics--compact" : "",
        isStrip ? "position-scouting-metrics--strip" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Position-specific scouting metrics"
    >
      {metrics.map((metric) => (
        <article
          key={metric.key}
          className={[
            "position-scouting-metrics__card",
            metric.tierClass,
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {isStrip ? (
            <>
              <div className="position-scouting-metrics__head">
                <div className="position-scouting-metrics__label-row">
                  <ScoutingMetricIcon metricKey={metric.key} />
                  <span className="position-scouting-metrics__label">{metric.label}</span>
                  {metric.description ? (
                    <InfoTip text={metric.description} label={metric.label} />
                  ) : null}
                </div>
                <MetricValue displayValue={metric.displayValue} unit={metric.unit} />
              </div>
              {metric.barStyle !== "none" ? (
                <MetricBar barPercent={metric.barPercent} barStyle={metric.barStyle} />
              ) : null}
            </>
          ) : (
            <>
              <div className="position-scouting-metrics__top">
                <ScoutingMetricIcon metricKey={metric.key} />
                <MetricValue displayValue={metric.displayValue} unit={metric.unit} />
              </div>
              {metric.barStyle !== "none" ? (
                <MetricBar barPercent={metric.barPercent} barStyle={metric.barStyle} />
              ) : null}
              <div className="position-scouting-metrics__label-row">
                <span className="position-scouting-metrics__label">{metric.label}</span>
                {metric.description ? (
                  <InfoTip text={metric.description} label={metric.label} />
                ) : null}
              </div>
            </>
          )}
        </article>
      ))}
    </div>
  );
}
