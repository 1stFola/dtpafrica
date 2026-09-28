import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  playerToLegacyMeta,
  normalizeClubName,
  positionFullFromAbbreviation,
  runCalibration,
  type MatchMetricsRow,
  type PlayerCalibrationMeta,
} from "@dtp/engines";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { normalizePlayerAgeCategory } from "../players/age-category";
import { resolveUniquePlayerSlug } from "../players/player-slug";
import { SipRecalculationService } from "../sip/sip-recalculation.service";
import { resolveAcademyIdByClubName } from "../academy/academy-linking.util";
import {
  legacyMatchMetricsToPlayerMatchRecord,
  playerMatchMetricsToLegacyMetrics,
  readCalibrationMetricsFromBenchmark,
} from "../sip/legacy-match-metrics-mapper";
import { CalibrationMetricsDto } from "./dto/calibration-metrics.dto";
import {
  CalibrationPlayerInfoDto,
  LegacyMatchMetricsDto,
} from "./dto/calibration-player-info.dto";
import { playerIdentityFields } from "../players/player-identity";

type MetricsRecord = {
  minutesPlayed: number;
  ballTouches: number;
  totalDistanceMiles: number;
  sprintDistanceYards: number;
  firstStepAccelerations: number;
  intenseAccelerations: number;
  kickingPowerMph: number | null;
  topSpeedMph: number | null;
  sprints: number;
  intenseTurns: number;
  avgTurnEntrySpeedMph: number | null;
  avgTurnExitSpeedMph: number | null;
  leftTurns: number;
  rightTurns: number;
  backTurns: number;
  distanceWithBallYards: number;
  topSpeedWithBallMph: number | null;
  intenseTurnsWithBall: number;
};

@Injectable()
export class AdminCalibrationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SipRecalculationService)
    private readonly sipRecalc: SipRecalculationService
  ) {}

  private parseHeightFt(heightFt?: string): number | undefined {
    const raw = heightFt
      ?.trim()
      .toLowerCase()
      .replace(/[‘’‛`´]/g, "'")
      .replace(/[“”″]/g, "\"");
    if (!raw) return undefined;
    const cmMatch = raw.match(/^(\d+(?:\.\d+)?)\s*cm$/);
    const meterMatch = raw.match(/^(\d+(?:\.\d+)?)\s*m$/);
    const cm = cmMatch
      ? Math.round(Number(cmMatch[1]))
      : meterMatch
        ? Math.round(Number(meterMatch[1]) * 100)
        : undefined;
    if (cm != null) return cm >= 100 && cm <= 230 ? cm : undefined;

    const match =
      raw.match(/^(\d+)\s*(?:ft|feet|foot|')\s*(\d{1,2})?\s*(?:in|inch|inches|")?$/) ??
      raw.match(/^(\d+)\s*[-.\s]\s*(\d{1,2})$/);
    if (!match) {
      const feetOnly = raw.match(/^(\d+)\s*(?:ft|feet|foot)$/);
      if (!feetOnly) return undefined;
      const feet = parseInt(feetOnly[1], 10) || 0;
      const feetOnlyCm = Math.round(feet * 12 * 2.54);
      return feetOnlyCm >= 100 && feetOnlyCm <= 230 ? feetOnlyCm : undefined;
    }
    const feet = parseInt(match[1], 10) || 0;
    const inches = parseInt(match[2] ?? "0", 10) || 0;
    if (inches < 0 || inches > 11) return undefined;
    const parsedCm = Math.round((feet * 12 + inches) * 2.54);
    return parsedCm >= 100 && parsedCm <= 230 ? parsedCm : undefined;
  }

  private parseRequiredHeightFt(heightFt?: string): number | undefined {
    if (!heightFt?.trim()) return undefined;
    const heightCm = this.parseHeightFt(heightFt);
    if (heightCm == null) {
      throw new BadRequestException(
        "Height must be entered as feet/inches like 5'11\", 5ft 11in, or centimeters like 180cm."
      );
    }
    return heightCm;
  }

  private splitFullName(fullName: string): { firstName: string; lastName: string } {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length <= 1) {
      const name = parts[0] || "Player";
      return { firstName: name, lastName: name };
    }
    return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
  }

  private infoToLegacyMeta(info: CalibrationPlayerInfoDto): PlayerCalibrationMeta {
    return {
      full_name: info.fullName.trim(),
      gender: info.gender || "Male",
      date_of_birth: info.dateOfBirth || "",
      position: info.position,
      nationality: info.nationality || "",
      height_ft: info.heightFt || "",
      weight_kg: info.weightKg ?? "",
      current_club: info.currentClub ? normalizeClubName(info.currentClub) : "",
      photo_url: info.photoUrl || "",
      video_url: info.videoUrl || "",
    };
  }

  private legacyMetricsToRow(m: LegacyMatchMetricsDto): MatchMetricsRow {
    return {
      minutesPlayed: m.duration ?? 0,
      ballTouches: m.ball_touches ?? 0,
      totalDistanceMiles: m.total_distance ?? 0,
      sprintDistanceYards: m.sprint_distance ?? 0,
      firstStepAccelerations: m.first_step_accelerations ?? 0,
      intenseAccelerations: m.intense_accelerations ?? 0,
      kickingPowerMph: m.kicking_power ?? 0,
      topSpeedMph: m.top_speed ?? 0,
      sprints: m.sprints ?? 0,
      intenseTurns: m.intense_turns ?? 0,
      avgTurnEntrySpeedMph: m.avg_turn_entry ?? 0,
      avgTurnExitSpeedMph: m.avg_turn_exit ?? 0,
      leftTurns: m.left_turns ?? 0,
      rightTurns: m.right_turns ?? 0,
      backTurns: m.back_turns ?? 0,
      distanceWithBallYards: m.distance_with_ball ?? 0,
      topSpeedWithBallMph: m.top_speed_with_ball ?? 0,
      intenseTurnsWithBall: m.intense_turns_with_ball ?? 0,
    };
  }


  private toMetricsRow(row: MetricsRecord): MatchMetricsRow {
    return {
      minutesPlayed: row.minutesPlayed,
      ballTouches: row.ballTouches,
      totalDistanceMiles: row.totalDistanceMiles,
      sprintDistanceYards: row.sprintDistanceYards,
      firstStepAccelerations: row.firstStepAccelerations,
      intenseAccelerations: row.intenseAccelerations,
      kickingPowerMph: row.kickingPowerMph,
      topSpeedMph: row.topSpeedMph,
      sprints: row.sprints,
      intenseTurns: row.intenseTurns,
      avgTurnEntrySpeedMph: row.avgTurnEntrySpeedMph,
      avgTurnExitSpeedMph: row.avgTurnExitSpeedMph,
      leftTurns: row.leftTurns,
      rightTurns: row.rightTurns,
      backTurns: row.backTurns,
      distanceWithBallYards: row.distanceWithBallYards,
      topSpeedWithBallMph: row.topSpeedWithBallMph,
      intenseTurnsWithBall: row.intenseTurnsWithBall,
    };
  }

  private metricsRecordFromRow(row: MatchMetricsRow): Omit<MetricsRecord, never> {
    return {
      minutesPlayed: row.minutesPlayed,
      ballTouches: row.ballTouches,
      totalDistanceMiles: row.totalDistanceMiles,
      sprintDistanceYards: row.sprintDistanceYards,
      firstStepAccelerations: row.firstStepAccelerations,
      intenseAccelerations: row.intenseAccelerations,
      kickingPowerMph: row.kickingPowerMph ?? null,
      topSpeedMph: row.topSpeedMph ?? null,
      sprints: row.sprints,
      intenseTurns: row.intenseTurns,
      avgTurnEntrySpeedMph: row.avgTurnEntrySpeedMph ?? null,
      avgTurnExitSpeedMph: row.avgTurnExitSpeedMph ?? null,
      leftTurns: row.leftTurns,
      rightTurns: row.rightTurns,
      backTurns: row.backTurns,
      distanceWithBallYards: row.distanceWithBallYards,
      topSpeedWithBallMph: row.topSpeedWithBallMph ?? null,
      intenseTurnsWithBall: row.intenseTurnsWithBall,
    };
  }

  private mergeMetrics(
    base: MatchMetricsRow,
    override?: CalibrationMetricsDto
  ): MatchMetricsRow {
    if (!override) return base;
    return { ...base, ...override };
  }

  private formatResult(
    playerId: string | null,
    displayName: string,
    positionPrimary: string,
    saved: boolean,
    result: ReturnType<typeof runCalibration>
  ) {
    return {
      playerId,
      displayName,
      positionPrimary,
      saved,
      ...result,
    };
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  }

  private buildBenchmarkMetadata(
    result: ReturnType<typeof runCalibration>,
    calibrationMetrics?: LegacyMatchMetricsDto | null
  ) {
    return {
      meta: result.meta,
      nearest: result.nearestBenchmark,
      alternatives: result.alternativeBenchmarks,
      rankedCandidates: result.rankedCandidates,
      primaryBenchmarkIndex: result.primaryBenchmarkIndex,
      filterInfo: result.filterInfo,
      ...(calibrationMetrics ? { calibrationMetrics } : {}),
    };
  }

  private readCalibrationMeta(
    benchmarkMetadata: unknown
  ): Record<string, unknown> | null {
    if (!benchmarkMetadata || typeof benchmarkMetadata !== "object") return null;
    const meta = (benchmarkMetadata as Record<string, unknown>).meta;
    return meta && typeof meta === "object" ? (meta as Record<string, unknown>) : null;
  }

  private readCalibrationGender(benchmarkMetadata: unknown): string {
    const gender = this.readCalibrationMeta(benchmarkMetadata)?.gender;
    return typeof gender === "string" && gender.trim() ? gender.trim() : "Male";
  }

  private buildMediaItems(photoUrl?: string | null, videoUrl?: string | null) {
    return [
      photoUrl
        ? {
            type: "photo",
            title: "Profile photo",
            url: photoUrl,
          }
        : null,
      videoUrl
        ? {
            type: "video",
            title: "Highlight video",
            url: videoUrl,
          }
        : null,
    ].filter(Boolean);
  }

  private generateScoutingSummary(args: {
    displayName: string;
    position: string;
    ageGroup?: string | null;
    overallRating?: number | null;
    offensiveRating?: number | null;
    defensiveRating?: number | null;
  }) {
    const overall = args.overallRating ?? 0;
    const tier =
      overall >= 85
        ? "elite prospect"
        : overall >= 75
          ? "pro-ready profile"
          : overall >= 65
            ? "developing prospect"
            : "emerging profile";
    const balance =
      (args.offensiveRating ?? 0) >= (args.defensiveRating ?? 0)
        ? "attacking contribution"
        : "defensive reliability";
    const ageBand = args.ageGroup ? `${args.ageGroup} ` : "";

    return `${args.displayName} projects as a ${ageBand}${tier} at ${args.position}, with the strongest current signal in ${balance}. The profile should be reviewed alongside recent match footage and benchmark context before recruitment decisions.`;
  }

  async getPlayerMetrics(playerId: string) {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: {
        id: true,
        displayName: true,
        dateOfBirth: true,
        positionPrimary: true,
        nationality: true,
        dominantFoot: true,
        heightCm: true,
        weightKg: true,
        city: true,
        playerPhotoUrl: true,
        videoUrl: true,
        overallRating: true,
        offensiveRating: true,
        defensiveRating: true,
        benchmarkMetadata: true,
      },
    });
    if (!player) throw new NotFoundException("Player not found");

    const metrics = await this.prisma.playerMatchMetrics.findFirst({
      where: { playerId },
      orderBy: { createdAt: "desc" },
    });

    const heightFt =
      player.heightCm != null
        ? `${Math.floor(player.heightCm / 30.48)}'${Math.round((player.heightCm % 30.48) / 2.54)}"`
        : "";

    const fromDb = metrics ? playerMatchMetricsToLegacyMetrics(metrics) : {};
    const fromSnapshot = readCalibrationMetricsFromBenchmark(player.benchmarkMetadata) ?? {};
    const mergedMetrics = { ...fromDb, ...fromSnapshot };

    return {
      player: {
        id: player.id,
        fullName: player.displayName,
        gender: this.readCalibrationGender(player.benchmarkMetadata),
        dateOfBirth: player.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        position: player.positionPrimary,
        preferredFoot: player.dominantFoot,
        benchmarkRegion: "Global",
        benchmarkAgeBand: "Auto",
        nationality: player.nationality,
        heightFt,
        weightKg: player.weightKg,
        currentClub: player.city ? normalizeClubName(player.city) : null,
        photoUrl: player.playerPhotoUrl,
        videoUrl: player.videoUrl,
        overallRating: player.overallRating,
        offensiveRating: player.offensiveRating,
        defensiveRating: player.defensiveRating,
      },
      metrics: Object.keys(mergedMetrics).length > 0 ? mergedMetrics : null,
    };
  }

  runAdhoc(
    player: CalibrationPlayerInfoDto,
    metrics: LegacyMatchMetricsDto,
    save = false,
    primaryBenchmarkIndex?: number,
  ) {
    if (!player.fullName?.trim()) {
      throw new BadRequestException("Full name is required");
    }
    if (!player.position) {
      throw new BadRequestException("Position is required");
    }
    const result = runCalibration(
      this.legacyMetricsToRow(metrics),
      this.infoToLegacyMeta(player),
      { primaryBenchmarkIndex },
    );
    return this.formatResult(null, player.fullName, player.position, save, result);
  }

  async runForPlayer(
    playerId: string,
    options: {
      save?: boolean;
      metricsOverride?: CalibrationMetricsDto | LegacyMatchMetricsDto;
      playerInfo?: CalibrationPlayerInfoDto;
      primaryBenchmarkIndex?: number;
    } = {}
  ) {
    const player = await this.prisma.player.findUnique({ where: { id: playerId } });
    if (!player) throw new NotFoundException("Player not found");

    const stored = await this.prisma.playerMatchMetrics.findFirst({
      where: { playerId },
      orderBy: { createdAt: "desc" },
    });

    const legacyMetricsOverride =
      options.metricsOverride && "duration" in options.metricsOverride
        ? (options.metricsOverride as LegacyMatchMetricsDto)
        : undefined;

    const legacyOverride = legacyMetricsOverride
      ? this.legacyMetricsToRow(legacyMetricsOverride)
      : undefined;

    if (!stored && !legacyOverride && !options.metricsOverride) {
      throw new BadRequestException(
        "No match metrics on file. Upload CSV or enter match performance data."
      );
    }

    const base = stored
      ? this.toMetricsRow(stored)
      : legacyOverride ?? this.emptyMetrics();

    const metrics = legacyOverride
      ? legacyOverride
      : this.mergeMetrics(base, options.metricsOverride as CalibrationMetricsDto);

    const calibrationMetricsForPersist =
      legacyMetricsOverride ??
      (stored ? playerMatchMetricsToLegacyMetrics(stored) : null);

    const meta = options.playerInfo
      ? this.infoToLegacyMeta(options.playerInfo)
      : {
          ...playerToLegacyMeta(player),
          gender: this.readCalibrationGender(player.benchmarkMetadata),
        };

    const result = runCalibration(metrics, meta, {
      primaryBenchmarkIndex: options.primaryBenchmarkIndex,
    });
    const headline = result.calibratedSummary;
    const parsedHeightCm = this.parseRequiredHeightFt(options.playerInfo?.heightFt);
    const currentClub = options.playerInfo?.currentClub?.trim();
    const resolvedAcademyId = currentClub
      ? await resolveAcademyIdByClubName(this.prisma, currentClub)
      : null;

    if (options.save) {
      await this.prisma.player.update({
        where: { id: playerId },
        data: {
          overallRating: headline.overall_rating,
          offensiveRating: headline.offensive_score,
          defensiveRating: headline.defensive_score,
          displayName: options.playerInfo?.fullName ?? player.displayName,
          positionPrimary: options.playerInfo?.position ?? player.positionPrimary,
          dominantFoot: options.playerInfo?.preferredFoot?.trim()
            ? options.playerInfo.preferredFoot.trim()
            : player.dominantFoot,
          nationality: options.playerInfo?.nationality ?? player.nationality,
          dateOfBirth: options.playerInfo?.dateOfBirth
            ? new Date(options.playerInfo.dateOfBirth)
            : player.dateOfBirth,
          heightCm: options.playerInfo?.heightFt
            ? parsedHeightCm
            : player.heightCm,
          weightKg: options.playerInfo?.weightKg ?? player.weightKg,
          academyId: resolvedAcademyId ?? player.academyId,
          city: currentClub
            ? resolvedAcademyId
              ? null
              : normalizeClubName(currentClub)
            : player.city,
          playerPhotoUrl: options.playerInfo?.photoUrl ?? player.playerPhotoUrl,
          videoUrl: options.playerInfo?.videoUrl ?? player.videoUrl,
          ratingAttributes: this.toJson(result.calibrated),
          benchmarkMetadata: this.toJson(
            this.buildBenchmarkMetadata(result, calibrationMetricsForPersist)
          ),
          mediaItems: this.toJson(
            this.buildMediaItems(
              options.playerInfo?.photoUrl ?? player.playerPhotoUrl,
              options.playerInfo?.videoUrl ?? player.videoUrl
            )
          ),
          scoutingSummary:
            player.scoutingSummary ??
            this.generateScoutingSummary({
              displayName: options.playerInfo?.fullName ?? player.displayName,
              position: options.playerInfo?.position ?? player.positionPrimary,
              ageGroup: player.ageGroup,
              overallRating: headline.overall_rating,
              offensiveRating: headline.offensive_score,
              defensiveRating: headline.defensive_score,
            }),
        },
      });

      if (calibrationMetricsForPersist) {
        await this.persistMetrics(playerId, calibrationMetricsForPersist);
      }
      try {
        await this.sipRecalc.recalculatePlayer(playerId);
      } catch {
        // Profile intelligence can rebuild aggregates on next public view.
      }
    }

    return this.formatResult(
      player.id,
      options.playerInfo?.fullName ?? player.displayName,
      options.playerInfo?.position ?? player.positionPrimary,
      Boolean(options.save),
      result
    );
  }

  async createPlayerFromCalibration(
    playerInfo: CalibrationPlayerInfoDto,
    metrics: LegacyMatchMetricsDto,
    primaryBenchmarkIndex?: number,
  ) {
    if (!playerInfo.fullName?.trim()) {
      throw new BadRequestException("Full name is required");
    }
    if (!playerInfo.position) {
      throw new BadRequestException("Position is required");
    }

    const metricsRow = this.legacyMetricsToRow(metrics);
    const result = runCalibration(metricsRow, this.infoToLegacyMeta(playerInfo), {
      primaryBenchmarkIndex,
    });
    const headline = result.calibratedSummary;
    const { firstName, lastName } = this.splitFullName(playerInfo.fullName);
    const dob = playerInfo.dateOfBirth ? new Date(playerInfo.dateOfBirth) : null;
    const age =
      dob != null
        ? new Date().getFullYear() - dob.getFullYear()
        : undefined;
    const ageGroup = normalizePlayerAgeCategory({ age, dateOfBirth: dob });
    const parsedHeightCm = this.parseRequiredHeightFt(playerInfo.heightFt);
    const currentClub = playerInfo.currentClub?.trim();
    const resolvedAcademyId = currentClub
      ? await resolveAcademyIdByClubName(this.prisma, currentClub)
      : null;

    const slug = await resolveUniquePlayerSlug(
      this.prisma,
      playerInfo.fullName.trim()
    );
    const player = await this.prisma.player.create({
      data: {
        firstName,
        lastName,
        ...playerIdentityFields(playerInfo.fullName),
        positionPrimary: playerInfo.position,
        positionFull: positionFullFromAbbreviation(playerInfo.position),
        dominantFoot: playerInfo.preferredFoot?.trim() || undefined,
        nationality: playerInfo.nationality,
        dateOfBirth: dob,
        age,
        ageGroup,
        heightCm: parsedHeightCm,
        weightKg: playerInfo.weightKg,
        academyId: resolvedAcademyId ?? undefined,
        city: currentClub && !resolvedAcademyId ? normalizeClubName(currentClub) : undefined,
        playerPhotoUrl: playerInfo.photoUrl,
        videoUrl: playerInfo.videoUrl,
        slug,
        overallRating: headline.overall_rating,
        offensiveRating: headline.offensive_score,
        defensiveRating: headline.defensive_score,
        ratingAttributes: this.toJson(result.calibrated),
        benchmarkMetadata: this.toJson(this.buildBenchmarkMetadata(result, metrics)),
        mediaItems: this.toJson(
          this.buildMediaItems(playerInfo.photoUrl, playerInfo.videoUrl)
        ),
        scoutingSummary: this.generateScoutingSummary({
          displayName: playerInfo.fullName.trim(),
          position: playerInfo.position,
          ageGroup,
          overallRating: headline.overall_rating,
          offensiveRating: headline.offensive_score,
          defensiveRating: headline.defensive_score,
        }),
        isPublic: false,
        isFeatured: false,
        registrationStatus: "approved",
      },
    });

    await this.persistMetrics(player.id, metrics);
    try {
      await this.sipRecalc.recalculatePlayer(player.id);
    } catch {
      // Profile intelligence can rebuild aggregates on next public view.
    }

    return {
      player: {
        id: player.id,
        slug: player.slug,
        displayName: player.displayName,
      },
      ...this.formatResult(
        player.id,
        player.displayName,
        player.positionPrimary,
        true,
        result
      ),
    };
  }

  private async persistMetrics(playerId: string, legacy: LegacyMatchMetricsDto) {
    const data = legacyMatchMetricsToPlayerMatchRecord(legacy);
    const existing = await this.prisma.playerMatchMetrics.findFirst({
      where: {
        playerId,
        match: { competition: "Calibration import" },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      await this.prisma.playerMatchMetrics.update({
        where: { id: existing.id },
        data,
      });
      return;
    }

    const match = await this.prisma.match.create({
      data: {
        competition: "Calibration import",
        season: String(new Date().getFullYear()),
        playedAt: new Date(),
      },
    });

    await this.prisma.playerMatchMetrics.create({
      data: {
        playerId,
        matchId: match.id,
        ...data,
      },
    });
  }

  private emptyMetrics(): MatchMetricsRow {
    return {
      minutesPlayed: 0,
      ballTouches: 0,
      totalDistanceMiles: 0,
      sprintDistanceYards: 0,
      firstStepAccelerations: 0,
      intenseAccelerations: 0,
      kickingPowerMph: 0,
      topSpeedMph: 0,
      sprints: 0,
      intenseTurns: 0,
      avgTurnEntrySpeedMph: 0,
      avgTurnExitSpeedMph: 0,
      leftTurns: 0,
      rightTurns: 0,
      backTurns: 0,
      distanceWithBallYards: 0,
      topSpeedWithBallMph: 0,
      intenseTurnsWithBall: 0,
    };
  }
}
