import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calibrationCategoryScoresFromAttributes,
  summarizeCalibratedRatings,
  speedProfileScoreFromAttributes,
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

test("speed profile rewards balanced pace, acceleration, and sprint speed", () => {
  assert.equal(
    speedProfileScoreFromAttributes({
      pace: 69,
      acceleration: 69,
      sprint_speed: 69,
    }),
    69,
  );

  assert.equal(
    speedProfileScoreFromAttributes({
      pace: 92,
      acceleration: 88,
      sprint_speed: 45,
    }),
    69,
  );
});

test("radar categories do not hide weak core traits behind high averages", () => {
  const scores = Object.fromEntries(
    calibrationCategoryScoresFromAttributes({
      pace: 92,
      acceleration: 88,
      sprint_speed: 45,
      passing: 92,
      vision: 88,
      team_play: 45,
      dribbling: 92,
      ball_control: 88,
      first_touch: 85,
      technique: 84,
      finishing: 45,
      stamina: 92,
      agility: 88,
      strength: 45,
      positioning: 92,
      decision_making: 88,
      work_rate: 84,
      composure: 45,
    }).map((item) => [item.key, item.score]),
  );

  assert.ok(scores.speed < 75);
  assert.ok(scores.distribution < 75);
  assert.ok(scores.ball_skills < 80);
  assert.ok(scores.physicality < 75);
  assert.ok(scores.defensive_iq < 80);
});

test("overall rating is role-weighted while pentagon evidence remains unchanged", () => {
  const attributes = attributesFromCategories({
    speed: 35,
    distribution: 72,
    ballSkills: 68,
    physicality: 58,
    defensiveIq: 70,
  });

  assert.deepEqual(
    calibrationCategoryScoresFromAttributes(attributes).map((item) => item.score),
    [35, 72, 68, 58, 70],
  );
  assert.equal(summarizeCalibratedRatings(attributes, "AM").overall_rating, 64);
  assert.equal(summarizeCalibratedRatings(attributes, "RW").overall_rating, 57);
});

test("attacking roles do not inherit strong defense from athletic attacking traits", () => {
  const attributes = attributesFromCategories({
    speed: 82,
    distribution: 76,
    ballSkills: 84,
    physicality: 74,
    defensiveIq: 52,
  });

  const summary = summarizeCalibratedRatings(attributes, "LW");

  assert.ok(summary.offensive_score >= 80);
  assert.ok(summary.defensive_score <= 58);
  assert.ok(summary.offensive_score - summary.defensive_score >= 20);
});

test("defensive roles do not inherit strong attack from physical defensive traits", () => {
  const attributes = attributesFromCategories({
    speed: 76,
    distribution: 58,
    ballSkills: 48,
    physicality: 84,
    defensiveIq: 82,
  });

  const summary = summarizeCalibratedRatings(attributes, "CB");

  assert.ok(summary.defensive_score >= 82);
  assert.ok(summary.offensive_score <= 58);
  assert.ok(summary.defensive_score - summary.offensive_score >= 24);
});
