import type { PrismaClient } from "@prisma/client";
import {
  ADMIN_PERMISSIONS,
  ALL_PERMISSION_SLUGS,
  DEFAULT_ROLES,
} from "../admin/rbac/permissions.catalog";


/**
 * RBAC seed.
 *
 * Incremental mode — the mode used against live data — only guarantees that the
 * permission catalogue and the default roles EXIST. A role that is already in
 * the database keeps exactly the permissions an admin granted it: the seed must
 * never overwrite live RBAC. Only a role this run actually creates receives the
 * catalogue defaults.
 *
 * This previously reset every non-super_admin role on every run, so each
 * incremental seed silently reverted permission changes made through the admin
 * UI. `AdminRbacService.syncCatalog` already had the non-destructive shape;
 * this matches it.
 *
 * A full seed bootstraps an empty database, so there it still resets each
 * non-super_admin role to the catalogue defaults.
 */
export async function seedRbac(prisma: PrismaClient) {
  // Catalogue rows are system-defined and are not editable from the admin UI,
  // so refreshing them is safe in either mode.
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
