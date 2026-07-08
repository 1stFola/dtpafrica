// @ts-nocheck
import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeClubName } from "@dtp/engines";
import {
  isFullSeed,
  shouldPreserveSbMatch,
  type SeedOptions,
} from "../src/seed/seed-options";
import { allocateMatchSlug, loadExistingMatchSlugs } from "../src/scoreboard/match-slug";

const COMP_SLUG = "lagos-queens-cup-2026";
const COMP_ID = "00000000-0000-4000-8lqc-000000000000";
const TIMEZONE = "Africa/Lagos";
const VENUE = "Legacy Pitch, National Stadium, Surulere, Lagos Nigeria";

type GroupKey = "A" | "B";

type TeamSeed = {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  groupKey: GroupKey;
  logoUrl: string;
};

type MatchSeed = {
  id: string;
  homeSlug: string;
  awaySlug: string;
  groupKey: GroupKey;
  kickoffAt: string;
  matchday: number;
};

function teamId(seed: number): string {
  return `00000000-0000-4000-8lqt-${String(seed).padStart(12, "0")}`;
}

function matchId(seed: number): string {
  return `00000000-0000-4000-8lqm-${String(seed).padStart(12, "0")}`;
}

/** WAT (UTC+1) kickoff stored as ISO with explicit offset. */
function watKickoff(date: string, time: string): string {
  const [h, m] = time.split(":").map((x) => Number(x));
  return `${date}T${String(h).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}:00+01:00`;
}

const TEAMS: TeamSeed[] = [
  {
    id: teamId(1),
    slug: "fc-robo-queens",
    name: "FC Robo Queens",
    shortName: "ROB",
    groupKey: "A",
    logoUrl: "https://img.sofascore.com/api/v1/team/372568/image",
  },
  {
    id: teamId(2),
    slug: "cats-ladies",
    name: "Cats Ladies",
    shortName: "CAT",
    groupKey: "A",
    logoUrl:
      "https://scontent-hou1-1.cdninstagram.com/v/t51.82787-19/523351556_18057174743612819_3538260982108151012_n.jpg?stp=dst-jpg_s150x150_tt6&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLmRqYW5nby45MTkuYzIifQ&_nc_ht=scontent-hou1-1.cdninstagram.com&_nc_cat=111&_nc_oc=Q6cZ2gEBsUJTfFuErYtmI69CK6mqGyV9w17gBWQjqCfq4etP5Az3TsqkC0lM1n5sK2CVXvDZJch7KcVS9FN4NonE59Xm&_nc_ohc=VEEwh5UvqtsQ7kNvwEgWHYD&_nc_gid=KCyNdIwVG2dMb5ePONTCIw&edm=AOQ1c0wBAAAA&ccb=7-5&oh=00_AQCjwfBmETuC0WnTxpOMoFuqEQ-bFOQeELcMbTZM-qpDQw&oe=6A537E6E&_nc_sid=8b3546",
  },
  {
    id: teamId(3),
    slug: "dannaz-ladies",
    name: "Dannaz Ladies",
    shortName: "DAN",
    groupKey: "A",
    logoUrl: "https://img.sofascore.com/api/v1/team/500103/image",
  },
  {
    id: teamId(4),
    slug: "dreamstar-ladies",
    name: "Dreamstar Ladies",
    shortName: "DRM",
    groupKey: "A",
    logoUrl: "https://bestchoicesports.com.ng/wp-content/uploads/2020/06/IMG-20200629-WA0062.jpg",
  },
  {
    id: teamId(5),
    slug: "ayisat-yusuf-fa",
    name: "Ayisat Yusuf FA",
    shortName: "AYF",
    groupKey: "B",
    logoUrl:
      "https://media.licdn.com/dms/image/v2/D4D22AQGtLCCLETxx6A/feedshare-shrink_800/feedshare-shrink_800/0/1720086754905?e=2147483647&t=OdtLibLHkO-DNGn3KuUlZySm7CH4mV2dpWKS2F7ZcC8&v=beta",
  },
  {
    id: teamId(6),
    slug: "nakamura-fa",
    name: "Nakamura FA",
    shortName: "NAK",
    groupKey: "B",
    logoUrl: "https://nakamurafc.com/wp-content/uploads/2023/08/Asset-1.svg",
  },
  {
    id: teamId(7),
    slug: "asisat-oshoala-academy",
    name: "Asisat Oshoala Academy",
    shortName: "AOA",
    groupKey: "B",
    logoUrl: "https://asisatoshoalaacademy.ng/wp-content/uploads/2025/07/AOA_Green_Logo.webp",
  },
  {
    id: teamId(8),
    slug: "fa-victory-queens",
    name: "FA Victory Queens",
    shortName: "FVQ",
    groupKey: "B",
    logoUrl:
      "https://nakamurafc.com/wp-content/uploads/2026/05/WhatsApp-Image-2026-05-17-at-7.57.15-AM.jpeg",
  },
];

const MATCHES: MatchSeed[] = [
  {
    id: matchId(1),
    homeSlug: "fc-robo-queens",
    awaySlug: "dannaz-ladies",
    groupKey: "A",
    kickoffAt: watKickoff("2026-07-08", "07:00"),
    matchday: 1,
  },
  {
    id: matchId(2),
    homeSlug: "nakamura-fa",
    awaySlug: "ayisat-yusuf-fa",
    groupKey: "B",
    kickoffAt: watKickoff("2026-07-08", "08:00"),
    matchday: 1,
  },
  {
    id: matchId(3),
    homeSlug: "cats-ladies",
    awaySlug: "dreamstar-ladies",
    groupKey: "A",
    kickoffAt: watKickoff("2026-07-08", "09:00"),
    matchday: 1,
  },
  {
    id: matchId(4),
    homeSlug: "fa-victory-queens",
    awaySlug: "asisat-oshoala-academy",
    groupKey: "B",
    kickoffAt: watKickoff("2026-07-08", "10:00"),
    matchday: 1,
  },
  {
    id: matchId(5),
    homeSlug: "dannaz-ladies",
    awaySlug: "cats-ladies",
    groupKey: "A",
    kickoffAt: watKickoff("2026-07-09", "07:00"),
    matchday: 2,
  },
  {
    id: matchId(6),
    homeSlug: "ayisat-yusuf-fa",
    awaySlug: "asisat-oshoala-academy",
    groupKey: "B",
    kickoffAt: watKickoff("2026-07-09", "08:00"),
    matchday: 2,
  },
  {
    id: matchId(7),
    homeSlug: "dreamstar-ladies",
    awaySlug: "fc-robo-queens",
    groupKey: "A",
    kickoffAt: watKickoff("2026-07-09", "09:00"),
    matchday: 2,
  },
  {
    id: matchId(8),
    homeSlug: "fa-victory-queens",
    awaySlug: "nakamura-fa",
    groupKey: "B",
    kickoffAt: watKickoff("2026-07-09", "10:00"),
    matchday: 2,
  },
  {
    id: matchId(9),
    homeSlug: "fc-robo-queens",
    awaySlug: "cats-ladies",
    groupKey: "A",
    kickoffAt: watKickoff("2026-07-10", "07:00"),
    matchday: 3,
  },
  {
    id: matchId(10),
    homeSlug: "nakamura-fa",
    awaySlug: "asisat-oshoala-academy",
    groupKey: "B",
    kickoffAt: watKickoff("2026-07-10", "08:00"),
    matchday: 3,
  },
  {
    id: matchId(11),
    homeSlug: "dannaz-ladies",
    awaySlug: "dreamstar-ladies",
    groupKey: "A",
    kickoffAt: watKickoff("2026-07-10", "09:00"),
    matchday: 3,
  },
  {
    id: matchId(12),
    homeSlug: "fa-victory-queens",
    awaySlug: "ayisat-yusuf-fa",
    groupKey: "B",
    kickoffAt: watKickoff("2026-07-10", "10:00"),
    matchday: 3,
  },
];

export async function seedLagosQueensCup2026(
  prisma: PrismaClient,
  options?: SeedOptions
) {
  const formatConfig = {
    format: "group_stage",
    editionLabel: "Lagos Queens Cup 2026",
    startDate: "2026-07-08",
    timezone: TIMEZONE,
    points: { win: 3, draw: 1, loss: 0 },
    groups: [
      { key: "A", teamCount: 4, matchCount: 6 },
      { key: "B", teamCount: 4, matchCount: 6 },
    ],
    tiebreakers: ["points", "goal_difference", "goals_for", "head_to_head"],
  };

  const comp = await prisma.sbCompetition.upsert({
    where: { slug: COMP_SLUG },
    update: {
      name: "Lagos Queens Cup 2026",
      season: "2026",
      type: "tournament",
      formatType: "LAGOS_QUEENS_CUP_GROUPS",
      formatConfig: formatConfig as Prisma.InputJsonValue,
      country: "Nigeria",
      description:
        "An eight-team women's football tournament featuring two groups of four, played as a single round-robin over three matchdays.",
      isPublished: true,
    },
    create: {
      id: COMP_ID,
      slug: COMP_SLUG,
      name: "Lagos Queens Cup 2026",
      season: "2026",
      type: "tournament",
      formatType: "LAGOS_QUEENS_CUP_GROUPS",
      formatConfig: formatConfig as Prisma.InputJsonValue,
      country: "Nigeria",
      description:
        "An eight-team women's football tournament featuring two groups of four, played as a single round-robin over three matchdays.",
      isPublished: true,
    },
  });

  const stageByKey = new Map<string, string>();
  for (const group of ["A", "B"] as const) {
    const row = await prisma.sbCompetitionStage.upsert({
      where: { competitionId_key: { competitionId: comp.id, key: `group_${group.toLowerCase()}` } },
      update: {
        name: `Group ${group}`,
        stageType: "group",
        sortOrder: group === "A" ? 1 : 2,
        config: { group, matchdays: 3, teams: 4 } as Prisma.InputJsonValue,
      },
      create: {
        competitionId: comp.id,
        key: `group_${group.toLowerCase()}`,
        name: `Group ${group}`,
        stageType: "group",
        sortOrder: group === "A" ? 1 : 2,
        config: { group, matchdays: 3, teams: 4 } as Prisma.InputJsonValue,
      },
    });
    stageByKey.set(group, row.id);
  }

  const matchIds = MATCHES.map((m) => m.id);
  const teamSlugs = TEAMS.map((t) => t.slug);
  if (isFullSeed(options)) {
    await prisma.sbMatch.deleteMany({ where: { competitionId: comp.id, id: { notIn: matchIds } } });
    await prisma.sbTeam.deleteMany({ where: { competitionId: comp.id, slug: { notIn: teamSlugs } } });
  }

  const teamIds: Record<string, string> = {};
  for (const team of TEAMS) {
    const row = await prisma.sbTeam.upsert({
      where: { competitionId_slug: { competitionId: comp.id, slug: team.slug } },
      update: {
        name: normalizeClubName(team.name),
        shortName: team.shortName,
        groupKey: team.groupKey,
        city: "Lagos",
        logoUrl: team.logoUrl,
      },
      create: {
        id: team.id,
        competitionId: comp.id,
        slug: team.slug,
        name: normalizeClubName(team.name),
        shortName: team.shortName,
        groupKey: team.groupKey,
        city: "Lagos",
        logoUrl: team.logoUrl,
      },
    });
    teamIds[team.slug] = row.id;
  }

  const usedMatchSlugs = await loadExistingMatchSlugs(prisma);
  for (const match of MATCHES) {
    if (await shouldPreserveSbMatch(prisma, match.id, options)) continue;
    const stageKey = `group_${match.groupKey.toLowerCase()}`;
    const slug = allocateMatchSlug(match.homeSlug, match.awaySlug, usedMatchSlugs);
    await prisma.sbMatch.upsert({
      where: { id: match.id },
      update: {
        slug,
        homeScore: 0,
        awayScore: 0,
        status: "scheduled",
        minute: null,
        stageKey,
        stageId: stageByKey.get(match.groupKey),
        matchday: match.matchday,
        roundLabel: `Group ${match.groupKey} - Matchday ${match.matchday}`,
        venue: VENUE,
        kickoffAt: new Date(match.kickoffAt),
        homeTeamId: teamIds[match.homeSlug],
        awayTeamId: teamIds[match.awaySlug],
        stats: null,
        meta: { group: match.groupKey, timezone: TIMEZONE } as Prisma.InputJsonValue,
      },
      create: {
        id: match.id,
        slug,
        competitionId: comp.id,
        stageKey,
        stageId: stageByKey.get(match.groupKey),
        matchday: match.matchday,
        homeTeamId: teamIds[match.homeSlug],
        awayTeamId: teamIds[match.awaySlug],
        status: "scheduled",
        homeScore: 0,
        awayScore: 0,
        minute: null,
        kickoffAt: new Date(match.kickoffAt),
        venue: VENUE,
        roundLabel: `Group ${match.groupKey} - Matchday ${match.matchday}`,
        stats: null,
        meta: { group: match.groupKey, timezone: TIMEZONE } as Prisma.InputJsonValue,
      },
    });
  }

  const [teamCount, matchCount] = await Promise.all([
    prisma.sbTeam.count({ where: { competitionId: comp.id } }),
    prisma.sbMatch.count({ where: { competitionId: comp.id } }),
  ]);

  console.log("Lagos Queens Cup 2026 seeded:", COMP_SLUG);
  console.log("  teams:", teamCount, "(expected 8)");
  console.log("  matches:", matchCount, "(expected 12)");
  console.log("  venue:", VENUE);
  return { comp, teamCount, matchCount };
}
