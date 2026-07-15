import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCalibrationRealityControls } from "./reality-controls";
import { summarizeCalibratedRatings } from "./rating-summary";

const ATTRS = [
  "pace",
  "acceleration",
  "sprint_speed",
  "stamina",
  "strength",
  "agility",
  "dribbling",
  "ball_control",
  "passing",
  "finishing",
  "technique",
  "first_touch",
  "vision",
  "composure",
  "decision_making",
  "work_rate",
  "positioning",
  "team_play",
];

function flatAttributes(score: number) {
  return Object.fromEntries(ATTRS.map((key) => [key, score]));
}

test("reality controls prevent benchmark calibration from over-inflating weak raw evidence", () => {
  const controlled = applyCalibrationRealityControls(flatAttributes(40), flatAttributes(72));
  const summary = summarizeCalibratedRatings(controlled);

  assert.equal(summary.overall_rating, 48);
  assert.equal(summary.offensive_score, 48);
  assert.equal(summary.defensive_score, 48);
});

test("reality controls still allow modest benchmark lift for credible raw profiles", () => {
  const controlled = applyCalibrationRealityControls(flatAttributes(58), flatAttributes(72));
  const summary = summarizeCalibratedRatings(controlled);

  assert.equal(summary.overall_rating, 63);
  assert.equal(summary.offensive_score, 63);
  assert.equal(summary.defensive_score, 63);
});
