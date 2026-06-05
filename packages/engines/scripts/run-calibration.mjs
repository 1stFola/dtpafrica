/**
 * Run legacy calibration engine against seed-style metrics (no DB).
 * Usage: node packages/engines/scripts/run-calibration.mjs [playerId]
 */
import { runCalibration } from "../dist/calibration/pipeline.js";

const seedMetrics = {
  minutesPlayed: 78,
  ballTouches: 62,
  totalDistanceMiles: 6.2,
  sprintDistanceYards: 420,
  firstStepAccelerations: 14,
  intenseAccelerations: 22,
  kickingPowerMph: 58,
  topSpeedMph: 19.2,
  sprints: 18,
  intenseTurns: 12,
  avgTurnEntrySpeedMph: 8.5,
  avgTurnExitSpeedMph: 10.2,
  leftTurns: 8,
  rightTurns: 9,
  backTurns: 3,
  distanceWithBallYards: 280,
  topSpeedWithBallMph: 16.5,
  intenseTurnsWithBall: 7,
};

const seedMeta = {
  full_name: "ALLI O. SANNI",
  gender: "Male",
  date_of_birth: "",
  position: "AM",
  nationality: "Nigerian",
  current_club: "Lagos",
};

const result = runCalibration(seedMetrics, seedMeta);

console.log("\n=== Calibration (legacy engine) ===\n");
console.log("Player:", result.meta.full_name, "| Position:", result.meta.position);
console.log(
  "Nearest benchmark:",
  result.nearestBenchmark.full_name ?? "(none)",
  "| similarity:",
  result.nearestBenchmark.__similarity,
);
console.log("\nRaw overall:", result.rawSummary.overall_rating);
console.log("Calibrated overall:", result.calibratedSummary.overall_rating);
console.log(
  "Off / Def (calibrated):",
  result.calibratedSummary.offensive_score,
  "/",
  result.calibratedSummary.defensive_score,
);
console.log("\nTop attributes (calibrated):");
const top = Object.entries(result.calibrated)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8)
  .map(([k, v]) => `${k}: ${v}`)
  .join(", ");
console.log(top);
console.log("\nBenchmark pool size:", result.filterInfo.poolSize);
