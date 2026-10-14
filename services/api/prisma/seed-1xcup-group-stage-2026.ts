/**
 * 1XCup 2026 — the twenty-four-team group stage.
 *
 * The qualifying zones and the `group_stage` stage row itself already exist from
 * seed-1xcup-2026.ts; what was missing was the draw and the fixtures. Six groups of
 * four play a single round robin, thirty-six matches in all.
 *
 * Two things worth knowing before editing this file:
 *
 *   - **`groupKey` is repurposed for the twenty-four teams that advanced.** It held
 *     their qualifying zone, which has done its job once a team reaches the group
 *     stage; the standings engine groups a table by it, so the group letter has to
 *     live there for the six group tables to exist. The seventy-six eliminated teams
 *     keep their zone untouched.
 *   - **The sheet named one team RIGHTLAND UNITED FC.** No such team played the
 *     qualifiers. It is Maryland United FC, confirmed by the competition owner, and
 *     is aliased below rather than created as a duplicate club.
 *
 * The source JSON reports "total: 37, scheduled: 19"; its arrays hold 36 and 18. Each
 * group has exactly the 6 fixtures a four-team round robin requires, so the fixture
 * list is complete and the count block is simply wrong.
 */
// Prisma is a value import: DbNull/JsonNull are runtime sentinels.
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { shouldPreserveSbMatch } from "../src/seed/seed-options";
import { createSeedMatchSlugAllocator } from "../src/scoreboard/match-slug";

const COMP_SLUG = "1xcup-2026";
const STAGE_KEY = "group_stage";
const TIMEZONE = "Africa/Lagos";
const VENUE = "Inspire Sport Arena";

/** Sheet name -> the name the competition already uses. */
const TEAM_ALIASES: Record<string, string> = {
  "RIGHTLAND UNITED FC": "MARYLAND UNITED FC",
};

/** Group letter -> the four teams drawn into it. */
const GROUPS: Record<string, string[]> = {
  "A": ["VIDO 99 FC", "EMILOJU FC", "JP YOUNG STARS FC", "BYT ACADEMICAL FC"],
  "B": ["NEWHOPE NAIJA FC", "KIRAA FA", "CRUSADERS FC", "DIVINE PRAISE FC"],
  "C": ["AJUWA FA", "TONIC FC", "MEGA 22 FC", "JOY COMETH FC"],
  "D": ["36 LION FC", "MARYLAND UNITED FC", "CRYSTAL FC", "IGHALO FA"],
  "E": ["DYNAMIC FC", "YOUNG STRIKERS FC", "AMA SMILE FC", "INSPIRE SA"],
  "F": ["COLLINS EDWIN SC", "ELITE STARS FC", "AUX FC", "ECAS FA"],
};

type GroupMatchSeed = {
  id: string; group: string; home: string; away: string; kickoffAt: string;
  status: "scheduled" | "finished"; homeScore: number; awayScore: number;
};

const MATCHES: GroupMatchSeed[] = [
  { id: "76245bb9-8f07-5e67-8e37-e1ea7ad24b94", group: "A", home: "VIDO 99 FC", away: "EMILOJU FC",
    kickoffAt: "2026-09-14T06:00:00+01:00", status: "finished", homeScore: 3, awayScore: 1 },
  { id: "2a216fb4-77f5-5979-85c2-298fda09f094", group: "A", home: "JP YOUNG STARS FC", away: "BYT ACADEMICAL FC",
    kickoffAt: "2026-09-14T07:00:00+01:00", status: "finished", homeScore: 1, awayScore: 1 },
  { id: "07ae7ca1-3bba-56c3-83a0-ad326e9bc426", group: "C", home: "AJUWA FA", away: "JOY COMETH FC",
    kickoffAt: "2026-09-14T07:00:00+01:00", status: "finished", homeScore: 4, awayScore: 0 },
  { id: "0b14eeaa-f01c-5e6f-8040-3e07ff4f40ac", group: "B", home: "NEWHOPE NAIJA FC", away: "KIRAA FA",
    kickoffAt: "2026-09-14T09:00:00+01:00", status: "finished", homeScore: 0, awayScore: 0 },
  { id: "3a3743d1-25c5-54ba-8cb3-83283043cd09", group: "C", home: "TONIC FC", away: "MEGA 22 FC",
    kickoffAt: "2026-09-14T09:00:00+01:00", status: "finished", homeScore: 1, awayScore: 1 },
  { id: "fc39f0e6-2969-5cfd-8084-30cb6c252924", group: "F", home: "ECAS FA", away: "AUX FC",
    kickoffAt: "2026-09-14T06:00:00+01:00", status: "finished", homeScore: 0, awayScore: 1 },
  { id: "2992c23e-7c5e-5e6e-85e1-015dcf583df4", group: "D", home: "36 LION FC", away: "IGHALO FA",
    kickoffAt: "2026-09-17T09:00:00+01:00", status: "finished", homeScore: 4, awayScore: 1 },
  { id: "dd0602ca-474a-59ca-87f6-390e9c66a54b", group: "D", home: "MARYLAND UNITED FC", away: "CRYSTAL FC",
    kickoffAt: "2026-09-17T07:00:00+01:00", status: "finished", homeScore: 2, awayScore: 1 },
  { id: "0a35f4d2-dde5-5609-8240-fcaafde70491", group: "E", home: "INSPIRE SA", away: "YOUNG STRIKERS FC",
    kickoffAt: "2026-09-17T09:00:00+01:00", status: "finished", homeScore: 0, awayScore: 1 },
  { id: "ddf26776-50e7-52ee-84b6-ab7f37d9b22f", group: "E", home: "DYNAMIC FC", away: "AMA SMILE FC",
    kickoffAt: "2026-09-22T09:00:00+01:00", status: "finished", homeScore: 3, awayScore: 2 },
  { id: "a6e40382-65e8-591b-8218-2d0634c1b074", group: "B", home: "KIRAA FA", away: "CRUSADERS FC",
    kickoffAt: "2026-09-22T07:00:00+01:00", status: "finished", homeScore: 2, awayScore: 2 },
  { id: "0ca58558-785a-5a72-8619-24ff5e33ef8a", group: "F", home: "ELITE STARS FC", away: "AUX FC",
    kickoffAt: "2026-09-22T09:00:00+01:00", status: "finished", homeScore: 2, awayScore: 1 },
  { id: "e645936a-6290-536c-8cd2-dba3f4e995a8", group: "A", home: "EMILOJU FC", away: "BYT ACADEMICAL FC",
    kickoffAt: "2026-09-23T06:00:00+01:00", status: "finished", homeScore: 2, awayScore: 1 },
  { id: "e0de40bb-39c3-5609-86a1-05e07a19a49a", group: "C", home: "AJUWA FA", away: "TONIC FC",
    kickoffAt: "2026-09-23T08:00:00+01:00", status: "finished", homeScore: 2, awayScore: 2 },
  { id: "f11318d1-65f8-56ad-8ff4-864a8b095500", group: "B", home: "NEWHOPE NAIJA FC", away: "DIVINE PRAISE FC",
    kickoffAt: "2026-09-23T09:00:00+01:00", status: "finished", homeScore: 1, awayScore: 0 },
  { id: "87de5ddd-8da0-513a-80dd-b1df3525f259", group: "F", home: "COLLINS EDWIN SC", away: "ECAS FA",
    kickoffAt: "2026-09-24T06:00:00+01:00", status: "finished", homeScore: 3, awayScore: 0 },
  { id: "93183a4d-071d-52bc-8f1b-eb3781ca8384", group: "A", home: "VIDO 99 FC", away: "JP YOUNG STARS FC",
    kickoffAt: "2026-09-24T08:00:00+01:00", status: "finished", homeScore: 2, awayScore: 2 },
  { id: "3033fbde-fb19-55a6-8e1c-8d02ec0a7850", group: "D", home: "36 LION FC", away: "MARYLAND UNITED FC",
    kickoffAt: "2026-09-24T10:00:00+01:00", status: "finished", homeScore: 1, awayScore: 0 },
  { id: "c4ed5ab8-4e13-5c08-85b3-d2736af62a32", group: "B", home: "DIVINE PRAISE FC", away: "CRUSADERS FC",
    kickoffAt: "2026-09-29T05:00:00+01:00", status: "scheduled", homeScore: 0, awayScore: 0 },
  { id: "48d19b45-26c1-5f88-8e63-604e220da088", group: "D", home: "IGHALO FA", away: "CRYSTAL FC",
    kickoffAt: "2026-09-29T07:00:00+01:00", status: "scheduled", homeScore: 0, awayScore: 0 },
  { id: "c2419592-166f-50c2-8b3c-57a48176e196", group: "E", home: "INSPIRE SA", away: "DYNAMIC FC",
    kickoffAt: "2026-09-29T09:00:00+01:00", status: "scheduled", homeScore: 0, awayScore: 0 },
  { id: "c935e5ae-63d6-5c51-8b80-422eaef59af2", group: "E", home: "YOUNG STRIKERS FC", away: "AMA SMILE FC",
    kickoffAt: "2026-09-30T05:00:00+01:00", status: "scheduled", homeScore: 0, awayScore: 0 },
  { id: "8db6d0c5-aeac-5b9f-8412-58993f48b7ac", group: "F", home: "COLLINS EDWIN SC", away: "ELITE STARS FC",
    kickoffAt: "2026-09-30T07:00:00+01:00", status: "scheduled", homeScore: 0, awayScore: 0 },
  { id: "8f1c3af7-9ed3-5ab6-8014-cf96716c9847", group: "C", home: "JOY COMETH FC", away: "MEGA 22 FC",
    kickoffAt: "2026-09-30T09:00:00+01:00", status: "scheduled", homeScore: 0, awayScore: 0 },
  { id: "4bc01af1-ae89-5d16-8689-d24e1d11e13a", group: "A", home: "VIDO 99 FC", away: "BYT ACADEMICAL FC",
    kickoffAt: "2026-10-01T05:00:00+01:00", status: "scheduled", homeScore: 0, awayScore: 0 },
  { id: "da0addce-37bf-51b4-8b5a-077f8d0ee097", group: "A", home: "EMILOJU FC", away: "JP YOUNG STARS FC",
    kickoffAt: "2026-10-01T07:00:00+01:00", status: "scheduled", homeScore: 0, awayScore: 0 },
  { id: "5b9d52f4-9c74-58de-854c-c196865ad401", group: "B", home: "NEWHOPE NAIJA FC", away: "CRUSADERS FC",
    kickoffAt: "2026-10-01T09:00:00+01:00", status: "scheduled", homeScore: 0, awayScore: 0 },
  { id: "c450c75a-1003-5c75-8b79-46dcda5f4628", group: "B", home: "DIVINE PRAISE FC", away: "KIRAA FA",
    kickoffAt: "2026-10-06T05:00:00+01:00", status: "scheduled", homeScore: 0, awayScore: 0 },
  { id: "feb8818f-893f-5336-8fac-f2e229d7fbe3", group: "C", home: "AJUWA FA", away: "MEGA 22 FC",
    kickoffAt: "2026-10-06T07:00:00+01:00", status: "scheduled", homeScore: 0, awayScore: 0 },
  { id: "c4f70bb8-15af-53d2-8639-323dd2d862a1", group: "C", home: "TONIC FC", away: "JOY COMETH FC",
    kickoffAt: "2026-10-06T09:00:00+01:00", status: "scheduled", homeScore: 0, awayScore: 0 },
  { id: "b0ac08a0-58f1-5348-8ad0-fa88f6c3e071", group: "D", home: "36 LION FC", away: "CRYSTAL FC",
    kickoffAt: "2026-10-07T05:00:00+01:00", status: "scheduled", homeScore: 0, awayScore: 0 },
  { id: "7ac3045e-1935-5d97-832a-1ff6cf11bf8e", group: "D", home: "IGHALO FA", away: "MARYLAND UNITED FC",
    kickoffAt: "2026-10-07T07:00:00+01:00", status: "scheduled", homeScore: 0, awayScore: 0 },
  { id: "15ab0c45-0007-5774-8380-cf81fb3ceefd", group: "E", home: "INSPIRE SA", away: "AMA SMILE FC",
    kickoffAt: "2026-10-07T09:00:00+01:00", status: "scheduled", homeScore: 0, awayScore: 0 },
  { id: "0d3d24e0-4a67-54c3-81d3-f0cb83399844", group: "E", home: "YOUNG STRIKERS FC", away: "DYNAMIC FC",
    kickoffAt: "2026-10-08T05:00:00+01:00", status: "scheduled", homeScore: 0, awayScore: 0 },
  { id: "89452e0b-16c3-51a5-878d-6d42920a5379", group: "F", home: "COLLINS EDWIN SC", away: "AUX FC",
    kickoffAt: "2026-10-08T07:00:00+01:00", status: "scheduled", homeScore: 0, awayScore: 0 },
  { id: "3f5472c3-c998-516a-8d4b-67b2a6e6043d", group: "F", home: "ECAS FA", away: "ELITE STARS FC",
    kickoffAt: "2026-10-08T09:00:00+01:00", status: "scheduled", homeScore: 0, awayScore: 0 },
];

export async function seed1XCupGroupStage2026(prisma: PrismaClient) {
  const comp = await prisma.sbCompetition.findUnique({
    where: { slug: COMP_SLUG },
    select: { id: true, name: true },
  });
  /* The group stage is an addition to a competition seeded elsewhere. If that has
     not run yet there is nothing to attach to, and inventing the competition here
     would produce a second 1XCup. */
  if (!comp) {
    console.log("1XCup group stage: 1xcup-2026 not seeded yet, skipping");
    return { skipped: true as const };
  }

  const stage = await prisma.sbCompetitionStage.findUnique({
    where: { competitionId_key: { competitionId: comp.id, key: STAGE_KEY } },
    select: { id: true },
  });
  if (!stage) {
    console.log("1XCup group stage: the group_stage stage row is missing, skipping");
    return { skipped: true as const };
  }

  /* Match on a whitespace- and case-insensitive key: the competition holds
     "DIVINE PRAISE  FC" with a double space, which an exact compare misses. */
  const teams = await prisma.sbTeam.findMany({
    where: { competitionId: comp.id },
    select: { id: true, name: true, slug: true },
  });
  const key = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();
  const bySheetName = new Map(teams.map((t) => [key(t.name), t]));
  const resolve = (sheetName: string) =>
    bySheetName.get(key(TEAM_ALIASES[key(sheetName)] ?? sheetName)) ?? null;

  const unresolved: string[] = [];
  for (const [letter, names] of Object.entries(GROUPS)) {
    for (const name of names) {
      const team = resolve(name);
      if (!team) {
        unresolved.push(name);
        continue;
      }
      /* The group letter replaces the qualifying zone for teams that advanced —
         the standings engine groups a table by this column. */
      await prisma.sbTeam.update({
        where: { id: team.id },
        /* Just the letter, as Jagaban and Lagos Queens store it: the standings card
           already prefixes "Group", and "Group A" here rendered as "Group Group A". */
        data: { groupKey: letter },
      });
    }
  }
  if (unresolved.length) {
    // Loud rather than silent: a team that cannot be resolved means its group table
    // would be short a side, which is worse than a failed seed.
    throw new Error(
      `1XCup group stage: these teams are not in the competition: ${unresolved.join(", ")}`
    );
  }

  const slugFor = await createSeedMatchSlugAllocator(prisma, MATCHES.map((m) => m.id));
  let seeded = 0;
  let preserved = 0;
  for (const match of MATCHES) {
    if (await shouldPreserveSbMatch(prisma, match.id)) {
      preserved += 1;
      continue;
    }
    const home = resolve(match.home);
    const away = resolve(match.away);
    if (!home || !away) continue;
    const shared = {
      slug: slugFor(match.id, home.slug, away.slug),
      stageId: stage.id,
      /* `group_a` … `group_f`: the app identifies group matches by this prefix,
         and the letter is read back off it. */
      stageKey: `group_${match.group.toLowerCase()}`,
      roundLabel: `Group ${match.group}`,
      homeTeamId: home.id,
      awayTeamId: away.id,
      status: match.status,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      minute: null,
      kickoffAt: new Date(match.kickoffAt),
      venue: VENUE,
      // `stats` is a nullable Json column; Prisma needs DbNull to write SQL NULL.
      stats: Prisma.DbNull,
      isPublished: true,
      meta: { timezone: TIMEZONE, group: match.group } as Prisma.InputJsonValue,
    };
    await prisma.sbMatch.upsert({
      where: { id: match.id },
      update: shared,
      create: { id: match.id, competitionId: comp.id, ...shared },
    });
    seeded += 1;
  }

  const groupMatches = await prisma.sbMatch.count({
    where: { competitionId: comp.id, stageKey: { startsWith: "group_" } },
  });
  const grouped = await prisma.sbTeam.count({
    where: { competitionId: comp.id, groupKey: { in: Object.keys(GROUPS) } },
  });
  console.log(
    `Seeded 1XCup group stage: ${groupMatches} group matches (expected 36), ` +
      `${grouped} teams drawn into groups (expected 24). ${seeded} written, ${preserved} preserved.`
  );
  return { comp, groupMatches, grouped };
}
