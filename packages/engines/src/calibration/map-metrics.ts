/** Prisma / API match-metrics row shape used for calibration input. */
export type MatchMetricsRow = {
  minutesPlayed: number;
  ballTouches: number;
  totalDistanceMiles: number;
  sprintDistanceYards: number;
  firstStepAccelerations: number;
  intenseAccelerations: number;
  kickingPowerMph?: number | null;
  topSpeedMph?: number | null;
  sprints: number;
  intenseTurns: number;
  avgTurnEntrySpeedMph?: number | null;
  avgTurnExitSpeedMph?: number | null;
  leftTurns: number;
  rightTurns: number;
  backTurns: number;
  distanceWithBallYards: number;
  topSpeedWithBallMph?: number | null;
  intenseTurnsWithBall: number;
};

export type PlayerCalibrationMeta = {
  full_name: string;
  gender?: string;
  date_of_birth?: string;
  position: string;
  nationality?: string;
  height_ft?: string;
  weight_kg?: number | string;
  current_club?: string;
  photo_url?: string;
  video_url?: string;
};

/** Maps DB metrics to legacy CSV field names expected by `computeRawRatings`. */
export function matchMetricsToLegacyInput(m: MatchMetricsRow): Record<string, number> {
  const accelerations = m.firstStepAccelerations + m.intenseAccelerations;
  return {
    duration: 90,
    ball_touches: m.ballTouches,
    total_distance: m.totalDistanceMiles,
    sprint_distance: m.sprintDistanceYards,
    accelerations,
    decelerations: Math.max(5, Math.round(accelerations * 0.85)),
    top_speed: m.topSpeedMph ?? 0,
    sprints: m.sprints,
    intense_turns: m.intenseTurns,
    avg_turn_entry: m.avgTurnEntrySpeedMph ?? 0,
    avg_turn_exit: m.avgTurnExitSpeedMph ?? 0,
    left_turns: m.leftTurns,
    right_turns: m.rightTurns,
    back_turns: m.backTurns,
    kicking_power: m.kickingPowerMph ?? 0,
    distance_with_ball: m.distanceWithBallYards,
    top_speed_with_ball: m.topSpeedWithBallMph ?? 0,
    intense_turns_with_ball: m.intenseTurnsWithBall,
  };
}

export function playerToLegacyMeta(p: {
  displayName: string;
  dateOfBirth?: Date | null;
  positionPrimary: string;
  nationality?: string | null;
  heightCm?: number | null;
  weightKg?: number | null;
  playerPhotoUrl?: string | null;
  videoUrl?: string | null;
  city?: string | null;
}): PlayerCalibrationMeta {
  const dob = p.dateOfBirth
    ? p.dateOfBirth.toISOString().slice(0, 10)
    : "";
  const heightFt =
    p.heightCm != null ? `${Math.floor(p.heightCm / 30.48)}'${Math.round((p.heightCm % 30.48) / 2.54)}"` : "";

  return {
    full_name: p.displayName,
    gender: "Male",
    date_of_birth: dob,
    position: p.positionPrimary,
    nationality: p.nationality ?? "",
    height_ft: heightFt,
    weight_kg: p.weightKg ?? "",
    current_club: p.city ?? "",
    photo_url: p.playerPhotoUrl ?? "",
    video_url: p.videoUrl ?? "",
  };
}
