import type { SeedResult } from "./run-seed";

export type SeedRunStatus = {
  running: boolean;
  startedAt: string | null;
  lastRun: SeedResult | null;
};

let status: SeedRunStatus = {
  running: false,
  startedAt: null,
  lastRun: null,
};

export function getSeedRunStatus(): SeedRunStatus {
  return status;
}

export function markSeedRunStarted(): void {
  status = {
    ...status,
    running: true,
    startedAt: new Date().toISOString(),
  };
}

export function markSeedRunFinished(result: SeedResult): void {
  status = {
    running: false,
    startedAt: null,
    lastRun: result,
  };
}
