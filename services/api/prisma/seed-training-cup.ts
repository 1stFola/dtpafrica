// @ts-nocheck
/**
 * DTP Training Cup — a sandbox for teaching match recorders the console.
 *
 * Deliberately unpublished: it must never appear on the public ScoreBoard, but
 * recorders and supervisors reach it in the admin portal like any other
 * fixture. Halves are 5 minutes so a trainee can walk the whole flow —
 * kick-off, added time, half-time, second half, submit — inside ten minutes.
 *
 * Full squads with shirt numbers are seeded so trainees see the console resolve
 * "No. 10" into a real player name in the generated commentary.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { shouldPreserveSbMatch } from "../src/seed/seed-options";
import { createSeedMatchSlugAllocator } from "../src/scoreboard/match-slug";

const COMP_SLUG = "dtp-training-cup";
const COMP_ID = "7ac1f0de-0000-4000-8aaa-000000000001";
const TIMEZONE = "Africa/Lagos";
const VENUE = "DTP Training Ground";

/** Minutes per half. Five keeps a full training run under ten minutes. */
const HALF_LENGTH_MINUTES = 5;

type TeamSeed = { id: string; slug: string; name: string; shortName: string };

const TEAMS: TeamSeed[] = [
  { id: "7ac1f0de-0000-4000-8bbb-000000000001", slug: "france", name: "France", shortName: "FRA" },
  { id: "7ac1f0de-0000-4000-8bbb-000000000002", slug: "spain", name: "Spain", shortName: "ESP" },
];

type MatchSeed = {
  id: string;
  slugBase: [string, string];
  roundLabel: string;
  homeSlug: string;
  awaySlug: string;
  kickoffAt: string;
};

/* One practice fixture is enough to teach the console; a second only doubles
   the resetting between trainees. */
const MATCHES: MatchSeed[] = [
  {
    id: "7ac1f0de-0000-4000-8ccc-000000000001",
    slugBase: ["france", "spain"],
    roundLabel: "Semi-Final 1",
    homeSlug: "france",
    awaySlug: "spain",
    kickoffAt: "2026-07-14T18:00:00.000+01:00",
  },
];

/** Squads for the practice fixture, as supplied. */
const SQUADS: Record<string, Array<{ name: string; number: number | null }>> = {
  france: [
    { name: "Mike Maignan", number: 16 },
    { name: "Jules Kounde", number: 5 },
    { name: "Dayot Upamecano", number: 4 },
    { name: "William Saliba", number: 17 },
    { name: "Lucas Digne", number: 3 },
    { name: "Aurelien Tchouameni", number: 8 },
    { name: "Adrien Rabiot", number: 14 },
    { name: "Ousmane Dembele", number: 7 },
    { name: "Michael Olise", number: 11 },
    { name: "Bradley Barcola", number: 12 },
    { name: "Kylian Mbappe", number: 10 },
  ],
  spain: [
    { name: "Unai Simon", number: 23 },
    { name: "Pedro Porro", number: 12 },
    { name: "Pau Cubarsi", number: 22 },
    { name: "Aymeric Laporte", number: 14 },
    { name: "Marc Cucurella", number: 24 },
    { name: "Rodri", number: 16 },
    { name: "Fabian Ruiz", number: 8 },
    { name: "Dani Olmo", number: 10 },
    { name: "Lamine Yamal", number: 19 },
    { name: "Alex Baena", number: 15 },
    { name: "Mikel Oyarzabal", number: 21 },
  ],
};

export async function seedTrainingCup(prisma: PrismaClient) {
  const formatConfig = {
    format: "training_sandbox",
    purpose: "Training fixtures for match recorders. Never shown on the public site.",
    timezone: TIMEZONE,
    /** The console reads this to preselect the half length at kick-off. */
    halfLengthMinutes: HALF_LENGTH_MINUTES,
    isTraining: true,
  };

  const fields = {
    name: "DTP Training Cup",
    season: "2026",
    type: "tournament",
    formatType: "TRAINING_SANDBOX",
    formatConfig: formatConfig as Prisma.InputJsonValue,
    country: "Nigeria",
    description:
      "Practice fixtures for training match recorders on the live console. Hidden from the public ScoreBoard.",
    status: "upcoming",
    /* The one setting that matters: unpublished keeps it off every public
       endpoint while leaving it reachable in the admin portal. */
    isPublished: false,
  };

  const comp = await prisma.sbCompetition.upsert({
    where: { slug: COMP_SLUG },
    update: fields,
    create: { id: COMP_ID, slug: COMP_SLUG, ...fields },
  });

  const teamIds: Record<string, string> = {};
  for (const team of TEAMS) {
    const row = await prisma.sbTeam.upsert({
      where: { competitionId_slug: { competitionId: comp.id, slug: team.slug } },
      update: { name: team.name, shortName: team.shortName },
      create: {
        id: team.id,
        competitionId: comp.id,
        slug: team.slug,
        name: team.name,
        shortName: team.shortName,
      },
    });
    teamIds[team.slug] = row.id;
  }

  const slugFor = await createSeedMatchSlugAllocator(prisma, MATCHES.map((m) => m.id));
  for (const match of MATCHES) {
    if (await shouldPreserveSbMatch(prisma, match.id)) continue;
    const shared = {
      slug: slugFor(match.id, match.slugBase[0], match.slugBase[1]),
      homeTeamId: teamIds[match.homeSlug],
      awayTeamId: teamIds[match.awaySlug],
      status: "scheduled",
      homeScore: 0,
      awayScore: 0,
      minute: null,
      kickoffAt: new Date(match.kickoffAt),
      venue: VENUE,
      roundLabel: match.roundLabel,
      stageKey: "semi_final",
      stats: null,
      isPublished: true,
      meta: { training: true, timezone: TIMEZONE } as Prisma.InputJsonValue,
    };
    await prisma.sbMatch.upsert({
      where: { id: match.id },
      update: shared,
      create: { id: match.id, competitionId: comp.id, ...shared },
    });
  }

  /* Matchday squads give trainees the full experience: tapping "No. 10" for
     France produces commentary naming Kylian Mbappe. */
  let squadRows = 0;
  for (const match of MATCHES) {
    for (const side of [match.homeSlug, match.awaySlug]) {
      const teamId = teamIds[side];
      await prisma.sbMatchSquadPlayer.deleteMany({ where: { matchId: match.id, teamId } });
      const players = SQUADS[side] ?? [];
      for (const [index, player] of players.entries()) {
        await prisma.sbMatchSquadPlayer.create({
          data: {
            matchId: match.id,
            teamId,
            playerName: player.name,
            jerseyNumber: player.number,
            isStarter: index < 11,
            sortOrder: index,
          },
        });
        squadRows += 1;
      }
    }
  }

  console.log(
    `Seeded DTP Training Cup (unpublished): ${TEAMS.length} teams, ${MATCHES.length} matches, ${squadRows} squad players, ${HALF_LENGTH_MINUTES}-minute halves`
  );
  return { comp, squadRows };
}
