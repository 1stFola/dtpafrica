import type { Academy } from "@prisma/client";
import { jwtSecret } from "../shared/jwt-secrets";

export type PublicAcademy = Omit<Academy, "passwordHash">;

export function sanitizeAcademy<T extends { passwordHash?: string | null }>(
  row: T
): Omit<T, "passwordHash"> {
  const { passwordHash: _hash, ...rest } = row;
  return rest;
}

/** Signs and verifies academy sessions. Required in production; see shared/jwt-secrets.ts. */
export function academyJwtSecret(): string {
  return jwtSecret("ACADEMY_JWT_SECRET");
}
