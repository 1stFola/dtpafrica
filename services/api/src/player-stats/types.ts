export type MaybeNumber = number | null;

export type RawMetric = {
  value: MaybeNumber;
  unit?: string | null;
  confidence?: number | null;
};

export type ExtractedPlayerStats = {
  ball_possessions: RawMetric;
  total_distance: RawMetric;
  sprint_distance: RawMetric;
  top_speed: RawMetric;
  kicking_power: RawMetric;
  distance_with_ball: RawMetric;
  top_speed_with_ball: RawMetric;
  intense_turns_with_ball: RawMetric;
  first_step_accelerations: RawMetric;
  intense_accelerations: RawMetric;
  sprints: RawMetric;
  intense_turns: RawMetric;
  avg_turn_entry_speed: RawMetric;
  avg_turn_exit_speed: RawMetric;
  left_turns: RawMetric;
  right_turns: RawMetric;
  back_turns: RawMetric;
  one_touch_possessions_count: RawMetric;
  multi_touch_possessions_count: RawMetric;
  total_ball_possessions: RawMetric;
  possession_duration_seconds: RawMetric;
  release_laces_count: RawMetric;
  release_inside_foot_count: RawMetric;
  release_other_footzone_count: RawMetric;
  left_foot_touch_percentage: RawMetric;
  right_foot_touch_percentage: RawMetric;
  left_foot_release_percentage: RawMetric;
  right_foot_release_percentage: RawMetric;
  left_foot_receive_percentage: RawMetric;
  right_foot_receive_percentage: RawMetric;
  left_foot_kicking_power: RawMetric;
  right_foot_kicking_power: RawMetric;
  warnings: string[];
};

export type FinalPlayerStatsCsvRow = Record<string, number | string | null>;

export const CSV_HEADERS = [
  "duration",
  "ball_touches",
  "total_distance",
  "sprint_distance",
  "first_step_accelerations",
  "intense_accelerations",
  "top_speed",
  "sprints",
  "intense_turns",
  "avg_turn_entry",
  "avg_turn_exit",
  "left_turns",
  "right_turns",
  "back_turns",
  "kicking_power",
  "distance_with_ball",
  "top_speed_with_ball",
  "intense_turns_with_ball",
  "one_touch_possessions_percentage",
  "multi_touch_possessions__percentage",
  "possession_duration_seconds",
  "release_inside_foot_percentage",
  "release_laces_percentage",
  "release_other_footzone_percentage",
  "turn_efficiency",
  "quick_release_score",
  "left_foot_touch_percentage",
  "right_foot_touch_percentage",
  "left_foot_release_percentage",
  "right_foot_release_percentage",
  "left_foot_receive_percentage",
  "right_foot_receive_percentage",
  "left_foot_kicking_power_mph",
  "right_foot_kicking_power_mph",
] as const;
