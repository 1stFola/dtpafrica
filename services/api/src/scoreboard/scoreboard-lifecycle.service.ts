import { Inject, Injectable } from "@nestjs/common";
import type { Prisma, SbMatch, SbMatchEvent } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CompetitionEngineService } from "./competition-engine.service";
import type { MatchdayRosterGuard, MatchStatsForGuard } from "./roster-guard";
import { isGoalkeeper } from "./roster-position";

type FinishedMatch = Pick<
  SbMatch,
  | "id"
  | "competitionId"
  | "homeTeamId"
  | "awayTeamId"
  | "homeScore"
  | "awayScore"
  | "minute"
  | "stageKey"
  | "stats"
>;

type PlayerStatDeltas = {
  goals?: number;
  assists?: number;
  appearances?: number;
  minutesPlayed?: number;
  cleanSheets?: number;
  careerGoals?: number;
  careerAssists?: number;
  careerAppearances?: number;
  careerMinutes?: number;
  careerCleanSheets?: number;
};

type LifecycleStats = MatchStatsForGuard & {
  lifecycle?: { finishedProcessedAt?: string };
};

type EventMetadata = {
  statsApplied?: boolean;
  [key: string]: unknown;
};

const GROUP_FORMATS = new Set(["JAGABAN_CUP_STANDARD", "HYBRID_CHAMPIONS_LEAGUE"]);
const STANDINGS_DEBOUNCE_MS = 1500;

@Injectable()
export class ScoreboardLifecycleService {
  private readonly standingsTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CompetitionEngineService)
    private readonly competitionEngine: CompetitionEngineService
  ) {}

  async applyMatchEventToPlayerStats(
    event: Pick<SbMatchEvent, "id" | "type" | "playerId" | "assistPlayerId" | "metadata">,
    competitionId: string
  ) {
    const meta = (event.metadata ?? {}) as EventMetadata;
    if (meta.statsApplied) return;

    const deltas = new Map<string, PlayerStatDeltas>();
    if ((event.type === "goal" || event.type === "goal_penalty") && event.playerId) {
      this.mergeDeltas(deltas, event.playerId, { goals: 1, careerGoals: 1 });
    }
    if (event.type === "goal" && event.assistPlayerId) {
      this.mergeDeltas(deltas, event.assistPlayerId, {
        assists: 1,
        careerAssists: 1,
      });
    }
    if (deltas.size === 0) return;

    await this.flushPlayerDeltas(competitionId, deltas);
    await this.prisma.sbMatchEvent.update({
      where: { id: event.id },
      data: {
        metadata: {
          ...meta,
          statsApplied: true,
          statsAppliedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Take the credit back for events that are about to be deleted.
   *
   * `applyMatchEventToPlayerStats` only ever increments, and nothing used to
   * decrement -- so deleting a goal left its credit behind for good. Re-importing
   * one match timeline gave every scorer in it a phantom goal, twice gave them two,
   * and on live that is the whole of the 1XCup surplus that
   * `db:repair:player-stats` has to correct.
   *
   * Only an event whose credit was actually written can have it taken back, which
   * is what `statsApplied` records. An event that never counted -- because it was
   * recorded with no player on it, the commonest case here -- is skipped, or the
   * deletion would invent a debt.
   *
   * Totals are floored at zero rather than decremented blindly. `careerGoals` also
   * holds what a player entered about themselves at registration, and while taking
   * back a credit this service granted is right, driving the number negative on the
   * way is not.
   */
  async reverseMatchEventStats(
    events: Pick<SbMatchEvent, "type" | "playerId" | "assistPlayerId" | "metadata">[],
    competitionId: string
  ) {
    const deltas = new Map<string, PlayerStatDeltas>();
    for (const event of events) {
      const meta = (event.metadata ?? {}) as EventMetadata;
      if (!meta.statsApplied) continue;
      if ((event.type === "goal" || event.type === "goal_penalty") && event.playerId) {
        this.mergeDeltas(deltas, event.playerId, { goals: 1, careerGoals: 1 });
      }
      if (event.type === "goal" && event.assistPlayerId) {
        this.mergeDeltas(deltas, event.assistPlayerId, { assists: 1, careerAssists: 1 });
      }
    }
    if (deltas.size === 0) return 0;

    for (const [playerId, d] of deltas) {
      const row = await this.prisma.sbPlayerCompetitionStats.findUnique({
        where: { competitionId_playerId: { competitionId, playerId } },
        select: { id: true, goals: true, assists: true },
      });
      if (row) {
        await this.prisma.sbPlayerCompetitionStats.update({
          where: { id: row.id },
          data: {
            goals: Math.max(0, row.goals - (d.goals ?? 0)),
            assists: Math.max(0, row.assists - (d.assists ?? 0)),
          },
        });
      }
      const player = await this.prisma.player.findUnique({
        where: { id: playerId },
        select: { careerGoals: true, careerAssists: true },
      });
      if (player) {
        await this.prisma.player.update({
          where: { id: playerId },
          data: {
            careerGoals: Math.max(0, player.careerGoals - (d.careerGoals ?? 0)),
            careerAssists: Math.max(0, player.careerAssists - (d.careerAssists ?? 0)),
          },
        });
      }
    }
    return deltas.size;
  }

  /**
   * Reverse every event on a match, by id, before they are deleted.
   *
   * The deleting call sites use `deleteMany`, which does not hand back the rows it
   * removed, so the credit has to be taken back while they can still be read.
   */
  async reverseMatchEventStatsByFilter(
    where: { matchId: string; metadata?: unknown },
    competitionId: string
  ) {
    const events = await this.prisma.sbMatchEvent.findMany({
      where: where as never,
      select: { type: true, playerId: true, assistPlayerId: true, metadata: true },
    });
    return this.reverseMatchEventStats(events, competitionId);
  }

  async onMatchFinished(matchId: string) {
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: { competition: { select: { formatType: true } } },
    });
    if (!match || match.status !== "finished") return;

    const claimed = await this.claimFinishedProcessing(matchId, match.stats);
    if (!claimed) return;

    const deltas = new Map<string, PlayerStatDeltas>();
    await this.collectRosterAppearanceDeltas(match as FinishedMatch, deltas);
    await this.collectCleanSheetDeltas(match as FinishedMatch, deltas);

    if (deltas.size > 0) {
      await this.flushPlayerDeltas(match.competitionId, deltas);
    }

    if (this.shouldRefreshStandings(match, match.competition.formatType)) {
      this.scheduleStandingsRefresh(match.competitionId);
    }
  }

  async refreshCompetitionStandings(competitionId: string) {
    const payload = await this.competitionEngine.standings(competitionId);
    await this.prisma.sbCompetition.update({
      where: { id: competitionId },
      data: {
        standingsSnapshot: payload as unknown as Prisma.InputJsonValue,
        standingsUpdatedAt: new Date(),
      },
    });
    return payload;
  }

  async refreshStandingsForFinishedMatch(matchId: string) {
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: { competition: { select: { formatType: true } } },
    });
    if (!match || match.status !== "finished") return;
    if (this.shouldRefreshStandings(match, match.competition.formatType)) {
      this.scheduleStandingsRefresh(match.competitionId);
    }
  }

  private shouldRefreshStandings(
    match: Pick<SbMatch, "stageKey">,
    formatType: string | null
  ) {
    if (match.stageKey?.startsWith("group_")) return true;
    if (formatType === "STANDARD_LEAGUE") return true;
    if (formatType && GROUP_FORMATS.has(formatType)) {
      return !match.stageKey || match.stageKey.startsWith("group_");
    }
    return false;
  }

  private scheduleStandingsRefresh(competitionId: string) {
    const existing = this.standingsTimers.get(competitionId);
    if (existing) clearTimeout(existing);
    this.standingsTimers.set(
      competitionId,
      setTimeout(() => {
        this.standingsTimers.delete(competitionId);
        void this.refreshCompetitionStandings(competitionId).catch(() => {});
      }, STANDINGS_DEBOUNCE_MS)
    );
  }

  private async claimFinishedProcessing(
    matchId: string,
    _statsJson: Prisma.JsonValue | null
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.sbMatch.findUnique({
        where: { id: matchId },
        select: { stats: true, status: true },
      });
      if (!row || row.status !== "finished") return false;

      const stats = (row.stats ?? {}) as LifecycleStats;
      if (stats.lifecycle?.finishedProcessedAt) return false;

      await tx.sbMatch.update({
        where: { id: matchId },
        data: {
          stats: {
            ...stats,
            lifecycle: { finishedProcessedAt: new Date().toISOString() },
          } as Prisma.InputJsonValue,
        },
      });
      return true;
    });
  }

  private mergeDeltas(
    map: Map<string, PlayerStatDeltas>,
    playerId: string,
    add: PlayerStatDeltas
  ) {
    const cur = map.get(playerId) ?? {};
    const keys = Object.keys(add) as Array<keyof PlayerStatDeltas>;
    for (const key of keys) {
      const v = add[key];
      if (v == null) continue;
      cur[key] = ((cur[key] as number | undefined) ?? 0) + v;
    }
    map.set(playerId, cur);
  }

  private async flushPlayerDeltas(
    competitionId: string,
    deltas: Map<string, PlayerStatDeltas>
  ) {
    if (deltas.size === 0) return;

    await this.prisma.$transaction(
      [...deltas.entries()].flatMap(([playerId, d]) => [
        this.prisma.sbPlayerCompetitionStats.upsert({
          where: { competitionId_playerId: { competitionId, playerId } },
          create: {
            competitionId,
            playerId,
            goals: d.goals ?? 0,
            assists: d.assists ?? 0,
            appearances: d.appearances ?? 0,
            minutesPlayed: d.minutesPlayed ?? 0,
            cleanSheets: d.cleanSheets ?? 0,
          },
          update: {
            goals: d.goals ? { increment: d.goals } : undefined,
            assists: d.assists ? { increment: d.assists } : undefined,
            appearances: d.appearances ? { increment: d.appearances } : undefined,
            minutesPlayed: d.minutesPlayed ? { increment: d.minutesPlayed } : undefined,
            cleanSheets: d.cleanSheets ? { increment: d.cleanSheets } : undefined,
          },
        }),
        this.prisma.player.update({
          where: { id: playerId },
          data: {
            careerGoals: d.careerGoals ? { increment: d.careerGoals } : undefined,
            careerAssists: d.careerAssists ? { increment: d.careerAssists } : undefined,
            careerAppearances: d.careerAppearances
              ? { increment: d.careerAppearances }
              : undefined,
            careerMinutes: d.careerMinutes ? { increment: d.careerMinutes } : undefined,
            careerCleanSheets: d.careerCleanSheets
              ? { increment: d.careerCleanSheets }
              : undefined,
          },
        }),
      ])
    );
  }

  private async loadSquadsMap(squadIds: string[]) {
    const unique = [...new Set(squadIds)];
    if (!unique.length) return new Map<string, { playerId: string | null; position: string | null }>();
    const rows = await this.prisma.sbTeamSquad.findMany({
      where: { id: { in: unique } },
      select: { id: true, playerId: true, position: true },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async collectRosterAppearanceDeltas(
    match: FinishedMatch,
    deltas: Map<string, PlayerStatDeltas>
  ) {
    const stats = (match.stats ?? {}) as MatchStatsForGuard;
    const rosters = stats.matchdayRosters ?? {};
    const minutes = Math.min(90, Math.max(1, match.minute ?? 90));
    const squadIds = Object.values(rosters).flatMap((r) => r.xi.map((s) => s.squadId));
    const squads = await this.loadSquadsMap(squadIds);

    for (const roster of Object.values(rosters)) {
      for (const slot of roster.xi) {
        const squad = squads.get(slot.squadId);
        if (!squad?.playerId) continue;
        this.mergeDeltas(deltas, squad.playerId, {
          appearances: 1,
          minutesPlayed: minutes,
          careerAppearances: 1,
          careerMinutes: minutes,
        });
      }
    }
  }

  private async collectCleanSheetDeltas(
    match: FinishedMatch,
    deltas: Map<string, PlayerStatDeltas>
  ) {
    const stats = (match.stats ?? {}) as MatchStatsForGuard;
    const rosters = stats.matchdayRosters ?? {};
    const homeRoster = rosters[match.homeTeamId];
    const awayRoster = rosters[match.awayTeamId];
    const squadIds = [
      ...(homeRoster?.xi.map((s) => s.squadId) ?? []),
      ...(awayRoster?.xi.map((s) => s.squadId) ?? []),
    ];
    const squads = await this.loadSquadsMap(squadIds);

    if (match.awayScore === 0) {
      this.collectGkCleanSheet(homeRoster, deltas, squads);
    }
    if (match.homeScore === 0) {
      this.collectGkCleanSheet(awayRoster, deltas, squads);
    }
  }

  private collectGkCleanSheet(
    roster: MatchdayRosterGuard | undefined,
    deltas: Map<string, PlayerStatDeltas>,
    squads: Map<string, { playerId: string | null; position: string | null }>
  ) {
    if (!roster) return;
    for (const slot of roster.xi) {
      const squad = squads.get(slot.squadId);
      if (!squad?.playerId || !isGoalkeeper(squad.position)) continue;
      this.mergeDeltas(deltas, squad.playerId, {
        cleanSheets: 1,
        careerCleanSheets: 1,
      });
      return;
    }
  }
}
