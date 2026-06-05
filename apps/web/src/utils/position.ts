export { positionFullFromAbbreviation, resolvePositionFullLabel } from "./positionLabels";

export function isGoalkeeper(pos: string | null | undefined): boolean {
  const p = (pos ?? "").toUpperCase();
  return p.includes("GK") || p.includes("GOAL");
}
