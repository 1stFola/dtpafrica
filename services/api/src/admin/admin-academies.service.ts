import { Inject, Injectable, NotFoundException } from "@nestjs/common";
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

@Injectable()
export class AdminAcademiesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.academy.findMany({
      orderBy: [{ isPublished: "desc" }, { name: "asc" }],
    });
  }

  async get(id: string) {
    const academy = await this.prisma.academy.findUnique({ where: { id } });
    if (!academy) throw new NotFoundException("Academy not found");
    return academy;
  }

  create(dto: UpsertAcademyDto) {
    return this.prisma.academy.create({
      data: {
        name: dto.name.trim(),
        slug: clean(dto.slug) ?? slugify(dto.name),
        city: clean(dto.city),
        country: clean(dto.country),
        description: clean(dto.description),
        logoUrl: clean(dto.logoUrl),
        websiteUrl: clean(dto.websiteUrl),
        isPublished: dto.isPublished ?? true,
      },
    });
  }

  async update(id: string, dto: UpsertAcademyDto) {
    const existing = await this.get(id);
    return this.prisma.academy.update({
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
      },
    });
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.academy.delete({ where: { id } });
    return { ok: true };
  }
}
