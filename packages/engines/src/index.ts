export const ENGINES_VERSION = "0.1.0";

export * from "./sip/types";
export * from "./sip/metrics-engine";
export * from "./sip/tactical-style-engine";
export * from "./sip/position-fit-engine";
export * from "./sip/pipeline";
export * from "./sip/formations";
export * from "./sip/philosophies";
export * from "./sip/philosophy-fit-engine";
export * from "./sip/strong-xi-engine";
export * from "./sip/comparison-engine";
export * from "./mvce/types";
export * from "./mvce/valuation-engine";
export * from "./mvce/comparison-engine";
export * from "./mvce/bands";
export * from "./mvce/multipliers";
export * from "./calibration/map-metrics";
export * from "./calibration/pipeline";
export { loadLegacyCalibration } from "./calibration/load-legacy";
export { getCalibrationAttributeKeys } from "./calibration/pipeline";
export * from "./scoreboard/competition-types";
export * from "./scoreboard/competition-templates";
export * from "./scoreboard/generate-fixtures";
export * from "./scoreboard/group-standings";
export { normalizeClubName } from "./scoreboard/normalize-club-name";
export {
  normalizePlayerName,
  playerLookupKey,
} from "./scoreboard/normalize-player-name";
