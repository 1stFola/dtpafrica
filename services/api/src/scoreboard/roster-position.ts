/** Shared GK detection for roster / lifecycle (mirrors web admin types). */
export function isGoalkeeper(pos: string | null | undefined): boolean {
  const p = (pos ?? "").toUpperCase();
  return p.includes("GK") || p.includes("GOAL");
}
