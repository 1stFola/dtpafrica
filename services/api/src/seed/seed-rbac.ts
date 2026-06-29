import type { PrismaClient } from "@prisma/client";
import {
  ADMIN_PERMISSIONS,
  ALL_PERMISSION_SLUGS,
  DEFAULT_ROLES,
} from "../admin/rbac/permissions.catalog";

/** Idempotent RBAC seed — safe to run on every deploy / incremental seed. */
export async function seedRbac(prisma: PrismaClient) {
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

  for (const roleDef of DEFAULT_ROLES) {
    const role = await prisma.adminRole.upsert({
      where: { slug: roleDef.slug },
      create: {
        slug: roleDef.slug,
        name: roleDef.name,
        description: roleDef.description,
      },
      update: {
        name: roleDef.name,
        description: roleDef.description,
      },
    });

    const slugs =
      roleDef.permissionSlugs === "all" ? ALL_PERMISSION_SLUGS : roleDef.permissionSlugs;

    const permissionIds = slugs
      .map((slug) => permBySlug.get(slug)?.id)
      .filter((id): id is string => Boolean(id));

    if (roleDef.slug !== "super_admin") {
      await prisma.adminRolePermission.deleteMany({ where: { roleId: role.id } });
    }
    if (permissionIds.length > 0) {
      await prisma.adminRolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
  }

  return { permissions: ADMIN_PERMISSIONS.length, roles: DEFAULT_ROLES.length };
}
