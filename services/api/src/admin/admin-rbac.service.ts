import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AdminAuthService } from "./auth/admin-auth.service";
import { ADMIN_PERMISSIONS } from "./rbac/permissions.catalog";

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
      include: { role: true },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      isActive: u.isActive,
      roleSlug: u.role?.slug ?? null,
      roleName: u.role?.name ?? null,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    }));
  }

  async createUser(input: {
    email: string;
    name?: string;
    password: string;
    roleSlug: string;
  }) {
    await this.adminAuth.assertUniqueEmail(input.email);
    const role = await this.prisma.adminRole.findUnique({
      where: { slug: input.roleSlug },
    });
    if (!role) throw new BadRequestException("Role not found");

    const passwordHash = await this.adminAuth.hashPassword(input.password);
    const user = await this.prisma.adminUser.create({
      data: {
        email: input.email.trim().toLowerCase(),
        name: input.name?.trim() || null,
        passwordHash,
        roleId: role.id,
      },
      include: { role: true },
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      roleSlug: user.role?.slug ?? null,
      roleName: user.role?.name ?? null,
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
      },
      include: { role: true },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      roleSlug: user.role?.slug ?? null,
      roleName: user.role?.name ?? null,
    };
  }
}
