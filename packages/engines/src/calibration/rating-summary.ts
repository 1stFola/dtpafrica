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

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function average(values: number[]) {
  if (values.length === 0) return 50;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

export function calibrationCategoryScoresFromAttributes(
  attributes: Record<string, number>,
): CalibrationCategoryScore[] {
  return [
    {
      key: "speed",
      label: "Speed Profile",
      score: readAttributeGroup(attributes, ["pace", "acceleration", "sprint_speed"]),
    },
    {
      key: "distribution",
      label: "Distribution",
      score: readAttributeGroup(attributes, ["passing", "vision", "team_play"]),
    },
    {
      key: "ball_skills",
      label: "Ball Skills",
      score: readAttributeGroup(attributes, [
        "dribbling",
        "ball_control",
        "finishing",
        "technique",
        "first_touch",
      ]),
    },
    {
      key: "physicality",
      label: "Physicality",
      score: readAttributeGroup(attributes, ["stamina", "strength", "agility"]),
    },
    {
      key: "defensive_iq",
      label: "Defensive IQ",
      score: readAttributeGroup(attributes, [
        "positioning",
        "work_rate",
        "decision_making",
        "composure",
      ]),
    },
  ];
}

export function summarizeCalibratedRatings(
  attributes: Record<string, number>,
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
  const overallRating = clampScore(average(categories.map((item) => item.score)));

  return {
    offensive_score: offensiveScore,
    defensive_score: defensiveScore,
    overall_rating: overallRating,
  };
}
