import {
  FORMATION_IDS,
  FORMATIONS,
  PHILOSOPHY_IDS,
  comparePlayers,
  computePhilosophyFit,
  generateStrongXi,
  rankPlayersForPhilosophy,
  type FormationId,
  type PhilosophyId,
} from "@dtp/engines";
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PlayerWithSip, toPhilosophyFitPlayer } from "./scouting.mapper";

@Injectable()
export class ScoutingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  meta() {
    return {
      formations: FORMATION_IDS,
      philosophies: PHILOSOPHY_IDS,
    };
  }

  private parseFormation(f: string): FormationId {
    if ((FORMATION_IDS as string[]).includes(f)) return f as FormationId;
    throw new BadRequestException(`Invalid formation: ${f}`);
  }

  private parsePhilosophy(p: string): PhilosophyId {
    if ((PHILOSOPHY_IDS as string[]).includes(p)) return p as PhilosophyId;
    throw new BadRequestException(`Invalid philosophy: ${p}`);
  }

  private async loadSipPlayers(): Promise<PlayerWithSip[]> {
    return this.prisma.player.findMany({
      where: { tacticalScores: { isNot: null } },
      include: { tacticalScores: true, positionFit: true },
    });
  }

  async tacticalSearch(query: {
    position?: string;
    ageGroup?: string;
    minGegenpress?: number;
    limit?: number;
  }) {
    const where: Prisma.PlayerWhereInput = {
      tacticalScores: { isNot: null },
    };
    if (query.position) {
      where.positionPrimary = query.position;
    }
    if (query.ageGroup) {
      where.ageGroup = query.ageGroup;
    }
    if (query.minGegenpress != null) {
      where.tacticalScores = {
        is: { gegenpressScore: { gte: query.minGegenpress } },
      };
    }

    return this.prisma.player.findMany({
      where,
      take: Math.min(query.limit ?? 25, 100),
      orderBy: { overallRating: "desc" },
      include: { tacticalScores: true, positionFit: true },
    });
  }

  async philosophyFit(query: {
    formation: string;
    philosophy: string;
    playerId?: string;
    slotId?: string;
    limit?: number;
  }) {
    const formation = this.parseFormation(query.formation);
    const philosophy = this.parsePhilosophy(query.philosophy);

    if (query.playerId) {
      const row = await this.prisma.player.findUnique({
        where: { id: query.playerId },
        include: { tacticalScores: true, positionFit: true },
      });
      if (!row) throw new NotFoundException("Player not found");
      const p = toPhilosophyFitPlayer(row);
      if (!p) throw new BadRequestException("Player has no tactical scores");
      const slots = FORMATIONS[formation];
      const slot = query.slotId ? slots.find((s) => s.id === query.slotId) : undefined;
      const fit = computePhilosophyFit(p, philosophy, formation, slot);
      await this.persistPhilosophyFit(fit);
      return { formation, philosophy, rankings: [fit] };
    }

    const rows = await this.loadSipPlayers();
    const players = rows
      .map(toPhilosophyFitPlayer)
      .filter((p): p is NonNullable<typeof p> => p != null);

    const rankings = rankPlayersForPhilosophy(
      players,
      formation,
      philosophy,
      query.slotId
    ).slice(0, Math.min(query.limit ?? 25, 100));

    for (const fit of rankings.slice(0, 10)) {
      await this.persistPhilosophyFit(fit);
    }

    return { formation, philosophy, slotId: query.slotId ?? null, rankings };
  }

  async strongXi(formationRaw: string, philosophyRaw: string) {
    const formation = this.parseFormation(formationRaw);
    const philosophy = this.parsePhilosophy(philosophyRaw);
    const rows = await this.loadSipPlayers();
    const players = rows
      .map(toPhilosophyFitPlayer)
      .filter((p): p is NonNullable<typeof p> => p != null);

    const result = generateStrongXi(players, formation, philosophy);

    for (const pick of result.xi) {
      await this.persistPhilosophyFit(pick.fit);
    }

    return result;
  }

  async playerComparison(idsRaw: string) {
    const ids = idsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      throw new BadRequestException("ids query required (comma-separated, max 4)");
    }
    if (ids.length > 4) {
      throw new BadRequestException("Maximum 4 players");
    }

    const rows = await this.prisma.player.findMany({
      where: { id: { in: ids }, tacticalScores: { isNot: null } },
      include: { tacticalScores: true, positionFit: true },
    });

    if (rows.length !== ids.length) {
      throw new NotFoundException("One or more players not found or missing tactical scores");
    }

    const players = rows
      .map(toPhilosophyFitPlayer)
      .filter((p): p is NonNullable<typeof p> => p != null);

    return comparePlayers(players);
  }

  private async persistPhilosophyFit(fit: {
    playerId: string;
    formation: string;
    philosophy: string;
    positionSlot?: string;
    philosophyFitScore: number;
    positionFitScore: number;
    confidenceScore: number;
  }) {
    const existing = await this.prisma.philosophyFitProfile.findFirst({
      where: {
        playerId: fit.playerId,
        formation: fit.formation,
        philosophy: fit.philosophy,
        positionSlot: fit.positionSlot ?? null,
      },
    });
    const data = {
      philosophyFitScore: fit.philosophyFitScore,
      positionFitScore: fit.positionFitScore,
      confidenceScore: fit.confidenceScore,
    };
    if (existing) {
      await this.prisma.philosophyFitProfile.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await this.prisma.philosophyFitProfile.create({
        data: {
          playerId: fit.playerId,
          formation: fit.formation,
          philosophy: fit.philosophy,
          positionSlot: fit.positionSlot ?? null,
          ...data,
        },
      });
    }
  }
}
