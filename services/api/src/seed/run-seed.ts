import type { Prisma, PrismaClient } from "@prisma/client";
import { ADS_CONFIG_KEY, DEFAULT_AD_SLOTS } from "../ads/ads.constants";
import { seedRbac } from "./seed-rbac";
import {
  seedLegacyAcademies,
  seedLegacyPlayers,
  seedMvce,
  seedScoreboard,
  seedScoutToProInternationalTournament2026,
} from "./prisma-seed-modules";
import { isFullSeed, type SeedOptions } from "./seed-options";
import { legacyMatchMetricsToPlayerMatchRecord } from "../sip/legacy-match-metrics-mapper";
import type { LegacyMatchMetricsDto } from "../admin/dto/calibration-player-info.dto";
import { normalizePlayerAgeCategory } from "../players/age-category";
import { syncPlayerAgeCategories } from "../../prisma/sync-player-age-categories";
import { matchAcademyByClubName } from "../academy/academy-linking.util";

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

async function syncPlayerAcademyLinksFromClubNames(prisma: PrismaClient): Promise<number> {
  const [academies, players] = await Promise.all([
    prisma.academy.findMany({ select: { id: true, name: true, slug: true } }),
    prisma.player.findMany({
      where: {
        academyId: null,
        city: { not: null },
      },
      select: { id: true, city: true },
    }),
  ]);

  let updated = 0;
  for (const player of players) {
    const academy = matchAcademyByClubName(player.city, academies);
    if (!academy) continue;
    await prisma.player.update({
      where: { id: player.id },
      data: {
        academyId: academy.id,
        city: null,
      },
    });
    updated += 1;
  }
  return updated;
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
  const staticContentKeyCount = 88;

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
            "ALLI O. SANNI profiles as an Under 18 pro-ready attacking midfielder with standout ball control, passing range, and creative decision-making. Scouts should validate the benchmark fit with recent match footage and tournament-level opposition.",
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
            ageGroup: normalizePlayerAgeCategory({ age: 17 }),
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
              "ALLI O. SANNI profiles as an Under 18 pro-ready attacking midfielder with standout ball control, passing range, and creative decision-making. Scouts should validate the benchmark fit with recent match footage and tournament-level opposition.",
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
        const suppliedBlogPosts = [
          {
            slug: "when-a-dream-becomes-a-trap",
            title: "When a Dream Becomes a Trap",
            excerpt:
              "How young footballers and families can spot exploitation, fake trials, and unsafe pathways before dreams are hijacked.",
            body: `Across Africa, football is more than a game. For millions of young players, it is a dream, a way out, a family hope, and sometimes the only visible road to a different future.

That dream is powerful. It is also vulnerable.

Too often, talented players and their families are pushed into unsafe football pathways by people who promise trials, contracts, travel, exposure, or agent connections without proof. Some players pay money they cannot afford. Some travel without proper documentation. Some disappear into systems where nobody can verify who they are, what they have achieved, or whether the opportunity is real.

The problem is not ambition. The problem is the absence of trusted structure.

At DirectToPro Africa, we believe talent should not have to depend on chance, guesswork, or desperate introductions. A player should be visible through verified data, credible scouting context, match evidence, and transparent football information.

Warning signs every player and family should know

Be careful when anyone asks for money before showing verifiable details about the club, competition, scout, or trial. Be careful when a promised opportunity has no official email, no written invitation, no clear location, no responsible contact, and no way to check the source.

A serious football pathway should be traceable. It should protect the player. It should explain the next step clearly.

What a safer pathway looks like

A safer pathway starts with documentation. Players need accurate profiles, age records, position data, match footage, verified statistics, and a clear sporting history. Scouts need context that helps them compare players fairly. Families need confidence that the process is not built on pressure or secrecy.

This is why DTP Africa focuses on verified player profiles, role-based ratings, match data, and transparent scouting intelligence.

The dream should remain a dream

Football can still open doors. It can still change lives. But the pathway must become safer, more accountable, and more professional.

Our mission is simple: help African talent be seen the right way, by the right people, through a process that respects the player and protects the dream.`,
            publishedAt: new Date("2026-07-02"),
          },
          {
            slug: "inside-the-directtopro-africa-rating-system",
            title: "Inside the DirectToPro Africa Rating System",
            excerpt:
              "How DTP Africa evaluates players by role using physical, technical, mental, and tactical pillars.",
            body: `Talent is not one thing.

A winger, a centre back, a goalkeeper, and an attacking midfielder should not be judged by the same football questions. Speed may matter differently for each role. Decision-making may show up in different ways. Technical quality depends on what the position demands.

That is why the DirectToPro Africa rating system is built around role-based evaluation.

The four evaluation pillars

Our framework studies players through four major pillars: physical, technical, mental, and tactical.

Physical data helps us understand movement, speed, intensity, acceleration, and athletic output. Technical data looks at ball contact, control, foot usage, release habits, and execution. Mental indicators focus on consistency, resilience, discipline, and response under pressure. Tactical evaluation considers role understanding, positioning, team function, and decision quality.

Why role-based scoring matters

A 78 rating for a defensive midfielder does not mean the same thing as a 78 rating for a striker. The system weights categories based on what a player is being asked to do on the pitch.

For example, a fullback may be judged heavily on repeated running, defensive actions, recovery speed, and wide-ball contribution. A striker may be judged more on movement, finishing threat, acceleration, and attacking decisions.

The goal is not to flatten football into one number. The goal is to make player comparison more honest.

What the rating levels mean

DTP ratings help scouts and coaches quickly understand where a player sits in their development journey. A lower score can still represent a player with strong potential if the role context and age profile support it. A higher score indicates stronger evidence across the weighted pillars for that position.

The rating should always be read with match footage, player history, and scouting notes.

Data supports the eye, it does not replace it

We believe the best scouting combines human football judgment with verified information. Data can reveal patterns, reduce bias, and make hidden talent easier to compare. But the game still needs experienced eyes.

DTP Africa is building that bridge: verified data, role context, match evidence, and opportunity in one place.`,
            publishedAt: new Date("2026-07-01"),
          },
        ];

        for (const post of suppliedBlogPosts) {
          await prisma.blogPost.upsert({
            where: { slug: post.slug },
            update: post,
            create: post,
          });
        }

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
          { key: "home.headlineAccent", value: "Local talent" },
          {
            key: "home.lead",
            value:
              "DirectToPro Africa connects grassroots football talent to scouts, academies, and clubs through verified data, tactical intelligence, and market-value insight.",
          },
          { key: "home.primaryCta", value: "Register talent" },
          { key: "home.secondaryCta", value: "Featured players" },
          { key: "home.marquee.phrase", value: "from local roots to global reach" },
          { key: "home.reel.url", value: "https://youtu.be/uIgqg7m9EDA" },
          {
            key: "home.reel.body",
            value:
              "DTP Africa is building the intelligence and data infrastructure, to turn the overlooked African football talent into verifiable and discoverable opportunity.",
          },
          { key: "home.reel.cta", value: "Watch Reel" },
          { key: "home.featured.kicker", value: "Featured Talent" },
          { key: "home.featured.title", value: "Discover verified prospects" },
          {
            key: "home.featured.body",
            value:
              "Scout-rated profiles with position fit, ratings, and match-verified career stats.",
          },
          { key: "home.featured.cta", value: "View All Talents" },
          { key: "home.intel.kicker", value: "Intelligence Suite" },
          { key: "home.intel.title", value: "Scout smarter. Value with confidence" },
          {
            key: "home.intel.body",
            value:
              "Tactical fit from SIP and market-value bands from MVCE - built for African grassroots talent.",
          },
          {
            key: "home.intel.cardTitle",
            value: "Scouting Hub | Tactical fit & Strong XI",
          },
          {
            key: "home.intel.cardBody",
            value:
              "Philosophy matching, formation-aware Strong XI picks, and position-fit confidence for every verified profile.",
          },
          { key: "home.intel.cardCta", value: "Explore Scouting" },
          { key: "home.footage.kicker", value: "Player Highlights" },
          { key: "home.footage.title", value: "Curated match footage" },
          {
            key: "home.footage.body",
            value:
              "Verified clips from Jagaban Cup, 1XCup, and NLO - defensive reads, goals, and game-changing moments.",
          },
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
              "At DirectToPro Africa, we digitally identify and connect African football talent to verified opportunities through trusted data, responsible scouting, and transparent player development pathways.",
          },
          {
            key: "about.vision",
            value:
              "Every talented player — regardless of postcode — has a verifiable pathway to professional opportunity.",
          },
          { key: "about.hero.kicker", value: "About DTP Africa" },
          {
            key: "about.hero.position",
            value: "African football intelligence, visibility, and evidence infrastructure.",
          },
          { key: "about.hero.title_line1", value: "Talent is everywhere." },
          { key: "about.hero.title_line2", value: "Evidence is not." },
          {
            key: "about.hero.body",
            value:
              "Across Africa, exceptional footballers compete every day on community pitches, academy grounds, school fields, and local stadiums. Many have ability. Far fewer have access to the consistent documentation, credible performance evidence, structured visibility, and professional context that help football decision-makers evaluate potential with confidence.",
          },
          { key: "about.hero.change_line", value: "DTP Africa exists to change that." },
          { key: "about.hero.belief", value: "Make Talent Visible. Make Potential Verifiable." },
          { key: "about.problem.kicker", value: "The information gap" },
          { key: "about.problem.title_line1", value: "The talent is not missing." },
          { key: "about.problem.title_line2", value: "The visibility is." },
          { key: "about.problem.intro1", value: "Africa has never had a shortage of football talent." },
          {
            key: "about.problem.intro2",
            value:
              "The deeper challenge is that too much potential remains difficult to evaluate beyond the moment in which it is seen.",
          },
          {
            key: "about.problem.close_lead",
            value: "The result is an information gap between potential and opportunity.",
          },
          { key: "about.problem.close_body", value: "DTP Africa is working to close that gap." },
          {
            key: "about.manifesto.title",
            value:
              "We are building the infrastructure between grassroots football and professional decision-making.",
          },
          {
            key: "about.manifesto.body",
            value:
              "DTP Africa brings together football data, performance intelligence, match documentation, player profiling, digital visibility, and scouting context within a growing ecosystem.",
          },
          {
            key: "about.manifesto.emphasis",
            value: "Potential becomes more actionable when it is supported by better evidence.",
          },
          { key: "about.founder.kicker", value: "The Founder / CEO" },
          { key: "about.founder.name", value: "Fola Sanni" },
          { key: "about.founder.role", value: "Founder and CEO, DTP Africa" },
          {
            key: "about.founder.body",
            value:
              "Growing up in Nigeria and remaining deeply connected to its football culture, I saw a recurring problem that talent alone could not solve.\n\nAcross Africa, thousands of gifted young footballers compete, develop, and dedicate themselves to the game, yet too many remain outside the view of professional scouts, clubs, and academies. Not because the talent is absent, but because the evidence around that talent is often fragmented, inconsistent, or difficult to trust.\n\nAs a software and data engineer, I came to understand that the challenge was bigger than exposure.\n\nIt was also a problem of credibility.\n\nScouts and football decision-makers need more than potential. They need context, reliable performance information, structured player histories, and evidence they can evaluate with confidence.\n\nThat realization became the foundation for DTP Africa.\n\nI set out to help build infrastructure that gives grassroots players and local clubs a stronger, more credible digital presence-one capable of turning match activity, performance data, player records, and development history into a more verifiable football identity.\n\nFor me, this work is deeply personal.\n\nFootball can represent far more than competition. For many young players and their families, it can become a pathway to economic mobility, professional opportunity, education, travel, and a different future.\n\nWhat drives me is the belief that geography, limited visibility, or the absence of the right connection should not be the reason genuine potential goes unseen.\n\nThrough DTP Africa, I am applying my background in software, data, and systems thinking to a human challenge: building better infrastructure around grassroots football so that talent can be documented more clearly, evaluated more fairly, and discovered with greater confidence.",
          },
          {
            key: "about.founder.quote",
            value:
              "To help ensure that a player's future is shaped more by their ability, evidence, character, and drive-and less by how far they are from opportunity.",
          },
          { key: "about.final.kicker", value: "From Potential to Proof" },
          { key: "about.final.title", value: "From Potential to Proof." },
          { key: "about.final.body1", value: "The next exceptional player may already be playing." },
          {
            key: "about.final.body2",
            value:
              "The question is whether the football world will have enough evidence to recognize the opportunity.",
          },
          { key: "about.final.emphasis", value: "DTP Africa is building for that moment." },
          { key: "blog.hero.kicker", value: "DTP Africa Blog" },
          { key: "blog.hero.title", value: "Football intelligence deserves a stronger public record." },
          {
            key: "blog.hero.body",
            value:
              "Practical thinking on football development, transparent scouting, player protection, data-led evaluation, and the future of African talent discovery.",
          },
          { key: "featured_players.hero.kicker", value: "Verified talent intelligence" },
          {
            key: "featured_players.hero.title",
            value: "Featured players with proof behind the promise.",
          },
          {
            key: "featured_players.hero.body",
            value:
              "Explore player profiles shaped by ratings, tactical summaries, performance history, and scouting context from the DTP Africa intelligence ecosystem.",
          },
          { key: "register.hero.kicker", value: "Player evidence intake" },
          {
            key: "register.hero.title",
            value: "Start building a football identity that can be trusted.",
          },
          {
            key: "register.hero.body",
            value:
              "Submit a player profile for DTP review. Players under 18 require a parent or guardian on the form so the process stays clear, responsible, and properly documented.",
          },
          { key: "contact.hero.kicker", value: "Start the conversation" },
          { key: "contact.hero.title", value: "Bring the right football evidence into view." },
          {
            key: "contact.hero.body",
            value:
              "Reach the DTP Africa team for partnerships, scouting conversations, club onboarding, media, or platform support.",
          },
          { key: "contact.panel.kicker", value: "Direct channels" },
          {
            key: "contact.panel.title",
            value: "For clubs, scouts, academies, partners, and football families.",
          },
          { key: "contact.whatsapp", value: "+19452756104" },
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
      name: "scout-to-pro-international-tournament-2026",
      run: async () => {
        await seedScoutToProInternationalTournament2026(prisma, seedPlayerId, { mode });
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
    {
      name: "player-academy-links",
      run: async () => {
        const updated = await syncPlayerAcademyLinksFromClubNames(prisma);
        if (updated > 0) {
          console.log("Synced player academy links from club names:", updated);
        }
      },
    },
    {
      name: "player-age-categories",
      run: async () => {
        const updated = await syncPlayerAgeCategories(prisma);
        if (updated > 0) {
          console.log("Synced player age categories:", updated);
        }
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
