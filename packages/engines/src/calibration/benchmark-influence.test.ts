import { test } from "node:test";
import assert from "node:assert/strict";
import { applySelectedBenchmarkInfluence } from "./benchmark-influence";

test("selected benchmark influences calibrated attributes before final reality caps", () => {
  const calibrated = {
    pace: 60,
    acceleration: 60,
    sprint_speed: 60,
  };
  const benchmark = {
    pace: 90,
    acceleration: 80,
    sprint_speed: 70,
  };

  const out = applySelectedBenchmarkInfluence(calibrated, benchmark, 62);

  assert.equal(out.pace, 65);
  assert.equal(out.acceleration, 64);
  assert.equal(out.sprint_speed, 62);
});
