import assert from "node:assert/strict";
import test from "node:test";
import type { FormationSlot } from "./formations";
import {
  computePhilosophyConfidence,
  computePhilosophyFit,
  computePhilosophyFitScore,
  PHILOSOPHY_FIT_WEIGHTS,
} from "./philosophy-fit-engine";
import type { PhilosophyFitPlayer } from "./philosophy-fit-engine";

function samplePlayer(overrides: Partial<PhilosophyFitPlayer> = {}): PhilosophyFitPlayer {
  return {
    id: "p1",
    displayName: "Test Player",
    positionPrimary: "ST",
    overallRating: 75,
    offensiveRating: 80,
    defensiveRating: 55,
    tactical: {
      gegenpressScore: 70,
      tikiTakaScore: 60,
      counterAttackScore: 83,
      totalFootballScore: 65,
      highLineScore: 55,
      wingerScore: 72,
      lowBlockScore: 40,
      quickReleaseScore: 68,
      ballRetentionScore: 62,
      technicalCleanlinessScore: 70,
      directPlayScore: 74,
      flairScore: 66,
      pressResistanceScore: 58,
      possessionHubScore: 64,
      transitionExplosivenessScore: 78,
      isolationThreatScore: 76,
      twoFootednessScore: 55,
    },
    ...overrides,
  };
}

const gkSlot: FormationSlot = {
  id: "gk",
  label: "GK",
  positions: ["GK"],
  role: "gk",
  x: 50,
  y: 90,
};

const stSlot: FormationSlot = {
  id: "st",
  label: "ST",
  positions: ["ST"],
  role: "att",
  x: 50,
  y: 16,
};

const mismatchedSlot: FormationSlot = {
  id: "lb",
  label: "LB",
  positions: ["LB"],
  role: "def",
  x: 18,
  y: 72,
};

test("philosophy fit stays within 0–100 for goalkeeper slot (regression)", () => {
  const player = samplePlayer({ positionPrimary: "GK" });
  const fit = computePhilosophyFit(player, "Counter-Attacking", "4-2-3-1", gkSlot);

  assert.ok(fit.philosophyFitScore >= 0 && fit.philosophyFitScore <= 100);
  assert.ok(fit.positionFitScore >= 0 && fit.positionFitScore <= 100);
  assert.ok(fit.confidenceScore >= 0 && fit.confidenceScore <= 100);
  assert.ok(fit.primaryStyleScore >= 0 && fit.primaryStyleScore <= 100);
});

test("counter-attacking fit uses tactical trait as primary style score", () => {
  const player = samplePlayer();
  const fit = computePhilosophyFit(player, "Counter-Attacking", "4-2-3-1", stSlot);

  assert.ok(Math.abs(fit.primaryStyleScore - 83) < 1);
  assert.ok(fit.philosophyFitScore >= 70 && fit.philosophyFitScore <= 95);
});

test("weighted composite cannot reach 100 when position fit and confidence are low", () => {
  const tactical = 83;
  const positionFit = 45;
  const confidence = computePhilosophyConfidence(tactical, positionFit);
  const composite = computePhilosophyFitScore(tactical, positionFit, confidence);

  assert.equal(confidence, 59);
  assert.equal(composite, 66.8);
  assert.ok(composite < 75);
});

test("mismatched slot yields realistic system fit, not flat 100", () => {
  const player = samplePlayer({
    positionPrimary: "ST",
    positionSecondary: null,
    tactical: {
      ...samplePlayer().tactical,
      counterAttackScore: 83,
      gegenpressScore: 100,
    },
  });

  const counterFit = computePhilosophyFit(
    player,
    "Counter-Attacking",
    "4-2-3-1",
    mismatchedSlot
  );
  const gegenFit = computePhilosophyFit(
    player,
    "Gegenpressing",
    "4-2-3-1",
    mismatchedSlot
  );

  assert.equal(counterFit.positionFitScore, 45);
  assert.equal(gegenFit.positionFitScore, 45);
  assert.ok(counterFit.philosophyFitScore < 80);
  assert.ok(gegenFit.philosophyFitScore < 85);
  assert.notEqual(counterFit.philosophyFitScore, 100);
  assert.notEqual(gegenFit.philosophyFitScore, 100);
});

test("composite weights sum to 1", () => {
  const { tacticalTrait, positionFit, confidence } = PHILOSOPHY_FIT_WEIGHTS;
  assert.equal(tacticalTrait + positionFit + confidence, 1);
});
