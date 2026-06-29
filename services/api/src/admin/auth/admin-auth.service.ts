import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../../prisma/prisma.service";
import { ALL_PERMISSION_SLUGS } from "../rbac/permissions.catalog";
import { adminJwtSecret } from "./admin-auth.util";
import type { AdminAuthContext } from "./admin-auth.types";

const BCRYPT_ROUNDS = 10;

export type AdminJwtPayload = {
  sub: string;
  email: string;
  roleSlug: string | null;
};

@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService
  ) {}

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  verifyToken(token: string): AdminJwtPayload {
    const payload = this.jwt.verify<AdminJwtPayload>(token, {
      secret: adminJwtSecret(),
    });
    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException("Invalid admin token");
    }
    return payload;
  }

  signToken(user: { id: string; email: string; roleSlug: string | null }) {
    const payload: AdminJwtPayload = {
      sub: user.id,
      email: user.email,
      roleSlug: user.roleSlug,
    };
    return this.jwt.sign(payload, {
      secret: adminJwtSecret(),
      expiresIn: "7d",
    });
  }

  apiKeyContext(): AdminAuthContext {
    return {
      method: "api_key",
      roleSlug: "super_admin",
      roleName: "Super Admin (API key)",
      permissions: [...ALL_PERMISSION_SLUGS],
    };
  }

  async contextFromJwt(payload: AdminJwtPayload): Promise<AdminAuthContext> {
    const user = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub },
      include: {
        role: {
          include: {
            permissions: { include: { permission: true } },
          },
        },
      },
    });
    if (!user?.isActive) {
      throw new UnauthorizedException("Admin user not found or inactive");
    }

    const permissions =
      user.role?.permissions.map((rp) => rp.permission.slug) ?? [];

    return {
      method: "jwt",
      roleSlug: user.role?.slug ?? null,
      roleName: user.role?.name ?? null,
      permissions,
      userId: user.id,
      email: user.email,
      displayName: user.name ?? user.email,
    };
  }

  async login(email: string, password: string) {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.adminUser.findUnique({
      where: { email: normalized },
      include: { role: true },
    });
    if (!user?.passwordHash || !user.isActive) {
      throw new UnauthorizedException("Invalid email or password");
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException("Invalid email or password");
    }
    const token = this.signToken({
      id: user.id,
      email: user.email,
      roleSlug: user.role?.slug ?? null,
    });
    const session = await this.contextFromJwt({
      sub: user.id,
      email: user.email,
      roleSlug: user.role?.slug ?? null,
    });
    return { token, session };
  }

  async sessionFromToken(token: string) {
    return this.contextFromJwt(this.verifyToken(token));
  }

  async assertUniqueEmail(email: string, excludeId?: string) {
    const normalized = email.trim().toLowerCase();
    const existing = await this.prisma.adminUser.findFirst({
      where: {
        email: { equals: normalized, mode: "insensitive" },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });
    if (existing) {
      throw new ConflictException("Email is already in use");
    }
  }
}
