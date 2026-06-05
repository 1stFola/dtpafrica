import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  playerToLegacyMeta,
  normalizeClubName,
  runCalibration,
  type MatchMetricsRow,
  type PlayerCalibrationMeta,
} from "@dtp/engines";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { resolveUniquePlayerSlug } from "../players/player-slug";
import { CalibrationMetricsDto } from "./dto/calibration-metrics.dto";
import {
  CalibrationPlayerInfoDto,
  LegacyMatchMetricsDto,
} from "./dto/calibration-player-info.dto";

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
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private parseHeightFt(heightFt?: string): number | undefined {
    if (!heightFt?.trim()) return undefined;
    const match = heightFt.trim().match(/(\d+)['']?(\d+)?/);
    if (!match) return undefined;
    const feet = parseInt(match[1], 10) || 0;
    const inches = parseInt(match[2] ?? "0", 10) || 0;
    return Math.round((feet * 12 + inches) * 2.54);
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

  private rowToLegacyMetrics(m: MatchMetricsRow): LegacyMatchMetricsDto {
    return {
      duration: m.minutesPlayed,
      total_distance: m.totalDistanceMiles,
      sprint_distance: m.sprintDistanceYards,
      sprints: m.sprints,
      top_speed: m.topSpeedMph ?? 0,
      first_step_accelerations: m.firstStepAccelerations,
      intense_accelerations: m.intenseAccelerations,
      intense_turns: m.intenseTurns,
      avg_turn_entry: m.avgTurnEntrySpeedMph ?? 0,
      avg_turn_exit: m.avgTurnExitSpeedMph ?? 0,
      turn_efficiency: 0,
      left_turns: m.leftTurns,
      right_turns: m.rightTurns,
      back_turns: m.backTurns,
      ball_touches: m.ballTouches,
      possession_duration_seconds: 0,
      one_touch_possessions_percentage: 0,
      multi_touch_possessions__percentage: 0,
      quick_release_score: 0,
      distance_with_ball: m.distanceWithBallYards,
      top_speed_with_ball: m.topSpeedWithBallMph ?? 0,
      intense_turns_with_ball: m.intenseTurnsWithBall,
      kicking_power: m.kickingPowerMph ?? 0,
      release_inside_foot_percentage: 0,
      release_laces_percentage: 0,
      release_other_footzone_percentage: 0,
      left_foot_touch_percentage: 0,
      left_foot_release_percentage: 0,
      left_foot_receive_percentage: 0,
      left_foot_kicking_power_mph: 0,
      right_foot_touch_percentage: 0,
      right_foot_release_percentage: 0,
      right_foot_receive_percentage: 0,
      right_foot_kicking_power_mph: 0,
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

  private buildBenchmarkMetadata(result: ReturnType<typeof runCalibration>) {
    return {
      nearest: result.nearestBenchmark,
      alternatives: result.alternativeBenchmarks,
      filterInfo: result.filterInfo,
    };
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
    const player = await this.prisma.player.findUnique({ where: { id: playerId } });
    if (!player) throw new NotFoundException("Player not found");

    const metrics = await this.prisma.playerMatchMetrics.findFirst({
      where: { playerId },
      orderBy: { createdAt: "desc" },
    });

    const heightFt =
      player.heightCm != null
        ? `${Math.floor(player.heightCm / 30.48)}'${Math.round((player.heightCm % 30.48) / 2.54)}"`
        : "";

    return {
      player: {
        id: player.id,
        fullName: player.displayName,
        gender: "Male",
        dateOfBirth: player.dateOfBirth?.toISOString().slice(0, 10) ?? null,
        position: player.positionPrimary,
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
      metrics: metrics ? this.rowToLegacyMetrics(this.toMetricsRow(metrics)) : null,
    };
  }

  runAdhoc(
    player: CalibrationPlayerInfoDto,
    metrics: LegacyMatchMetricsDto,
    save = false
  ) {
    if (!player.fullName?.trim()) {
      throw new BadRequestException("Full name is required");
    }
    if (!player.position) {
      throw new BadRequestException("Position is required");
    }
    const result = runCalibration(
      this.legacyMetricsToRow(metrics),
      this.infoToLegacyMeta(player)
    );
    return this.formatResult(null, player.fullName, player.position, save, result);
  }

  async runForPlayer(
    playerId: string,
    options: {
      save?: boolean;
      metricsOverride?: CalibrationMetricsDto | LegacyMatchMetricsDto;
      playerInfo?: CalibrationPlayerInfoDto;
    } = {}
  ) {
    const player = await this.prisma.player.findUnique({ where: { id: playerId } });
    if (!player) throw new NotFoundException("Player not found");

    const stored = await this.prisma.playerMatchMetrics.findFirst({
      where: { playerId },
      orderBy: { createdAt: "desc" },
    });

    const legacyOverride =
      options.metricsOverride && "duration" in options.metricsOverride
        ? this.legacyMetricsToRow(options.metricsOverride as LegacyMatchMetricsDto)
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

    const meta = options.playerInfo
      ? this.infoToLegacyMeta(options.playerInfo)
      : playerToLegacyMeta(player);

    const result = runCalibration(metrics, meta);

    if (options.save) {
      await this.prisma.player.update({
        where: { id: playerId },
        data: {
          overallRating: result.rawSummary.overall_rating,
          offensiveRating: result.rawSummary.offensive_score,
          defensiveRating: result.rawSummary.defensive_score,
          displayName: options.playerInfo?.fullName ?? player.displayName,
          positionPrimary: options.playerInfo?.position ?? player.positionPrimary,
          nationality: options.playerInfo?.nationality ?? player.nationality,
          dateOfBirth: options.playerInfo?.dateOfBirth
            ? new Date(options.playerInfo.dateOfBirth)
            : player.dateOfBirth,
          heightCm: options.playerInfo?.heightFt
            ? this.parseHeightFt(options.playerInfo.heightFt)
            : player.heightCm,
          weightKg: options.playerInfo?.weightKg ?? player.weightKg,
          city: options.playerInfo?.currentClub
            ? normalizeClubName(options.playerInfo.currentClub)
            : player.city,
          playerPhotoUrl: options.playerInfo?.photoUrl ?? player.playerPhotoUrl,
          videoUrl: options.playerInfo?.videoUrl ?? player.videoUrl,
          ratingAttributes: this.toJson(result.calibrated),
          benchmarkMetadata: this.toJson(this.buildBenchmarkMetadata(result)),
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
              overallRating: result.rawSummary.overall_rating,
              offensiveRating: result.rawSummary.offensive_score,
              defensiveRating: result.rawSummary.defensive_score,
            }),
        },
      });

      await this.persistMetrics(playerId, metrics);
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
    metrics: LegacyMatchMetricsDto
  ) {
    if (!playerInfo.fullName?.trim()) {
      throw new BadRequestException("Full name is required");
    }
    if (!playerInfo.position) {
      throw new BadRequestException("Position is required");
    }

    const metricsRow = this.legacyMetricsToRow(metrics);
    const result = runCalibration(metricsRow, this.infoToLegacyMeta(playerInfo));
    const { firstName, lastName } = this.splitFullName(playerInfo.fullName);
    const dob = playerInfo.dateOfBirth ? new Date(playerInfo.dateOfBirth) : null;
    const age =
      dob != null
        ? new Date().getFullYear() - dob.getFullYear()
        : undefined;
    const ageGroup =
      age == null
        ? undefined
        : age <= 15
          ? "U15"
          : age <= 17
            ? "U17"
            : age <= 20
              ? "U20"
              : age <= 23
                ? "U23"
                : "Senior";

    const slug = await resolveUniquePlayerSlug(
      this.prisma,
      playerInfo.fullName.trim()
    );
    const player = await this.prisma.player.create({
      data: {
        firstName,
        lastName,
        displayName: playerInfo.fullName.trim(),
        positionPrimary: playerInfo.position,
        nationality: playerInfo.nationality,
        dateOfBirth: dob,
        age,
        ageGroup,
        heightCm: this.parseHeightFt(playerInfo.heightFt),
        weightKg: playerInfo.weightKg,
        city: playerInfo.currentClub ? normalizeClubName(playerInfo.currentClub) : undefined,
        playerPhotoUrl: playerInfo.photoUrl,
        videoUrl: playerInfo.videoUrl,
        slug,
        overallRating: result.rawSummary.overall_rating,
        offensiveRating: result.rawSummary.offensive_score,
        defensiveRating: result.rawSummary.defensive_score,
        ratingAttributes: this.toJson(result.calibrated),
        benchmarkMetadata: this.toJson(this.buildBenchmarkMetadata(result)),
        mediaItems: this.toJson(
          this.buildMediaItems(playerInfo.photoUrl, playerInfo.videoUrl)
        ),
        scoutingSummary: this.generateScoutingSummary({
          displayName: playerInfo.fullName.trim(),
          position: playerInfo.position,
          ageGroup,
          overallRating: result.rawSummary.overall_rating,
          offensiveRating: result.rawSummary.offensive_score,
          defensiveRating: result.rawSummary.defensive_score,
        }),
        isPublic: false,
        isFeatured: false,
        registrationStatus: "approved",
      },
    });

    await this.persistMetrics(player.id, metricsRow);

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

  private async persistMetrics(playerId: string, row: MatchMetricsRow) {
    const data = this.metricsRecordFromRow(row);
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
