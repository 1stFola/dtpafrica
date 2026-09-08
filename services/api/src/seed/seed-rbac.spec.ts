import { describe, it, expect, beforeEach } from "vitest";
import { seedRbac } from "./seed-rbac";
import { ALL_PERMISSION_SLUGS, DEFAULT_ROLES } from "../admin/rbac/permissions.catalog";

/**
 * In-memory stand-in for the three RBAC tables. Enough of the Prisma surface
 * for seedRbac; grants are held as a roleId -> Set<permissionId> map so a test
 * can assert on exactly what a role ended up with.
 */
function makePrisma() {
  const permissions = new Map<string, { id: string; slug: string }>();
  const roles = new Map<string, { id: string; slug: string; name: string; description: string }>();
  const grants = new Map<string, Set<string>>();
  let seq = 0;

  return {
    grants,
    roles,
    permissions,
    adminPermission: {
      upsert: async ({ where, create }: any) => {
        const found = permissions.get(where.slug);
        if (found) return found;
        const row = { id: `perm-${++seq}`, slug: create.slug };
        permissions.set(row.slug, row);
        return row;
      },
      findMany: async ({ where }: any) =>
        [...permissions.values()].filter((p) => where.slug.in.includes(p.slug)),
    },
    adminRole: {
      findUnique: async ({ where }: any) => roles.get(where.slug) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `role-${++seq}`, ...data };
        roles.set(row.slug, row);
        grants.set(row.id, new Set());
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = [...roles.values()].find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    adminRolePermission: {
      deleteMany: async ({ where }: any) => {
        const set = grants.get(where.roleId);
        const n = set?.size ?? 0;
        set?.clear();
        return { count: n };
      },
      createMany: async ({ data }: any) => {
        for (const { roleId, permissionId } of data) {
          if (!grants.has(roleId)) grants.set(roleId, new Set());
          grants.get(roleId)!.add(permissionId);
        }
        return { count: data.length };
      },
    },
  };
}

/** Permission slugs currently granted to a role, for readable assertions. */
function slugsFor(p: ReturnType<typeof makePrisma>, roleSlug: string): string[] {
  const role = p.roles.get(roleSlug)!;
  const byId = new Map([...p.permissions.values()].map((x) => [x.id, x.slug]));
  return [...(p.grants.get(role.id) ?? [])].map((id) => byId.get(id)!).sort();
}

const CUSTOMISABLE = DEFAULT_ROLES.find((r) => r.slug !== "super_admin")!.slug;

describe("seedRbac", () => {
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
  });

  it("creates the default roles on a fresh database", async () => {
    const result = await seedRbac(prisma as never, { mode: "incremental" });
    expect(result.rolesCreated).toBe(DEFAULT_ROLES.length);
    expect(result.rolesPreserved).toBe(0);
    expect(prisma.roles.size).toBe(DEFAULT_ROLES.length);
  });

  // Regression: seedRbac used to deleteMany() every non-super_admin role's
  // grants on every run, so an incremental seed against live data silently
  // reverted permissions set through the admin UI.
  it("does not touch an existing role's permissions in incremental mode", async () => {
    await seedRbac(prisma as never, { mode: "incremental" });

    // An admin narrows the role to a single permission.
    const role = prisma.roles.get(CUSTOMISABLE)!;
    const kept = [...prisma.grants.get(role.id)!][0];
    prisma.grants.set(role.id, new Set([kept]));
    const before = slugsFor(prisma, CUSTOMISABLE);
    expect(before).toHaveLength(1);

    const result = await seedRbac(prisma as never, { mode: "incremental" });

    expect(slugsFor(prisma, CUSTOMISABLE)).toEqual(before);
    expect(result.rolesPreserved).toBeGreaterThan(0);
    expect(result.rolesCreated).toBe(0);
  });

  it("keeps a permission an admin added beyond the defaults", async () => {
    await seedRbac(prisma as never, { mode: "incremental" });
    const role = prisma.roles.get(CUSTOMISABLE)!;
    const extra = [...prisma.permissions.values()].find(
      (p) => !prisma.grants.get(role.id)!.has(p.id)
    )!;
    prisma.grants.get(role.id)!.add(extra.id);

    await seedRbac(prisma as never, { mode: "incremental" });

    expect(slugsFor(prisma, CUSTOMISABLE)).toContain(extra.slug);
  });

  it("tops up super_admin so new permissions still reach it", async () => {
    await seedRbac(prisma as never, { mode: "incremental" });
    const superAdmin = prisma.roles.get("super_admin")!;
    prisma.grants.set(superAdmin.id, new Set());

    await seedRbac(prisma as never, { mode: "incremental" });

    expect(slugsFor(prisma, "super_admin")).toEqual([...ALL_PERMISSION_SLUGS].sort());
  });

  it("still resets a role to catalogue defaults on a full seed", async () => {
    await seedRbac(prisma as never, { mode: "incremental" });
    const role = prisma.roles.get(CUSTOMISABLE)!;
    const defaults = slugsFor(prisma, CUSTOMISABLE);
    prisma.grants.set(role.id, new Set());

    await seedRbac(prisma as never, { mode: "full" });

    expect(slugsFor(prisma, CUSTOMISABLE)).toEqual(defaults);
  });
});
