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
      score: readAttr(attributes, ["pace", "acceleration", "sprint_speed"], att),
    },
    {
      key: "passing",
      label: "DISTRIBUTION",
      score: readAttr(attributes, ["passing", "vision", "team_play"], att),
    },
    {
      key: "technical",
      label: "BALL SKILLS",
      score: readAttr(
        attributes,
        ["dribbling", "ball_control", "finishing", "technique", "first_touch"],
        att
      ),
    },
    {
      key: "physical",
      label: "PHYSICALITY",
      score: readAttr(attributes, ["stamina", "strength", "agility"], overall),
    },
    {
      key: "defending",
      label: "DEFENSIVE IQ",
      score: readAttr(
        attributes,
        ["positioning", "work_rate", "decision_making", "composure"],
        def
      ),
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
