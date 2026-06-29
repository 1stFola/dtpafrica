import { SetMetadata } from "@nestjs/common";

export const REQUIRE_PERMISSIONS_KEY = "require_permissions";

/** Require one or more permission slugs (user needs any of them). */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, permissions);
