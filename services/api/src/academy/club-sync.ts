import { Logger } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { clubIdentityKey, normalizeClubName } from "@dtp/engines";
import { scoreboardTeamSlugForAcademy } from "./academy-team-sync.util";

/**
 * Club identity across competitions.
 *
 * A club that enters several competitions has one SbTeam per competition —
 * that is how fixtures, squads and standings are scoped — so the same club
 * used to appear once per competition with nothing tying the entries together.
 * Every SbTeam now carries an academyId pointing at its club profile (Academy),
 * and this module is what assigns it.
 *
 * Teams are grouped by clubIdentityKey (alias-resolved, case- and
 * punctuation-insensitive). Each group is linked to, in order of preference:
 *   1. the club profile any team in the group is already linked to — a manual
 *      link always wins;
 *   2. an existing profile whose slug is the team's slug, the convention the
 *      academy → team sync already relies on (including the ex-intl- prefix);
 *   3. an existing profile whose name has the same identity key;
 *   4. otherwise a new, published club profile built from the group's most
 *      recent team.
 *
 * It only ever fills gaps: a linked team is never re-pointed, an existing
 * profile's fields are never overwritten (a missing crest is filled in), and a
 * group whose teams are already split across two profiles is reported and left
 * for an admin rather than guessed at. Safe to run repeatedly.
 */

type ClubSyncPrisma = Pick<PrismaClient, "sbTeam" | "academy">;

const logger = new Logger("ClubSync");

/**
 * For hooks that run right after a team is written. Linking is a convenience
 * on top of that write, so a failure here is logged and swallowed rather than
 * failing a team the admin has already successfully created. The next sync
 * (seed, or Admin > Academies > Sync clubs) picks it up.
 */
export async function linkTeamsToClubsQuietly(
  prisma: ClubSyncPrisma,
  teamIds: string[]
): Promise<void> {
  if (!teamIds.length) return;
  try {
    await syncTeamsToClubs(prisma, { teamIds });
  } catch (err) {
    logger.warn(
      `Club linking skipped for ${teamIds.length} team(s): ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export type ClubSyncResult = {
  teamsScanned: number;
  teamsLinked: number;
  clubsCreated: number;
  clubsMatched: number;
  /** Club names left untouched because their teams point at different profiles. */
  ambiguous: string[];
};

type TeamRow = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  city: string | null;
  academyId: string | null;
  createdAt: Date;
  competition: { country: string | null; createdAt: Date };
};

type AcademyRow = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  isPublished: boolean;
  loginUsername: string | null;
  createdAt: Date;
};

function slugifyClub(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "club"
  );
}

/** Newest entry first: the club's current name, crest and city live there. */
function byRecency(a: TeamRow, b: TeamRow): number {
  return (
    b.competition.createdAt.getTime() - a.competition.createdAt.getTime() ||
    b.createdAt.getTime() - a.createdAt.getTime()
  );
}

/**
 * When two profiles share an identity key, prefer the published one, then a
 * real partner account (it has a login), then the oldest.
 */
function preferAcademy(current: AcademyRow | undefined, candidate: AcademyRow): AcademyRow {
  if (!current) return candidate;
  if (current.isPublished !== candidate.isPublished) {
    return current.isPublished ? current : candidate;
  }
  if (Boolean(current.loginUsername) !== Boolean(candidate.loginUsername)) {
    return current.loginUsername ? current : candidate;
  }
  return current.createdAt <= candidate.createdAt ? current : candidate;
}

export async function syncTeamsToClubs(
  prisma: ClubSyncPrisma,
  options: { teamIds?: string[] } = {}
): Promise<ClubSyncResult> {
  const [teams, academies] = await Promise.all([
    prisma.sbTeam.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        city: true,
        academyId: true,
        createdAt: true,
        competition: { select: { country: true, createdAt: true } },
      },
    }) as Promise<TeamRow[]>,
    prisma.academy.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        logoUrl: true,
        isPublished: true,
        loginUsername: true,
        createdAt: true,
      },
    }) as Promise<AcademyRow[]>,
  ]);

  const result: ClubSyncResult = {
    teamsScanned: teams.length,
    teamsLinked: 0,
    clubsCreated: 0,
    clubsMatched: 0,
    ambiguous: [],
  };

  const academyById = new Map(academies.map((a) => [a.id, a]));
  const usedSlugs = new Set(academies.map((a) => a.slug));
  const academyByTeamSlug = new Map<string, AcademyRow>();
  const academyByKey = new Map<string, AcademyRow>();
  for (const academy of academies) {
    const teamSlug = scoreboardTeamSlugForAcademy(academy);
    if (teamSlug) academyByTeamSlug.set(teamSlug, preferAcademy(academyByTeamSlug.get(teamSlug), academy));
    const key = clubIdentityKey(academy.name);
    if (key) academyByKey.set(key, preferAcademy(academyByKey.get(key), academy));
  }

  const groups = new Map<string, TeamRow[]>();
  for (const team of teams) {
    const key = clubIdentityKey(team.name);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(team);
    else groups.set(key, [team]);
  }

  const scope = options.teamIds ? new Set(options.teamIds) : null;

  for (const [key, group] of groups) {
    if (scope && !group.some((team) => scope.has(team.id))) continue;

    const unlinked = group.filter((team) => !team.academyId);
    if (!unlinked.length) continue;

    group.sort(byRecency);
    const latest = group[0];
    const linkedIds = [...new Set(group.map((team) => team.academyId).filter(Boolean))] as string[];
    if (linkedIds.length > 1) {
      result.ambiguous.push(normalizeClubName(latest.name));
      continue;
    }

    let academy: AcademyRow | undefined = linkedIds[0] ? academyById.get(linkedIds[0]) : undefined;
    if (!academy) {
      academy =
        group.map((team) => academyByTeamSlug.get(team.slug)).find(Boolean) ?? academyByKey.get(key);
      if (academy) result.clubsMatched++;
    }

    const crest = group.find((team) => team.logoUrl)?.logoUrl ?? null;
    if (!academy) {
      academy = await createClub(prisma, {
        name: normalizeClubName(latest.name),
        city: group.find((team) => team.city)?.city ?? null,
        country: latest.competition.country ?? "Nigeria",
        logoUrl: crest,
        usedSlugs,
      });
      academyById.set(academy.id, academy);
      academyByKey.set(key, academy);
      result.clubsCreated++;
    } else if (!academy.logoUrl && crest) {
      // Fill a missing crest only; an existing one is never replaced.
      await prisma.academy.update({ where: { id: academy.id }, data: { logoUrl: crest } });
      academy.logoUrl = crest;
    }

    // academyId: null in the filter so a concurrent manual link is never overwritten.
    const linked = await prisma.sbTeam.updateMany({
      where: { id: { in: unlinked.map((team) => team.id) }, academyId: null },
      data: { academyId: academy.id },
    });
    result.teamsLinked += linked.count;
  }

  return result;
}

async function createClub(
  prisma: ClubSyncPrisma,
  input: {
    name: string;
    city: string | null;
    country: string;
    logoUrl: string | null;
    usedSlugs: Set<string>;
  }
): Promise<AcademyRow> {
  const base = slugifyClub(input.name);
  for (let attempt = 1; attempt <= 50; attempt++) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    if (input.usedSlugs.has(slug)) continue;
    try {
      const created = await prisma.academy.create({
        data: {
          name: input.name,
          slug,
          city: input.city,
          country: input.country,
          logoUrl: input.logoUrl,
          // Published immediately: a club's history should be visible on the
          // Clubs page as soon as it has played in a competition.
          isPublished: true,
        },
        select: {
          id: true,
          slug: true,
          name: true,
          logoUrl: true,
          isPublished: true,
          loginUsername: true,
          createdAt: true,
        },
      });
      input.usedSlugs.add(slug);
      return created;
    } catch (err) {
      // Another request took the slug between our read and this write.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        input.usedSlugs.add(slug);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Could not allocate a club profile slug for "${input.name}"`);
}
