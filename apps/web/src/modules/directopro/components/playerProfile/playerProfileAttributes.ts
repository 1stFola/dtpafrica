export const ATTRIBUTE_GROUPS = [
  {
    title: "Athletic",
    keys: ["pace", "acceleration", "sprint_speed", "stamina", "strength", "agility"],
  },
  {
    title: "Technical",
    keys: ["dribbling", "ball_control", "passing", "finishing", "technique", "first_touch"],
  },
  {
    title: "Mental",
    keys: ["vision", "composure", "decision_making"],
  },
  {
    title: "Team impact",
    keys: ["work_rate", "positioning", "team_play"],
  },
] as const;

export const ATTRIBUTE_LABELS: Record<string, string> = {
  pace: "Pace",
  acceleration: "Acceleration",
  sprint_speed: "Sprint speed",
  stamina: "Stamina",
  strength: "Strength",
  agility: "Agility",
  dribbling: "Dribbling",
  ball_control: "Ball control",
  passing: "Passing",
  finishing: "Finishing",
  technique: "Technique",
  first_touch: "First touch",
  vision: "Vision",
  composure: "Composure",
  decision_making: "Decision making",
  work_rate: "Work rate",
  positioning: "Positioning",
  team_play: "Team play",
};

export type RatingAttributeKey = (typeof ATTRIBUTE_GROUPS)[number]["keys"][number];

export const ALL_ATTRIBUTE_KEYS = ATTRIBUTE_GROUPS.flatMap(
  (group) => group.keys
) as RatingAttributeKey[];

export function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function attributeTierClass(score: number): string {
  if (score >= 80) return "player-profile-attr--elite";
  if (score >= 70) return "player-profile-attr--silver";
  if (score >= 60) return "player-profile-attr--developing";
  return "player-profile-attr--base";
}
