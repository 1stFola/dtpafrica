import type { PublicPlayerProfile } from "../../../api/client";
import type { CategoryScore } from "../../directopro/components/playerProfile/PlayerCategoryRadar";
import { isGoalkeeper } from "../../../utils/position";
import {
  withCalibratedMetrics,
  type CalibratedPlayerInput,
} from "./resolveCalibratedPlayerMetrics";

type RadarPlayerInput = Pick<
  PublicPlayerProfile,
  | "overallRating"
  | "offensiveRating"
  | "defensiveRating"
  | "ratingAttributes"
  | "tacticalSummary"
> &
  CalibratedPlayerInput;

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function readAttr(
  attributes: Record<string, number>,
  keys: readonly string[],
  fallback: number
) {
  const values = keys
    .map((key) => attributes[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return fallback;
  return clampScore(average(values));
}

function weightedAttrScore(
  attributes: Record<string, number>,
  entries: readonly { key: string; weight: number }[],
  fallback: number,
  options: {
    supportFloorWeight?: number;
    spreadAllowance?: number;
    spreadPenalty?: number;
  } = {}
) {
  const available = entries
    .map((entry) => ({ ...entry, value: attributes[entry.key] }))
    .filter((entry): entry is { key: string; weight: number; value: number } =>
      typeof entry.value === "number" && Number.isFinite(entry.value)
    );

  if (available.length === 0) return fallback;
  if (available.length < entries.length) {
    return readAttr(
      attributes,
      entries.map((entry) => entry.key),
      fallback
    );
  }

  const totalWeight = available.reduce((sum, entry) => sum + entry.weight, 0);
  const weightedScore =
    available.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / totalWeight;
  const values = available.map((entry) => entry.value);
  const supportFloor = Math.min(...values);
  const spread = Math.max(...values) - supportFloor;
  const supportFloorWeight = options.supportFloorWeight ?? 0.1;
  const spreadAllowance = options.spreadAllowance ?? 18;
  const spreadPenalty = options.spreadPenalty ?? 0.15;
  const weakTraitPenalty = Math.max(0, spread - spreadAllowance) * spreadPenalty;

  return clampScore(
    weightedScore * (1 - supportFloorWeight) + supportFloor * supportFloorWeight - weakTraitPenalty
  );
}

function speedProfileScore(attributes: Record<string, number>, fallback: number) {
  return weightedAttrScore(
    attributes,
    [
      { key: "pace", weight: 0.34 },
      { key: "acceleration", weight: 0.36 },
      { key: "sprint_speed", weight: 0.3 },
    ],
    fallback,
    { supportFloorWeight: 0.08, spreadAllowance: 16, spreadPenalty: 0.16 }
  );
}

function distributionScore(attributes: Record<string, number>, fallback: number) {
  return weightedAttrScore(
    attributes,
    [
      { key: "passing", weight: 0.42 },
      { key: "vision", weight: 0.32 },
      { key: "team_play", weight: 0.26 },
    ],
    fallback,
    { supportFloorWeight: 0.08, spreadAllowance: 20, spreadPenalty: 0.1 }
  );
}

function ballSkillsScore(attributes: Record<string, number>, fallback: number) {
  return weightedAttrScore(
    attributes,
    [
      { key: "dribbling", weight: 0.22 },
      { key: "ball_control", weight: 0.24 },
      { key: "first_touch", weight: 0.2 },
      { key: "technique", weight: 0.2 },
      { key: "finishing", weight: 0.14 },
    ],
    fallback,
    { supportFloorWeight: 0.06, spreadAllowance: 20, spreadPenalty: 0.08 }
  );
}

function physicalityScore(attributes: Record<string, number>, fallback: number) {
  return weightedAttrScore(
    attributes,
    [
      { key: "stamina", weight: 0.38 },
      { key: "agility", weight: 0.34 },
      { key: "strength", weight: 0.28 },
    ],
    fallback,
    { supportFloorWeight: 0.08, spreadAllowance: 18, spreadPenalty: 0.1 }
  );
}

function defensiveIqScore(attributes: Record<string, number>, fallback: number) {
  return weightedAttrScore(
    attributes,
    [
      { key: "positioning", weight: 0.32 },
      { key: "decision_making", weight: 0.28 },
      { key: "work_rate", weight: 0.24 },
      { key: "composure", weight: 0.16 },
    ],
    fallback,
    { supportFloorWeight: 0.08, spreadAllowance: 20, spreadPenalty: 0.08 }
  );
}

export function buildAttributeMap(
  player: Pick<
    PublicPlayerProfile,
    "overallRating" | "offensiveRating" | "defensiveRating" | "ratingAttributes" | "tacticalSummary"
  >
): Record<string, number> {
  const overall = player.overallRating ?? 62;
  const offensive = player.offensiveRating ?? overall;
  const defensive = player.defensiveRating ?? overall;
  const tactical = player.tacticalSummary;

  const fallback = {
    pace: overall,
    acceleration: overall,
    sprint_speed: overall,
    stamina: defensive,
    strength: defensive,
    agility: offensive,
    dribbling: offensive,
    ball_control: offensive,
    passing: tactical ? tactical.tikiTakaScore : offensive,
    finishing: offensive,
    technique: offensive,
    first_touch: offensive,
    vision: tactical ? tactical.totalFootballScore : overall,
    composure: overall,
    decision_making: overall,
    work_rate: defensive,
    positioning: defensive,
    team_play: tactical ? tactical.counterAttackScore : overall,
  };

  return {
    ...fallback,
    ...(player.ratingAttributes ?? {}),
  };
}

/** Five-axis radar: composite category blends (not single attributes). */
export function buildPerformanceRadarScores(player: RadarPlayerInput): CategoryScore[] {
  const calibrated = withCalibratedMetrics(player);
  const overall = calibrated.overallRating ?? 62;
  const att = clampScore(calibrated.offensiveRating ?? overall);
  const def = clampScore(calibrated.defensiveRating ?? overall);
  const attributes = buildAttributeMap(calibrated);

  return [
    {
      key: "pace",
      label: "SPEED PROFILE",
      score: speedProfileScore(attributes, att),
    },
    {
      key: "passing",
      label: "DISTRIBUTION",
      score: distributionScore(attributes, att),
    },
    {
      key: "technical",
      label: "BALL SKILLS",
      score: ballSkillsScore(attributes, att),
    },
    {
      key: "physical",
      label: "PHYSICALITY",
      score: physicalityScore(attributes, overall),
    },
    {
      key: "defending",
      label: "DEFENSIVE IQ",
      score: defensiveIqScore(attributes, def),
    },
  ];
}

export function formatStatValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(value);
}

export function resolvePlayerAge(player: PublicPlayerProfile): string {
  if (player.ageGroup?.trim()) return player.ageGroup.trim();
  return "—";
}

export function resolvePlayerClub(player: PublicPlayerProfile): string {
  if (player.club?.trim()) return player.club.trim();
  const team = player.scoreboardHistory?.teams?.[0];
  if (team?.teamName?.trim()) return team.teamName.trim();
  return "—";
}

export function isGkProfile(
  player: Pick<PublicPlayerProfile, "role" | "positionPrimary">
): boolean {
  return isGoalkeeper(player.role) || isGoalkeeper(player.positionPrimary);
}

const METRIC_LABELS: Record<string, string> = {
  goals: "Goals",
  assists: "Assists",
  yellow: "Yellow cards",
  red: "Red cards",
};

export function buildStatLeaderHonor(
  competitionName: string | undefined,
  metric: string,
  rank: number
): string | null {
  if (rank !== 1 || !competitionName?.trim()) return null;
  const label = METRIC_LABELS[metric] ?? metric;
  return `${competitionName.trim()} ${label} Stat Leader`;
}

export function philosophyFitTier(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return "—";
  if (score >= 85) return "Elite fit";
  if (score >= 75) return "Strong fit";
  if (score >= 65) return "Developing fit";
  return "Emerging fit";
}

export function philosophyFitTierClass(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) {
    return "strong-xi-modal__tier-badge--neutral";
  }
  if (score >= 85) return "strong-xi-modal__tier-badge--elite";
  if (score >= 75) return "strong-xi-modal__tier-badge--strong";
  if (score >= 65) return "strong-xi-modal__tier-badge--developing";
  return "strong-xi-modal__tier-badge--emerging";
}

export function initialsFromName(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?"
  );
}
