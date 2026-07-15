export type CalibrationRatingSummary = {
  offensive_score: number;
  defensive_score: number;
  overall_rating: number;
};

export type CalibrationCategoryScore = {
  key: "speed" | "distribution" | "ball_skills" | "physicality" | "defensive_iq";
  label: string;
  score: number;
};

type CalibrationCategoryKey = CalibrationCategoryScore["key"];

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function average(values: number[]) {
  if (values.length === 0) return 50;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function benchmarkPosition(position?: string) {
  const normalized = String(position ?? "").trim().toUpperCase();
  if (["RW", "LW", "WINGER"].includes(normalized)) return "WINGER";
  if (["RB", "LB", "RWB", "LWB", "FB"].includes(normalized)) return "FB";
  return normalized;
}

function readAttributeGroup(
  attributes: Record<string, number>,
  keys: readonly string[],
  fallback = 50,
) {
  const values = keys
    .map((key) => attributes[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length > 0 ? clampScore(average(values)) : clampScore(fallback);
}

function weightedAttributeGroup(
  attributes: Record<string, number>,
  entries: readonly { key: string; weight: number }[],
  fallback = 50,
  options: {
    supportFloorWeight?: number;
    spreadAllowance?: number;
    spreadPenalty?: number;
  } = {},
) {
  const available = entries
    .map((entry) => ({ ...entry, value: attributes[entry.key] }))
    .filter((entry): entry is { key: string; weight: number; value: number } =>
      typeof entry.value === "number" && Number.isFinite(entry.value)
    );

  if (available.length === 0) return clampScore(fallback);
  if (available.length < entries.length) {
    return readAttributeGroup(
      attributes,
      entries.map((entry) => entry.key),
      fallback,
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
    weightedScore * (1 - supportFloorWeight) + supportFloor * supportFloorWeight - weakTraitPenalty,
  );
}

export function speedProfileScoreFromAttributes(
  attributes: Record<string, number>,
  fallback = 50,
) {
  return weightedAttributeGroup(
    attributes,
    [
      { key: "pace", weight: 0.34 },
      { key: "acceleration", weight: 0.36 },
      { key: "sprint_speed", weight: 0.3 },
    ],
    fallback,
    { supportFloorWeight: 0.08, spreadAllowance: 16, spreadPenalty: 0.16 },
  );
}

function distributionScoreFromAttributes(attributes: Record<string, number>) {
  return weightedAttributeGroup(attributes, [
    { key: "passing", weight: 0.42 },
    { key: "vision", weight: 0.32 },
    { key: "team_play", weight: 0.26 },
  ], 50, { supportFloorWeight: 0.08, spreadAllowance: 20, spreadPenalty: 0.1 });
}

function ballSkillsScoreFromAttributes(attributes: Record<string, number>) {
  return weightedAttributeGroup(attributes, [
    { key: "dribbling", weight: 0.22 },
    { key: "ball_control", weight: 0.24 },
    { key: "first_touch", weight: 0.2 },
    { key: "technique", weight: 0.2 },
    { key: "finishing", weight: 0.14 },
  ], 50, { supportFloorWeight: 0.06, spreadAllowance: 20, spreadPenalty: 0.08 });
}

function physicalityScoreFromAttributes(attributes: Record<string, number>) {
  return weightedAttributeGroup(attributes, [
    { key: "stamina", weight: 0.38 },
    { key: "agility", weight: 0.34 },
    { key: "strength", weight: 0.28 },
  ], 50, { supportFloorWeight: 0.08, spreadAllowance: 18, spreadPenalty: 0.1 });
}

function defensiveIqScoreFromAttributes(attributes: Record<string, number>) {
  return weightedAttributeGroup(attributes, [
    { key: "positioning", weight: 0.32 },
    { key: "decision_making", weight: 0.28 },
    { key: "work_rate", weight: 0.24 },
    { key: "composure", weight: 0.16 },
  ], 50, { supportFloorWeight: 0.08, spreadAllowance: 20, spreadPenalty: 0.08 });
}

function roleOverallWeights(position?: string): Record<CalibrationCategoryKey, number> {
  switch (benchmarkPosition(position)) {
    case "ST":
      return { speed: 0.24, distribution: 0.12, ball_skills: 0.3, physicality: 0.2, defensive_iq: 0.14 };
    case "WINGER":
      return { speed: 0.3, distribution: 0.16, ball_skills: 0.28, physicality: 0.16, defensive_iq: 0.1 };
    case "AM":
      return { speed: 0.14, distribution: 0.28, ball_skills: 0.3, physicality: 0.1, defensive_iq: 0.18 };
    case "CM":
      return { speed: 0.1, distribution: 0.28, ball_skills: 0.2, physicality: 0.18, defensive_iq: 0.24 };
    case "CDM":
      return { speed: 0.08, distribution: 0.2, ball_skills: 0.12, physicality: 0.22, defensive_iq: 0.38 };
    case "FB":
      return { speed: 0.22, distribution: 0.2, ball_skills: 0.1, physicality: 0.24, defensive_iq: 0.24 };
    case "CB":
      return { speed: 0.08, distribution: 0.16, ball_skills: 0.08, physicality: 0.28, defensive_iq: 0.4 };
    default:
      return { speed: 0.2, distribution: 0.2, ball_skills: 0.2, physicality: 0.2, defensive_iq: 0.2 };
  }
}

function weightedCategorySummary(
  categories: CalibrationCategoryScore[],
  weights: Record<CalibrationCategoryKey, number>,
) {
  const byKey = Object.fromEntries(categories.map((item) => [item.key, item.score])) as Record<
    CalibrationCategoryKey,
    number
  >;
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  return clampScore(
    Object.entries(weights).reduce(
      (sum, [key, weight]) => sum + byKey[key as CalibrationCategoryKey] * weight,
      0,
    ) / totalWeight,
  );
}

export function calibrationCategoryScoresFromAttributes(
  attributes: Record<string, number>,
): CalibrationCategoryScore[] {
  return [
    {
      key: "speed",
      label: "Speed Profile",
      score: speedProfileScoreFromAttributes(attributes),
    },
    {
      key: "distribution",
      label: "Distribution",
      score: distributionScoreFromAttributes(attributes),
    },
    {
      key: "ball_skills",
      label: "Ball Skills",
      score: ballSkillsScoreFromAttributes(attributes),
    },
    {
      key: "physicality",
      label: "Physicality",
      score: physicalityScoreFromAttributes(attributes),
    },
    {
      key: "defensive_iq",
      label: "Defensive IQ",
      score: defensiveIqScoreFromAttributes(attributes),
    },
  ];
}

export function summarizeCalibratedRatings(
  attributes: Record<string, number>,
  position?: string,
): CalibrationRatingSummary {
  const categories = calibrationCategoryScoresFromAttributes(attributes);
  const byKey = Object.fromEntries(categories.map((item) => [item.key, item.score])) as Record<
    CalibrationCategoryScore["key"],
    number
  >;

  const offensiveScore = clampScore(
    byKey.ball_skills * 0.35 +
      byKey.speed * 0.25 +
      byKey.distribution * 0.25 +
      byKey.physicality * 0.15,
  );
  const defensiveScore = clampScore(
    byKey.defensive_iq * 0.55 + byKey.physicality * 0.25 + byKey.distribution * 0.2,
  );
  const overallRating = weightedCategorySummary(categories, roleOverallWeights(position));

  return {
    offensive_score: offensiveScore,
    defensive_score: defensiveScore,
    overall_rating: overallRating,
  };
}
