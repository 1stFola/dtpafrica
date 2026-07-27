import { positionFullFromAbbreviation } from "@dtp/engines";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { normalizePlayingPhilosophiesInput } from "../players/player-home-profile";
import { resolveUniquePlayerSlug, previewPlayerSlug } from "../players/player-slug";
import { BulkUpdatePlayersDto } from "./dto/bulk-update-players.dto";
import { QuickEditPlayerDto } from "./dto/quick-edit-player.dto";
import { UpdatePlayerAdminDto } from "./dto/update-player-admin.dto";

type MediaItemRow = {
  type?: string;
  title?: string;
  url?: string;
  [key: string]: unknown;
};

function parseUrlList(value?: string | null): string[] {
  if (!value?.trim()) return [];
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeUrlArray(value?: string[] | null): string[] {
  if (!value?.length) return [];
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function resolveUrlList(
  arrayValue?: string[] | null,
  stringValue?: string | null
): string[] {
  const fromArray = normalizeUrlArray(arrayValue);
  if (fromArray.length > 0) return fromArray;
  return parseUrlList(stringValue);
}

function asMediaItems(value: unknown): MediaItemRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MediaItemRow => Boolean(item && typeof item === "object"));
}

function isPublicationType(type?: string): boolean {
  if (!type) return false;
  const normalized = type.toLowerCase();
  return normalized === "article" || normalized === "publication" || normalized === "press";
}

function buildQuickEditMediaItems(args: {
  videoUrls?: string[];
  photoUrls?: string[];
  publicationUrls?: string[];
}): MediaItemRow[] {
  const items: MediaItemRow[] = [];

  (args.videoUrls ?? []).forEach((url, index) => {
    items.push({
      type: "video",
      title: index === 0 ? "Highlight video" : `Video ${index + 1}`,
      url,
    });
  });

  (args.photoUrls ?? []).forEach((url, index) => {
    items.push({
      type: "photo",
      title: index === 0 ? "Profile photo" : `Photo ${index + 1}`,
      url,
    });
  });

  (args.publicationUrls ?? []).forEach((url, index) => {
    items.push({
      type: "article",
      title: index === 0 ? "Press" : `Publication ${index + 1}`,
      url,
    });
  });

  return items;
}

function extractVideoUrls(items: MediaItemRow[], playerVideoUrl?: string | null): string[] {
  const urls = items
    .filter((item) => item.type === "video" && item.url)
    .map((item) => String(item.url));
  if (urls.length === 0 && playerVideoUrl?.trim()) {
    return [playerVideoUrl.trim()];
  }
  return urls;
}

function extractPhotoUrls(items: MediaItemRow[], playerPhotoUrl?: string | null): string[] {
  const urls = items
    .filter((item) => item.type === "photo" && item.url)
    .map((item) => String(item.url));
  if (urls.length === 0 && playerPhotoUrl?.trim()) {
    return [playerPhotoUrl.trim()];
  }
  return urls;
}

function extractPublicationUrls(items: MediaItemRow[]): string[] {
  return items
    .filter((item) => isPublicationType(item.type) && item.url)
    .map((item) => String(item.url));
}

function readEstimatedPlayerValue(benchmarkMetadata: unknown): string | null {
  if (!benchmarkMetadata || typeof benchmarkMetadata !== "object") return null;
  const value = (benchmarkMetadata as Record<string, unknown>).estimatedPlayerValue;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

@Injectable()
export class AdminPlayersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: {
    id?: string;
    q?: string;
    status?: string;
    academyId?: string;
    position?: string;
    featured?: string;
    hasMedia?: string;
    sort?: string;
    sortDir?: string;
    limit?: number;
    offset?: number;
  }) {
    const and: Prisma.PlayerWhereInput[] = [];

    if (query.id?.trim()) {
      and.push({ id: query.id.trim() });
    }

    if (query.q?.trim()) {
      const term = query.q.trim();
      and.push({
        OR: [
          { displayName: { contains: term, mode: "insensitive" } },
          { slug: { contains: term, mode: "insensitive" } },
        ],
      });
    }
    if (query.status) {
      and.push({ registrationStatus: query.status });
    }
    if (query.academyId) {
      if (query.academyId === "none") {
        and.push({ academyId: null });
      } else {
        and.push({ academyId: query.academyId });
      }
    }
    if (query.position?.trim()) {
      and.push({ positionPrimary: query.position.trim().toUpperCase() });
    }
    if (query.featured === "true") {
      and.push({ isFeatured: true });
    } else if (query.featured === "false") {
      and.push({ isFeatured: false });
    }

    const hasMedia = query.hasMedia?.trim();
    if (hasMedia === "video") {
      and.push({ videoUrl: { not: null } });
    } else if (hasMedia === "photo") {
      and.push({ playerPhotoUrl: { not: null } });
    } else if (hasMedia === "any") {
      and.push({
        OR: [{ videoUrl: { not: null } }, { playerPhotoUrl: { not: null } }],
      });
    } else if (hasMedia === "none") {
      and.push({ videoUrl: null, playerPhotoUrl: null });
    }

    const where: Prisma.PlayerWhereInput = and.length > 0 ? { AND: and } : {};

    const sortDir = query.sortDir === "asc" ? "asc" : "desc";
    let orderBy: Prisma.PlayerOrderByWithRelationInput = { updatedAt: sortDir };
    if (query.sort === "name") {
      orderBy = { displayName: sortDir };
    } else if (query.sort === "rating") {
      orderBy = { overallRating: sortDir };
    } else if (query.sort === "date") {
      orderBy = { createdAt: sortDir };
    }

    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);

    const [total, items] = await this.prisma.$transaction([
      this.prisma.player.count({ where }),
      this.prisma.player.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy,
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
          academyId: true,
          videoUrl: true,
          playerPhotoUrl: true,
          updatedAt: true,
          createdAt: true,
          academy: { select: { id: true, name: true, slug: true } },
        },
      }),
    ]);

    return { items, total, offset, limit };
  }

  async bulkUpdate(dto: BulkUpdatePlayersDto) {
    const ids = [...new Set(dto.ids.filter(Boolean))];
    if (ids.length === 0) {
      throw new BadRequestException("At least one player id is required");
    }

    if (dto.delete) {
      if (dto.updates && Object.keys(dto.updates).length > 0) {
        throw new BadRequestException("Delete cannot be combined with bulk updates");
      }
      const result = await this.prisma.player.deleteMany({
        where: { id: { in: ids } },
      });
      return { deleted: result.count, ids };
    }

    const updates = dto.updates ?? {};
    const data: Prisma.PlayerUncheckedUpdateManyInput = {};

    if (updates.academyId !== undefined) {
      if (updates.academyId === null || updates.academyId === "") {
        data.academyId = null;
      } else {
        const academy = await this.prisma.academy.findUnique({
          where: { id: updates.academyId },
          select: { id: true },
        });
        if (!academy) throw new NotFoundException("Academy not found");
        data.academyId = academy.id;
      }
    }

    if (updates.isFeatured !== undefined) {
      data.isFeatured = updates.isFeatured;
    }

    if (updates.positionPrimary !== undefined) {
      const positionPrimary = updates.positionPrimary.trim().toUpperCase();
      if (!positionPrimary) {
        throw new BadRequestException("positionPrimary cannot be empty");
      }
      data.positionPrimary = positionPrimary;
      data.positionFull = positionFullFromAbbreviation(positionPrimary);
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException("No updates provided");
    }

    const result = await this.prisma.player.updateMany({
      where: { id: { in: ids } },
      data,
    });

    return { updated: result.count, ids };
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

  async getQuickEditContext(id: string) {
    const player = await this.prisma.player.findUnique({
      where: { id },
      select: {
        id: true,
        displayName: true,
        slug: true,
        heightCm: true,
        dominantFoot: true,
        positionPrimary: true,
        videoUrl: true,
        playerPhotoUrl: true,
        mediaItems: true,
        benchmarkMetadata: true,
      },
    });
    if (!player) throw new NotFoundException("Player not found");

    const mediaItems = asMediaItems(player.mediaItems);

    const videoUrls = extractVideoUrls(mediaItems, player.videoUrl);
    const photoUrls = extractPhotoUrls(mediaItems, player.playerPhotoUrl);
    const publicationUrls = extractPublicationUrls(mediaItems);

    return {
      id: player.id,
      displayName: player.displayName,
      slug: player.slug,
      heightCm: player.heightCm,
      preferredFoot: player.dominantFoot,
      positionPrimary: player.positionPrimary,
      estimatedPlayerValue: readEstimatedPlayerValue(player.benchmarkMetadata),
      videoUrls,
      photoUrls,
      publicationUrls,
    };
  }

  async quickEdit(id: string, dto: QuickEditPlayerDto) {
    const existing = await this.prisma.player.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Player not found");

    const data: Prisma.PlayerUpdateInput = {};
    const existingMedia = asMediaItems(existing.mediaItems);
    const preservedMedia = existingMedia.filter((item) => {
      if (item.type === "video" || item.type === "photo") return false;
      return !isPublicationType(item.type);
    });

    if (dto.heightCm !== undefined) {
      data.heightCm = dto.heightCm;
    }

    if (dto.preferredFoot !== undefined) {
      data.dominantFoot = dto.preferredFoot.trim() || null;
    }

    if (dto.positionPrimary !== undefined) {
      const positionPrimary = dto.positionPrimary.trim().toUpperCase();
      data.positionPrimary = positionPrimary;
      data.positionFull = positionFullFromAbbreviation(positionPrimary);
    }

    if (dto.estimatedPlayerValue !== undefined) {
      const benchmarkMetadata =
        existing.benchmarkMetadata && typeof existing.benchmarkMetadata === "object"
          ? { ...(existing.benchmarkMetadata as Record<string, unknown>) }
          : {};
      const trimmed = dto.estimatedPlayerValue.trim();
      if (trimmed) {
        benchmarkMetadata.estimatedPlayerValue = trimmed;
      } else {
        delete benchmarkMetadata.estimatedPlayerValue;
      }
      data.benchmarkMetadata =
        Object.keys(benchmarkMetadata).length > 0
          ? (benchmarkMetadata as Prisma.InputJsonValue)
          : Prisma.JsonNull;
    }

    const touchesMedia =
      dto.videoUrl !== undefined ||
      dto.videoUrls !== undefined ||
      dto.photosUrl !== undefined ||
      dto.photoUrls !== undefined ||
      dto.publicationsUrl !== undefined ||
      dto.publicationUrls !== undefined;

    const nextVideoUrls = resolveUrlList(
      dto.videoUrls,
      dto.videoUrl !== undefined ? dto.videoUrl : undefined
    );
    const existingVideoUrls = extractVideoUrls(existingMedia, existing.videoUrl);
    const resolvedVideoUrls =
      dto.videoUrl !== undefined || dto.videoUrls !== undefined
        ? nextVideoUrls
        : existingVideoUrls;

    if (dto.videoUrl !== undefined || dto.videoUrls !== undefined) {
      data.videoUrl = resolvedVideoUrls[0] ?? null;
    }

    if (touchesMedia) {
      const mergedMedia = buildQuickEditMediaItems({
        videoUrls: resolvedVideoUrls,
        photoUrls:
          dto.photoUrls !== undefined || dto.photosUrl !== undefined
            ? resolveUrlList(dto.photoUrls, dto.photosUrl)
            : extractPhotoUrls(existingMedia, existing.playerPhotoUrl),
        publicationUrls:
          dto.publicationUrls !== undefined || dto.publicationsUrl !== undefined
            ? resolveUrlList(dto.publicationUrls, dto.publicationsUrl)
            : extractPublicationUrls(existingMedia),
      });
      const nextMedia = [...preservedMedia, ...mergedMedia];
      data.mediaItems =
        nextMedia.length > 0 ? (nextMedia as Prisma.InputJsonValue) : Prisma.JsonNull;

      const firstPhoto = mergedMedia.find((item) => item.type === "photo" && item.url);
      if (firstPhoto?.url) {
        data.playerPhotoUrl = String(firstPhoto.url);
      } else if (
        (dto.photosUrl !== undefined || dto.photoUrls !== undefined) &&
        resolveUrlList(dto.photoUrls, dto.photosUrl).length === 0
      ) {
        data.playerPhotoUrl = null;
      }
    }

    const updated = await this.prisma.player.update({
      where: { id },
      data,
      select: {
        id: true,
        displayName: true,
        slug: true,
        heightCm: true,
        dominantFoot: true,
        positionPrimary: true,
        positionFull: true,
        videoUrl: true,
        playerPhotoUrl: true,
        mediaItems: true,
        benchmarkMetadata: true,
        updatedAt: true,
      },
    });

    const mediaItems = asMediaItems(updated.mediaItems);

    const videoUrls = extractVideoUrls(mediaItems, updated.videoUrl);
    const photoUrls = extractPhotoUrls(mediaItems, updated.playerPhotoUrl);
    const publicationUrls = extractPublicationUrls(mediaItems);

    return {
      id: updated.id,
      displayName: updated.displayName,
      slug: updated.slug,
      heightCm: updated.heightCm,
      preferredFoot: updated.dominantFoot,
      positionPrimary: updated.positionPrimary,
      positionFull: updated.positionFull,
      estimatedPlayerValue: readEstimatedPlayerValue(updated.benchmarkMetadata),
      videoUrls,
      photoUrls,
      publicationUrls,
      updatedAt: updated.updatedAt,
    };
  }
}
