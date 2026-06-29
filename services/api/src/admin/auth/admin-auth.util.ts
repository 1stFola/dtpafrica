export function adminJwtSecret(): string {
  return (
    process.env.ADMIN_JWT_SECRET?.trim() ||
    process.env.ADMIN_API_KEY?.trim() ||
    "dtp-dev-admin-jwt-fallback"
  );
}

export const SUPER_ADMIN_ROLE_SLUG = "super_admin";
