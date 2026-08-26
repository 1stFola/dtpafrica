import { randomBytes } from "node:crypto";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AdminAuthService } from "./auth/admin-auth.service";
import { ADMIN_PERMISSIONS } from "./rbac/permissions.catalog";

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

/** Roles that must be pinned to exactly one competition. */
const COMPETITION_SCOPED_ROLE = "match_recorder";

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
      include: { role: true, competition: { select: { id: true, name: true } } },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      isActive: u.isActive,
      roleSlug: u.role?.slug ?? null,
      roleName: u.role?.name ?? null,
      competitionId: u.competitionId ?? null,
      competitionName: u.competition?.name ?? null,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    }));
  }

  async createUser(input: {
    email: string;
    name?: string;
    password?: string;
    roleSlug: string;
    competitionId?: string | null;
  }) {
    await this.adminAuth.assertUniqueEmail(input.email);
    const role = await this.prisma.adminRole.findUnique({
      where: { slug: input.roleSlug },
    });
    if (!role) throw new BadRequestException("Role not found");

    const competitionId = await this.resolveCompetitionScope(input.competitionId);
    this.assertScopeRequired(role.slug, competitionId);

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
        competitionId,
      },
      include: { role: true, competition: { select: { id: true, name: true } } },
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      roleSlug: user.role?.slug ?? null,
      roleName: user.role?.name ?? null,
      competitionId: user.competitionId ?? null,
      competitionName: user.competition?.name ?? null,
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
   * A recorder with no competition would fall back to unscoped and see every
   * fixture, so the scope is mandatory for that role rather than optional.
   */
  private assertScopeRequired(roleSlug: string | null, competitionId: string | null) {
    if (roleSlug === COMPETITION_SCOPED_ROLE && !competitionId) {
      throw new BadRequestException(
        "A Match Recorder must be assigned a competition"
      );
    }
  }

  /**
   * Competition scope for a contracted recorder. An empty value clears the
   * scope; an unknown id is rejected rather than silently ignored, so a typo
   * cannot quietly grant access to every competition.
   */
  private async resolveCompetitionScope(
    competitionId?: string | null
  ): Promise<string | null> {
    if (competitionId === undefined || competitionId === null || competitionId === "") {
      return null;
    }
    const competition = await this.prisma.sbCompetition.findUnique({
      where: { id: competitionId },
      select: { id: true },
    });
    if (!competition) throw new BadRequestException("Competition not found");
    return competition.id;
  }

  async updateUser(
    id: string,
    input: {
      email?: string;
      name?: string;
      password?: string;
      roleSlug?: string;
      isActive?: boolean;
      competitionId?: string | null;
    }
  ) {
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

    const nextCompetitionId =
      input.competitionId !== undefined
        ? await this.resolveCompetitionScope(input.competitionId)
        : existing.competitionId;
    const nextRole = await this.prisma.adminRole.findUnique({ where: { id: roleId ?? "" } });
    this.assertScopeRequired(nextRole?.slug ?? null, nextCompetitionId);

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
        ...(input.competitionId !== undefined ? { competitionId: nextCompetitionId } : {}),
        /* Changing role away from a scoped one clears the stale scope. */
        ...(nextRole?.slug !== COMPETITION_SCOPED_ROLE && existing.competitionId
          ? { competitionId: null }
          : {}),
      },
      include: { role: true, competition: { select: { id: true, name: true } } },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      roleSlug: user.role?.slug ?? null,
      roleName: user.role?.name ?? null,
      competitionId: user.competitionId ?? null,
      competitionName: user.competition?.name ?? null,
    };
  }
}
