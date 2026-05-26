import { PrismaClient } from "@prisma/client";
import { seedMvce } from "./seed-mvce";
import { seedScoreboard } from "./seed-scoreboard";

const prisma = new PrismaClient();

const SEED_PLAYER_ID = "00000000-0000-4000-8000-000000000001";
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
};
const SEED_MEDIA_ITEMS = [
  {
    type: "video",
    title: "Match highlight reel",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  },
];

async function main() {
  const player = await prisma.player.upsert({
    where: { id: SEED_PLAYER_ID },
    update: {
      slug: "alli-o-sanni",
      isFeatured: true,
      isPublic: true,
      registrationStatus: "approved",
      biography:
        "Creative attacking midfielder from Lagos with elite close control and progressive passing.",
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      overallRating: 79,
      offensiveRating: 82,
      defensiveRating: 73,
      ratingAttributes: SEED_RATING_ATTRIBUTES,
      benchmarkMetadata: SEED_BENCHMARK_METADATA,
      mediaItems: SEED_MEDIA_ITEMS,
      scoutingSummary:
        "ALLI O. SANNI profiles as a U18 pro-ready attacking midfielder with standout ball control, passing range, and creative decision-making. Scouts should validate the benchmark fit with recent match footage and tournament-level opposition.",
    },
    create: {
      id: SEED_PLAYER_ID,
      firstName: "ALLI",
      lastName: "SANNI",
      displayName: "ALLI O. SANNI",
      slug: "alli-o-sanni",
      positionPrimary: "AM",
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
      ratingAttributes: SEED_RATING_ATTRIBUTES,
      benchmarkMetadata: SEED_BENCHMARK_METADATA,
      mediaItems: SEED_MEDIA_ITEMS,
      scoutingSummary:
        "ALLI O. SANNI profiles as a U18 pro-ready attacking midfielder with standout ball control, passing range, and creative decision-making. Scouts should validate the benchmark fit with recent match footage and tournament-level opposition.",
    },
  });

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
      releaseInsideFootCount: 22,
      releaseLacesCount: 18,
      releaseOtherFootzoneCount: 6,
      leftFootTouchCount: 24,
      rightFootTouchCount: 38,
      leftFootReceiveCount: 20,
      rightFootReceiveCount: 30,
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

  await prisma.academy.upsert({
    where: { slug: "dtp-lagos-hub" },
    update: {},
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

  const staticRows: { key: string; value: string }[] = [
    {
      key: "home.eyebrow",
      value: "From the Streets to the Stadium",
    },
    {
      key: "home.headline",
      value: "Global stage for local talent",
    },
    {
      key: "home.lead",
      value:
        "DirectToPro Africa connects grassroots football talent to scouts, academies, and clubs through verified data, tactical intelligence, and market-value insight.",
    },
    {
      key: "home.primaryCta",
      value: "Register talent",
    },
    {
      key: "home.secondaryCta",
      value: "Featured players",
    },
    {
      key: "home.announcement.enabled",
      value: "false",
    },
    {
      key: "home.announcement.title",
      value: "DTP scouting windows are opening soon",
    },
    {
      key: "home.announcement.body",
      value:
        "Follow upcoming registration windows, academy showcases, and scouting updates from the DTP team.",
    },
    {
      key: "home.announcement.ctaLabel",
      value: "Contact us",
    },
    {
      key: "home.announcement.ctaHref",
      value: "/contact",
    },
    {
      key: "home.event.enabled",
      value: "false",
    },
    {
      key: "home.event.title",
      value: "Next showcase event",
    },
    {
      key: "home.event.date",
      value: "Dates to be announced",
    },
    {
      key: "home.event.venue",
      value: "Nigeria",
    },
    {
      key: "home.event.body",
      value:
        "Publish event details here when tickets, trials, or showcase registration opens.",
    },
    {
      key: "home.event.ctaLabel",
      value: "Register interest",
    },
    {
      key: "home.event.ctaHref",
      value: "/contact",
    },
    {
      key: "home.featuredVideo.enabled",
      value: "false",
    },
    {
      key: "home.featuredVideo.title",
      value: "Featured video",
    },
    {
      key: "home.featuredVideo.url",
      value: "https://www.youtube.com/",
    },
    {
      key: "home.featuredVideo.caption",
      value: "Use this section for a campaign, player highlight, or academy story.",
    },
    {
      key: "home.winsWall.enabled",
      value: "false",
    },
    {
      key: "home.winsWall.title",
      value: "Trusted by the DTP network",
    },
    {
      key: "home.winsWall.logos",
      value:
        '[{"name":"DTP Lagos Hub","imageUrl":"","href":"/academy"}]',
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
    {
      key: "contact.whatsapp",
      value: "+2348000000000",
    },
    {
      key: "contact.email",
      value: "hello@dtp.africa",
    },
  ];

  for (const row of staticRows) {
    await prisma.staticContent.upsert({
      where: { key: row.key },
      update: { value: row.value },
      create: row,
    });
  }

  await seedScoreboard(prisma, player.id);
  await seedMvce(prisma, player.id);

  console.log("Seed complete. Player id:", player.id);
  console.log("Public profile: /player/alli-o-sanni");
  console.log("ScoreBoard: /scoreboard/competition/jagaban-cup-2026");
  console.log("MVCE: /valuation/player/" + player.id);
  console.log("Run: POST /api/v1/sip/players/" + player.id + "/recalculate");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
