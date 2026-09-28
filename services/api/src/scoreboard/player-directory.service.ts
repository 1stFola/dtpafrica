import { Inject, Injectable } from "@nestjs/common";
import { normalizePlayerName, playerLookupKey } from "@dtp/engines";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { resolveUniquePlayerSlug, slugifyPlayerName } from "../players/player-slug";
import { PlaceholderPlayerNameError, isPlaceholderName } from "../players/placeholder-names";

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
    /* `Unknown`, `Player`, `No. 9` describe what was known when the sheet was
       filled in, not who was on the pitch. Made into player records they collect
       goals and climb the scoring charts -- on live, `Player` is second in the Ex
       Internationals Cup. The timeline sync has always refused them; this path
       never did, which is where those records came from. */
    if (isPlaceholderName(normalized)) {
      throw new PlaceholderPlayerNameError(displayName);
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

    const slugBase = slugifyPlayerName(normalized);
    const bySlug = await this.prisma.player.findUnique({
      where: { slug: slugBase },
      select: { id: true, displayName: true, normalizedName: true },
    });
    if (bySlug && playerLookupKey(bySlug.displayName) === key) {
      if (!bySlug.normalizedName) {
        return this.prisma.player.update({
          where: { id: bySlug.id },
          data: { normalizedName: key },
        });
      }
      return this.prisma.player.findUniqueOrThrow({ where: { id: bySlug.id } });
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
