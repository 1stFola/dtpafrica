import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calibrationCategoryScoresFromAttributes,
  summarizeCalibratedRatings,
} from "./rating-summary";

function attributesFromCategories(input: {
  speed: number;
  distribution: number;
  ballSkills: number;
  physicality: number;
  defensiveIq: number;
}): Record<string, number> {
  return {
    pace: input.speed,
    acceleration: input.speed,
    sprint_speed: input.speed,
    passing: input.distribution,
    vision: input.distribution,
    team_play: input.distribution,
    dribbling: input.ballSkills,
    ball_control: input.ballSkills,
    finishing: input.ballSkills,
    technique: input.ballSkills,
    first_touch: input.ballSkills,
    stamina: input.physicality,
    strength: input.physicality,
    agility: input.physicality,
    positioning: input.defensiveIq,
    work_rate: input.defensiveIq,
    decision_making: input.defensiveIq,
    composure: input.defensiveIq,
  };
}

test("calibrated headline ratings stay aligned with pentagon category scores", () => {
  const playerA = attributesFromCategories({
    speed: 69,
    distribution: 76,
    ballSkills: 69,
    physicality: 71,
    defensiveIq: 74,
  });
  const playerB = attributesFromCategories({
    speed: 69,
    distribution: 75,
    ballSkills: 68,
    physicality: 69,
    defensiveIq: 73,
  });

  assert.deepEqual(
    calibrationCategoryScoresFromAttributes(playerA).map((item) => item.score),
    [69, 76, 69, 71, 74],
  );
  assert.deepEqual(
    calibrationCategoryScoresFromAttributes(playerB).map((item) => item.score),
    [69, 75, 68, 69, 73],
  );

  const summaryA = summarizeCalibratedRatings(playerA);
  const summaryB = summarizeCalibratedRatings(playerB);

  assert.equal(summaryA.overall_rating, 72);
  assert.equal(summaryB.overall_rating, 71);
  assert.ok(Math.abs(summaryA.offensive_score - summaryB.offensive_score) <= 1);
  assert.ok(Math.abs(summaryA.defensive_score - summaryB.defensive_score) <= 2);
});
