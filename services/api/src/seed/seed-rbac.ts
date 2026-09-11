import type { PrismaClient } from "@prisma/client";
import {
  ADMIN_PERMISSIONS,
  ALL_PERMISSION_SLUGS,
  DEFAULT_ROLES,
} from "../admin/rbac/permissions.catalog";

/**
 * RBAC seed. Additive only: it guarantees that the permission catalogue and the
 * default roles EXIST, and never touches a role that is already in the
 * database, so the permissions an admin has granted or revoked through the UI
 * survive every seed. Only a role this run creates receives the catalogue
 * defaults; super_admin is additionally topped up (see below).
 *
 * This previously reset every non-super_admin role on every run, silently
 * reverting permission changes. `AdminRbacService.syncCatalog` already had the
 * non-destructive shape; this matches it.
 */
export async function seedRbac(prisma: PrismaClient) {
  // Catalogue rows are system-defined and are not editable from the admin UI,
  // so refreshing them is safe.
  for (const perm of ADMIN_PERMISSIONS) {
    await prisma.adminPermission.upsert({
      where: { slug: perm.slug },
      create: {
        slug: perm.slug,
        resource: perm.resource,
        action: perm.action,
        description: perm.description,
      },
      update: {
        resource: perm.resource,
        action: perm.action,
        description: perm.description,
      },
    });
  }

  const permissionRows = await prisma.adminPermission.findMany({
    where: { slug: { in: ALL_PERMISSION_SLUGS } },
  });
  const permBySlug = new Map(permissionRows.map((p) => [p.slug, p]));

  let rolesCreated = 0;
  let rolesPreserved = 0;

  for (const roleDef of DEFAULT_ROLES) {
    const existing = await prisma.adminRole.findUnique({ where: { slug: roleDef.slug } });

    const role = existing
      ? await prisma.adminRole.update({
          where: { id: existing.id },
          data: { name: roleDef.name, description: roleDef.description },
        })
      : await prisma.adminRole.create({
          data: {
            slug: roleDef.slug,
            name: roleDef.name,
            description: roleDef.description,
          },
        });

    if (!existing) rolesCreated++;

    // super_admin is not editable from the admin UI (AdminRbacService rejects
    // it outright), so it is always topped up. That is purely additive: a
    // newly introduced permission still reaches the super admin.
    const isSuperAdmin = roleDef.slug === "super_admin";

    if (existing && !isSuperAdmin) {
      // Live role — leave its grants exactly as the admin left them.
      rolesPreserved++;
      continue;
    }

    const slugs =
      roleDef.permissionSlugs === "all" ? ALL_PERMISSION_SLUGS : roleDef.permissionSlugs;

    const permissionIds = slugs
      .map((slug) => permBySlug.get(slug)?.id)
      .filter((id): id is string => Boolean(id));

    // Nothing here ever revokes a grant; seeding is additive only.
    if (permissionIds.length > 0) {
      await prisma.adminRolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
  }

  return {
    permissions: ADMIN_PERMISSIONS.length,
    roles: DEFAULT_ROLES.length,
    rolesCreated,
    rolesPreserved,
  };
}
