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
  { label: "CF", keys: ["finishing", "positioning", "strength", "first_touch", "team_play"] },
  { label: "LW", keys: ["pace", "dribbling", "acceleration", "agility", "sprint_speed"] },
  { label: "RW", keys: ["pace", "dribbling", "acceleration", "agility", "sprint_speed"] },
  { label: "AM", keys: ["vision", "technique", "dribbling", "passing", "first_touch"] },
  { label: "CAM", keys: ["vision", "technique", "passing", "dribbling", "composure"] },
  { label: "CM", keys: ["passing", "vision", "decision_making", "team_play", "work_rate"] },
  { label: "CDM", keys: ["work_rate", "positioning", "strength", "passing", "decision_making"] },
  { label: "CB", keys: ["strength", "positioning", "composure", "work_rate"] },
  { label: "LCB", keys: ["strength", "positioning", "composure", "work_rate"] },
  { label: "RCB", keys: ["strength", "positioning", "composure", "work_rate"] },
  { label: "RB", keys: ["pace", "sprint_speed", "stamina", "work_rate", "passing"] },
  { label: "LB", keys: ["pace", "sprint_speed", "stamina", "work_rate", "passing"] },
  { label: "RWB", keys: ["pace", "sprint_speed", "stamina", "work_rate", "acceleration"] },
  { label: "LWB", keys: ["pace", "sprint_speed", "stamina", "work_rate", "acceleration"] },
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

function coordsNear(a: PitchMarkerCoords, b: PitchMarkerCoords, threshold = 5): boolean {
  return Math.abs(a.x - b.x) <= threshold && Math.abs(a.y - b.y) <= threshold;
}

function primaryRoleHaystack(input: SecondaryPitchInput): string {
  return normalizePositionHaystack(
    input.positionPrimary,
    input.positionFull ?? null,
    input.role ?? null
  );
}

function isDistinctSecondaryRole(
  label: string,
  primaryHaystack: string,
  primaryMarker: PitchMarkerCoords
): boolean {
  if (!label.trim()) return false;
  if (primaryHaystack && rolesEquivalent(label, primaryHaystack)) return false;

  const marker = resolvePitchMarkerFromLabel(label);
  if (!marker) return false;
  return !coordsNear(marker, primaryMarker);
}

function pickBestDistinctRole(
  ranked: { label: string; score: number }[],
  primaryHaystack: string,
  primaryMarker: PitchMarkerCoords
): string | null {
  const seenSlots = new Set<string>();

  for (const entry of ranked) {
    const marker = resolvePitchMarkerFromLabel(entry.label);
    if (!marker) continue;

    const slotKey = `${Math.round(marker.x)}:${Math.round(marker.y)}`;
    if (seenSlots.has(slotKey)) continue;
    seenSlots.add(slotKey);

    if (!isDistinctSecondaryRole(entry.label, primaryHaystack, primaryMarker)) continue;
    return entry.label;
  }

  return null;
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
  positionFull?: string | null,
  role?: string | null
): PitchMarkerCoords {
  const primary = positionPrimary?.trim() ?? "";
  const full = positionFull?.trim() ?? "";
  const roleToken = role?.trim() ?? "";

  const candidates =
    isVaguePrimaryToken(primary) && full
      ? [full, primary, roleToken]
      : [primary, full, roleToken].filter(Boolean);

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

type TacticalSummaryInput = {
  gegenpressScore: number;
  tikiTakaScore: number;
  counterAttackScore: number;
  wingerScore: number;
  totalFootballScore: number;
};

const TACTICAL_ROLE_PROFILES: { label: string; scoreOf: (t: TacticalSummaryInput) => number }[] = [
  { label: "RW", scoreOf: (t) => t.wingerScore },
  { label: "LW", scoreOf: (t) => t.wingerScore },
  { label: "CAM", scoreOf: (t) => t.tikiTakaScore },
  { label: "CM", scoreOf: (t) => (t.tikiTakaScore + t.totalFootballScore) / 2 },
  { label: "ST", scoreOf: (t) => t.counterAttackScore },
  { label: "CDM", scoreOf: (t) => t.gegenpressScore },
  { label: "AM", scoreOf: (t) => t.totalFootballScore },
];

function pickSecondBestRole(
  ranked: { label: string; score: number }[],
  primaryHaystack: string,
  primaryMarker: PitchMarkerCoords
): string | null {
  if (ranked.length === 0) return null;

  const deduped: { label: string; score: number }[] = [];
  for (const entry of ranked) {
    const last = deduped[deduped.length - 1];
    if (last && rolesEquivalent(last.label, entry.label)) {
      if (entry.score > last.score) last.score = entry.score;
    } else {
      deduped.push({ ...entry });
    }
  }

  const primaryIsTop =
    deduped.length > 0 && rolesEquivalent(deduped[0].label, primaryHaystack);
  const candidates = primaryIsTop ? deduped.slice(1) : deduped;

  return pickBestDistinctRole(candidates, primaryHaystack, primaryMarker);
}

function wingLabelForPrimary(primaryRole?: string | null): "LW" | "RW" {
  const haystack = normalizeRoleToken(primaryRole);
  if (matchesToken(haystack, "LEFT") || matchesToken(haystack, "LW") || matchesToken(haystack, "LB")) {
    return "RW";
  }
  if (matchesToken(haystack, "RIGHT") || matchesToken(haystack, "RW") || matchesToken(haystack, "RB")) {
    return "LW";
  }
  return "RW";
}

export type SecondaryPitchInput = {
  /** Registration/calibration primary — used to exclude duplicate secondary roles. */
  positionPrimary?: string | null;
  positionFull?: string | null;
  role?: string | null;
  positionSecondary?: string | null;
  positionFitSecondary?: string | null;
  scoutingSecondaryPositionFit?: string | null;
  ratingAttributes?: Record<string, number> | null;
  tacticalSummary?: TacticalSummaryInput | null;
};

function trySecondaryLabel(
  label: string | null | undefined,
  primaryHaystack: string,
  primaryMarker: PitchMarkerCoords
): PitchMarkerCoords | null {
  if (!isDistinctSecondaryRole(label ?? "", primaryHaystack, primaryMarker)) return null;
  return resolvePitchMarkerFromLabel(label);
}

/**
 * Derive secondary role from 18-point rating attributes — second-best role
 * profile average that differs from the primary role and pitch slot.
 */
export function deriveSecondaryRoleFromAttributes(
  attributes: Record<string, number> | null | undefined,
  primaryHaystack: string,
  primaryMarker: PitchMarkerCoords
): string | null {
  if (!attributes || Object.keys(attributes).length === 0) return null;

  const ranked = SECONDARY_ROLE_PROFILES.map(({ label, keys }) => ({
    label,
    score: averageKeys(attributes, keys),
  }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return pickSecondBestRole(ranked, primaryHaystack, primaryMarker);
}

/** Derive secondary role from tactical style scores when explicit fields are absent. */
export function deriveSecondaryRoleFromTactical(
  tactical: TacticalSummaryInput | null | undefined,
  primaryHaystack: string,
  primaryMarker: PitchMarkerCoords,
  primaryRole?: string | null
): string | null {
  if (!tactical) return null;

  const wingLabel = wingLabelForPrimary(primaryRole ?? primaryHaystack);
  const ranked = TACTICAL_ROLE_PROFILES.map(({ label, scoreOf }) => ({
    label: label === "RW" || label === "LW" ? wingLabel : label,
    score: scoreOf(tactical),
  }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const deduped: { label: string; score: number }[] = [];
  for (const entry of ranked) {
    const last = deduped[deduped.length - 1];
    if (last && rolesEquivalent(last.label, entry.label)) {
      if (entry.score > last.score) last.score = entry.score;
    } else {
      deduped.push({ ...entry });
    }
  }

  return pickSecondBestRole(deduped, primaryHaystack, primaryMarker);
}

/**
 * Secondary marker: API secondary roles first (positionSecondary → position fit →
 * scouting fit), then attribute-group inference when no API secondary exists.
 * Returns null when unavailable or overlapping primary.
 */
export function resolveSecondaryPitchMarker(
  input: SecondaryPitchInput,
  primaryMarker: PitchMarkerCoords
): PitchMarkerCoords | null {
  const primaryHaystack = primaryRoleHaystack(input);

  const apiCandidates = [
    input.positionSecondary,
    input.positionFitSecondary,
    input.scoutingSecondaryPositionFit,
  ];

  for (const label of apiCandidates) {
    const marker = trySecondaryLabel(label, primaryHaystack, primaryMarker);
    if (marker) return marker;
  }

  if (input.ratingAttributes && Object.keys(input.ratingAttributes).length > 0) {
    const attributeRole = deriveSecondaryRoleFromAttributes(
      input.ratingAttributes,
      primaryHaystack,
      primaryMarker
    );
    const marker = trySecondaryLabel(attributeRole, primaryHaystack, primaryMarker);
    if (marker) return marker;
  }

  if (input.tacticalSummary) {
    const tacticalRole = deriveSecondaryRoleFromTactical(
      input.tacticalSummary,
      primaryHaystack,
      primaryMarker,
      input.positionPrimary
    );
    return trySecondaryLabel(tacticalRole, primaryHaystack, primaryMarker);
  }

  return null;
}

const RIGHT_FACING_TOKENS = [
  "RB",
  "RWB",
  "RIGHT BACK",
  "RIGHT WING BACK",
  "RM",
  "RIGHT MID",
  "RIGHT MIDFIELDER",
  "RW",
  "RIGHT WING",
  "RIGHT WINGER",
  "RF",
  "RIGHT FORWARD",
  "RIGHT",
];

const LEFT_FACING_TOKENS = [
  "LB",
  "LWB",
  "LEFT BACK",
  "LEFT WING BACK",
  "LM",
  "LEFT MID",
  "LEFT MIDFIELDER",
  "LW",
  "LEFT WING",
  "LEFT WINGER",
  "LF",
  "LEFT FORWARD",
  "LEFT",
];

/**
 * CSS rotation (degrees) for a subtle attack-direction arrow on pitch markers.
 * Triangle default points down; 180deg points toward the attacking goal (top).
 */
export function resolveFacingDegrees(
  positionPrimary?: string | null,
  positionFull?: string | null
): number {
  const haystack = normalizePositionHaystack(positionPrimary, null, positionFull);
  if (!haystack) return 180;

  for (const token of RIGHT_FACING_TOKENS) {
    if (matchesToken(haystack, token)) return 135;
  }
  for (const token of LEFT_FACING_TOKENS) {
    if (matchesToken(haystack, token)) return 225;
  }

  return 180;
}
