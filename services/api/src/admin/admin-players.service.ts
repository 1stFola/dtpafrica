import { positionFullFromAbbreviation } from "@dtp/engines";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { normalizePlayingPhilosophiesInput } from "../players/player-home-profile";
import { resolveUniquePlayerSlug, previewPlayerSlug } from "../players/player-slug";
import { UpdatePlayerAdminDto } from "./dto/update-player-admin.dto";

@Injectable()
export class AdminPlayersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list(query: { q?: string; status?: string; limit?: number }) {
    const where: {
      OR?: { displayName?: { contains: string; mode: "insensitive" } }[];
      registrationStatus?: string;
    } = {};

    if (query.q) {
      where.OR = [{ displayName: { contains: query.q, mode: "insensitive" } }];
    }
    if (query.status) {
      where.registrationStatus = query.status;
    }

    return this.prisma.player.findMany({
      where,
      take: Math.min(query.limit ?? 100, 200),
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        displayName: true,
        positionPrimary: true,
        positionFull: true,
        playingPhilosophies: true,
        slug: true,
        isFeatured: true,
        isPublic: true,
        registrationStatus: true,
        nationality: true,
        age: true,
        overallRating: true,
        offensiveRating: true,
        defensiveRating: true,
        updatedAt: true,
        createdAt: true,
      },
    });
  }

  previewSlug(displayName: string, excludeId?: string) {
    if (!displayName?.trim()) {
      return { slug: "", available: false };
    }
    return previewPlayerSlug(this.prisma, displayName.trim(), excludeId);
  }

  async update(id: string, dto: UpdatePlayerAdminDto) {
    const existing = await this.prisma.player.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Player not found");

    let slug = dto.slug;
    if (slug === undefined && dto.displayName && dto.displayName !== existing.displayName) {
      slug = await resolveUniquePlayerSlug(this.prisma, dto.displayName, id);
    } else if (!existing.slug && !slug) {
      slug = await resolveUniquePlayerSlug(this.prisma, existing.displayName, id);
    }

    const positionPrimary =
      dto.positionPrimary !== undefined
        ? dto.positionPrimary.trim().toUpperCase()
        : undefined;
    const positionFull =
      dto.positionFull !== undefined
        ? dto.positionFull.trim() || null
        : positionPrimary !== undefined
          ? positionFullFromAbbreviation(positionPrimary)
          : undefined;
    const playingPhilosophies = normalizePlayingPhilosophiesInput(
      dto.playingPhilosophies
    );

    return this.prisma.player.update({
      where: { id },
      data: {
        isFeatured: dto.isFeatured,
        isPublic: dto.isPublic,
        registrationStatus: dto.registrationStatus,
        biography: dto.biography,
        videoUrl: dto.videoUrl,
        displayName: dto.displayName,
        positionPrimary,
        positionFull,
        playingPhilosophies:
          playingPhilosophies === undefined
            ? undefined
            : playingPhilosophies.length > 0
              ? (playingPhilosophies as Prisma.InputJsonValue)
              : Prisma.JsonNull,
        slug,
      },
    });
  }
}
