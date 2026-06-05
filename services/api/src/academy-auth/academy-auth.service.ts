import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";
import {
  buildSeedByTeamSlug,
  presentAcademyListing,
} from "../academy/academy-directory.util";
import { academyJwtSecret, sanitizeAcademy } from "./academy-auth.util";

const BCRYPT_ROUNDS = 10;

export type AcademyJwtPayload = {
  sub: string;
  slug: string;
  username: string;
};

export type AcademyDirectoryEntry = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  city: string;
  seed: number | null;
  badges: string[];
};

@Injectable()
export class AcademyAuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService
  ) {}

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  verifyToken(token: string): AcademyJwtPayload {
    const payload = this.jwt.verify<AcademyJwtPayload>(token, {
      secret: academyJwtSecret(),
    });
    if (!payload?.sub || !payload.slug || !payload.username) {
      throw new UnauthorizedException("Invalid academy token");
    }
    return payload;
  }

  signToken(academy: { id: string; slug: string; loginUsername: string }) {
    const payload: AcademyJwtPayload = {
      sub: academy.id,
      slug: academy.slug,
      username: academy.loginUsername,
    };
    return this.jwt.sign(payload, {
      secret: academyJwtSecret(),
      expiresIn: "7d",
    });
  }

  async login(username: string, password: string) {
    const normalized = username.trim().toLowerCase();
    const academy = await this.prisma.academy.findFirst({
      where: { loginUsername: { equals: normalized, mode: "insensitive" } },
    });
    if (!academy?.passwordHash || !academy.loginUsername) {
      throw new UnauthorizedException("Invalid username or password");
    }
    const ok = await bcrypt.compare(password, academy.passwordHash);
    if (!ok) {
      throw new UnauthorizedException("Invalid username or password");
    }
    const token = this.signToken({
      id: academy.id,
      slug: academy.slug,
      loginUsername: academy.loginUsername,
    });
    return {
      token,
      academy: sanitizeAcademy(academy),
    };
  }

  async sessionForPayload(payload: AcademyJwtPayload) {
    const academy = await this.prisma.academy.findUnique({
      where: { id: payload.sub },
    });
    if (!academy) throw new UnauthorizedException("Academy not found");
    return { ok: true as const, academy: sanitizeAcademy(academy) };
  }

  async sessionFromToken(token: string) {
    return this.sessionForPayload(this.verifyToken(token));
  }

  async assertUniqueLoginUsername(username: string, excludeId?: string) {
    const normalized = username.trim().toLowerCase();
    const existing = await this.prisma.academy.findFirst({
      where: {
        loginUsername: { equals: normalized, mode: "insensitive" },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });
    if (existing) {
      throw new ConflictException("Login username is already in use");
    }
  }

  async directory(): Promise<AcademyDirectoryEntry[]> {
    const comp = await this.prisma.sbCompetition.findUnique({
      where: { slug: "ex-internationals-cup-2026" },
      include: { teams: true },
    });
    const seedByTeamSlug = buildSeedByTeamSlug(comp?.teams ?? []);

    const rows = await this.prisma.academy.findMany({
      where: { isPublished: true },
      orderBy: [{ name: "asc" }],
    });

    return rows.map((row) => {
      const listing = presentAcademyListing(row, seedByTeamSlug);
      const cityParts = [listing.city, listing.country].filter(Boolean);
      return {
        id: listing.id,
        name: listing.name,
        slug: listing.slug,
        logoUrl: listing.logoUrl,
        city: cityParts.length > 0 ? cityParts.join(", ") : "Lagos, Nigeria",
        seed: listing.seed,
        badges: listing.badges,
      };
    });
  }
}
