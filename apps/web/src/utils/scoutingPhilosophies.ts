/**
 * Scouting Intelligence playing-philosophy taxonomy.
 * Source of truth: `packages/engines/src/sip/philosophies.ts` (`PHILOSOPHY_IDS`)
 */
export const SCOUTING_PHILOSOPHY_IDS = [
  "Gegenpressing",
  "Tiki-Taka",
  "Counter-Attacking",
  "Total Football",
  "High Line System",
  "Low Block System",
  "Wing Play",
  "Direct Vertical Football",
  "Inverted Fullback System",
  "False 9 Fluid System",
] as const;

export type ScoutingPhilosophyId = (typeof SCOUTING_PHILOSOPHY_IDS)[number];

export function isScoutingPhilosophyId(value: string): value is ScoutingPhilosophyId {
  return (SCOUTING_PHILOSOPHY_IDS as readonly string[]).includes(value);
}
