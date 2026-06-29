import type { Prisma, PrismaClient } from "@prisma/client";
import { ADS_CONFIG_KEY, DEFAULT_AD_SLOTS } from "../ads/ads.constants";
import { seedRbac } from "./seed-rbac";
import {
  seedLegacyAcademies,
  seedLegacyPlayers,
  seedMvce,
  seedScoreboard,
} from "./prisma-seed-modules";
import { isFullSeed, type SeedOptions } from "./seed-options";
import { legacyMatchMetricsToPlayerMatchRecord } from "../sip/legacy-match-metrics-mapper";
import type { LegacyMatchMetricsDto } from "../admin/dto/calibration-player-info.dto";

/**
 * Production use only by trusted admins via POST /api/v1/admin/database/seed.
 * Incremental mode (default) upserts missing seed entities without resetting
 * admin-edited statuses. Full mode overwrites ads.config and academy passwords.
 */
export const SEED_PLAYER_ID = "00000000-0000-4000-8000-000000000001";

const SEED_RATING_ATTRIBUTES = {
  pace: 78,
  acceleration: 80,
  sprint_speed: 76,
  stamina: 74,
  strength: 62,
  agility: 83,
  dribbling: 84,
  ball_control: 86,
  passing: 82,
  finishing: 71,
  technique: 85,
  first_touch: 84,
  vision: 81,
  composure: 76,
  decision_making: 78,
  work_rate: 73,
  positioning: 77,
  team_play: 80,
};

const SEED_BENCHMARK_METADATA = {
  nearest: {
    full_name: "Kevin De Bruyne",
    position: "AM",
    archetype: "Elite Creator",
    nationality: "Belgium",
    overall_rating: 90,
    __similarity: 72,
    pace: 76,
    acceleration: 76,
    sprint_speed: 74,
    stamina: 82,
    strength: 78,
    agility: 80,
    dribbling: 86,
    ball_control: 89,
    passing: 92,
    finishing: 84,
    technique: 91,
    first_touch: 90,
    vision: 94,
    composure: 88,
    decision_making: 91,
    work_rate: 87,
    positioning: 86,
    team_play: 90,
  },
  alternatives: [],
  filterInfo: { poolSize: 20 },
  calibrationMetrics: {
    duration: 78,
    ball_touches: 62,
    one_touch_possessions_percentage: 45.2,
    multi_touch_possessions__percentage: 54.8,
    possession_duration_seconds: 3.2,
    quick_release_score: 45.2,
    left_foot_release_percentage: 34.8,
    right_foot_release_percentage: 65.2,
    left_foot_touch_percentage: 38.7,
    right_foot_touch_percentage: 61.3,
    release_laces_percentage: 40,
    turn_efficiency: 1.2,
    kicking_power: 58,
    top_speed_with_ball: 16.5,
    distance_with_ball: 280,
    first_step_accelerations: 14,
    sprints: 18,
  },
};

const ISMAEL_SALISU_CALIBRATION_METRICS = {
  duration: 82,
  ball_touches: 74,
  one_touch_possessions_percentage: 36.4,
  multi_touch_possessions__percentage: 63.6,
  possession_duration_seconds: 4.8,
  quick_release_score: 36.4,
  left_foot_release_percentage: 48,
  right_foot_release_percentage: 52,
  left_foot_touch_percentage: 46,
  right_foot_touch_percentage: 54,
  release_laces_percentage: 38,
  turn_efficiency: 1.15,
  kicking_power: 62,
  top_speed: 18.4,
  first_step_accelerations: 11,
  intense_turns: 9,
  sprints: 14,
};

async function seedDemoCalibrationPlayer(
  prisma: PrismaClient,
  slug: string,
  calibrationMetrics: LegacyMatchMetricsDto
): Promise<void> {
  const player = await prisma.player.findUnique({
    where: { slug },
    select: { id: true, benchmarkMetadata: true },
  });
  if (!player) return;

  const existingMeta =
    player.benchmarkMetadata && typeof player.benchmarkMetadata === "object"
      ? (player.benchmarkMetadata as Record<string, unknown>)
      : {};
  const existingCal =
    existingMeta.calibrationMetrics && typeof existingMeta.calibrationMetrics === "object"
      ? (existingMeta.calibrationMetrics as Record<string, unknown>)
      : {};
  const mergedCalibration = { ...calibrationMetrics, ...existingCal };
  const needsCalibrationMerge = Object.entries(calibrationMetrics).some(([key, value]) => {
    const current = existingCal[key];
    return current == null && value != null;
  });
  if (needsCalibrationMerge) {
    await prisma.player.update({
      where: { id: player.id },
      data: {
        benchmarkMetadata: {
          ...existingMeta,
          calibrationMetrics: mergedCalibration,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  const existingMetrics = await prisma.playerMatchMetrics.findFirst({
    where: { playerId: player.id },
  });
  const matchRecord = legacyMatchMetricsToPlayerMatchRecord(calibrationMetrics);

  if (!existingMetrics) {
    const match = await prisma.match.create({
      data: {
        competition: "Calibration import",
        season: String(new Date().getFullYear()),
        playedAt: new Date(),
      },
    });
    await prisma.playerMatchMetrics.create({
      data: {
        playerId: player.id,
        matchId: match.id,
        ...matchRecord,
      },
    });
    return;
  }

  await prisma.playerMatchMetrics.updateMany({
    where: { playerId: player.id },
    data: {
      possessionDurationSeconds: matchRecord.possessionDurationSeconds,
    },
  });
}

const SEED_MEDIA_ITEMS = [
  {
    type: "video",
    title: "Match highlight reel",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  },
];

export type SeedPhaseError = {
  phase: string;
  message: string;
};

export type SeedResult = {
  ok: boolean;
  mode: "incremental" | "full";
  durationMs: number;
  seedPlayerId: string;
  counts: {
    players: number;
    academies: number;
    competitions: number;
    blogPosts: number;
    legacyPlayers: number;
    legacyAcademies: number;
    legacyAcademyLinks: number;
    staticContentKeys: number;
  };
  legacySampleSlugs: string[];
  errors: SeedPhaseError[];
  completedAt: string;
};

type SeedPhase = {
  name: string;
  run: () => Promise<void>;
};

export async function runDatabaseSeed(
  prisma: PrismaClient,
  options?: SeedOptions
): Promise<SeedResult> {
  const mode = isFullSeed(options) ? "full" : "incremental";
  const startedAt = Date.now();
  const errors: SeedPhaseError[] = [];
  let seedPlayerId = SEED_PLAYER_ID;
  let legacyPlayers = 0;
  let legacyAcademyLinks = 0;
  let legacySampleSlugs: string[] = [];
  let legacyAcademyCount = 0;
  const staticContentKeyCount = 28;

  const phases: SeedPhase[] = [
    {
      name: "rbac",
      run: async () => {
        await seedRbac(prisma);
      },
    },
    {
      name: "core-player",
      run: async () => {
        const corePlayerUpdate = {
          slug: "alli-o-sanni",
          positionFull: "ATTACKING MIDFIELDER",
          playingPhilosophies: ["Tiki-Taka", "Total Football"],
          biography:
            "Creative attacking midfielder from Lagos with elite close control and progressive passing.",
          videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          overallRating: 79,
          offensiveRating: 82,
          defensiveRating: 73,
          careerGoals: 4,
          careerAssists: 6,
          careerAppearances: 11,
          careerMinutes: 847,
          ratingAttributes: SEED_RATING_ATTRIBUTES,
          benchmarkMetadata: SEED_BENCHMARK_METADATA,
          mediaItems: SEED_MEDIA_ITEMS,
          scoutingSummary:
            "ALLI O. SANNI profiles as a U18 pro-ready attacking midfielder with standout ball control, passing range, and creative decision-making. Scouts should validate the benchmark fit with recent match footage and tournament-level opposition.",
          ...(mode === "full"
            ? {
                isFeatured: true,
                isPublic: true,
                registrationStatus: "approved",
              }
            : {}),
        };

        const player = await prisma.player.upsert({
          where: { id: SEED_PLAYER_ID },
          update: corePlayerUpdate,
          create: {
            id: SEED_PLAYER_ID,
            firstName: "ALLI",
            lastName: "SANNI",
            displayName: "ALLI O. SANNI",
            slug: "alli-o-sanni",
            positionPrimary: "AM",
            positionFull: "ATTACKING MIDFIELDER",
            playingPhilosophies: ["Tiki-Taka", "Total Football"],
            nationality: "Nigerian",
            city: "Lagos",
            state: "Lagos",
            age: 17,
            ageGroup: "U18",
            dominantFoot: "Right",
            isFeatured: true,
            isPublic: true,
            registrationStatus: "approved",
            biography:
              "Creative attacking midfielder from Lagos with elite close control and progressive passing.",
            videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            overallRating: 79,
            offensiveRating: 82,
            defensiveRating: 73,
            careerGoals: 4,
            careerAssists: 6,
            careerAppearances: 11,
            careerMinutes: 847,
            ratingAttributes: SEED_RATING_ATTRIBUTES,
            benchmarkMetadata: SEED_BENCHMARK_METADATA,
            mediaItems: SEED_MEDIA_ITEMS,
            scoutingSummary:
              "ALLI O. SANNI profiles as a U18 pro-ready attacking midfielder with standout ball control, passing range, and creative decision-making. Scouts should validate the benchmark fit with recent match footage and tournament-level opposition.",
          },
        });
        seedPlayerId = player.id;

        const existingMetrics = await prisma.playerMatchMetrics.findFirst({
          where: { playerId: player.id },
        });

        if (!existingMetrics) {
          const match = await prisma.match.create({
            data: {
              competition: "NLO",
              season: "2025-26",
              playedAt: new Date(),
            },
          });

          await prisma.playerMatchMetrics.create({
            data: {
              playerId: player.id,
              matchId: match.id,
              minutesPlayed: 78,
              ballTouches: 62,
              oneTouchPossessions: 28,
              multiTouchPossessions: 34,
              possessionDurationSeconds: 3.2,
              releaseInsideFootCount: 22,
              releaseLacesCount: 18,
              releaseOtherFootzoneCount: 6,
              leftFootTouchCount: 24,
              rightFootTouchCount: 38,
              leftFootReleaseCount: 16,
              rightFootReleaseCount: 30,
              leftFootReceiveCount: 20,
              rightFootReceiveCount: 30,
              leftFootKickingPowerMph: 54,
              rightFootKickingPowerMph: 58,
              totalDistanceMiles: 6.2,
              sprintDistanceYards: 420,
              firstStepAccelerations: 14,
              intenseAccelerations: 22,
              kickingPowerMph: 58,
              topSpeedMph: 19.2,
              sprints: 18,
              intenseTurns: 12,
              avgTurnEntrySpeedMph: 8.5,
              avgTurnExitSpeedMph: 10.2,
              leftTurns: 8,
              rightTurns: 9,
              backTurns: 3,
              distanceWithBallYards: 280,
              topSpeedWithBallMph: 16.5,
              intenseTurnsWithBall: 7,
            },
          });
        } else if (existingMetrics.possessionDurationSeconds <= 0) {
          await prisma.playerMatchMetrics.update({
            where: { id: existingMetrics.id },
            data: { possessionDurationSeconds: 3.2 },
          });
        }

        const benchName = "Reference AM — Tiki-Taka";
        const existingBench = await prisma.tacticalBenchmark.findFirst({
          where: { playerName: benchName },
        });
        if (!existingBench) {
          await prisma.tacticalBenchmark.create({
            data: {
              playerName: benchName,
              position: "AM",
              country: "NG",
              clubStyle: "Possession",
              tacticalArchetype: "Possession Hub",
              tikiTakaScore: 88,
              gegenpressScore: 72,
              counterAttackScore: 65,
              totalFootballScore: 80,
              highLineScore: 70,
              wingerScore: 60,
              lowBlockScore: 45,
              bestSystemFit: "Tiki-Taka",
              description: "Seed benchmark for tactical match engine (Phase 2).",
            },
          });
        }
      },
    },
    {
      name: "blog-posts",
      run: async () => {
        await prisma.blogPost.upsert({
          where: { slug: "dtp-platform-launch" },
          update: {},
          create: {
            slug: "dtp-platform-launch",
            title: "DirectToPro Africa launches unified talent platform",
            excerpt:
              "One home for registration, scouting intelligence, and verified player profiles.",
            body: `DirectToPro Africa is rebuilding from the ground up with a single platform for players, scouts, and academies.

Public profiles, tactical intelligence, and market-value tools now share one player graph — so talent is never duplicated across disconnected systems.

Register your profile today and follow featured players as new match data flows in.`,
            publishedAt: new Date("2026-05-01"),
          },
        });

        await prisma.blogPost.upsert({
          where: { slug: "pathway-for-grassroots-talent" },
          update: {},
          create: {
            slug: "pathway-for-grassroots-talent",
            title: "A clear pathway from grassroots to global scouts",
            excerpt: "How verified data and video help African talent get seen.",
            body: `Grassroots players deserve the same visibility as academy graduates in Europe.

DTP combines match metrics, video, and tactical scoring so scouts can compare players fairly — not just by highlight reels.

Parents and guardians can register minors with consent workflows built for youth football compliance.`,
            publishedAt: new Date("2026-05-15"),
          },
        });
      },
    },
    {
      name: "academies",
      run: async () => {
        const dtpAcademy = await prisma.academy.upsert({
          where: { slug: "dtp-lagos-hub" },
          update: mode === "full" ? { isPublished: true } : {},
          create: {
            slug: "dtp-lagos-hub",
            name: "DTP Lagos Development Hub",
            city: "Lagos",
            country: "Nigeria",
            description:
              "Flagship development centre for U15–U19 talent with weekly tactical review and video analysis.",
            websiteUrl: "https://www.dtp.africa",
          },
        });

        await prisma.player.update({
          where: { id: seedPlayerId },
          data: { academyId: dtpAcademy.id },
        });

        await prisma.academy.upsert({
          where: { slug: "abuja-elite-academy" },
          update: {},
          create: {
            slug: "abuja-elite-academy",
            name: "Abuja Elite Football Academy",
            city: "Abuja",
            country: "Nigeria",
            description:
              "Partner academy focused on physical preparation and competitive league placement.",
          },
        });
      },
    },
    {
      name: "static-content",
      run: async () => {
        const staticRows: { key: string; value: string }[] = [
          { key: "home.eyebrow", value: "From the Streets to the Stadium" },
          { key: "home.headline", value: "Global stage for local talent" },
          {
            key: "home.lead",
            value:
              "DirectToPro Africa connects grassroots football talent to scouts, academies, and clubs through verified data, tactical intelligence, and market-value insight.",
          },
          { key: "home.primaryCta", value: "Register talent" },
          { key: "home.secondaryCta", value: "Featured players" },
          { key: "home.announcement.enabled", value: "false" },
          {
            key: "home.announcement.title",
            value: "DTP scouting windows are opening soon",
          },
          {
            key: "home.announcement.body",
            value:
              "Follow upcoming registration windows, academy showcases, and scouting updates from the DTP team.",
          },
          { key: "home.announcement.ctaLabel", value: "Contact us" },
          { key: "home.announcement.ctaHref", value: "/contact" },
          { key: "home.event.enabled", value: "false" },
          { key: "home.event.title", value: "Next showcase event" },
          { key: "home.event.date", value: "Dates to be announced" },
          { key: "home.event.venue", value: "Nigeria" },
          {
            key: "home.event.body",
            value:
              "Publish event details here when tickets, trials, or showcase registration opens.",
          },
          { key: "home.event.ctaLabel", value: "Register interest" },
          { key: "home.event.ctaHref", value: "/contact" },
          { key: "home.featuredVideo.enabled", value: "false" },
          { key: "home.featuredVideo.title", value: "Featured video" },
          { key: "home.featuredVideo.url", value: "https://www.youtube.com/" },
          {
            key: "home.featuredVideo.caption",
            value: "Use this section for a campaign, player highlight, or academy story.",
          },
          { key: "home.winsWall.enabled", value: "false" },
          { key: "home.winsWall.title", value: "Trusted by the DTP network" },
          {
            key: "home.winsWall.logos",
            value: '[{"name":"DTP Lagos Hub","imageUrl":"","href":"/academy"}]',
          },
          {
            key: "homepage.video-highlights",
            value: JSON.stringify(
              [
                {
                  id: "hl-sikiru-defending-prowess",
                  playerName: "YUSUFF SIKIRU",
                  title: "Defending Prowess",
                  youtubeUrl: "https://youtu.be/YmRafZN6FYk",
                  sortOrder: 0,
                },
                {
                  id: "hl-emmanuel-strong-defense",
                  playerName: "OLUGBE EMMANUEL",
                  title: "Strong Defense Ability",
                  youtubeUrl: "https://youtu.be/znTjvLeagsw",
                  sortOrder: 1,
                },
                {
                  id: "hl-sikiru-great-defensive",
                  playerName: "YUSUFF SIKIRU",
                  title: "Great defensive ability",
                  youtubeUrl: "https://youtu.be/01_IXNYUMac",
                  sortOrder: 2,
                },
              ],
              null,
              2
            ),
          },
          {
            key: "about.mission",
            value:
              "Connect African grassroots football talent to global opportunity through verified data, transparent ratings, and trusted scouting tools.",
          },
          {
            key: "about.vision",
            value:
              "Every talented player — regardless of postcode — has a verifiable pathway to professional opportunity.",
          },
          { key: "contact.whatsapp", value: "+2348000000000" },
          { key: "contact.email", value: "hello@dtp.africa" },
        ];

        for (const row of staticRows) {
          await prisma.staticContent.upsert({
            where: { key: row.key },
            update: mode === "full" ? { value: row.value } : {},
            create: row,
          });
        }
      },
    },
    {
      name: "ads-config",
      run: async () => {
        await prisma.staticContent.upsert({
          where: { key: ADS_CONFIG_KEY },
          update:
            mode === "full"
              ? { value: JSON.stringify({ slots: DEFAULT_AD_SLOTS }) }
              : {},
          create: {
            key: ADS_CONFIG_KEY,
            value: JSON.stringify({ slots: DEFAULT_AD_SLOTS }),
          },
        });
      },
    },
    {
      name: "scoreboard",
      run: async () => {
        await seedScoreboard(prisma, seedPlayerId, { mode });
      },
    },
    {
      name: "mvce",
      run: async () => {
        await seedMvce(prisma, seedPlayerId);
      },
    },
    {
      name: "legacy-academies",
      run: async () => {
        legacyAcademyCount = await seedLegacyAcademies(prisma, { mode });
      },
    },
    {
      name: "legacy-players",
      run: async () => {
        const legacyResult = await seedLegacyPlayers(prisma, { mode });
        legacyPlayers = legacyResult.playerCount;
        legacyAcademyLinks = legacyResult.academyLinkCount;
        legacySampleSlugs = legacyResult.sampleSlugs;
      },
    },
    {
      name: "demo-player-metrics",
      run: async () => {
        await seedDemoCalibrationPlayer(
          prisma,
          "ismael-salisu",
          ISMAEL_SALISU_CALIBRATION_METRICS
        );
      },
    },
  ];

  for (const phase of phases) {
    try {
      await phase.run();
    } catch (err) {
      errors.push({
        phase: phase.name,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const [players, academies, competitions, blogPosts] = await Promise.all([
    prisma.player.count(),
    prisma.academy.count(),
    prisma.sbCompetition.count(),
    prisma.blogPost.count(),
  ]);

  const durationMs = Date.now() - startedAt;

  return {
    ok: errors.length === 0,
    mode,
    durationMs,
    seedPlayerId,
    counts: {
      players,
      academies,
      competitions,
      blogPosts,
      legacyPlayers,
      legacyAcademies: legacyAcademyCount,
      legacyAcademyLinks,
      staticContentKeys: staticContentKeyCount,
    },
    legacySampleSlugs,
    errors,
    completedAt: new Date().toISOString(),
  };
}
