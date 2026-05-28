import {
  computePhilosophyFit,
  computePositionFitScore,
  FORMATIONS,
  PHILOSOPHY_IDS,
  type FormationId,
  type PhilosophyId,
} from "@dtp/engines";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { MvceService } from "../mvce/mvce.service";
import { SipRecalculationService } from "../sip/sip-recalculation.service";
import {
  toPhilosophyFitPlayer,
  type PlayerWithSip,
} from "../scouting/scouting.mapper";

const PROFILE_FORMATION: FormationId = "4-2-3-1";
const PHILOSOPHY_FIT_LIMIT = 5;

@Injectable()
export class PlayerProfileIntelligenceService {
  private readonly logger = new Logger(PlayerProfileIntelligenceService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SipRecalculationService) private readonly sipRecalc: SipRecalculationService,
    @Inject(MvceService) private readonly mvce: MvceService
  ) {}

  /** Run SIP / philosophy-fit / MVCE engines when public profile data is missing. */
  async ensureForPublicProfile(playerId: string): Promise<void> {
    const snapshot = await this.prisma.player.findUnique({
      where: { id: playerId, isPublic: true },
      select: {
        id: true,
        _count: {
          select: {
            matchMetrics: true,
            philosophyFitRows: true,
            mvceValuations: true,
          },
        },
        tacticalScores: { select: { playerId: true } },
      },
    });
    if (!snapshot) return;

    if (snapshot._count.matchMetrics > 0 && !snapshot.tacticalScores) {
      try {
        await this.sipRecalc.recalculatePlayer(playerId);
      } catch (error) {
        this.logger.warn(
          `SIP recalculation skipped for ${playerId}: ${error instanceof Error ? error.message : error}`
        );
      }
    }

    const hasTactical = await this.prisma.tacticalScores.findUnique({
      where: { playerId },
      select: { playerId: true },
    });

    if (hasTactical && snapshot._count.philosophyFitRows === 0) {
      try {
        await this.ensurePhilosophyFits(playerId);
      } catch (error) {
        this.logger.warn(
          `Philosophy fit generation skipped for ${playerId}: ${error instanceof Error ? error.message : error}`
        );
      }
    }

    if (snapshot._count.mvceValuations === 0) {
      try {
        await this.mvce.generate({ playerId });
      } catch (error) {
        this.logger.warn(
          `MVCE generation skipped for ${playerId}: ${error instanceof Error ? error.message : error}`
        );
      }
    }
  }

  private async ensurePhilosophyFits(playerId: string) {
    const row = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: { tacticalScores: true, positionFit: true },
    });
    if (!row?.tacticalScores) return;

    const player = toPhilosophyFitPlayer(row as PlayerWithSip);
    if (!player) return;

    const slots = FORMATIONS[PROFILE_FORMATION];
    const bestSlot =
      slots
        .map((slot) => ({ slot, score: computePositionFitScore(player, slot) }))
        .sort((a, b) => b.score - a.score)[0]?.slot ?? slots.find((s) => s.id === "cam");

    const fits = PHILOSOPHY_IDS.map((philosophy: PhilosophyId) =>
      computePhilosophyFit(player, philosophy, PROFILE_FORMATION, bestSlot)
    )
      .sort((a, b) => b.philosophyFitScore - a.philosophyFitScore)
      .slice(0, PHILOSOPHY_FIT_LIMIT);

    for (const fit of fits) {
      await this.persistPhilosophyFit(fit);
    }
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
