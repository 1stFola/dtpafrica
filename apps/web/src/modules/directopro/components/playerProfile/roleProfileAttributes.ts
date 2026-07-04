import {
  resolvePositionGroup,
  type PositionMetricGroup,
} from "../../../scouting/utils/positionScoutingMetrics";
import { ALL_ATTRIBUTE_KEYS, type RatingAttributeKey } from "./playerProfileAttributes";

/** Fallback when position is missing or does not resolve to a mapped group. */
export const DEFAULT_CORE_ATTRIBUTE_KEYS: readonly RatingAttributeKey[] = [
  "pace",
  "passing",
  "dribbling",
  "stamina",
  "strength",
  "team_play",
];

/**
 * Six core scouting attributes per outfield role group.
 * User-facing concepts without a dedicated key (e.g. interceptions, aerial)
 * map to the closest calibrated attribute in the 18-point schema.
 */
export const ROLE_CORE_ATTRIBUTE_KEYS: Record<
  PositionMetricGroup,
  readonly RatingAttributeKey[]
> = {
  striker: [
    "finishing",
    "acceleration",
    "sprint_speed",
    "strength",
    "positioning",
    "composure",
  ],
  cm_am: [
    "passing",
    "vision",
    "stamina",
    "ball_control",
    "decision_making",
    "composure",
  ],
  winger: ["pace", "acceleration", "dribbling", "technique", "agility", "work_rate"],
  center_back: [
    "strength",
    "positioning",
    "sprint_speed",
    "work_rate",
    "composure",
    "decision_making",
  ],
  fullback: [
    "pace",
    "sprint_speed",
    "stamina",
    "work_rate",
    "acceleration",
    "passing",
  ],
  goalkeeper: [
    "positioning",
    "composure",
    "decision_making",
    "agility",
    "vision",
    "strength",
  ],
};

const ROLE_PROFILE_SUBSTITUTION_THRESHOLD = 55;

export function resolveCoreRoleAttributeKeys(
  positionPrimary?: string | null,
  role?: string | null
): readonly RatingAttributeKey[] {
  const haystack = [positionPrimary, role]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .trim();

  if (!haystack) return DEFAULT_CORE_ATTRIBUTE_KEYS;

  const group = resolvePositionGroup(positionPrimary, role);
  return ROLE_CORE_ATTRIBUTE_KEYS[group];
}

export function resolveIntelligentRoleProfileKeys({
  attributes,
  positionPrimary,
  role,
  secondaryRole,
}: {
  attributes: Record<string, number>;
  positionPrimary?: string | null;
  role?: string | null;
  secondaryRole?: string | null;
}): {
  coreKeys: readonly RatingAttributeKey[];
  remainingKeys: readonly RatingAttributeKey[];
} {
  const coreKeys = [...resolveCoreRoleAttributeKeys(positionPrimary, role)];
  const remainingKeys = new Set(resolveRemainingAttributeKeys(coreKeys));
  const secondaryCoreKeys = secondaryRole?.trim()
    ? resolveCoreRoleAttributeKeys(secondaryRole, secondaryRole)
    : [];
  const originalRemainingKeys = new Set(remainingKeys);
  const usedReplacementKeys = new Set<RatingAttributeKey>();

  for (let index = 0; index < coreKeys.length; index += 1) {
    const currentKey = coreKeys[index];
    const currentScore = attributes[currentKey] ?? 0;
    if (currentScore >= ROLE_PROFILE_SUBSTITUTION_THRESHOLD) continue;

    const replacementKey = secondaryCoreKeys
      .filter(
        (key) =>
          originalRemainingKeys.has(key) &&
          remainingKeys.has(key) &&
          !usedReplacementKeys.has(key)
      )
      .sort((a, b) => (attributes[b] ?? 0) - (attributes[a] ?? 0))[0];

    if (!replacementKey) continue;

    coreKeys[index] = replacementKey;
    usedReplacementKeys.add(replacementKey);
    remainingKeys.delete(replacementKey);
    remainingKeys.add(currentKey);
  }

  return {
    coreKeys,
    remainingKeys: ALL_ATTRIBUTE_KEYS.filter((key) => remainingKeys.has(key)),
  };
}

export function resolveRemainingAttributeKeys(
  coreKeys: readonly string[]
): readonly RatingAttributeKey[] {
  const core = new Set(coreKeys);
  return ALL_ATTRIBUTE_KEYS.filter((key) => !core.has(key));
}

export function resolveRoleProfileHeading(
  positionPrimary?: string | null,
  role?: string | null
): string {
  const group = resolvePositionGroup(positionPrimary, role);
  switch (group) {
    case "striker":
      return "Striker role profile";
    case "winger":
      return "Winger role profile";
    case "center_back":
      return "Centre-back role profile";
    case "fullback":
      return "Full-back role profile";
    case "goalkeeper":
      return "Goalkeeper role profile";
    case "cm_am":
    default:
      return "Midfield role profile";
  }
}
