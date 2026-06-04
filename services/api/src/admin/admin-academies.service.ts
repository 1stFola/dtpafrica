import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AcademyAuthService } from "../academy-auth/academy-auth.service";
import { sanitizeAcademy } from "../academy-auth/academy-auth.util";
import { PrismaService } from "../prisma/prisma.service";
import { UpsertAcademyDto } from "./dto/upsert-academy.dto";

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "academy"
  );
}

function clean(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanUsername(value?: string) {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

@Injectable()
export class AdminAcademiesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AcademyAuthService) private readonly academyAuth: AcademyAuthService
  ) {}

  async list() {
    const rows = await this.prisma.academy.findMany({
      orderBy: [{ isPublished: "desc" }, { name: "asc" }],
    });
    return rows.map(sanitizeAcademy);
  }

  async get(id: string) {
    const academy = await this.prisma.academy.findUnique({ where: { id } });
    if (!academy) throw new NotFoundException("Academy not found");
    return sanitizeAcademy(academy);
  }

  private async credentialData(dto: UpsertAcademyDto, excludeId?: string) {
    const loginUsername = cleanUsername(dto.loginUsername);
    if (loginUsername) {
      await this.academyAuth.assertUniqueLoginUsername(loginUsername, excludeId);
    }
    const password = dto.password?.trim();
    const passwordHash =
      password && password.length > 0
        ? await this.academyAuth.hashPassword(password)
        : undefined;
    return { loginUsername, passwordHash };
  }

  async create(dto: UpsertAcademyDto) {
    const { loginUsername, passwordHash } = await this.credentialData(dto);
    const row = await this.prisma.academy.create({
      data: {
        name: dto.name.trim(),
        slug: clean(dto.slug) ?? slugify(dto.name),
        city: clean(dto.city),
        country: clean(dto.country),
        description: clean(dto.description),
        logoUrl: clean(dto.logoUrl),
        websiteUrl: clean(dto.websiteUrl),
        isPublished: dto.isPublished ?? true,
        ...(loginUsername != null ? { loginUsername } : {}),
        ...(passwordHash != null ? { passwordHash } : {}),
      },
    });
    return sanitizeAcademy(row);
  }

  async update(id: string, dto: UpsertAcademyDto) {
    const existing = await this.prisma.academy.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Academy not found");
    const { loginUsername, passwordHash } = await this.credentialData(dto, id);
    const row = await this.prisma.academy.update({
      where: { id },
      data: {
        name: dto.name.trim(),
        slug: clean(dto.slug) ?? (dto.name !== existing.name ? slugify(dto.name) : existing.slug),
        city: clean(dto.city),
        country: clean(dto.country),
        description: clean(dto.description),
        logoUrl: clean(dto.logoUrl),
        websiteUrl: clean(dto.websiteUrl),
        isPublished: dto.isPublished ?? existing.isPublished,
        ...(dto.loginUsername !== undefined
          ? { loginUsername: loginUsername ?? null }
          : {}),
        ...(passwordHash != null ? { passwordHash } : {}),
      },
    });
    return sanitizeAcademy(row);
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.academy.delete({ where: { id } });
    return { ok: true };
  }
}
