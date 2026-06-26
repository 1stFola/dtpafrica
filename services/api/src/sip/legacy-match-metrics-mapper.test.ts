import assert from "node:assert/strict";
import test from "node:test";
import type { PlayerMatchMetrics } from "@prisma/client";
import {
  legacyMatchMetricsToPlayerMatchRecord,
  mergeCalibrationExtrasIntoRaw,
  playerMatchMetricsToLegacyMetrics,
  readCalibrationMetricsFromBenchmark,
} from "./legacy-match-metrics-mapper";
import type { RawMatchMetrics } from "@dtp/engines";

function sampleRaw(overrides: Partial<RawMatchMetrics> = {}): RawMatchMetrics {
  return {
    minutesPlayed: 90,
    ballTouches: 42,
    oneTouchPossessions: 6200,
    multiTouchPossessions: 3800,
    possessionDurationSeconds: 12.5,
    releaseLacesCount: 4500,
    releaseInsideFootCount: 3500,
    releaseOtherFootzoneCount: 2000,
    leftFootTouchCount: 5200,
    rightFootTouchCount: 4800,
    leftFootReleaseCount: 5100,
    rightFootReleaseCount: 4900,
    leftFootReceiveCount: 5000,
    rightFootReceiveCount: 5000,
    leftFootKickingPowerMph: 68,
    rightFootKickingPowerMph: 72,
    totalDistanceMiles: 6.2,
    sprintDistanceYards: 420,
    firstStepAccelerations: 18,
    intenseAccelerations: 9,
    kickingPowerMph: 71,
    topSpeedMph: 19.4,
    sprints: 14,
    intenseTurns: 22,
    avgTurnEntrySpeedMph: 8.2,
    avgTurnExitSpeedMph: 9.1,
    leftTurns: 11,
    rightTurns: 9,
    backTurns: 2,
    distanceWithBallYards: 180,
    topSpeedWithBallMph: 14.2,
    intenseTurnsWithBall: 6,
    ...overrides,
  };
}

function sampleMetricsRow(
  overrides: Partial<PlayerMatchMetrics> = {}
): PlayerMatchMetrics {
  const record = legacyMatchMetricsToPlayerMatchRecord({
    duration: 90,
    ball_touches: 42,
    total_distance: 6.2,
    sprint_distance: 420,
    sprints: 14,
    top_speed: 19.4,
    first_step_accelerations: 18,
    intense_accelerations: 9,
    intense_turns: 22,
    avg_turn_entry: 8.2,
    avg_turn_exit: 9.1,
    turn_efficiency: 1.11,
    left_turns: 11,
    right_turns: 9,
    back_turns: 2,
    possession_duration_seconds: 12.5,
    one_touch_possessions_percentage: 62,
    multi_touch_possessions__percentage: 38,
    quick_release_score: 62,
    distance_with_ball: 180,
    top_speed_with_ball: 14.2,
    intense_turns_with_ball: 6,
    kicking_power: 71,
    release_inside_foot_percentage: 35,
    release_laces_percentage: 45,
    release_other_footzone_percentage: 20,
    left_foot_touch_percentage: 52,
    left_foot_release_percentage: 51,
    left_foot_receive_percentage: 50,
    left_foot_kicking_power_mph: 68,
    right_foot_touch_percentage: 48,
    right_foot_release_percentage: 49,
    right_foot_receive_percentage: 50,
    right_foot_kicking_power_mph: 72,
  });

  return {
    id: "metrics-1",
    playerId: "player-1",
    matchId: "match-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...record,
    ...overrides,
  };
}

test("legacy CSV percentages round-trip without inflation", () => {
  const legacy = {
    duration: 90,
    one_touch_possessions_percentage: 65.3,
    left_foot_release_percentage: 58.7,
    release_laces_percentage: 44.2,
    release_inside_foot_percentage: 33.1,
    release_other_footzone_percentage: 22.7,
    turn_efficiency: 1.08,
    quick_release_score: 65.3,
  };

  const stored = legacyMatchMetricsToPlayerMatchRecord(legacy);
  const row = sampleMetricsRow(stored);
  const restored = playerMatchMetricsToLegacyMetrics(row);

  assert.ok(Math.abs((restored.one_touch_possessions_percentage ?? 0) - 65.3) < 0.2);
  assert.ok(Math.abs((restored.left_foot_release_percentage ?? 0) - 58.7) < 0.2);
  assert.ok(Math.abs((restored.release_laces_percentage ?? 0) - 44.2) < 0.2);
});

test("single-sided foot percentages infer complement without exceeding 100", () => {
  const stored = legacyMatchMetricsToPlayerMatchRecord({
    left_foot_touch_percentage: 61,
  });

  const total = stored.leftFootTouchCount + stored.rightFootTouchCount;
  assert.equal(total, 10_000);
  const leftPct = (stored.leftFootTouchCount / total) * 100;
  assert.ok(leftPct >= 60.9 && leftPct <= 61.1);
});

test("mergeCalibrationExtrasIntoRaw preserves CSV percentages over derived counts", () => {
  const raw = sampleRaw({
    oneTouchPossessions: 0,
    multiTouchPossessions: 0,
    leftFootReleaseCount: 0,
    rightFootReleaseCount: 0,
  });

  const merged = mergeCalibrationExtrasIntoRaw(raw, { quickReleaseScore: 88 }, {
    one_touch_possessions_percentage: 71.5,
    multi_touch_possessions__percentage: 28.5,
    quick_release_score: 71.5,
    left_foot_release_percentage: 63.2,
    right_foot_release_percentage: 36.8,
    turn_efficiency: 1.12,
  });

  assert.equal(merged.one_touch_possessions_percentage, 71.5);
  assert.equal(merged.multi_touch_possessions_percentage, 28.5);
  assert.equal(merged.quick_release_score, 71.5);
  assert.equal(merged.left_foot_release_percentage, 63.2);
  assert.equal(merged.turn_efficiency, 1.12);
});

test("readCalibrationMetricsFromBenchmark returns stored snapshot", () => {
  const snapshot = { ball_touches: 42, turn_efficiency: 1.05 };
  const legacy = readCalibrationMetricsFromBenchmark({
    nearest: { full_name: "Benchmark" },
    calibrationMetrics: snapshot,
  });

  assert.deepEqual(legacy, snapshot);
});
