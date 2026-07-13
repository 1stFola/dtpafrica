import type { Prisma, PrismaClient } from "@prisma/client";
import { playerLookupKey } from "@dtp/engines";
import { normalizePlayerAgeCategory } from "../src/players/age-category";

type GoalkeeperSeed = {
  slug: string;
  firstName: string;
  lastName: string;
  displayName: string;
  squadDisplayName: string;
  teamSlug: string;
  shirtNumber: number;
  ageGroup: string;
  age: number;
  heightCm: number;
  dominantFoot: string;
  overallRating: number;
  defensiveRating: number;
  cleanSheets: number;
  appearances: number;
  minutes: number;
  biography: string;
  scoutingSummary: string;
  ratingAttributes: Record<string, number>;
  benchmarkMetadata: Prisma.InputJsonValue;
  events: Array<{
    matchId: string;
    type: string;
    minute: number;
    detail: string;
  }>;
};

const GOALKEEPERS: GoalkeeperSeed[] = [
  {
    slug: "itodo-ocheme",
    firstName: "Itodo",
    lastName: "Ocheme",
    displayName: "Itodo Ocheme",
    squadDisplayName: "Itodo Ocheme",
    teamSlug: "broad-city-fc",
    shirtNumber: 1,
    ageGroup: normalizePlayerAgeCategory({ age: 18 }) ?? "Under 21",
    age: 18,
    heightCm: 188,
    dominantFoot: "Right",
    overallRating: 76,
    defensiveRating: 81,
    cleanSheets: 3,
    appearances: 5,
    minutes: 450,
    biography:
      "Goalkeeper profile built for ScoreBoard evidence: shot-stopping, box command, distribution, and match-control actions.",
    scoutingSummary:
      "Itodo Ocheme is profiled as a commanding goalkeeper whose strongest evidence comes from tournament ScoreBoard actions: saves, claims under pressure, and controlled restart distribution.",
    ratingAttributes: {
      reflexes: 80,
      handling: 77,
      positioning: 78,
      goalkeeper_distribution: 74,
      command_of_area: 79,
      one_v_one: 76,
      composure: 78,
      decision_making: 77,
      aerial_control: 75,
      communication: 80,
    },
    benchmarkMetadata: {
      nearest: {
        full_name: "Andre Onana",
        position: "GK",
        archetype: "Modern shot-stopper",
        overall_rating: 82,
        __similarity: 67,
      },
      alternatives: [],
      filterInfo: { poolSize: 8 },
      goalkeeperProfile: {
        dataSource: "ScoreBoard timeline",
        trackedActions: ["saves", "claims", "distribution", "interventions"],
      },
    },
    events: [
      {
        matchId: "00000000-0000-4000-8jc0-000000000402",
        type: "save",
        minute: 64,
        detail: "Strong low save to protect Broad City's lead.",
      },
      {
        matchId: "00000000-0000-4000-8jc0-000000000402",
        type: "goalkeeper_claim",
        minute: 82,
        detail: "High claim under pressure in added attacking phase.",
      },
      {
        matchId: "00000000-0000-4000-8jc0-000000000304",
        type: "goalkeeper_distribution",
        minute: 38,
        detail: "Quick distribution to launch a transition.",
      },
      {
        matchId: "00000000-0000-4000-8jc0-000000000204",
        type: "goalkeeper_intervention",
        minute: 57,
        detail: "Sweeper-keeper intervention outside the box.",
      },
    ],
  },
  {
    slug: "isiaka-basit",
    firstName: "Isiaka",
    lastName: "Basit",
    displayName: "Isiaka Basit",
    squadDisplayName: "Basit Isiaka",
    teamSlug: "ikorodu-city-fc",
    shirtNumber: 30,
    ageGroup: normalizePlayerAgeCategory({ age: 18 }) ?? "Under 21",
    age: 18,
    heightCm: 186,
    dominantFoot: "Right",
    overallRating: 74,
    defensiveRating: 79,
    cleanSheets: 2,
    appearances: 4,
    minutes: 360,
    biography:
      "Goalkeeper profile built around ScoreBoard match history, with emphasis on saves, line protection, and penalty-box management.",
    scoutingSummary:
      "Isiaka Basit, also listed as Basit Isiaka in matchday squad records, profiles as a reactive goalkeeper with useful evidence in saves, one-v-one situations, and defensive interventions.",
    ratingAttributes: {
      reflexes: 79,
      handling: 74,
      positioning: 75,
      goalkeeper_distribution: 72,
      command_of_area: 73,
      one_v_one: 78,
      composure: 75,
      decision_making: 74,
      aerial_control: 72,
      communication: 76,
    },
    benchmarkMetadata: {
      nearest: {
        full_name: "Mike Maignan",
        position: "GK",
        archetype: "Explosive line goalkeeper",
        overall_rating: 84,
        __similarity: 64,
      },
      alternatives: [],
      filterInfo: { poolSize: 8 },
      goalkeeperProfile: {
        dataSource: "ScoreBoard timeline",
        aliases: ["Basit Isiaka"],
        trackedActions: ["saves", "one-v-one", "line protection"],
      },
    },
    events: [
      {
        matchId: "00000000-0000-4000-8jc0-000000000102",
        type: "save",
        minute: 33,
        detail: "Reaction save from a close-range effort.",
      },
      {
        matchId: "00000000-0000-4000-8jc0-000000000302",
        type: "penalty_saved",
        minute: 58,
        detail: "Penalty save to keep Ikorodu City in control.",
      },
      {
        matchId: "00000000-0000-4000-8jc0-000000000401",
        type: "goal_line_clearance",
        minute: 72,
        detail: "Goal-line intervention after a broken set-piece.",
      },
      {
        matchId: "00000000-0000-4000-8jc0-000000000204",
        type: "goalkeeper_command",
        minute: 70,
        detail: "Organised the defensive line during late pressure.",
      },
    ],
  },
];

async function upsertGoalkeeperPlayer(prisma: PrismaClient, seed: GoalkeeperSeed) {
  const normalizedName = playerLookupKey(seed.displayName);
  const update = {
    firstName: seed.firstName,
    lastName: seed.lastName,
    displayName: seed.displayName,
    normalizedName,
    positionPrimary: "GK",
    positionFull: "GOALKEEPER",
    positionSecondary: null,
    age: seed.age,
    ageGroup: seed.ageGroup,
    heightCm: seed.heightCm,
    dominantFoot: seed.dominantFoot,
    nationality: "Nigerian",
    city: "Lagos",
    state: "Lagos",
    isPublic: true,
    isFeatured: true,
    registrationStatus: "approved",
    overallRating: seed.overallRating,
    defensiveRating: seed.defensiveRating,
    offensiveRating: null,
    careerGoals: 0,
    careerAssists: 0,
    careerAppearances: seed.appearances,
    careerMinutes: seed.minutes,
    careerCleanSheets: seed.cleanSheets,
    biography: seed.biography,
    scoutingSummary: seed.scoutingSummary,
    ratingAttributes: seed.ratingAttributes,
    benchmarkMetadata: seed.benchmarkMetadata,
    playingPhilosophies: ["Low Block", "Counter Attack"],
  };

  const existing = await prisma.player.findFirst({
    where: {
      OR: [{ slug: seed.slug }, { normalizedName }],
    },
  });
  const player = existing
    ? await prisma.player.update({
      where: { id: existing.id },
      data: { ...update, slug: seed.slug },
    })
    : await prisma.player.create({
      data: {
        slug: seed.slug,
        ...update,
      },
    });

  await mergeGoalkeeperAliasPlayer(prisma, player.id, seed.squadDisplayName);
  return player;
}

async function mergeGoalkeeperAliasPlayer(
  prisma: PrismaClient,
  canonicalPlayerId: string,
  aliasName: string
) {
  const aliasNormalizedName = playerLookupKey(aliasName);
  if (!aliasNormalizedName) return;
  const duplicate = await prisma.player.findUnique({
    where: { normalizedName: aliasNormalizedName },
    select: { id: true },
  });
  if (!duplicate || duplicate.id === canonicalPlayerId) return;

  await prisma.sbMatchEvent.updateMany({
    where: { playerId: duplicate.id },
    data: { playerId: canonicalPlayerId },
  });
  await prisma.sbMatchEvent.updateMany({
    where: { assistPlayerId: duplicate.id },
    data: { assistPlayerId: canonicalPlayerId },
  });

  const secondaryEvents = await prisma.sbMatchEvent.findMany({
    where: { metadata: { path: ["secondaryPlayerId"], equals: duplicate.id } },
    select: { id: true, metadata: true },
  });
  for (const event of secondaryEvents) {
    await prisma.sbMatchEvent.update({
      where: { id: event.id },
      data: {
        metadata: {
          ...((event.metadata ?? {}) as Record<string, unknown>),
          secondaryPlayerId: canonicalPlayerId,
        },
      },
    });
  }

  await prisma.sbTeamSquad.deleteMany({ where: { playerId: duplicate.id } });
  await prisma.sbMatchSquadPlayer.updateMany({
    where: { playerId: duplicate.id },
    data: { playerId: canonicalPlayerId },
  });
  await prisma.playerMatchMetrics.updateMany({
    where: { playerId: duplicate.id },
    data: { playerId: canonicalPlayerId },
  });
  await prisma.player.delete({ where: { id: duplicate.id } });
}

async function upsertSquadRow(
  prisma: PrismaClient,
  seed: GoalkeeperSeed,
  playerId: string
) {
  const competition = await prisma.sbCompetition.findUnique({
    where: { slug: "jagaban-cup-2026" },
    select: { id: true },
  });
  if (!competition) return null;

  const team = await prisma.sbTeam.findUnique({
    where: {
      competitionId_slug: {
        competitionId: competition.id,
        slug: seed.teamSlug,
      },
    },
  });
  if (!team) return null;

  const existing = await prisma.sbTeamSquad.findUnique({ where: { playerId } });
  if (existing) {
    return prisma.sbTeamSquad.update({
      where: { id: existing.id },
      data: {
        teamId: team.id,
        displayName: seed.squadDisplayName,
        position: "GK",
        shirtNumber: seed.shirtNumber,
      },
    });
  }

  return prisma.sbTeamSquad.create({
    data: {
      teamId: team.id,
      playerId,
      displayName: seed.squadDisplayName,
      position: "GK",
      shirtNumber: seed.shirtNumber,
    },
  });
}

async function seedGoalkeeperEvents(
  prisma: PrismaClient,
  seed: GoalkeeperSeed,
  playerId: string,
  teamId: string
) {
  for (const event of seed.events) {
    const match = await prisma.sbMatch.findFirst({
      where: {
        id: event.matchId,
        competition: { slug: "jagaban-cup-2026" },
      },
      select: { id: true },
    });
    if (!match) continue;

    const existing = await prisma.sbMatchEvent.findFirst({
      where: {
        matchId: match.id,
        playerId,
        type: event.type,
        minute: event.minute,
      },
      select: { id: true },
    });
    const data = {
      matchId: match.id,
      teamId,
      playerId,
      playerLabel: seed.displayName,
      playerLabel2: seed.squadDisplayName,
      type: event.type,
      minute: event.minute,
      detail: event.detail,
      metadata: {
        source: "seed-goalkeeper-profiles",
        csvEventType: event.type,
        aliases: [seed.squadDisplayName],
      },
    };

    if (existing) {
      await prisma.sbMatchEvent.update({ where: { id: existing.id }, data });
    } else {
      await prisma.sbMatchEvent.create({ data });
    }
  }
}

export async function seedGoalkeeperProfiles(prisma: PrismaClient): Promise<number> {
  let count = 0;
  for (const seed of GOALKEEPERS) {
    const player = await upsertGoalkeeperPlayer(prisma, seed);
    const squad = await upsertSquadRow(prisma, seed, player.id);
    if (squad) {
      await seedGoalkeeperEvents(prisma, seed, player.id, squad.teamId);
      count++;
    }
  }
  return count;
}
