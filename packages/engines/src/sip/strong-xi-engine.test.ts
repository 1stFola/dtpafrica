import { test } from "node:test";
import assert from "node:assert/strict";
import { FORMATIONS, positionMatchesSlot } from "./formations";
import { generateStrongXi } from "./strong-xi-engine";
import type { PhilosophyFitPlayer } from "./philosophy-fit-engine";

function player(
  id: string,
  positionPrimary: string,
  overrides: Partial<PhilosophyFitPlayer> = {}
): PhilosophyFitPlayer {
  return {
    id,
    displayName: id,
    positionPrimary,
    positionSecondary: null,
    overallRating: 70,
    offensiveRating: 70,
    defensiveRating: 70,
    playerPhotoUrl: null,
    tactical: {
      gegenpressScore: 70,
      tikiTakaScore: 70,
      counterAttackScore: 70,
      totalFootballScore: 70,
      highLineScore: 70,
      wingerScore: 70,
      lowBlockScore: 70,
      quickReleaseScore: 70,
      ballRetentionScore: 70,
      technicalCleanlinessScore: 70,
      directPlayScore: 70,
      flairScore: 70,
      pressResistanceScore: 70,
      possessionHubScore: 70,
      transitionExplosivenessScore: 70,
      isolationThreatScore: 70,
      twoFootednessScore: 70,
    },
    positionFit: null,
    ...overrides,
  };
}

test("position matching does not place right backs into left-back slots", () => {
  const [gk, lb, , , rb] = FORMATIONS["4-3-3"];

  assert.equal(positionMatchesSlot("RB", lb), false);
  assert.equal(positionMatchesSlot("LB", rb), false);
  assert.equal(positionMatchesSlot("RB", rb), true);
  assert.equal(positionMatchesSlot("LB", lb), true);
  assert.equal(positionMatchesSlot("GK", gk), true);
  assert.equal(positionMatchesSlot("LW", gk), false);
});

test("strong xi only fills slots with primary or secondary role matches", () => {
  const players = [
    player("winger", "LW", { overallRating: 99 }),
    player("striker", "ST", { overallRating: 98 }),
    player("right-back", "RB", { overallRating: 65 }),
    player("left-back", "LB", { overallRating: 64 }),
    player("keeper", "GK", { overallRating: 60 }),
  ];

  const result = generateStrongXi(players, "4-3-3", "Gegenpressing");
  const bySlot = new Map(result.xi.map((pick) => [pick.slotId, pick.player.positionPrimary]));

  assert.equal(bySlot.get("gk"), "GK");
  assert.equal(bySlot.get("lb"), "LB");
  assert.equal(bySlot.get("rb"), "RB");
  assert.equal(bySlot.get("st"), "ST");
  assert.equal(bySlot.get("lw"), "LW");
  assert.equal(bySlot.has("cb1"), false);
  assert.equal(bySlot.has("cb2"), false);
});

test("strong xi can use a secondary role but not an unrelated role", () => {
  const players = [
    player("hybrid", "ST", { positionSecondary: "CB", overallRating: 92 }),
    player("pure-winger", "LW", { overallRating: 99 }),
  ];

  const result = generateStrongXi(players, "4-3-3", "Gegenpressing");
  const cbPick = result.xi.find((pick) => pick.slotId === "cb1" || pick.slotId === "cb2");
  const gkPick = result.xi.find((pick) => pick.slotId === "gk");

  assert.equal(cbPick?.player.id, "hybrid");
  assert.equal(gkPick, undefined);
});
