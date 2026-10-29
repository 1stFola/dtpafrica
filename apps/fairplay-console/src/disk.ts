import type { Health } from "./api";

/** "45 min", "6 h", "3 days": whole units, rounded down, so the time left is never overstated. */
export function roughly(minutes: number): string {
  if (minutes < 120) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / 1440)} days`;
}

/** The banner across the console when the Edge's disk is low. Null while there is room. */
export function diskMessage(disk: Health["disk"]): string | null {
  if (disk.state === "ok") return null;
  const free = `${(disk.freeBytes / 1e9).toFixed(1)} GB free`;
  if (disk.state === "hard_limit") {
    const full = disk.minutesToFull === null ? "" : ` At the current rate it is full in about ${roughly(disk.minutesToFull)}, and recording then stops.`;
    return `Disk almost full (${free}). New sessions, clips and exports are refused so the space is kept for recording.${full} An Edge admin must free space now.`;
  }
  const left = disk.minutesToHardLimit === null ? "" : ` About ${roughly(disk.minutesToHardLimit)} of recording before the hard limit.`;
  return `Disk running low (${free}).${left} Plan to free space before the next match.`;
}
