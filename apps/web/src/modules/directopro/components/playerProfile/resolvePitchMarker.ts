export type PitchMarkerCoords = { x: number; y: number };

type PositionSlot = { tokens: string[]; x: number; y: number };

/**
 * Pitch coordinates in percent (0–100). Y increases toward the attacking goal (top).
 * X increases left → right from the viewer's perspective.
 */
const POSITION_SLOTS: PositionSlot[] = [
  { tokens: ["GK", "GOALKEEPER", "GOAL KEEPER"], x: 50, y: 90 },
  { tokens: ["LWB", "LEFT WING BACK"], x: 16, y: 74 },
  { tokens: ["RWB", "RIGHT WING BACK"], x: 84, y: 74 },
  { tokens: ["LEFT BACK", "LB"], x: 18, y: 72 },
  { tokens: ["RIGHT BACK", "RB"], x: 82, y: 72 },
  { tokens: ["LCB"], x: 34, y: 76 },
  { tokens: ["RCB"], x: 66, y: 76 },
  { tokens: ["CB", "CENTRE BACK", "CENTER BACK", "CENTRAL DEFENDER"], x: 50, y: 76 },
  { tokens: ["CDM", "DM", "DEFENSIVE MID", "HOLDING MID"], x: 50, y: 60 },
  { tokens: ["LM", "LEFT MID", "LEFT MIDFIELDER"], x: 22, y: 52 },
  { tokens: ["RM", "RIGHT MID", "RIGHT MIDFIELDER"], x: 78, y: 52 },
  { tokens: ["CM", "CENTRAL MID", "CENTRE MID", "MIDFIELDER"], x: 50, y: 52 },
  { tokens: ["CAM", "AM", "ATTACKING MID", "NO. 10", "NUMBER 10"], x: 50, y: 38 },
  { tokens: ["LW", "LEFT WING", "LEFT WINGER"], x: 22, y: 30 },
  { tokens: ["RW", "RIGHT WING", "RIGHT WINGER"], x: 78, y: 30 },
  { tokens: ["LF", "LEFT FORWARD"], x: 28, y: 20 },
  { tokens: ["RF", "RIGHT FORWARD"], x: 72, y: 20 },
  { tokens: ["ST", "STRIKER", "CF", "CENTER FORWARD", "CENTRE FORWARD"], x: 50, y: 16 },
  { tokens: ["LEFT"], x: 22, y: 50 },
  { tokens: ["RIGHT"], x: 78, y: 50 },
  { tokens: ["CENTRE", "CENTER", "CENTRAL"], x: 50, y: 50 },
];

function normalizePositionHaystack(
  positionPrimary?: string | null,
  role?: string | null,
  positionFull?: string | null
): string {
  return [positionPrimary, role, positionFull]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesToken(haystack: string, token: string): boolean {
  if (token.length <= 3 && /^[A-Z]+$/.test(token)) {
    return new RegExp(`\\b${token}\\b`).test(haystack);
  }
  return haystack.includes(token);
}

/** Map role / abbreviation / full position label to a mini-pitch marker (percent coords). */
export function resolvePitchMarker(
  positionPrimary?: string | null,
  role?: string | null,
  positionFull?: string | null
): PitchMarkerCoords {
  const haystack = normalizePositionHaystack(positionPrimary, role, positionFull);
  if (!haystack) return { x: 50, y: 50 };

  for (const slot of POSITION_SLOTS) {
    for (const token of slot.tokens) {
      if (matchesToken(haystack, token)) {
        return { x: slot.x, y: slot.y };
      }
    }
  }

  return { x: 50, y: 50 };
}
