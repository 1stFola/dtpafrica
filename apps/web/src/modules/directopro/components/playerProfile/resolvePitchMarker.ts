export type PitchMarkerCoords = { x: number; y: number };

type PositionSlot = { tokens: string[]; x: number; y: number };

/**
 * Pitch coordinates in percent (0–100). Y increases toward the attacking goal (top).
 * X increases left → right from the viewer's perspective.
 * More specific slots are listed first so generic tokens (e.g. MIDFIELDER) lose to CAM.
 */
const POSITION_SLOTS: PositionSlot[] = [
  { tokens: ["GK", "GOALKEEPER", "GOAL KEEPER"], x: 50, y: 90 },
  { tokens: ["LWB", "LEFT WING BACK"], x: 16, y: 74 },
  { tokens: ["RWB", "RIGHT WING BACK"], x: 84, y: 74 },
  { tokens: ["LEFT BACK", "LB"], x: 18, y: 72 },
  { tokens: ["RIGHT BACK", "RB"], x: 82, y: 72 },
  { tokens: ["LCB"], x: 34, y: 76 },
  { tokens: ["RCB"], x: 66, y: 76 },
  { tokens: ["CB", "CENTRE BACK", "CENTER BACK", "CENTRAL DEFENDER", "CENTRAL BACK"], x: 50, y: 76 },
  { tokens: ["CDM", "DM", "DEFENSIVE MID", "HOLDING MID"], x: 50, y: 60 },
  { tokens: ["CAM", "ATTACKING MID", "ATTACKING MIDFIELDER", "NO. 10", "NUMBER 10", "AM"], x: 50, y: 38 },
  { tokens: ["LM", "LEFT MID", "LEFT MIDFIELDER"], x: 22, y: 52 },
  { tokens: ["RM", "RIGHT MID", "RIGHT MIDFIELDER"], x: 78, y: 52 },
  { tokens: ["CM", "CENTRAL MID", "CENTRE MID"], x: 50, y: 52 },
  { tokens: ["LW", "LEFT WING", "LEFT WINGER"], x: 22, y: 30 },
  { tokens: ["RW", "RIGHT WING", "RIGHT WINGER"], x: 78, y: 30 },
  { tokens: ["LF", "LEFT FORWARD"], x: 28, y: 20 },
  { tokens: ["RF", "RIGHT FORWARD"], x: 72, y: 20 },
  { tokens: ["ST", "STRIKER", "CF", "CENTER FORWARD", "CENTRE FORWARD"], x: 50, y: 16 },
  { tokens: ["MIDFIELDER"], x: 50, y: 52 },
  { tokens: ["LEFT"], x: 22, y: 50 },
  { tokens: ["RIGHT"], x: 78, y: 50 },
  { tokens: ["CENTRE", "CENTER", "CENTRAL"], x: 50, y: 50 },
];

/** Map 18-point attribute groups to outfield role contexts for secondary inference. */
const SECONDARY_ROLE_PROFILES: { label: string; keys: readonly string[] }[] = [
  { label: "ST", keys: ["finishing", "positioning", "strength", "acceleration", "first_touch"] },
  { label: "LW", keys: ["pace", "dribbling", "acceleration", "agility", "sprint_speed"] },
  { label: "RW", keys: ["pace", "dribbling", "acceleration", "agility", "sprint_speed"] },
  { label: "AM", keys: ["vision", "technique", "dribbling", "passing", "first_touch"] },
  { label: "CM", keys: ["passing", "vision", "decision_making", "team_play", "work_rate"] },
  { label: "CDM", keys: ["work_rate", "positioning", "strength", "passing", "decision_making"] },
  { label: "CB", keys: ["strength", "positioning", "composure", "work_rate"] },
  { label: "RB", keys: ["pace", "sprint_speed", "stamina", "work_rate", "passing"] },
  { label: "LB", keys: ["pace", "sprint_speed", "stamina", "work_rate", "passing"] },
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

function normalizeRoleToken(value?: string | null): string {
  if (!value?.trim()) return "";
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function matchesToken(haystack: string, token: string): boolean {
  if (token.length <= 3 && /^[A-Z]+$/.test(token)) {
    return new RegExp(`\\b${token}\\b`).test(haystack);
  }
  return haystack.includes(token);
}

function tokenSpecificity(token: string): number {
  const wordBonus = token.includes(" ") ? 12 : 0;
  return token.length + wordBonus;
}

function pickBestSlot(haystack: string): PositionSlot | null {
  let best: { slot: PositionSlot; score: number } | null = null;

  for (const slot of POSITION_SLOTS) {
    for (const token of slot.tokens) {
      if (!matchesToken(haystack, token)) continue;
      const score = tokenSpecificity(token);
      if (!best || score > best.score) {
        best = { slot, score };
      }
    }
  }

  return best?.slot ?? null;
}

function mapCoordsToPitchInset(coords: PitchMarkerCoords): PitchMarkerCoords {
  const insetX = 6;
  const insetY = 4;
  const spanX = 100 - insetX * 2;
  const spanY = 100 - insetY * 2;
  return {
    x: insetX + (coords.x / 100) * spanX,
    y: insetY + (coords.y / 100) * spanY,
  };
}

function averageKeys(attributes: Record<string, number>, keys: readonly string[]): number {
  const values = keys
    .map((key) => attributes[key])
    .filter((value): value is number => typeof value === "number" && !Number.isNaN(value));
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rolesEquivalent(a: string, b: string): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  const slotA = pickBestSlot(normalizeRoleToken(a));
  const slotB = pickBestSlot(normalizeRoleToken(b));
  if (slotA && slotB) {
    return slotA.x === slotB.x && slotA.y === slotB.y;
  }
  return normalizeRoleToken(a) === normalizeRoleToken(b);
}

function coordsNear(a: PitchMarkerCoords, b: PitchMarkerCoords, threshold = 4): boolean {
  return Math.abs(a.x - b.x) <= threshold && Math.abs(a.y - b.y) <= threshold;
}

/** Map role / abbreviation / full position label to a mini-pitch marker (percent coords). */
export function resolvePitchMarker(
  positionPrimary?: string | null,
  role?: string | null,
  positionFull?: string | null
): PitchMarkerCoords {
  const haystack = normalizePositionHaystack(positionPrimary, role, positionFull);
  if (!haystack) return mapCoordsToPitchInset({ x: 50, y: 50 });

  const slot = pickBestSlot(haystack);
  return mapCoordsToPitchInset(slot ? { x: slot.x, y: slot.y } : { x: 50, y: 50 });
}

const VAGUE_PRIMARY_TOKENS = new Set(["LEFT", "RIGHT", "CENTRE", "CENTER", "CENTRAL"]);

function isVaguePrimaryToken(value?: string | null): boolean {
  const token = normalizeRoleToken(value);
  return token.length > 0 && VAGUE_PRIMARY_TOKENS.has(token);
}

/**
 * Primary marker from registration/calibration fields (`positionPrimary`, then
 * `positionFull` when the abbreviation is ambiguous). Never uses SIP fit,
 * attributes, or display-only labels.
 */
export function resolvePrimaryPitchMarker(
  positionPrimary?: string | null,
  positionFull?: string | null
): PitchMarkerCoords {
  const primary = positionPrimary?.trim() ?? "";
  const full = positionFull?.trim() ?? "";

  const candidates =
    isVaguePrimaryToken(primary) && full
      ? [full, primary]
      : [primary, full].filter(Boolean);

  for (const label of candidates) {
    const marker = resolvePitchMarkerFromLabel(label);
    if (marker) return marker;
  }

  return mapCoordsToPitchInset({ x: 50, y: 50 });
}

/** Resolve marker coords from a single role label (e.g. secondary fit token). */
export function resolvePitchMarkerFromLabel(label?: string | null): PitchMarkerCoords | null {
  const haystack = normalizeRoleToken(label);
  if (!haystack) return null;
  const slot = pickBestSlot(haystack);
  if (!slot) return null;
  return mapCoordsToPitchInset({ x: slot.x, y: slot.y });
}

/**
 * Derive secondary role from 18-point rating attributes by highest group average
 * that differs from the primary role context.
 */
export function deriveSecondaryRoleFromAttributes(
  attributes: Record<string, number> | null | undefined,
  primaryRole?: string | null
): string | null {
  if (!attributes || Object.keys(attributes).length === 0) return null;

  const ranked = SECONDARY_ROLE_PROFILES.map(({ label, keys }) => ({
    label,
    avg: averageKeys(attributes, keys),
  }))
    .filter((entry) => entry.avg > 0)
    .sort((a, b) => b.avg - a.avg);

  for (const entry of ranked) {
    if (!rolesEquivalent(entry.label, primaryRole ?? "")) {
      return entry.label;
    }
  }

  return ranked[1]?.label ?? null;
}

export type SecondaryPitchInput = {
  /** Registration/calibration primary — used to exclude duplicate secondary roles. */
  positionPrimary?: string | null;
  positionSecondary?: string | null;
  positionFitSecondary?: string | null;
  scoutingSecondaryPositionFit?: string | null;
  ratingAttributes?: Record<string, number> | null;
};

function trySecondaryLabel(
  label: string | null | undefined,
  primaryRole: string,
  primaryMarker: PitchMarkerCoords
): PitchMarkerCoords | null {
  if (!label?.trim()) return null;
  if (rolesEquivalent(label, primaryRole)) return null;
  const marker = resolvePitchMarkerFromLabel(label);
  if (marker && !coordsNear(marker, primaryMarker)) {
    return marker;
  }
  return null;
}

/**
 * Secondary marker: API secondary roles first (positionSecondary → position fit →
 * scouting fit), then attribute-group inference only when no API secondary exists.
 * Returns null when unavailable or overlapping primary.
 */
export function resolveSecondaryPitchMarker(
  input: SecondaryPitchInput,
  primaryMarker: PitchMarkerCoords
): PitchMarkerCoords | null {
  const primaryRole = input.positionPrimary ?? "";

  const apiCandidates = [
    input.positionSecondary,
    input.positionFitSecondary,
    input.scoutingSecondaryPositionFit,
  ];

  for (const label of apiCandidates) {
    const marker = trySecondaryLabel(label, primaryRole, primaryMarker);
    if (marker) return marker;
  }

  const attributeRole = deriveSecondaryRoleFromAttributes(
    input.ratingAttributes,
    primaryRole
  );
  return trySecondaryLabel(attributeRole, primaryRole, primaryMarker);
}
