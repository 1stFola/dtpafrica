/**
 * Coal City Scouting Tournament 2026 — a three-day showcase at Onikan Stadium.
 *
 * Ten clubs across thirteen fixtures. This is not a round robin: six sides play
 * three matches and four play two, so the standings table ranks on an uneven
 * number of games. That is how the published schedule reads; it is reproduced
 * verbatim rather than balanced.
 *
 * Fixture names in the source schedule vary ("Coal City Utd" / "Coal City
 * United", "042 FC" / "042 Football Club", "Glorious Day FA" / "Gloriousday
 * FA", "DRV FC" / "DRV Football Club"). TEAMS below is the canonical list and
 * every fixture references a team slug, so a variant cannot silently create a
 * second club.
 */
// Prisma is a value import: DbNull/JsonNull are runtime sentinels.
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { normalizeClubName } from "@dtp/engines";
import {
  isFullSeed,
  shouldPreserveSbMatch,
  type SeedOptions,
} from "../src/seed/seed-options";
import { allocateMatchSlug, loadExistingMatchSlugs } from "../src/scoreboard/match-slug";

const COMP_SLUG = "coal-city-scouting-tournament-2026";
const COMP_ID = "2bd98f76-a5ae-4ae1-b8ed-2f42d325fced";
const COMP_NAME = "Coal City Scouting Tournament";
const TIMEZONE = "Africa/Lagos";
const VENUE = "Onikan Stadium, Lagos, Nigeria";
const CITY = "Lagos";
const COMP_LOGO =
  "https://lh3.googleusercontent.com/pw/AP1GczMDeuz3j9x7MQc8DPeiK2AeCnhu8MicI8nUFw79aBEpPFWZJp_zsGRo-owv4TF0G2HmkRHFBcPdmculxUTekE7zsqjQYWon6Z6U6m1Ll_aiNUEccO5AKCrswqt2aCxS6KSBqgQ_Q0VqdgyC56X1c_5W=w474-h429-s-no-gm?authuser=0";
const DESCRIPTION =
  "The Coal City Scouting Tournament is a three-day showcase at Onikan Stadium, Lagos. Ten clubs contest thirteen fixtures across 15-17 September 2026, with every match played in the morning.";

type TeamSeed = { id: string; slug: string; name: string; logoUrl: string | null };

const TEAMS: TeamSeed[] = [
  {
    id: "b6128cfa-839c-439c-a00c-6dfad3cd457f",
    slug: "coal-city-united",
    name: "Coal City United",
    logoUrl:
      "https://coalcityunitedfc.com/wp-content/uploads/2024/05/Coal-City-United-FC-Logo-01-1024x1024.png",
  },
  {
    id: "e11e1c9f-8d8a-4a6a-b9a7-17b645036817",
    slug: "athletic-sc",
    name: "Athletic SC",
    logoUrl:
      "https://lh3.googleusercontent.com/pw/AP1GczO_xOtfLrVwYx1LwGZrq1XEOwH7DQOiITrfIRpXMiaaiR5wR54_Lx5QTRRdeF6PIt0em_3x3ddD7g7f4zVrtVAQpGAvYm8BQHCpef_NmC3Sy50No0hkRBAVdTHTTmKhUW8GIOyS2ot3Ke2DtaiSCeFN=w317-h374-s-no-gm?authuser=0",
  },
  {
    id: "dead19d2-be03-40cc-9d2a-c1794bc1dda7",
    slug: "gloriousday-fa",
    name: "Gloriousday FA",
    /* The supplied Gloriousday logo was the Ikorodu City crest
       (ikoroducityfc.com/.../ikd-logo.png), byte-identical to the Ikorodu City
       entry below. Left null rather than shipping a rival club's badge. */
    logoUrl: null,
  },
  {
    id: "bc08241c-c435-4b16-a398-1cde925b9589",
    slug: "ikorodu-city-fc",
    name: "Ikorodu City FC",
    logoUrl: "https://www.ikoroducityfc.com/wp-content/uploads/2024/07/ikd-logo.png",
  },
  {
    id: "f15094b0-7524-4598-8aee-9fd7e09171ac",
    slug: "goal-getter-fa",
    name: "Goal Getter FA",
    logoUrl:
      "https://api.1xcup.ng/storage/team-registrations/logos/fcd17b47d32de0ad8fdf98c7fe253f5d.jpg",
  },
  {
    id: "96b96051-a4c0-4e9c-9c3f-becff57a5cc9",
    slug: "042-fc",
    name: "042 FC",
    logoUrl:
      "https://lh3.googleusercontent.com/pw/AP1GczPPGl2L0wDKeaHgvnXir7SlcmGm2HVqIlSMM5Vo3K4QrKZPjZMikqtVKS5percKgWvhqSq1gpI_v2mUHMaP00K-D1nuVtmjiow1H4x-OZxGtJhFvm2gvJqJ8yoGR5ssbpzVjsyKVUtz7RHJiNYgGrLt=w184-h188-s-no-gm?authuser=0",
  },
  {
    id: "8a5e2434-9c81-402f-a647-d0a9ea52c45c",
    slug: "klassisch-fa",
    name: "Klassisch FA",
    /* Google image-search thumbnail: short-lived and not a club-owned asset.
       Replace with a hosted crest. */
    logoUrl:
      "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTJ5bYL-YkWg1DkeMyKLUlME-qIDSNkrYerdQ&s",
  },
  {
    id: "5760bd92-b79d-4835-b37d-2e61dab07a78",
    slug: "drv-fc",
    name: "DRV FC",
    /* Facebook CDN URL carrying signed expiry parameters (oh/oe); it will stop
       resolving. Replace with a hosted crest. */
    logoUrl:
      "https://scontent-hou1-1.xx.fbcdn.net/v/t39.30808-6/300227235_1064908784284055_8038856656100315958_n.jpg?stp=dst-jpg_tt6&cstp=mx1073x1073&ctp=s1073x1073&_nc_cat=107&ccb=1-7&_nc_sid=6ee11a&_nc_ohc=fNxsxTSF1kAQ7kNvwEMYYz5&_nc_oc=Adqj1yqkeGSJjqAUXZ9k2CxOUeOjlMMdlilQC64zvXVYeubaf-gDUlxHykvW6OqQbV-UvtejSsajAm6yBkoC1Hxc&_nc_zt=23&_nc_ht=scontent-hou1-1.xx&_nc_gid=_zDTQ5KT7fOnEcRR7z71Dw&_nc_ss=7b289&oh=00_AQKgML0D5wjNIOiHayotp2y60p9uPFXvZr0R6LVCGAlfTw&oe=6AA579C8",
  },
  {
    id: "1011eee2-d520-4716-9ce3-1c5fff5997c4",
    slug: "vido-99-fc",
    name: "Vido 99 FC",
    logoUrl:
      "https://app.trickle.so/storage/public/images/usr_154548bd30000001/29096a99-dcd6-496f-8665-e1109d01d6dd.jpeg",
  },
  {
    id: "b18aeed5-7a0a-4f5e-966f-78fdc5566073",
    slug: "box-2-box-fc",
    name: "Box 2 Box FC",
    logoUrl:
      "https://lh3.googleusercontent.com/pw/AP1GczMolIKP6kSlSf8I5ayOSIY9f0J7ntpg40aVMwMXm1gidkUdsrJGwJhwNW47FBPsthvlHiYjBXUgObLjhVD1iMaggckHZwDAPc0lUXc3Ga79EMhrqEEjp6R82ZBKdua9RJA0B6bj4WhbzmJbVtHT5dfL=w970-h490-s-no-gm?authuser=0",
  },
];

type MatchSeed = {
  id: string;
  matchday: number;
  homeSlug: string;
  awaySlug: string;
  kickoffAt: string;
};

/** Each slot is a 55-minute match on the hour; kickoffs are West Africa Time. */
const MATCHES: MatchSeed[] = [
  // Day 1 — 15 September 2026
  {
    id: "39e34655-de14-4c61-b4d3-53a53bf42846",
    matchday: 1,
    homeSlug: "coal-city-united",
    awaySlug: "athletic-sc",
    kickoffAt: "2026-09-15T07:00:00.000+01:00",
  },
  {
    id: "7c64f09e-892e-4dc7-aff9-2a3dc9803f38",
    matchday: 1,
    homeSlug: "gloriousday-fa",
    awaySlug: "ikorodu-city-fc",
    kickoffAt: "2026-09-15T08:00:00.000+01:00",
  },
  {
    id: "46364cad-fc3d-4920-ac0d-6f1026ce21bc",
    matchday: 1,
    homeSlug: "goal-getter-fa",
    awaySlug: "042-fc",
    kickoffAt: "2026-09-15T09:00:00.000+01:00",
  },

  // Day 2 — 16 September 2026
  {
    id: "632a7381-2b5b-407f-8ca5-317bf80ae4d4",
    matchday: 2,
    homeSlug: "ikorodu-city-fc",
    awaySlug: "goal-getter-fa",
    kickoffAt: "2026-09-16T07:00:00.000+01:00",
  },
  {
    id: "c3ce0a0e-b002-47ba-82b6-74f8e623a5b8",
    matchday: 2,
    homeSlug: "klassisch-fa",
    awaySlug: "coal-city-united",
    kickoffAt: "2026-09-16T08:00:00.000+01:00",
  },
  {
    id: "b30c4e7c-9599-4d2f-b5f9-19f8619a08d0",
    matchday: 2,
    homeSlug: "athletic-sc",
    awaySlug: "drv-fc",
    kickoffAt: "2026-09-16T09:00:00.000+01:00",
  },
  {
    id: "431201af-334c-410a-bb32-3279d3f98cde",
    matchday: 2,
    homeSlug: "042-fc",
    awaySlug: "vido-99-fc",
    kickoffAt: "2026-09-16T10:00:00.000+01:00",
  },
  {
    id: "81392848-6284-4c37-802f-be8732afd54e",
    matchday: 2,
    homeSlug: "box-2-box-fc",
    awaySlug: "gloriousday-fa",
    kickoffAt: "2026-09-16T11:00:00.000+01:00",
  },

  // Day 3 — 17 September 2026
  {
    id: "a7f44bf6-8ab4-40dd-8214-838412f2b965",
    matchday: 3,
    homeSlug: "box-2-box-fc",
    awaySlug: "athletic-sc",
    kickoffAt: "2026-09-17T07:00:00.000+01:00",
  },
  {
    id: "9dc376a8-7c04-45c2-92b2-212e4188a78d",
    matchday: 3,
    homeSlug: "drv-fc",
    awaySlug: "ikorodu-city-fc",
    kickoffAt: "2026-09-17T08:00:00.000+01:00",
  },
  {
    id: "b50920a5-233d-4cf1-b7b5-b696b4bad2d6",
    matchday: 3,
    homeSlug: "gloriousday-fa",
    awaySlug: "042-fc",
    kickoffAt: "2026-09-17T09:00:00.000+01:00",
  },
  {
    id: "e0fbf450-d842-4211-a47a-e16a0972b6c0",
    matchday: 3,
    homeSlug: "coal-city-united",
    awaySlug: "vido-99-fc",
    kickoffAt: "2026-09-17T10:00:00.000+01:00",
  },
  {
    id: "cdb7c0bb-145f-4a2d-ac1c-56ea90a40b2e",
    matchday: 3,
    homeSlug: "goal-getter-fa",
    awaySlug: "klassisch-fa",
    kickoffAt: "2026-09-17T11:00:00.000+01:00",
  },
];

export async function seedCoalCityScoutingTournament2026(
  prisma: PrismaClient,
  options?: SeedOptions
) {
  const formatConfig = {
    format: "fixture_list",
    overview: DESCRIPTION,
    timezone: TIMEZONE,
    venue: VENUE,
    teams: TEAMS.length,
    matchdays: 3,
    matches: MATCHES.length,
    matchLengthMinutes: 55,
    points: { win: 3, draw: 1, loss: 0 },
    tiebreakers: ["points", "goal_difference", "goals_for", "head_to_head"],
    /* Six clubs play three fixtures and four play two, so the table ranks on an
       uneven number of games. */
    unevenFixtureCount: true,
  };

  const fields = {
    name: COMP_NAME,
    season: "2026",
    type: "tournament",
    formatType: "STANDARD_LEAGUE",
    formatConfig: formatConfig as Prisma.InputJsonValue,
    country: "Nigeria",
    logoUrl: COMP_LOGO,
    description: DESCRIPTION,
    status: "upcoming",
    isPublished: true,
  };

  const comp = await prisma.sbCompetition.upsert({
    where: { slug: COMP_SLUG },
    update: fields,
    create: { id: COMP_ID, slug: COMP_SLUG, ...fields },
  });

  if (isFullSeed(options)) {
    await prisma.sbMatch.deleteMany({
      where: { competitionId: comp.id, id: { notIn: MATCHES.map((m) => m.id) } },
    });
    await prisma.sbTeam.deleteMany({
      where: { competitionId: comp.id, slug: { notIn: TEAMS.map((t) => t.slug) } },
    });
  }

  const teamIds: Record<string, string> = {};
  for (const team of TEAMS) {
    const teamFields = {
      name: normalizeClubName(team.name),
      shortName: team.name,
      city: CITY,
      logoUrl: team.logoUrl,
      /* A single table, so no group key. */
      groupKey: null,
    };
    const row = await prisma.sbTeam.upsert({
      where: { competitionId_slug: { competitionId: comp.id, slug: team.slug } },
      update: teamFields,
      create: { id: team.id, competitionId: comp.id, slug: team.slug, ...teamFields },
    });
    teamIds[team.slug] = row.id;
  }

  const usedMatchSlugs = await loadExistingMatchSlugs(prisma);
  for (const match of MATCHES) {
    if (await shouldPreserveSbMatch(prisma, match.id, options)) continue;
    const shared = {
      slug: allocateMatchSlug(match.homeSlug, match.awaySlug, usedMatchSlugs),
      matchday: match.matchday,
      homeTeamId: teamIds[match.homeSlug],
      awayTeamId: teamIds[match.awaySlug],
      status: "scheduled",
      homeScore: 0,
      awayScore: 0,
      minute: null,
      kickoffAt: new Date(match.kickoffAt),
      venue: VENUE,
      roundLabel: `Day ${match.matchday}`,
      // `stats` is a nullable Json column; Prisma rejects a bare `null` here.
      stats: Prisma.DbNull,
      isPublished: true,
      meta: { timezone: TIMEZONE } as Prisma.InputJsonValue,
    };
    await prisma.sbMatch.upsert({
      where: { id: match.id },
      update: shared,
      create: { id: match.id, competitionId: comp.id, ...shared },
    });
  }

  const [teamCount, matchCount] = await Promise.all([
    prisma.sbTeam.count({ where: { competitionId: comp.id } }),
    prisma.sbMatch.count({ where: { competitionId: comp.id } }),
  ]);
  console.log(
    `Seeded ${COMP_NAME}: ${teamCount} teams (expected ${TEAMS.length}), ${matchCount} matches (expected ${MATCHES.length})`
  );
  return { comp, teamCount, matchCount };
}
