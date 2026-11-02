import { randomBytes } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AdminAuthService } from "./auth/admin-auth.service";
import { ADMIN_PERMISSIONS, DEFAULT_ROLES } from "./rbac/permissions.catalog";

/**
 * Generate a readable but strong password.
 *
 * Ambiguous characters are left out so a password can be read aloud or copied
 * off a screen without confusing 0/O or 1/l.
 */
function generatePassword(length = 16): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const symbols = "!@#$%^&*";
  const bytes = randomBytes(length + 2);
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  // Guarantee one symbol and one digit so it satisfies any policy.
  const pos = bytes[length] % length;
  out = out.slice(0, pos) + symbols[bytes[length + 1] % symbols.length] + out.slice(pos + 1);
  return out;
}

/**
 * Roles whose accounts must be limited to competitions. Everywhere else in admin
 * "no competitions" means every competition, which is right for DTP staff and
 * wrong for someone from outside.
 *
 *   - A Match Recorder may hold named competitions or all of them.
 *   - A FairPlay Organiser may hold named competitions only: FairPlay refuses an
 *     organiser account with no scope (fairplay/access.ts, decisions.md D4), and
 *     "all competitions" carries no scope at all once signed in.
 */
const COMPETITION_SCOPED_ROLES: Record<string, { noun: string; allowAll: boolean }> = {
  match_recorder: { noun: "A Match Recorder", allowAll: true },
  fairplay_organiser_viewer: { noun: "A FairPlay Organiser", allowAll: false },
};

export function isCompetitionScopedRole(roleSlug: string | null | undefined): boolean {
  return Boolean(roleSlug && roleSlug in COMPETITION_SCOPED_ROLES);
}

@Injectable()
export class AdminRbacService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminAuthService) private readonly adminAuth: AdminAuthService
  ) {}

  listPermissions() {
    return ADMIN_PERMISSIONS.map((p) => ({
      slug: p.slug,
      resource: p.resource,
      action: p.action,
      description: p.description,
    }));
  }

  async listRoles() {
    await this.syncCatalog();
    const roles = await this.prisma.adminRole.findMany({
      orderBy: { name: "asc" },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
    });
    return roles.map((role) => ({
      id: role.id,
      slug: role.slug,
      name: role.name,
      description: role.description,
      userCount: role._count.users,
      permissions: role.permissions.map((rp) => rp.permission.slug).sort(),
    }));
  }

  async getRole(slug: string) {
    await this.syncCatalog();
    const role = await this.prisma.adminRole.findUnique({
      where: { slug },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
    });
    if (!role) throw new NotFoundException("Role not found");
    return {
      id: role.id,
      slug: role.slug,
      name: role.name,
      description: role.description,
      userCount: role._count.users,
      permissions: role.permissions.map((rp) => rp.permission.slug).sort(),
    };
  }

  async updateRolePermissions(slug: string, permissionSlugs: string[]) {
    await this.syncCatalog();
    if (slug === "super_admin") {
      throw new BadRequestException("Cannot modify super_admin permissions");
    }
    const role = await this.prisma.adminRole.findUnique({ where: { slug } });
    if (!role) throw new NotFoundException("Role not found");

    const permissions = await this.prisma.adminPermission.findMany({
      where: { slug: { in: permissionSlugs } },
    });
    const found = new Set(permissions.map((p) => p.slug));
    const missing = permissionSlugs.filter((s) => !found.has(s));
    if (missing.length) {
      throw new BadRequestException(`Unknown permissions: ${missing.join(", ")}`);
    }

    await this.prisma.adminRolePermission.deleteMany({ where: { roleId: role.id } });
    if (permissions.length > 0) {
      await this.prisma.adminRolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });
    }
    return this.getRole(slug);
  }

  async listUsers() {
    const users = await this.prisma.adminUser.findMany({
      orderBy: [{ isActive: "desc" }, { email: "asc" }],
      include: {
        role: true,
        competition: { select: { id: true, name: true } },
        competitions: { include: { competition: { select: { id: true, name: true } } } },
      },
    });
    return users.map((u) => this.present(u));
  }

  async createUser(input: {
    email: string;
    name?: string;
    password?: string;
    roleSlug: string;
    competitionIds?: string[];
    allCompetitions?: boolean;
  }) {
    await this.syncCatalog();
    await this.adminAuth.assertUniqueEmail(input.email);
    const role = await this.prisma.adminRole.findUnique({
      where: { slug: input.roleSlug },
    });
    if (!role) throw new BadRequestException("Role not found");

    const allCompetitions = input.allCompetitions === true;
    /* An explicit grant of everything supersedes any named list, so the two
       cannot drift into disagreeing about what the account can reach. */
    const competitionIds = allCompetitions
      ? []
      : await this.resolveCompetitionScope(input.competitionIds ?? []);
    this.assertScopeRequired(role.slug, competitionIds, allCompetitions);

    /* Generated when none is supplied, and returned once below so the admin can
       hand it over. Only the hash is kept. */
    const password = input.password?.trim() ? input.password.trim() : generatePassword();
    const passwordHash = await this.adminAuth.hashPassword(password);
    const user = await this.prisma.adminUser.create({
      data: {
        email: input.email.trim().toLowerCase(),
        name: input.name?.trim() || null,
        passwordHash,
        roleId: role.id,
        allCompetitions,
        competitions: {
          create: competitionIds.map((competitionId) => ({ competitionId })),
        },
      },
      include: {
        role: true,
        competition: { select: { id: true, name: true } },
        competitions: { include: { competition: { select: { id: true, name: true } } } },
      },
    });
    return {
      ...this.present(user),
      /* Returned once, here, so the admin can hand it over. Only the hash is
         stored, so it can never be read back afterwards. */
      generatedPassword: input.password?.trim() ? null : password,
    };
  }

  /**
   * Remove an admin account.
   *
   * Refuses to delete the last account that can manage users, since that would
   * lock everybody out of the admin portal with no way back in.
   */
  async deleteUser(id: string, actingUserId?: string) {
    const user = await this.prisma.adminUser.findUnique({
      where: { id },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    if (!user) throw new NotFoundException("User not found");

    if (actingUserId && actingUserId === id) {
      throw new BadRequestException("You cannot delete the account you are signed in with");
    }

    const canManage = (u: typeof user) =>
      u?.role?.permissions.some((p) => p.permission.slug === "admin.users.manage") ?? false;
    if (canManage(user)) {
      const others = await this.prisma.adminUser.count({
        where: {
          id: { not: id },
          isActive: true,
          role: { permissions: { some: { permission: { slug: "admin.users.manage" } } } },
        },
      });
      if (others === 0) {
        throw new BadRequestException(
          "This is the last account that can manage users. Give another account that permission first."
        );
      }
    }

    await this.prisma.adminUser.delete({ where: { id } });
    return { id, deleted: true };
  }

  /**
   * Issue a fresh password.
   *
   * The plaintext is returned exactly once, here, and only the hash is stored —
   * a saved password cannot be read back later, by design. If it is lost, issue
   * another one.
   */
  async resetPassword(id: string, supplied?: string) {
    const user = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!user) throw new NotFoundException("User not found");

    const password = supplied?.trim() ? supplied.trim() : generatePassword();
    if (password.length < 8) {
      throw new BadRequestException("Password must be at least 8 characters");
    }
    await this.prisma.adminUser.update({
      where: { id },
      data: { passwordHash: await this.adminAuth.hashPassword(password) },
    });
    return { id, email: user.email, password };
  }

  /** A password the caller can show before creating the account. */
  suggestPassword() {
    return { password: generatePassword() };
  }

  /**
   * A scoped account with no competitions would fall back to unscoped and see
   * every fixture (a recorder) or be refused outright (an organiser), so a scope
   * is mandatory for those roles. A recorder may be granted everything; an
   * organiser must name the competitions, since FairPlay treats "no scope" as
   * "not yours to read".
   */
  private assertScopeRequired(
    roleSlug: string | null,
    competitionIds: string[],
    allCompetitions: boolean
  ) {
    const scoped = roleSlug ? COMPETITION_SCOPED_ROLES[roleSlug] : undefined;
    if (!scoped) return;
    if (allCompetitions && !scoped.allowAll) {
      throw new BadRequestException(
        `${scoped.noun} must be limited to named competitions; it cannot be granted all of them`
      );
    }
    if (!allCompetitions && competitionIds.length === 0) {
      throw new BadRequestException(
        scoped.allowAll
          ? `${scoped.noun} must be assigned at least one competition, or all of them`
          : `${scoped.noun} must be assigned at least one competition`
      );
    }
  }

  /**
   * Competitions a recorder may work in.
   *
   * Unknown ids are rejected rather than silently dropped: a typo that quietly
   * narrowed someone's scope would show up much later as "I cannot see my
   * fixtures", and one that widened it would not show up at all.
   */
  private async resolveCompetitionScope(competitionIds: string[]): Promise<string[]> {
    const wanted = [...new Set(competitionIds.map((id) => id.trim()).filter(Boolean))];
    if (wanted.length === 0) return [];
    const found = await this.prisma.sbCompetition.findMany({
      where: { id: { in: wanted } },
      select: { id: true },
    });
    if (found.length !== wanted.length) {
      const known = new Set(found.map((c) => c.id));
      throw new BadRequestException(
        `Unknown competition: ${wanted.filter((id) => !known.has(id)).join(", ")}`
      );
    }
    return found.map((c) => c.id);
  }

  /** Replace an account's competition grants wholesale. */
  private async writeScope(userId: string, competitionIds: string[]) {
    await this.prisma.$transaction([
      this.prisma.adminUserCompetition.deleteMany({ where: { adminUserId: userId } }),
      ...(competitionIds.length
        ? [
            this.prisma.adminUserCompetition.createMany({
              data: competitionIds.map((competitionId) => ({ adminUserId: userId, competitionId })),
            }),
          ]
        : []),
    ]);
  }

  /** One shape for every user response, so the console never sees two. */
  private present(user: {
    id: string; email: string; name: string | null; isActive: boolean;
    allCompetitions: boolean; competitionId: string | null;
    role?: { slug: string; name: string } | null;
    competition?: { id: string; name: string } | null;
    competitions?: { competition: { id: string; name: string } }[];
    createdAt?: Date; updatedAt?: Date;
  }) {
    /* Union of the join table and the legacy single-competition column, so
       accounts created before recorders could hold several still report the
       scope they actually have. */
    const granted = new Map<string, string>();
    for (const g of user.competitions ?? []) granted.set(g.competition.id, g.competition.name);
    if (user.competition) granted.set(user.competition.id, user.competition.name);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      roleSlug: user.role?.slug ?? null,
      roleName: user.role?.name ?? null,
      allCompetitions: user.allCompetitions,
      competitionIds: [...granted.keys()],
      competitionNames: [...granted.values()],
      ...(user.createdAt ? { createdAt: user.createdAt.toISOString() } : {}),
      ...(user.updatedAt ? { updatedAt: user.updatedAt.toISOString() } : {}),
    };
  }

  async updateUser(
    id: string,
    input: {
      email?: string;
      name?: string;
      password?: string;
      roleSlug?: string;
      isActive?: boolean;
      competitionIds?: string[];
      allCompetitions?: boolean;
    }
  ) {
    await this.syncCatalog();
    const existing = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("User not found");

    if (input.email) {
      await this.adminAuth.assertUniqueEmail(input.email, id);
    }

    let roleId = existing.roleId;
    if (input.roleSlug) {
      const role = await this.prisma.adminRole.findUnique({
        where: { slug: input.roleSlug },
      });
      if (!role) throw new BadRequestException("Role not found");
      roleId = role.id;
    }

    const nextRole = await this.prisma.adminRole.findUnique({ where: { id: roleId ?? "" } });
    const scopeTouched = input.competitionIds !== undefined || input.allCompetitions !== undefined;

    const nextAll =
      input.allCompetitions !== undefined ? input.allCompetitions : existing.allCompetitions;
    const currentIds = (
      await this.prisma.adminUserCompetition.findMany({
        where: { adminUserId: id },
        select: { competitionId: true },
      })
    ).map((g) => g.competitionId);
    const nextIds = nextAll
      ? []
      : input.competitionIds !== undefined
        ? await this.resolveCompetitionScope(input.competitionIds)
        : currentIds;

    /* Moving off a scoped role drops the scope with it, so a stale grant
       cannot outlive the role that needed it. Moving between scoped roles
       (recorder to organiser, say) keeps the named competitions. */
    const leavingScopedRole = !isCompetitionScopedRole(nextRole?.slug);
    this.assertScopeRequired(nextRole?.slug ?? null, nextIds, nextAll);

    const passwordHash = input.password
      ? await this.adminAuth.hashPassword(input.password)
      : undefined;

    const user = await this.prisma.adminUser.update({
      where: { id },
      data: {
        ...(input.email ? { email: input.email.trim().toLowerCase() } : {}),
        ...(input.name !== undefined ? { name: input.name?.trim() || null } : {}),
        ...(passwordHash ? { passwordHash } : {}),
        ...(input.roleSlug ? { roleId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(leavingScopedRole ? { allCompetitions: false, competitionId: null } : { allCompetitions: nextAll }),
      },
    });

    if (leavingScopedRole) await this.writeScope(id, []);
    else if (scopeTouched) await this.writeScope(id, nextIds);

    const fresh = await this.prisma.adminUser.findUniqueOrThrow({
      where: { id },
      include: {
        role: true,
        competition: { select: { id: true, name: true } },
        competitions: { include: { competition: { select: { id: true, name: true } } } },
      },
    });
    void user;
    return this.present(fresh);
  }

  private async syncCatalog() {
    for (const perm of ADMIN_PERMISSIONS) {
      await this.prisma.adminPermission.upsert({
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

    for (const roleDef of DEFAULT_ROLES) {
      const existing = await this.prisma.adminRole.findUnique({
        where: { slug: roleDef.slug },
      });
      if (existing) {
        await this.prisma.adminRole.update({
          where: { id: existing.id },
          data: {
            name: roleDef.name,
            description: roleDef.description,
          },
        });
        continue;
      }

      const role = await this.prisma.adminRole.create({
        data: {
          slug: roleDef.slug,
          name: roleDef.name,
          description: roleDef.description,
        },
      });
      const slugs =
        roleDef.permissionSlugs === "all"
          ? ADMIN_PERMISSIONS.map((permission) => permission.slug)
          : roleDef.permissionSlugs;
      const permissions = await this.prisma.adminPermission.findMany({
        where: { slug: { in: slugs } },
        select: { id: true },
      });
      if (permissions.length > 0) {
        await this.prisma.adminRolePermission.createMany({
          data: permissions.map((permission) => ({
            roleId: role.id,
            permissionId: permission.id,
          })),
          skipDuplicates: true,
        });
      }
    }
  }
}
