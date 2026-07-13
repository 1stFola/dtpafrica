export const PLAYER_AGE_CATEGORIES = {
  UNDER_18: "Under 18",
  UNDER_21: "Under 21",
  UNDER_23: "Under 23",
  SENIOR: "Senior",
} as const;

export type PlayerAgeCategory =
  (typeof PLAYER_AGE_CATEGORIES)[keyof typeof PLAYER_AGE_CATEGORIES];

export function ageFromDateOfBirth(
  dateOfBirth: Date | string | null | undefined,
  now = new Date()
): number | null {
  if (!dateOfBirth) return null;
  const dob = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;

  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < dob.getUTCDate())) {
    age -= 1;
  }
  return age >= 0 && age < 80 ? age : null;
}

export function ageCategoryFromNumber(age: number): PlayerAgeCategory {
  if (age < 18) return PLAYER_AGE_CATEGORIES.UNDER_18;
  if (age < 21) return PLAYER_AGE_CATEGORIES.UNDER_21;
  if (age < 23) return PLAYER_AGE_CATEGORIES.UNDER_23;
  return PLAYER_AGE_CATEGORIES.SENIOR;
}

export function normalizePlayerAgeCategory(player: {
  age?: number | null;
  ageGroup?: string | null;
  dateOfBirth?: Date | string | null;
}): PlayerAgeCategory | null {
  const age =
    player.age != null && Number.isFinite(player.age)
      ? player.age
      : ageFromDateOfBirth(player.dateOfBirth ?? null);
  if (age != null) return ageCategoryFromNumber(age);

  const raw = player.ageGroup?.trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes("senior") || raw.includes("open")) return PLAYER_AGE_CATEGORIES.SENIOR;
  if (raw.includes("23") || raw.includes("22")) return PLAYER_AGE_CATEGORIES.UNDER_23;
  if (raw.includes("21") || raw.includes("20") || raw.includes("19")) {
    return PLAYER_AGE_CATEGORIES.UNDER_21;
  }
  if (raw.includes("18") || raw.includes("17") || raw.includes("16") || raw.includes("15")) {
    return PLAYER_AGE_CATEGORIES.UNDER_18;
  }
  return null;
}
