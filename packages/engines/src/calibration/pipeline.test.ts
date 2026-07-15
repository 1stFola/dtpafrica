import { test } from "node:test";
import assert from "node:assert/strict";
import { runCalibration } from "./pipeline";

test("per-90 tracker rows remain grounded instead of saturating physical ratings", () => {
  const result = runCalibration(
    {
      minutesPlayed: 90,
      ballTouches: 17,
      totalDistanceMiles: 5.97,
      sprintDistanceYards: 635.2,
      firstStepAccelerations: 15,
      intenseAccelerations: 65,
      kickingPowerMph: 44.52,
      topSpeedMph: 19.46,
      sprints: 55,
      intenseTurns: 65,
      avgTurnEntrySpeedMph: 8.9,
      avgTurnExitSpeedMph: 5.1,
      leftTurns: 59,
      rightTurns: 52,
      backTurns: 38,
      distanceWithBallYards: 129,
      topSpeedWithBallMph: 14.8,
      intenseTurnsWithBall: 3,
    },
    {
      full_name: "ADEWALE LATEEF",
      gender: "Male",
      nationality: "Nigerian",
      position: "AM",
    },
  );

  assert.ok(result.rawSummary.overall_rating <= 60);
  assert.ok(result.calibratedSummary.overall_rating <= 60);
  assert.ok(result.calibrated.acceleration < 80);
  assert.ok(result.calibrated.ball_control < 50);
});

test("calibration treats normalized tracker rows as a 90-minute evidence window", () => {
  const metrics = {
    minutesPlayed: 65,
    ballTouches: 33.23,
    totalDistanceMiles: 5.51,
    sprintDistanceYards: 336.7,
    firstStepAccelerations: 5.54,
    intenseAccelerations: 56.77,
    kickingPowerMph: 37.58,
    topSpeedMph: 18.34,
    sprints: 52.62,
    intenseTurns: 72,
    avgTurnEntrySpeedMph: 8.5,
    avgTurnExitSpeedMph: 5.4,
    leftTurns: 69.23,
    rightTurns: 70.62,
    backTurns: 44.31,
    distanceWithBallYards: 158,
    topSpeedWithBallMph: 17.2,
    intenseTurnsWithBall: 10,
  };
  const meta = {
    full_name: "ASIM YUSUF",
    gender: "Male",
    nationality: "Nigerian",
    position: "AM",
  };

  const labelled65 = runCalibration(metrics, meta);
  const labelled90 = runCalibration({ ...metrics, minutesPlayed: 90 }, meta);

  assert.deepEqual(labelled65.rawSummary, labelled90.rawSummary);
  assert.deepEqual(labelled65.calibratedSummary, labelled90.calibratedSummary);
});
