import { Inject, Injectable } from "@nestjs/common";
import { normalizePlayerName, playerLookupKey } from "@dtp/engines";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { resolveUniquePlayerSlug, slugifyPlayerName } from "../players/player-slug";
import { PlaceholderPlayerNameError, isPlaceholderName } from "../players/placeholder-names";
import { tidyPlayerName } from "../players/tidy-player-name";

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
    /* The shirt number comes off first. A timeline event stores its player as
       `No. 11 EBULU EMMANUEL`, and any path handing that label straight to this method
       created a player *named* `No. 11 EBULU EMMANUEL`, slug `no-11-ebulu-emmanuel`.
       The guard below refuses a bare `No. 11` and always has, but the pattern only
       matches a number on its own -- a number with a name after it sailed through, and
       the number then followed that person into their profile URL.

       Stripping rather than refusing, because the name behind the number is the
       person: `No. 11 EBULU EMMANUEL` is Ebulu Emmanuel and should resolve to him. A
       bare `No. 11` still reaches the guard untouched, since there is no name behind
       it to take. */
    /* `tidyPlayerName` rather than normalise-and-strip, which is what this did. It collapses
       whitespace and takes the shirt number off exactly as before, and then fixes the casing
       -- which nothing did on write, so `NWOSU HENRY` became a record that shouts, and only
       `db:repair:player-display-names` ever put it right. A repair that has to be re-run
       after every match is a gap, not a tool.

       It cannot change who this resolves to by accident: the dedupe key is lowercased, so
       casing is invisible to it. The one case that does move the key is a reviewed
       correction -- `Emmanuel Jac9b` to `Emmanuel Jacob` -- which is the point of having
       them, and the lookup below then finds the right record rather than making a second. */
    const normalized = tidyPlayerName(displayName);
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

  /**
   * Publish the drafts among these players, because a club registered them on its squad.
   *
   * `resolveOrCreatePlayer` makes a hidden draft because a name harvested from a match
   * label must not reach the public directory until somebody approves it. A registered
   * squad is that approval: the club put the boy on its sheet. Imported as drafts, the UFC
   * 2026 squads (240 of 278 players) all opened as "Profile verification in progress" from
   * the timeline and Stat Leaders, and nothing in the admin lists drafts for anyone to
   * approve, so they would have stayed hidden.
   *
   * Called with the squad rows' own transaction, after the rows are written: a rejected
   * import must leave reusable drafts behind, not public players on no squad.
   *
   * Only a draft is promoted. A player waiting on their own registration (`pending`), or
   * one an admin hid, is left exactly as found.
   */
  async publishRegisteredPlayers(
    playerIds: string[],
    client: Pick<Prisma.TransactionClient, "player"> = this.prisma
  ): Promise<number> {
    if (!playerIds.length) return 0;
    const { count } = await client.player.updateMany({
      where: { id: { in: playerIds }, registrationStatus: "draft" },
      data: { registrationStatus: "approved", isPublic: true },
    });
    return count;
  }
}
