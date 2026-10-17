import { jwtSecret } from "../../shared/jwt-secrets";

/** Signs and verifies admin sessions. Required in production; see shared/jwt-secrets.ts. */
export function adminJwtSecret(): string {
  return jwtSecret("ADMIN_JWT_SECRET");
}

export const SUPER_ADMIN_ROLE_SLUG = "super_admin";
