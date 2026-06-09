import * as fs from "node:fs";
import * as path from "node:path";
import * as vm from "node:vm";

export type LegacyCalibrationApi = {
  ATTRS: string[];
  REAL_BENCHMARKS: Record<string, unknown>[];
  computeRawRatings: (data: Record<string, number>) => Record<string, number>;
  calibrate: (
    meta: Record<string, unknown>,
    raw: Record<string, number>,
  ) => {
    calibrated: Record<string, number>;
    rankedCandidates: Record<string, unknown>[];
    nearest: Record<string, unknown>;
    alternatives: Record<string, unknown>[];
    filterInfo: { poolSize: number };
  };
  estimateMissingFields: (data: Record<string, number>) => Record<string, number>;
  getPlayerMeta: (formData: Record<string, unknown>) => Record<string, unknown>;
  summaryRatings: (ratings: Record<string, number>) => {
    offensive_score: number;
    defensive_score: number;
    overall_rating: number;
  };
};

let cached: LegacyCalibrationApi | null = null;

function resolveLegacyDir(): string {
  const candidates = [
    path.join(__dirname, "legacy"),
    path.join(__dirname, "../../src/calibration/legacy"),
    path.join(process.cwd(), "packages/engines/src/calibration/legacy"),
    path.join(process.cwd(), "src/calibration/legacy"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "calibration-data.js"))) return dir;
  }
  throw new Error("calibration legacy scripts not found (calibration-data.js)");
}

/** Loads calibration-data.js + calibration-engine.js in one VM context (same as legacy HTML script order). */
export function loadLegacyCalibration(): LegacyCalibrationApi {
  if (cached) return cached;

  const legacyDir = resolveLegacyDir();
  const sandbox: Record<string, unknown> = {
    console,
    Math,
    Date,
    parseFloat,
    parseInt,
    isNaN,
    Number,
    Infinity,
    Array,
    Object,
    JSON,
  };

  const ctx = vm.createContext(sandbox);
  const dataJs = fs.readFileSync(path.join(legacyDir, "calibration-data.js"), "utf8");
  const engineJs = fs.readFileSync(path.join(legacyDir, "calibration-engine.js"), "utf8");
  vm.runInContext(dataJs, ctx);
  vm.runInContext(engineJs, ctx);

  const api = sandbox as unknown as LegacyCalibrationApi;
  if (typeof api.computeRawRatings !== "function" || typeof api.calibrate !== "function") {
    throw new Error("Legacy calibration scripts failed to load");
  }

  cached = api;
  return api;
}
