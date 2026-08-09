import { useState } from "react";
import { Link } from "react-router-dom";
import type { FeaturedPlayer } from "../../../../api/client";
import { playerProfilePath, slugifyDisplayName } from "../../../../utils/playerSlug";
import { resolvePositionFullLabel } from "../../../../utils/positionLabels";

type SignalTone =
  | "turn"
  | "release"
  | "touch"
  | "sprint"
  | "work"
  | "speed"
  | "ballSpeed"
  | "ballDistance";

type SignalDefinition = {
  key: string;
  label: string;
  tone: SignalTone;
  max?: number;
  display?: "integer" | "decimal" | "ratio";
};

type CardSignal = SignalDefinition & {
  value: number;
  percent: number;
  displayValue: string;
};

export const FEATURED_TALENT_SIGNALS: SignalDefinition[] = [
  { key: "turn_efficiency", label: "Turn efficiency", tone: "turn", display: "ratio" },
  { key: "quick_release_score", label: "Quick release score", tone: "release" },
  { key: "multi_touch_possessions_percentage", label: "Multi-touch possessions", tone: "touch" },
  { key: "sprint_distance", label: "Sprint distance", tone: "sprint", max: 800, display: "integer" },
  { key: "work_rate", label: "Work rate", tone: "work", max: 150, display: "decimal" },
  { key: "top_speed", label: "Top speed", tone: "speed", max: 23, display: "decimal" },
  {
    key: "top_speed_with_ball",
    label: "Top speed with the ball",
    tone: "ballSpeed",
    max: 20,
    display: "decimal",
  },
  { key: "distance_with_ball", label: "Distance with the ball", tone: "ballDistance", max: 450, display: "integer" },
];

const LEGEND_SIGNALS = FEATURED_TALENT_SIGNALS;
const CARD_SIGNAL_LIMIT = 5;

function readMetric(player: FeaturedPlayer, key: string): number | null {
  const metrics = player.metrics ?? {};
  const calibration = player.benchmarkMetadata?.calibrationMetrics ?? {};
  const aliases: Record<string, string[]> = {
    multi_touch_possessions_percentage: [
      "multi_touch_possessions_percentage",
      "multi_touch_possessions__percentage",
    ],
  };
  const keys = aliases[key] ?? [key];

  for (const source of [metrics, calibration]) {
    for (const candidate of keys) {
      const value = source?.[candidate];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
  }

  return null;
}

function signalPercent(value: number, definition: SignalDefinition) {
  if (definition.key === "turn_efficiency") {
    return Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
  }
  if (definition.max) return Math.max(0, Math.min(100, (value / definition.max) * 100));
  return Math.max(0, Math.min(100, value));
}

function formatSignalValue(value: number, definition: SignalDefinition) {
  if (definition.display === "ratio") {
    return value <= 1 ? value.toFixed(2) : `${Math.round(value)}%`;
  }
  if (definition.display === "decimal") {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
  return String(Math.round(value));
}

function playerInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]).join("");
  return initials.toUpperCase() || "?";
}

function isUsablePhotoUrl(url?: string | null) {
  if (!url) return false;
  return !/imgbox/i.test(url);
}

export function FeaturedTalentLegend() {
  return (
    <div className="featured-talent-legend" aria-label="Featured player metric colour key">
      <span className="featured-talent-legend__arrow" aria-hidden="true">
        &lsaquo;
      </span>
      <div className="featured-talent-legend__items">
        {LEGEND_SIGNALS.map((signal) => (
          <span
            key={signal.key}
            className={`featured-talent-legend__item featured-talent-legend__item--${signal.tone}`}
          >
            <span aria-hidden="true" />
            {signal.label}
          </span>
        ))}
      </div>
      <span className="featured-talent-legend__arrow" aria-hidden="true">
        &rsaquo;
      </span>
    </div>
  );
}

export function FeaturedTalentCard({ player }: { player: FeaturedPlayer }) {
  const [imageFailed, setImageFailed] = useState(false);
  const slugOrId = player.slug ?? slugifyDisplayName(player.displayName) ?? player.id;
  const href = playerProfilePath(player) ?? `/players/${slugOrId}`;
  const shouldUsePhoto = isUsablePhotoUrl(player.playerPhotoUrl) && !imageFailed;
  const signals = FEATURED_TALENT_SIGNALS.map((definition) => {
    const value = readMetric(player, definition.key);
    if (value == null) return null;
    return {
      ...definition,
      value,
      percent: signalPercent(value, definition),
      displayValue: formatSignalValue(value, definition),
    };
  })
    .filter((signal): signal is CardSignal => signal != null)
    .slice(0, CARD_SIGNAL_LIMIT);

  const fallbackSignals: CardSignal[] =
    signals.length > 0
      ? signals
      : [
          player.overallRating != null
            ? {
                key: "overall_rating",
                label: "Overall rating",
                tone: "release" as SignalTone,
                value: player.overallRating,
                percent: Math.max(0, Math.min(100, player.overallRating)),
                displayValue: String(Math.round(player.overallRating)),
              }
            : null,
          player.offensiveRating != null
            ? {
                key: "offensive_rating",
                label: "Attack rating",
                tone: "sprint" as SignalTone,
                value: player.offensiveRating,
                percent: Math.max(0, Math.min(100, player.offensiveRating)),
                displayValue: String(Math.round(player.offensiveRating)),
              }
            : null,
          player.defensiveRating != null
            ? {
                key: "defensive_rating",
                label: "Defense rating",
                tone: "touch" as SignalTone,
                value: player.defensiveRating,
                percent: Math.max(0, Math.min(100, player.defensiveRating)),
                displayValue: String(Math.round(player.defensiveRating)),
            }
            : null,
        ].filter((signal): signal is CardSignal => signal != null);

  return (
    <Link to={href} className="featured-talent-card">
      <div className="featured-talent-card__portrait">
        {shouldUsePhoto ? (
          <img
            src={player.playerPhotoUrl ?? ""}
            alt=""
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span aria-hidden="true">{playerInitials(player.displayName)}</span>
        )}
      </div>
      <div className="featured-talent-card__body">
        <h3>{player.displayName}</h3>
        <p>{resolvePositionFullLabel(player.positionPrimary, player.positionFull)}</p>

        <ul className="featured-talent-card__signals">
          {fallbackSignals.map((signal) => (
            <li
              key={signal.key}
              className={`featured-talent-card__signal featured-talent-card__signal--${signal.tone}`}
            >
              <span
                className="featured-talent-card__track"
                role="meter"
                aria-label={`${signal.label}: ${signal.displayValue}`}
                aria-valuenow={Math.round(signal.percent)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuetext={`${signal.label}: ${signal.displayValue}`}
              >
                <span style={{ width: `${signal.percent}%` }} />
              </span>
              <span className="featured-talent-card__figure">{signal.displayValue}</span>
            </li>
          ))}
        </ul>
      </div>
    </Link>
  );
}
