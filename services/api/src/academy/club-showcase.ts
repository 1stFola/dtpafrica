import type { PrismaClient } from "@prisma/client";
import { normalizeClubName, normalizePlayerName, playerLookupKey } from "@dtp/engines";
import { matchPathSegment } from "../scoreboard/match-slug";

/**
 * Everything the public "View club" modal shows, derived from the club's teams
 * in every published competition. Read-only; one round trip of parallel
 * queries, fetched only when the modal is opened.
 */

type ShowcasePrisma = Pick<PrismaClient, "sbMatch" | "sbMatchEvent" | "sbTeamSquad">;

export type ClubRecord = {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheets: number;
};

export type ClubShowcaseTeamRef = { name: string; shortName: string | null; logoUrl: string | null };

export type ClubShowcaseMatch = {
  matchId: string;
  matchSlug: string;
  kickoffAt: Date | null;
  status: string;
  competitionName: string;
  season: string;
  home: ClubShowcaseTeamRef;
  away: ClubShowcaseTeamRef;
  score: { home: number; away: number };
  /** Which side the club was on. */
  clubSide: "home" | "away";
  /** W / D / L from the club's point of view; null until the match is finished. */
  outcome: "W" | "D" | "L" | null;
};

export type ClubShowcaseScorer = {
  name: string;
  goals: number;
  /** Only set for public player profiles, so private ones are never linked. */
  slug: string | null;
  photoUrl: string | null;
};

export type ClubShowcasePlayer = {
  name: string;
  position: string | null;
  shirtNumber: number | null;
  slug: string | null;
  photoUrl: string | null;
  overallRating: number | null;
};

export type ClubShowcase = {
  record: ClubRecord;
  /** Last five results, newest first: the club's form guide. */
  recentResults: ClubShowcaseMatch[];
  /** Next fixtures, soonest first; a match in progress leads. */
  upcoming: ClubShowcaseMatch[];
  topScorers: ClubShowcaseScorer[];
  /** Standout players who have represented the club, public profiles first. */
  players: ClubShowcasePlayer[];
  /** Distinct players who have been in any of the club's squads. */
  squadSize: number;
};

const FINISHED = "finished";
const UPCOMING = ["live", "halftime", "scheduled"];
/** Own goals are credited to the side that benefits, not to a club's scorer. */
const SCORING_EVENTS = ["goal", "goal_penalty"];

const RESULT_LIMIT = 5;
const UPCOMING_LIMIT = 3;
const SCORER_LIMIT = 5;
const PLAYER_LIMIT = 8;

export const EMPTY_CLUB_SHOWCASE: ClubShowcase = {
  record: { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, cleanSheets: 0 },
  recentResults: [],
  upcoming: [],
  topScorers: [],
  players: [],
  squadSize: 0,
};

type MatchRow = {
  id: string;
  slug: string | null;
  status: string;
  kickoffAt: Date | null;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  homeTeam: { name: string; shortName: string | null; logoUrl: string | null };
  awayTeam: { name: string; shortName: string | null; logoUrl: string | null };
  competition: { name: string; season: string };
};

function teamRef(team: MatchRow["homeTeam"]): ClubShowcaseTeamRef {
  return { name: normalizeClubName(team.name), shortName: team.shortName, logoUrl: team.logoUrl };
}

function presentMatch(match: MatchRow, clubTeamIds: Set<string>): ClubShowcaseMatch {
  const clubSide = clubTeamIds.has(match.homeTeamId) ? "home" : "away";
  const forGoals = clubSide === "home" ? match.homeScore : match.awayScore;
  const againstGoals = clubSide === "home" ? match.awayScore : match.homeScore;
  return {
    matchId: match.id,
    matchSlug: matchPathSegment(match.slug, match.id),
    kickoffAt: match.kickoffAt,
    status: match.status,
    competitionName: match.competition.name,
    season: match.competition.season,
    home: teamRef(match.homeTeam),
    away: teamRef(match.awayTeam),
    score: { home: match.homeScore, away: match.awayScore },
    clubSide,
    outcome:
      match.status !== FINISHED
        ? null
        : forGoals > againstGoals
          ? "W"
          : forGoals < againstGoals
            ? "L"
            : "D",
  };
}

export function recordFromMatches(matches: MatchRow[], clubTeamIds: Set<string>): ClubRecord {
  const record = { ...EMPTY_CLUB_SHOWCASE.record };
  for (const match of matches) {
    if (match.status !== FINISHED) continue;
    const home = clubTeamIds.has(match.homeTeamId);
    const goalsFor = home ? match.homeScore : match.awayScore;
    const goalsAgainst = home ? match.awayScore : match.homeScore;
    record.played++;
    record.goalsFor += goalsFor;
    record.goalsAgainst += goalsAgainst;
    if (goalsAgainst === 0) record.cleanSheets++;
    if (goalsFor > goalsAgainst) record.won++;
    else if (goalsFor < goalsAgainst) record.lost++;
    else record.drawn++;
  }
  return record;
}

export async function buildClubShowcase(
  prisma: ShowcasePrisma,
  clubTeamIds: string[]
): Promise<ClubShowcase> {
  if (!clubTeamIds.length) return EMPTY_CLUB_SHOWCASE;
  const clubTeams = new Set(clubTeamIds);

  const matchInclude = {
    homeTeam: { select: { name: true, shortName: true, logoUrl: true } },
    awayTeam: { select: { name: true, shortName: true, logoUrl: true } },
    competition: { select: { name: true, season: true } },
  } as const;
  const clubMatches = {
    isPublished: true,
    competition: { isPublished: true },
    OR: [{ homeTeamId: { in: clubTeamIds } }, { awayTeamId: { in: clubTeamIds } }],
  };

  const [finished, upcoming, goalEvents, squad] = await Promise.all([
    prisma.sbMatch.findMany({
      where: { ...clubMatches, status: FINISHED },
      orderBy: { kickoffAt: "desc" },
      include: matchInclude,
    }) as Promise<MatchRow[]>,
    prisma.sbMatch.findMany({
      where: { ...clubMatches, status: { in: UPCOMING } },
      orderBy: { kickoffAt: "asc" },
      take: UPCOMING_LIMIT * 2,
      include: matchInclude,
    }) as Promise<MatchRow[]>,
    prisma.sbMatchEvent.findMany({
      where: {
        teamId: { in: clubTeamIds },
        type: { in: SCORING_EVENTS },
        match: { isPublished: true, competition: { isPublished: true } },
      },
      select: {
        playerId: true,
        playerLabel: true,
        player: { select: { displayName: true, slug: true, playerPhotoUrl: true, isPublic: true } },
      },
    }),
    prisma.sbTeamSquad.findMany({
      where: { teamId: { in: clubTeamIds } },
      select: {
        playerId: true,
        displayName: true,
        position: true,
        shirtNumber: true,
        player: {
          select: {
            displayName: true,
            slug: true,
            positionPrimary: true,
            playerPhotoUrl: true,
            overallRating: true,
            isPublic: true,
          },
        },
      },
    }),
  ]);

  // Scorers: by player where the event is linked, otherwise by name label.
  const scorers = new Map<string, ClubShowcaseScorer>();
  for (const event of goalEvents) {
    const name = event.player?.displayName ?? (event.playerLabel ? normalizePlayerName(event.playerLabel) : "");
    const key = event.playerId ?? `label:${playerLookupKey(name)}`;
    if (!name || key === "label:") continue;
    const current = scorers.get(key);
    if (current) {
      current.goals++;
      continue;
    }
    const isPublic = Boolean(event.player?.isPublic);
    scorers.set(key, {
      name,
      goals: 1,
      slug: isPublic ? (event.player?.slug ?? null) : null,
      photoUrl: isPublic ? (event.player?.playerPhotoUrl ?? null) : null,
    });
  }
  const topScorers = [...scorers.values()]
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name))
    .slice(0, SCORER_LIMIT);

  // Squad: one entry per player across every season.
  const byPlayer = new Map<string, ClubShowcasePlayer & { isPublic: boolean }>();
  for (const row of squad) {
    const key = row.playerId ?? `name:${playerLookupKey(row.displayName)}`;
    if (byPlayer.has(key)) continue;
    const isPublic = Boolean(row.player?.isPublic);
    byPlayer.set(key, {
      name: row.player?.displayName ?? row.displayName,
      position: row.position ?? row.player?.positionPrimary ?? null,
      shirtNumber: row.shirtNumber,
      slug: isPublic ? (row.player?.slug ?? null) : null,
      photoUrl: isPublic ? (row.player?.playerPhotoUrl ?? null) : null,
      overallRating: isPublic ? (row.player?.overallRating ?? null) : null,
      isPublic,
    });
  }
  const players = [...byPlayer.values()]
    .sort(
      (a, b) =>
        Number(b.isPublic) - Number(a.isPublic) ||
        (b.overallRating ?? -1) - (a.overallRating ?? -1) ||
        Number(Boolean(b.photoUrl)) - Number(Boolean(a.photoUrl)) ||
        a.name.localeCompare(b.name)
    )
    .slice(0, PLAYER_LIMIT)
    .map(({ isPublic: _isPublic, ...player }) => player);

  const liveFirst = [...upcoming].sort(
    (a, b) =>
      Number(b.status !== "scheduled") - Number(a.status !== "scheduled") ||
      (a.kickoffAt?.getTime() ?? Infinity) - (b.kickoffAt?.getTime() ?? Infinity)
  );

  return {
    record: recordFromMatches(finished, clubTeams),
    recentResults: finished.slice(0, RESULT_LIMIT).map((m) => presentMatch(m, clubTeams)),
    upcoming: liveFirst.slice(0, UPCOMING_LIMIT).map((m) => presentMatch(m, clubTeams)),
    topScorers,
    players,
    squadSize: byPlayer.size,
  };
}
