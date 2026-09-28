/**
 * Fold one player record into another.
 *
 * Extracted from `AdminScoreboardService.mergeScoreboardPlayers` so the admin
 * endpoint and `db:merge:duplicate-players` run the same code. Two
 * implementations of this would drift, and the cost of drift here is somebody's
 * goals ending up on the wrong profile.
 *
 * A Player is referenced by fourteen tables and each needs its own decision, which
 * is why this is long rather than clever:
 *
 *   - **Events** move wholesale, as scorer and as assister, and labels matching the
 *     source's name are claimed for the target — so a goal recorded against the
 *     losing spelling follows the person it belongs to.
 *   - **Squad and match-squad rows** move.
 *   - **Competition stats** are added together where both records have a row for
 *     the same competition, and the source's row is dropped.
 *   - **Per-match and per-season metrics** move unless the target already has one
 *     for that match or season, in which case the source's is discarded rather
 *     than guessed at.
 *   - **Tactical scores, position fit, philosophy fit and valuations** move, with
 *     the same rule for the one-per-player tables.
 *
 * What it deliberately does not touch is `careerGoals` and the other career
 * totals. They mix what a player entered about themselves at registration with the
 * platform's own increments, and adding one record's to another's would double the
 * self-reported part. `db:repair:player-stats` reconciles the platform's share
 * against the events afterwards, which is the honest way to settle it.
 *
 * The caller supplies the transaction. Everything here is one unit of work: a
 * half-merged player is worse than either of the two it came from.
 */
import type { Prisma } from "@prisma/client";

export type MergeTx = Prisma.TransactionClient;

export type MergeOutcome = {
  ok: true;
  source: { id: string; displayName: string; slug: string };
  target: { id: string; displayName: string; slug: string };
  moved: Record<string, number>;
};

export class MergePlayerNotFoundError extends Error {
  constructor(which: "source" | "target") {
    super(`${which === "source" ? "Source" : "Target"} player was not found`);
    this.name = "MergePlayerNotFoundError";
  }
}

export async function mergePlayerRecords(
  tx: MergeTx,
  args: { sourcePlayerId: string; targetPlayerId: string; removeSource?: boolean }
): Promise<MergeOutcome> {
  const sourcePlayerId = args.sourcePlayerId;
  const targetPlayerId = args.targetPlayerId;
  const body = { removeSource: args.removeSource };
  const [source, target] = await Promise.all([
    tx.player.findUnique({
      where: { id: sourcePlayerId },
      select: { id: true, displayName: true, slug: true },
    }),
    tx.player.findUnique({
      where: { id: targetPlayerId },
      select: { id: true, displayName: true, slug: true },
    }),
  ]);

  if (!source) throw new MergePlayerNotFoundError("source");
  if (!target) throw new MergePlayerNotFoundError("target");

  const eventPlayer = await tx.sbMatchEvent.updateMany({
    where: { playerId: source.id },
    data: { playerId: target.id },
  });
  const eventAssist = await tx.sbMatchEvent.updateMany({
    where: { assistPlayerId: source.id },
    data: { assistPlayerId: target.id },
  });
  const labeledPrimaryEvents = await tx.sbMatchEvent.updateMany({
    where: {
      playerId: null,
      playerLabel: { equals: source.displayName, mode: "insensitive" },
    },
    data: { playerId: target.id, playerLabel: target.displayName },
  });
  const labeledSecondaryEvents = await tx.sbMatchEvent.updateMany({
    where: {
      playerLabel2: { equals: source.displayName, mode: "insensitive" },
    },
    data: { playerLabel2: target.displayName },
  });
  const labeledAssistEvents = await tx.sbMatchEvent.updateMany({
    where: {
      assistPlayerId: null,
      assistLabel: { equals: source.displayName, mode: "insensitive" },
    },
    data: { assistPlayerId: target.id, assistLabel: target.displayName },
  });
  const teamSquad = await tx.sbTeamSquad.updateMany({
    where: { playerId: source.id },
    data: { playerId: target.id, displayName: target.displayName },
  });
  const matchSquad = await tx.sbMatchSquadPlayer.updateMany({
    where: { playerId: source.id },
    data: { playerId: target.id, playerName: target.displayName },
  });

  const sourceCompetitionStats = await tx.sbPlayerCompetitionStats.findMany({
    where: { playerId: source.id },
  });
  let competitionStatsMerged = 0;
  for (const row of sourceCompetitionStats) {
    const existing = await tx.sbPlayerCompetitionStats.findUnique({
      where: {
        competitionId_playerId: {
          competitionId: row.competitionId,
          playerId: target.id,
        },
      },
    });
    if (existing) {
      await tx.sbPlayerCompetitionStats.update({
        where: { id: existing.id },
        data: {
          goals: { increment: row.goals },
          assists: { increment: row.assists },
          appearances: { increment: row.appearances },
          minutesPlayed: { increment: row.minutesPlayed },
          cleanSheets: { increment: row.cleanSheets },
        },
      });
      await tx.sbPlayerCompetitionStats.delete({ where: { id: row.id } });
    } else {
      await tx.sbPlayerCompetitionStats.update({
        where: { id: row.id },
        data: { playerId: target.id },
      });
    }
    competitionStatsMerged++;
  }

  const sourceMatchMetrics = await tx.playerMatchMetrics.findMany({
    where: { playerId: source.id },
    select: { id: true, matchId: true },
  });
  let matchMetricsMoved = 0;
  let matchMetricsSkipped = 0;
  for (const metric of sourceMatchMetrics) {
    const conflict = await tx.playerMatchMetrics.findUnique({
      where: {
        playerId_matchId: {
          playerId: target.id,
          matchId: metric.matchId,
        },
      },
      select: { id: true },
    });
    if (conflict) {
      await tx.playerMatchMetrics.delete({ where: { id: metric.id } });
      matchMetricsSkipped++;
    } else {
      await tx.playerMatchMetrics.update({
        where: { id: metric.id },
        data: { playerId: target.id },
      });
      matchMetricsMoved++;
    }
  }

  const sourceAggregates = await tx.playerAggregatedMetrics.findMany({
    where: { playerId: source.id },
    select: { id: true, season: true },
  });
  for (const aggregate of sourceAggregates) {
    const conflict = await tx.playerAggregatedMetrics.findUnique({
      where: {
        playerId_season: { playerId: target.id, season: aggregate.season },
      },
      select: { id: true },
    });
    if (conflict) {
      await tx.playerAggregatedMetrics.delete({ where: { id: aggregate.id } });
    } else {
      await tx.playerAggregatedMetrics.update({
        where: { id: aggregate.id },
        data: { playerId: target.id },
      });
    }
  }

  const targetTactical = await tx.tacticalScores.findUnique({
    where: { playerId: target.id },
    select: { id: true },
  });
  const sourceTactical = await tx.tacticalScores.findUnique({
    where: { playerId: source.id },
    select: { id: true },
  });
  if (sourceTactical) {
    if (targetTactical) {
      await tx.tacticalScores.delete({ where: { id: sourceTactical.id } });
    } else {
      await tx.tacticalScores.update({
        where: { id: sourceTactical.id },
        data: { playerId: target.id },
      });
    }
  }

  const targetFit = await tx.positionFitSnapshot.findUnique({
    where: { playerId: target.id },
    select: { id: true },
  });
  const sourceFit = await tx.positionFitSnapshot.findUnique({
    where: { playerId: source.id },
    select: { id: true },
  });
  if (sourceFit) {
    if (targetFit) {
      await tx.positionFitSnapshot.delete({ where: { id: sourceFit.id } });
    } else {
      await tx.positionFitSnapshot.update({
        where: { id: sourceFit.id },
        data: { playerId: target.id },
      });
    }
  }

  await tx.philosophyFitProfile.updateMany({
    where: { playerId: source.id },
    data: { playerId: target.id },
  });
  await tx.mvceValuationRun.updateMany({
    where: { playerId: source.id },
    data: { playerId: target.id },
  });

  if (body.removeSource !== false) {
    await tx.player.delete({ where: { id: source.id } });
  }

  return {
    ok: true,
    source: { id: source.id, displayName: source.displayName, slug: source.slug },
    target: { id: target.id, displayName: target.displayName, slug: target.slug },
    moved: {
      eventPlayer: eventPlayer.count,
      eventAssist: eventAssist.count,
      labeledPrimaryEvents: labeledPrimaryEvents.count,
      labeledSecondaryEvents: labeledSecondaryEvents.count,
      labeledAssistEvents: labeledAssistEvents.count,
      teamSquad: teamSquad.count,
      matchSquad: matchSquad.count,
      competitionStats: competitionStatsMerged,
      matchMetrics: matchMetricsMoved,
      duplicateMatchMetricsDropped: matchMetricsSkipped,
    },
  };
}
