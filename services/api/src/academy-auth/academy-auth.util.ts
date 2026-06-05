import type { Academy } from "@prisma/client";

export type PublicAcademy = Omit<Academy, "passwordHash">;

export function sanitizeAcademy<T extends { passwordHash?: string | null }>(
  row: T
): Omit<T, "passwordHash"> {
  const { passwordHash: _hash, ...rest } = row;
  return rest;
}

export function academyJwtSecret(): string {
  return (
    process.env.ACADEMY_JWT_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    process.env.ADMIN_API_KEY?.trim() ||
    "dtp-dev-academy-jwt-change-me"
  );
}
