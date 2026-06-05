import { Inject, Injectable } from "@nestjs/common";
import { normalizePlayerName, playerLookupKey } from "@dtp/engines";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { resolveUniquePlayerSlug } from "../players/player-slug";

function splitDisplayName(displayName: string) {
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: parts[0] };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

@Injectable()
export class PlayerDirectoryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Resolve master Player by normalized name; create draft shell if missing. */
  async resolveOrCreatePlayer(displayName: string, position?: string | null) {
    const normalized = normalizePlayerName(displayName);
    const key = playerLookupKey(normalized);
    if (!key) {
      throw new Error("Player name is required");
    }

    const byKey = await this.prisma.player.findUnique({
      where: { normalizedName: key },
    });
    if (byKey) return byKey;

    const byDisplay = await this.prisma.player.findFirst({
      where: { displayName: { equals: normalized, mode: "insensitive" } },
      select: { id: true, normalizedName: true },
    });
    if (byDisplay) {
      if (!byDisplay.normalizedName) {
        return this.prisma.player.update({
          where: { id: byDisplay.id },
          data: { normalizedName: key },
        });
      }
      return this.prisma.player.findUniqueOrThrow({ where: { id: byDisplay.id } });
    }

    const { firstName, lastName } = splitDisplayName(normalized);
    const slug = await resolveUniquePlayerSlug(this.prisma, normalized);

    try {
      return await this.prisma.player.create({
        data: {
          firstName,
          lastName,
          displayName: normalized,
          normalizedName: key,
          slug,
          positionPrimary: position?.trim() || "MF",
          registrationStatus: "draft",
          isPublic: false,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const retry = await this.prisma.player.findUnique({ where: { normalizedName: key } });
        if (retry) return retry;
      }
      throw e;
    }
  }
}
