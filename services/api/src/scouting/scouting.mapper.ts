import type { PhilosophyFitPlayer } from "@dtp/engines";
import type { TacticalScores } from "@dtp/engines";
import type { Player, PositionFitSnapshot, TacticalScores as DbTactical } from "@prisma/client";

export type PlayerWithSip = Player & {
  tacticalScores: DbTactical | null;
  positionFit: PositionFitSnapshot | null;
};

export function toTacticalScores(row: DbTactical): TacticalScores {
  return {
    gegenpressScore: row.gegenpressScore,
    tikiTakaScore: row.tikiTakaScore,
    counterAttackScore: row.counterAttackScore,
    totalFootballScore: row.totalFootballScore,
    highLineScore: row.highLineScore,
    wingerScore: row.wingerScore,
    lowBlockScore: row.lowBlockScore,
    quickReleaseScore: row.quickReleaseScore,
    ballRetentionScore: row.ballRetentionScore,
    technicalCleanlinessScore: row.technicalCleanlinessScore,
    directPlayScore: row.directPlayScore,
    flairScore: row.flairScore,
    pressResistanceScore: row.pressResistanceScore,
    possessionHubScore: row.possessionHubScore,
    transitionExplosivenessScore: row.transitionExplosivenessScore,
    isolationThreatScore: row.isolationThreatScore,
    twoFootednessScore: row.twoFootednessScore,
  };
}

export function toPhilosophyFitPlayer(p: PlayerWithSip): PhilosophyFitPlayer | null {
  if (!p.tacticalScores) return null;
  return {
    id: p.id,
    displayName: p.displayName,
    positionPrimary: p.positionPrimary,
    positionSecondary: p.positionSecondary,
    overallRating: p.overallRating ?? 50,
    offensiveRating: p.offensiveRating ?? 50,
    defensiveRating: p.defensiveRating ?? 50,
    playerPhotoUrl: p.playerPhotoUrl,
    tactical: toTacticalScores(p.tacticalScores),
    positionFit: p.positionFit
      ? {
          primaryPositionFit: p.positionFit.primaryPositionFit,
          secondaryPositionFit: p.positionFit.secondaryPositionFit,
          hybridFit: p.positionFit.hybridFit,
          confidence: p.positionFit.confidence,
        }
      : null,
  };
}
