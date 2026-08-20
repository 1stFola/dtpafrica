import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { resolveUniquePlayerSlug } from "../players/player-slug";
import {
  AcademyPlayerChangeRequestDto,
  AcademyProfileChangeRequestDto,
} from "./dto/academy-change-request.dto";

type AcademyChangeKind = "academy_profile" | "player_profile";

type MediaItemRow = {
  type?: string;
  title?: string;
  url?: string;
  [key: string]: unknown;
};

function clean(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanUrlArray(value?: string[] | null) {
  return Array.from(
    new Set((value ?? []).map((entry) => entry.trim()).filter(Boolean))
  ).slice(0, 12);
}

function asMediaItems(value: unknown): MediaItemRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is MediaItemRow => Boolean(item && typeof item === "object"));
}

function isManagedMediaType(type?: string) {
  const normalized = type?.toLowerCase();
  return (
    normalized === "video" ||
    normalized === "photo" ||
    normalized === "article" ||
    normalized === "publication" ||
    normalized === "press"
  );
}

function extractUrls(items: MediaItemRow[], typeMatcher: (type?: string) => boolean) {
  return items
    .filter((item) => typeMatcher(item.type) && typeof item.url === "string" && item.url.trim())
    .map((item) => String(item.url).trim());
}

function isYouTubeUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return hostname === "youtube.com" || hostname === "m.youtube.com" || hostname === "youtu.be";
  } catch {
    return false;
  }
}

function buildMediaItems(args: {
  videoUrl?: string | null;
  photoUrls?: string[];
  publicationUrls?: string[];
}): MediaItemRow[] {
  const items: MediaItemRow[] = [];
  if (args.videoUrl) {
    items.push({ type: "video", title: "Highlight video", url: args.videoUrl });
  }
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
      title: index === 0 ? "Publication" : `Publication ${index + 1}`,
      url,
    });
  });
  return items;
}

function splitDisplayName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? displayName.trim(),
    lastName: parts.slice(1).join(" ") || parts[0] || displayName.trim(),
  };
}

@Injectable()
export class AcademyChangeRequestsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async submitAcademyProfile(slugOrId: string, dto: AcademyProfileChangeRequestDto) {
    const academy = await this.findAcademy(slugOrId);
    const payload = this.normalizeAcademyPayload(dto);
    this.assertPayloadHasChanges(payload);
    return this.createRequest(academy.id, "academy_profile", payload);
  }

  async submitPlayerProfile(
    slugOrId: string,
    playerId: string,
    dto: AcademyPlayerChangeRequestDto
  ) {
    const academy = await this.findAcademy(slugOrId);
    const player = await this.prisma.player.findFirst({
      where: { id: playerId, academyId: academy.id },
      select: { id: true },
    });
    if (!player) {
      throw new NotFoundException("Player not found for this academy");
    }
    const payload = this.normalizePlayerPayload(dto);
    this.assertPayloadHasChanges(payload);
    return this.createRequest(academy.id, "player_profile", payload, player.id);
  }

  async list(status?: string) {
    return this.prisma.academyChangeRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ submittedAt: "desc" }],
      include: {
        academy: {
          select: { id: true, name: true, slug: true, logoUrl: true },
        },
        player: {
          select: { id: true, displayName: true, slug: true, playerPhotoUrl: true },
        },
      },
    });
  }

  async approve(id: string, adminNotes?: string) {
    const request = await this.getPending(id);
    const payload = this.payloadObject(request.payload);

    if (request.kind === "academy_profile") {
      const data: Prisma.AcademyUpdateInput = {};
      if ("description" in payload) data.description = this.optionalString(payload.description);
      if ("foundedYear" in payload) data.foundedYear = this.optionalNumber(payload.foundedYear);
      if ("city" in payload) data.city = this.optionalString(payload.city);
      if ("country" in payload) data.country = this.optionalString(payload.country);
      if ("logoUrl" in payload) data.logoUrl = this.optionalString(payload.logoUrl);
      if ("websiteUrl" in payload) data.websiteUrl = this.optionalString(payload.websiteUrl);
      await this.prisma.academy.update({
        where: { id: request.academyId },
        data,
      });
    } else if (request.kind === "player_profile") {
      if (!request.playerId) {
        throw new BadRequestException("Player request is missing playerId");
      }
      await this.applyPlayerPayload(request.playerId, payload);
    } else {
      throw new BadRequestException("Unsupported change request type");
    }

    return this.prisma.academyChangeRequest.update({
      where: { id },
      data: {
        status: "approved",
        adminNotes: clean(adminNotes),
        reviewedAt: new Date(),
      },
      include: { academy: true, player: true },
    });
  }

  async reject(id: string, adminNotes?: string) {
    await this.getPending(id);
    return this.prisma.academyChangeRequest.update({
      where: { id },
      data: {
        status: "rejected",
        adminNotes: clean(adminNotes),
        reviewedAt: new Date(),
      },
      include: { academy: true, player: true },
    });
  }

  private async findAcademy(slugOrId: string) {
    const academy = await this.prisma.academy.findFirst({
      where: {
        OR: [{ slug: slugOrId }, { id: slugOrId }],
        isPublished: true,
      },
      select: { id: true },
    });
    if (!academy) throw new NotFoundException("Academy not found");
    return academy;
  }

  private createRequest(
    academyId: string,
    kind: AcademyChangeKind,
    payload: Record<string, unknown>,
    playerId?: string
  ) {
    return this.prisma.academyChangeRequest.create({
      data: {
        academyId,
        playerId,
        kind,
        payload: payload as Prisma.InputJsonValue,
      },
      include: {
        academy: { select: { id: true, name: true, slug: true, logoUrl: true } },
        player: { select: { id: true, displayName: true, slug: true, playerPhotoUrl: true } },
      },
    });
  }

  private normalizeAcademyPayload(dto: AcademyProfileChangeRequestDto) {
    return {
      ...(dto.description !== undefined ? { description: clean(dto.description) } : {}),
      ...(dto.foundedYear !== undefined ? { foundedYear: dto.foundedYear } : {}),
      ...(dto.city !== undefined ? { city: clean(dto.city) } : {}),
      ...(dto.country !== undefined ? { country: clean(dto.country) } : {}),
      ...(dto.logoUrl !== undefined ? { logoUrl: clean(dto.logoUrl) } : {}),
      ...(dto.websiteUrl !== undefined ? { websiteUrl: clean(dto.websiteUrl) } : {}),
    };
  }

  private normalizePlayerPayload(dto: AcademyPlayerChangeRequestDto) {
    const videoUrl = clean(dto.videoUrl);
    if (videoUrl && !isYouTubeUrl(videoUrl)) {
      throw new BadRequestException("Video Highlights URL must be a YouTube link.");
    }
    return {
      ...(dto.displayName !== undefined ? { displayName: clean(dto.displayName) } : {}),
      ...(dto.photoUrls !== undefined ? { photoUrls: cleanUrlArray(dto.photoUrls) } : {}),
      ...(dto.videoUrl !== undefined ? { videoUrl } : {}),
      ...(dto.publicationUrls !== undefined
        ? { publicationUrls: cleanUrlArray(dto.publicationUrls) }
        : {}),
    };
  }

  private assertPayloadHasChanges(payload: Record<string, unknown>) {
    if (Object.keys(payload).length === 0) {
      throw new BadRequestException("No changes submitted for review.");
    }
  }

  private async getPending(id: string) {
    const request = await this.prisma.academyChangeRequest.findUnique({
      where: { id },
    });
    if (!request) throw new NotFoundException("Change request not found");
    if (request.status !== "pending") {
      throw new BadRequestException("This change request has already been reviewed.");
    }
    return request;
  }

  private payloadObject(value: Prisma.JsonValue): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Invalid change request payload");
    }
    return value as Record<string, unknown>;
  }

  private optionalString(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  private optionalNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  private async applyPlayerPayload(playerId: string, payload: Record<string, unknown>) {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: {
        id: true,
        displayName: true,
        videoUrl: true,
        playerPhotoUrl: true,
        mediaItems: true,
      },
    });
    if (!player) throw new NotFoundException("Player not found");

    const data: Prisma.PlayerUpdateInput = {};
    const displayName = this.optionalString(payload.displayName);
    if (payload.displayName !== undefined && displayName) {
      const names = splitDisplayName(displayName);
      data.displayName = displayName;
      data.firstName = names.firstName;
      data.lastName = names.lastName;
      data.slug = await resolveUniquePlayerSlug(this.prisma, displayName, player.id);
    }

    const videoUrl = this.optionalString(payload.videoUrl);
    const photoUrls = Array.isArray(payload.photoUrls)
      ? payload.photoUrls.map(String).map((url) => url.trim()).filter(Boolean)
      : undefined;
    const publicationUrls = Array.isArray(payload.publicationUrls)
      ? payload.publicationUrls.map(String).map((url) => url.trim()).filter(Boolean)
      : undefined;

    if (payload.videoUrl !== undefined) {
      data.videoUrl = videoUrl;
    }

    if (
      payload.videoUrl !== undefined ||
      payload.photoUrls !== undefined ||
      payload.publicationUrls !== undefined
    ) {
      const preserved = asMediaItems(player.mediaItems).filter(
        (item) => !isManagedMediaType(item.type)
      );
      const existingMedia = asMediaItems(player.mediaItems);
      const existingVideoUrls = extractUrls(
        existingMedia,
        (type) => type?.toLowerCase() === "video"
      );
      const existingPhotoUrls = extractUrls(
        existingMedia,
        (type) => type?.toLowerCase() === "photo"
      );
      const existingPublicationUrls = extractUrls(existingMedia, (type) => {
        const normalized = type?.toLowerCase();
        return normalized === "article" || normalized === "publication" || normalized === "press";
      });
      const nextMedia = [
        ...preserved,
        ...buildMediaItems({
          videoUrl:
            payload.videoUrl !== undefined
              ? videoUrl
              : existingVideoUrls[0] ?? player.videoUrl,
          photoUrls:
            photoUrls ??
            (existingPhotoUrls.length
              ? existingPhotoUrls
              : player.playerPhotoUrl
                ? [player.playerPhotoUrl]
                : []),
          publicationUrls: publicationUrls ?? existingPublicationUrls,
        }),
      ];
      data.mediaItems =
        nextMedia.length > 0 ? (nextMedia as Prisma.InputJsonValue) : Prisma.JsonNull;
      if (photoUrls !== undefined) {
        data.playerPhotoUrl = photoUrls[0] ?? null;
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException("No applicable player changes found.");
    }
    await this.prisma.player.update({ where: { id: player.id }, data });
  }
}
