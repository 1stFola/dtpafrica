import type { CalibrationMetrics } from "../../../api/admin";

export type PlayerInfoForm = {
  full_name: string;
  gender: string;
  date_of_birth: string;
  position: string;
  benchmark_region: string;
  benchmark_age_band: string;
  nationality: string;
  height_ft: string;
  weight_kg: string;
  current_club: string;
  photo_url: string;
  video_url: string;
};

/** Legacy CSV / V3 form field names for match performance data. */
export type LegacyMetricsForm = {
  duration: string;
  total_distance: string;
  sprint_distance: string;
  sprints: string;
  top_speed: string;
  first_step_accelerations: string;
  intense_accelerations: string;
  intense_turns: string;
  avg_turn_entry: string;
  avg_turn_exit: string;
  turn_efficiency: string;
  left_turns: string;
  right_turns: string;
  back_turns: string;
  ball_touches: string;
  possession_duration_seconds: string;
  one_touch_possessions_percentage: string;
  multi_touch_possessions__percentage: string;
  quick_release_score: string;
  distance_with_ball: string;
  top_speed_with_ball: string;
  intense_turns_with_ball: string;
  kicking_power: string;
  release_inside_foot_percentage: string;
  release_laces_percentage: string;
  release_other_footzone_percentage: string;
  left_foot_touch_percentage: string;
  left_foot_release_percentage: string;
  left_foot_receive_percentage: string;
  left_foot_kicking_power_mph: string;
  right_foot_touch_percentage: string;
  right_foot_release_percentage: string;
  right_foot_receive_percentage: string;
  right_foot_kicking_power_mph: string;
};

export const CSV_HEADER_HINT =
  "duration, total_distance, sprint_distance, sprints, top_speed, first_step_accelerations, intense_accelerations, intense_turns, avg_turn_entry, avg_turn_exit, turn_efficiency, left_turns, right_turns, back_turns, ball_touches, possession_duration_seconds, one_touch_possessions_percentage, multi_touch_possessions__percentage, quick_release_score, distance_with_ball, top_speed_with_ball, intense_turns_with_ball, kicking_power, release_inside_foot_percentage, release_laces_percentage, release_other_footzone_percentage, left_foot_touch_percentage, left_foot_release_percentage, left_foot_receive_percentage, left_foot_kicking_power_mph, right_foot_touch_percentage, right_foot_release_percentage, right_foot_receive_percentage, right_foot_kicking_power_mph";

export const POSITIONS = ["GK", "ST", "WINGER", "AM", "CM", "CDM", "FB", "CB"] as const;
export const GENDERS = ["Male", "Female"] as const;
export const BENCHMARK_REGIONS = [
  "Global",
  "Europe",
  "Africa",
  "South America",
  "Asia",
  "North America",
] as const;
export const BENCHMARK_AGE_BANDS = ["Auto", "All Ages", "U17", "U20", "U23", "Senior"] as const;

export const PLAYER_FIELDS: {
  key: keyof PlayerInfoForm;
  label: string;
  type: "text" | "date" | "select" | "number";
  placeholder?: string;
  options?: readonly string[];
  full?: boolean;
}[] = [
  { key: "full_name", label: "Full Name", type: "text", placeholder: "Enter full name", full: true },
  { key: "gender", label: "Gender", type: "select", options: GENDERS },
  { key: "date_of_birth", label: "Date of Birth", type: "date" },
  { key: "position", label: "Position", type: "select", options: POSITIONS },
  {
    key: "benchmark_region",
    label: "Benchmark Region",
    type: "select",
    options: BENCHMARK_REGIONS,
  },
  {
    key: "benchmark_age_band",
    label: "Benchmark Age Band",
    type: "select",
    options: BENCHMARK_AGE_BANDS,
  },
  { key: "nationality", label: "Nationality", type: "text", placeholder: "Enter nationality" },
  { key: "height_ft", label: "Height (ft)", type: "text", placeholder: "e.g. 5'11\"" },
  { key: "weight_kg", label: "Weight (kg)", type: "number", placeholder: "Enter weight" },
  { key: "current_club", label: "Current Club", type: "text", placeholder: "Enter club name" },
  { key: "photo_url", label: "Photo URL", type: "text", placeholder: "https://..." },
  { key: "video_url", label: "Video URL", type: "text", placeholder: "https://...", full: true },
];

export const LEGACY_METRIC_FIELDS: {
  key: keyof LegacyMetricsForm;
  label: string;
  step?: string;
  full?: boolean;
}[] = [
  { key: "duration", label: "Duration" },
  { key: "total_distance", label: "Total distance", step: "0.01" },
  { key: "sprint_distance", label: "Sprint distance", step: "0.01" },
  { key: "sprints", label: "Sprints" },
  { key: "top_speed", label: "Top speed", step: "0.1" },
  { key: "first_step_accelerations", label: "First-step accelerations" },
  { key: "intense_accelerations", label: "Intense accelerations" },
  { key: "intense_turns", label: "Intense turns" },
  { key: "avg_turn_entry", label: "Average turn entry", step: "0.1" },
  { key: "avg_turn_exit", label: "Average turn exit", step: "0.1" },
  { key: "turn_efficiency", label: "Turn efficiency", step: "0.01" },
  { key: "left_turns", label: "Left turns" },
  { key: "right_turns", label: "Right turns" },
  { key: "back_turns", label: "Back turns" },
  { key: "ball_touches", label: "Ball possessions" },
  { key: "possession_duration_seconds", label: "Possession duration seconds", step: "0.1" },
  {
    key: "one_touch_possessions_percentage",
    label: "One-touch possessions percentage",
    step: "0.1",
  },
  {
    key: "multi_touch_possessions__percentage",
    label: "Multi-touch possessions percentage",
    step: "0.1",
  },
  { key: "quick_release_score", label: "Quick release score", step: "0.1" },
  { key: "distance_with_ball", label: "Distance with ball", step: "0.01" },
  { key: "top_speed_with_ball", label: "Top speed with ball", step: "0.1" },
  { key: "intense_turns_with_ball", label: "Intense turns with ball" },
  { key: "kicking_power", label: "Kicking power", step: "0.1" },
  {
    key: "release_inside_foot_percentage",
    label: "Release inside-foot percentage",
    step: "0.1",
  },
  { key: "release_laces_percentage", label: "Release laces percentage", step: "0.1" },
  {
    key: "release_other_footzone_percentage",
    label: "Release other-footzone percentage",
    step: "0.1",
  },
  { key: "left_foot_touch_percentage", label: "Left-foot touch percentage", step: "0.1" },
  {
    key: "left_foot_release_percentage",
    label: "Left-foot release percentage",
    step: "0.1",
  },
  {
    key: "left_foot_receive_percentage",
    label: "Left-foot receive percentage",
    step: "0.1",
  },
  { key: "left_foot_kicking_power_mph", label: "Left-foot kicking power mph", step: "0.1" },
  { key: "right_foot_touch_percentage", label: "Right-foot touch percentage", step: "0.1" },
  {
    key: "right_foot_release_percentage",
    label: "Right-foot release percentage",
    step: "0.1",
  },
  {
    key: "right_foot_receive_percentage",
    label: "Right-foot receive percentage",
    step: "0.1",
  },
  {
    key: "right_foot_kicking_power_mph",
    label: "Right-foot kicking power mph",
    step: "0.1",
  },
];

export function emptyPlayerInfo(): PlayerInfoForm {
  return {
    full_name: "",
    gender: "",
    date_of_birth: "",
    position: "",
    benchmark_region: "Global",
    benchmark_age_band: "Auto",
    nationality: "",
    height_ft: "",
    weight_kg: "",
    current_club: "",
    photo_url: "",
    video_url: "",
  };
}

export function emptyLegacyMetrics(): LegacyMetricsForm {
  const out = {} as LegacyMetricsForm;
  LEGACY_METRIC_FIELDS.forEach((f) => {
    out[f.key] = "";
  });
  return out;
}

export function parseCalibrationCsv(text: string): Record<string, string> | null {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const headers = lines[0].split(",").map((h) => h.trim());
  const values = lines[1].split(",").map((v) => v.trim());
  const data: Record<string, string> = {};
  headers.forEach((header, index) => {
    if (values[index] !== undefined && values[index] !== "") {
      data[header] = values[index];
    }
  });
  return data;
}

export function legacyMetricsToApi(form: LegacyMetricsForm): CalibrationMetrics {
  const n = (k: keyof LegacyMetricsForm) => Number(form[k]) || 0;
  return {
    minutesPlayed: n("duration"),
    ballTouches: n("ball_touches"),
    totalDistanceMiles: n("total_distance"),
    sprintDistanceYards: n("sprint_distance"),
    firstStepAccelerations: n("first_step_accelerations"),
    intenseAccelerations: n("intense_accelerations"),
    kickingPowerMph: n("kicking_power"),
    topSpeedMph: n("top_speed"),
    sprints: n("sprints"),
    intenseTurns: n("intense_turns"),
    avgTurnEntrySpeedMph: n("avg_turn_entry"),
    avgTurnExitSpeedMph: n("avg_turn_exit"),
    leftTurns: n("left_turns"),
    rightTurns: n("right_turns"),
    backTurns: n("back_turns"),
    distanceWithBallYards: n("distance_with_ball"),
    topSpeedWithBallMph: n("top_speed_with_ball"),
    intenseTurnsWithBall: n("intense_turns_with_ball"),
  };
}

export function apiMetricsToLegacy(m: CalibrationMetrics): LegacyMetricsForm {
  return {
    duration: String(m.minutesPlayed ?? ""),
    ball_touches: String(m.ballTouches ?? ""),
    total_distance: String(m.totalDistanceMiles ?? ""),
    sprint_distance: String(m.sprintDistanceYards ?? ""),
    sprints: String(m.sprints ?? ""),
    top_speed: String(m.topSpeedMph ?? ""),
    first_step_accelerations: String(m.firstStepAccelerations ?? ""),
    intense_accelerations: String(m.intenseAccelerations ?? ""),
    intense_turns: String(m.intenseTurns ?? ""),
    avg_turn_entry: String(m.avgTurnEntrySpeedMph ?? ""),
    avg_turn_exit: String(m.avgTurnExitSpeedMph ?? ""),
    turn_efficiency: "",
    left_turns: String(m.leftTurns ?? ""),
    right_turns: String(m.rightTurns ?? ""),
    back_turns: String(m.backTurns ?? ""),
    possession_duration_seconds: "",
    one_touch_possessions_percentage: "",
    multi_touch_possessions__percentage: "",
    quick_release_score: "",
    distance_with_ball: String(m.distanceWithBallYards ?? ""),
    top_speed_with_ball: String(m.topSpeedWithBallMph ?? ""),
    intense_turns_with_ball: String(m.intenseTurnsWithBall ?? ""),
    kicking_power: String(m.kickingPowerMph ?? ""),
    release_inside_foot_percentage: "",
    release_laces_percentage: "",
    release_other_footzone_percentage: "",
    left_foot_touch_percentage: "",
    left_foot_release_percentage: "",
    left_foot_receive_percentage: "",
    left_foot_kicking_power_mph: "",
    right_foot_touch_percentage: "",
    right_foot_release_percentage: "",
    right_foot_receive_percentage: "",
    right_foot_kicking_power_mph: "",
  };
}

export function playerInfoToApiPayload(info: PlayerInfoForm) {
  return {
    fullName: info.full_name.trim(),
    gender: info.gender || "Male",
    dateOfBirth: info.date_of_birth || undefined,
    position: info.position,
    benchmarkRegion: info.benchmark_region || "Global",
    benchmarkAgeBand: info.benchmark_age_band || "Auto",
    nationality: info.nationality || undefined,
    heightFt: info.height_ft || undefined,
    weightKg: info.weight_kg ? Number(info.weight_kg) : undefined,
    currentClub: info.current_club || undefined,
    photoUrl: info.photo_url || undefined,
    videoUrl: info.video_url || undefined,
  };
}

export function parseHeightFtToCm(heightFt: string): number | undefined {
  if (!heightFt.trim()) return undefined;
  const feetMatch = heightFt.trim().match(/(\d+)['']?(\d+)?/);
  if (!feetMatch) return undefined;
  const feet = parseInt(feetMatch[1], 10) || 0;
  const inches = parseInt(feetMatch[2] ?? "0", 10) || 0;
  return Math.round((feet * 12 + inches) * 2.54);
}

export function legacyMetricsFromForm(form: LegacyMetricsForm): Record<string, number> {
  const out: Record<string, number> = {};
  LEGACY_METRIC_FIELDS.forEach((f) => {
    const v = form[f.key];
    if (v !== "") out[f.key] = Number(v) || 0;
  });
  return out;
}

export function contextToPlayerInfo(
  ctx: {
    fullName: string;
    gender?: string | null;
    dateOfBirth?: string | null;
    position: string;
    benchmarkRegion?: string | null;
    benchmarkAgeBand?: string | null;
    nationality?: string | null;
    heightFt?: string | null;
    weightKg?: number | null;
    currentClub?: string | null;
    photoUrl?: string | null;
    videoUrl?: string | null;
  }
): PlayerInfoForm {
  return {
    full_name: ctx.fullName,
    gender: ctx.gender || "Male",
    date_of_birth: ctx.dateOfBirth?.slice(0, 10) ?? "",
    position: ctx.position,
    benchmark_region: ctx.benchmarkRegion || "Global",
    benchmark_age_band: ctx.benchmarkAgeBand || "Auto",
    nationality: ctx.nationality ?? "",
    height_ft: ctx.heightFt ?? "",
    weight_kg: ctx.weightKg != null ? String(ctx.weightKg) : "",
    current_club: ctx.currentClub ?? "",
    photo_url: ctx.photoUrl ?? "",
    video_url: ctx.videoUrl ?? "",
  };
}

export function legacyMetricsFromApi(m: Record<string, number | undefined>): LegacyMetricsForm {
  const out = emptyLegacyMetrics();
  (Object.keys(out) as (keyof LegacyMetricsForm)[]).forEach((k) => {
    if (m[k] != null) out[k] = String(m[k]);
  });
  return out;
}
