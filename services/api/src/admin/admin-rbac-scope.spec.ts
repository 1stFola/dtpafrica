import { describe, expect, it, vi } from "vitest";
import { AdminRbacService, isCompetitionScopedRole } from "./admin-rbac.service";

/**
 * Competition scope on admin accounts, as the Users page drives it.
 *
 * A Match Recorder may hold named competitions or all of them. A FairPlay
 * Organiser must hold named competitions: FairPlay refuses an organiser with
 * no scope (fairplay/access.ts), and "all competitions" signs in with none.
 * Before this, every role but match_recorder lost its competitions on any
 * update, so renaming an organiser locked them out.
 */
const roles: Record<string, { id: string; slug: string }> = {
  read_only: { id: "role-ro", slug: "read_only" },
  match_recorder: { id: "role-rec", slug: "match_recorder" },
  fairplay_organiser_viewer: { id: "role-org", slug: "fairplay_organiser_viewer" },
};
const byId = new Map(Object.values(roles).map((r) => [r.id, r]));

function setup(user: { roleId: string; allCompetitions?: boolean; grants?: string[] }) {
  const existing = {
    id: "u1",
    email: "org@dtp.test",
    name: null,
    isActive: true,
    roleId: user.roleId,
    allCompetitions: user.allCompetitions ?? false,
    competitionId: null,
  };
  const grants = new Set(user.grants ?? []);
  const prisma = {
    adminUser: {
      findUnique: vi.fn().mockResolvedValue(existing),
      update: vi.fn().mockImplementation(async ({ data }: any) => Object.assign(existing, data)),
      findUniqueOrThrow: vi.fn().mockImplementation(async () => ({
        ...existing,
        role: { slug: byId.get(existing.roleId)!.slug, name: "x" },
        competition: null,
        competitions: [...grants].map((id) => ({ competition: { id, name: `Comp ${id}` } })),
      })),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({
        ...existing,
        allCompetitions: data.allCompetitions,
        role: { slug: byId.get(data.roleId)!.slug, name: "x" },
        competition: null,
        competitions: data.competitions.create.map(({ competitionId }: any) => ({
          competition: { id: competitionId, name: `Comp ${competitionId}` },
        })),
      })),
    },
    adminRole: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) =>
        where.slug ? roles[where.slug] ?? null : byId.get(where.id) ?? null
      ),
    },
    adminUserCompetition: {
      findMany: vi.fn().mockImplementation(async () => [...grants].map((competitionId) => ({ competitionId }))),
      deleteMany: vi.fn().mockImplementation(async () => { grants.clear(); return { count: 0 }; }),
      createMany: vi.fn().mockImplementation(async ({ data }: any) => {
        for (const row of data) grants.add(row.competitionId);
        return { count: data.length };
      }),
    },
    sbCompetition: {
      findMany: vi.fn().mockImplementation(async ({ where }: any) => where.id.in.map((id: string) => ({ id }))),
    },
    $transaction: vi.fn().mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const service: any = Object.create(AdminRbacService.prototype);
  service.prisma = prisma;
  service.adminAuth = {
    assertUniqueEmail: vi.fn(),
    hashPassword: vi.fn().mockResolvedValue("hash"),
  };
  service.syncCatalog = vi.fn();
  return { service, prisma, grants };
}

describe("competition scope on admin accounts", () => {
  it("knows which roles are scoped", () => {
    expect(isCompetitionScopedRole("match_recorder")).toBe(true);
    expect(isCompetitionScopedRole("fairplay_organiser_viewer")).toBe(true);
    expect(isCompetitionScopedRole("read_only")).toBe(false);
    expect(isCompetitionScopedRole(null)).toBe(false);
  });

  it("refuses an organiser with no competitions", async () => {
    const { service } = setup({ roleId: roles.read_only.id });
    await expect(
      service.createUser({ email: "o@dtp.test", roleSlug: "fairplay_organiser_viewer" })
    ).rejects.toThrow("A FairPlay Organiser must be assigned at least one competition");
  });

  it("refuses an organiser granted all competitions", async () => {
    const { service } = setup({ roleId: roles.read_only.id });
    await expect(
      service.createUser({
        email: "o@dtp.test",
        roleSlug: "fairplay_organiser_viewer",
        allCompetitions: true,
        competitionIds: ["c1"],
      })
    ).rejects.toThrow("cannot be granted all of them");
  });

  it("creates an organiser with named competitions", async () => {
    const { service } = setup({ roleId: roles.read_only.id });
    const created = await service.createUser({
      email: "o@dtp.test",
      roleSlug: "fairplay_organiser_viewer",
      competitionIds: ["c1", "c2"],
    });
    expect(created.competitionIds).toEqual(["c1", "c2"]);
    expect(created.allCompetitions).toBe(false);
  });

  it("still lets a recorder hold all competitions", async () => {
    const { service } = setup({ roleId: roles.read_only.id });
    const created = await service.createUser({
      email: "r@dtp.test",
      roleSlug: "match_recorder",
      allCompetitions: true,
    });
    expect(created.allCompetitions).toBe(true);
  });

  it("keeps an organiser's competitions through a rename", async () => {
    const { service, prisma, grants } = setup({
      roleId: roles.fairplay_organiser_viewer.id,
      grants: ["c1"],
    });
    const updated = await service.updateUser("u1", { name: "Renamed" });
    expect([...grants]).toEqual(["c1"]);
    expect(prisma.adminUserCompetition.deleteMany).not.toHaveBeenCalled();
    expect(prisma.adminUser.update.mock.calls[0][0].data.allCompetitions).toBe(false);
    expect(updated.competitionIds).toEqual(["c1"]);
  });

  it("refuses to switch an organiser to all competitions", async () => {
    const { service, grants } = setup({
      roleId: roles.fairplay_organiser_viewer.id,
      grants: ["c1"],
    });
    await expect(service.updateUser("u1", { allCompetitions: true })).rejects.toThrow(
      "cannot be granted all of them"
    );
    expect([...grants]).toEqual(["c1"]);
  });

  it("drops the scope when an organiser becomes staff", async () => {
    const { service, grants } = setup({
      roleId: roles.fairplay_organiser_viewer.id,
      grants: ["c1"],
    });
    const updated = await service.updateUser("u1", { roleSlug: "read_only" });
    expect([...grants]).toEqual([]);
    expect(updated.competitionIds).toEqual([]);
  });

  it("carries named competitions from recorder to organiser", async () => {
    const { service, grants } = setup({ roleId: roles.match_recorder.id, grants: ["c1"] });
    const updated = await service.updateUser("u1", { roleSlug: "fairplay_organiser_viewer" });
    expect([...grants]).toEqual(["c1"]);
    expect(updated.roleSlug).toBe("fairplay_organiser_viewer");
  });

  it("refuses to move a recorder on all competitions to organiser", async () => {
    const { service } = setup({ roleId: roles.match_recorder.id, allCompetitions: true });
    await expect(
      service.updateUser("u1", { roleSlug: "fairplay_organiser_viewer" })
    ).rejects.toThrow("cannot be granted all of them");
  });
});
