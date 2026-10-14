/**
 * Fold one ScoreBoard team into another.
 *
 * A team is scoped to a competition — fixtures, squads and the table all hang off
 * the competition's own entry — so "the same team twice" means two different
 * things, and the merge does two different things:
 *
 *   - **Same competition** (`absorb`): a real duplicate. Everything the source owns
 *     moves to the target and the source is deleted. That is its fixtures as home
 *     and as away side, its squad, the per-match squads, events, the Vision rows
 *     that name it, and the matchday rosters kept inside each match's `stats`,
 *     which are keyed by team id and so would otherwise be orphaned silently.
 *     A squad member who is already on the target's squad (same player profile,
 *     or the same name where neither has a profile) is folded into that row rather
 *     than listed twice.
 *
 *   - **Different competitions** (`link`): the same club entered in two
 *     competitions. Both entries stay, because each competition needs its own,
 *     but they are tied to one club profile (academyId) and the source takes the
 *     target's name, short name and crest, so the club reads the same everywhere.
 *     Nothing moves between competitions.
 *
 * An absorb is refused when the two teams have played each other: the fixture
 * would become a team against itself. That fixture has to be dealt with first.
 *
 * **Shirt numbers.** A link never touches a squad: each competition keeps its own
 * numbers. An absorb puts two squads of one competition together, so the plan
 * lists, before anything is written, every number two different players would
 * then share (the number lookup refuses to guess between them, so a goal recorded
 * as "No. 7" would stay unattributed until one is changed) and every combined
 * player whose two entries carried different numbers (the kept team's number
 * stays; the match-day squads keep the number actually worn in each match).
 *
 * The caller supplies the transaction; a half-merged team is worse than either
 * of the two it came from.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

export type TeamMergeTx = Prisma.TransactionClient;
export type TeamMergeMode = "absorb" | "link";

type TeamRow = {
  id: string;
  competitionId: string;
  name: string;
  shortName: string | null;
  slug: string;
  logoUrl: string | null;
  academyId: string | null;
  competition: { name: string };
};

export type TeamMergePlan = {
  mode: TeamMergeMode;
  source: { id: string; name: string; competition: string };
  target: { id: string; name: string; competition: string };
  /** Why the merge cannot run; null when it can. */
  blocked: string | null;
  counts: {
    fixtures: number;
    squad: number;
    events: number;
    matchSquadPlayers: number;
    /** Fixtures between the two teams: an absorb would make each one a team v itself. */
    headToHead: number;
  };
  /** Absorb only; always empty for a link, which leaves both squads alone. */
  shirtNumbers: {
    clashes: Array<{ number: number; kept: string; incoming: string }>;
    renumbered: Array<{ name: string; kept: number; dropped: number }>;
  };
};

export type TeamMergeOutcome = TeamMergePlan & {
  moved: {
    homeFixtures: number;
    awayFixtures: number;
    squadMoved: number;
    squadFolded: number;
    events: number;
    matchSquadPlayers: number;
    rosters: number;
    visionTeamSides: number;
    visionIdentityAssignments: number;
    visionEventCandidates: number;
  };
  /** Set when neither team had a club profile, so the caller can create one. */
  needsClubLink: boolean;
};

export class TeamMergeError extends Error {
  constructor(
    message: string,
    readonly kind: "not_found" | "invalid" | "conflict"
  ) {
    super(message);
    this.name = "TeamMergeError";
  }
}

const teamSelect = {
  id: true,
  competitionId: true,
  name: true,
  shortName: true,
  slug: true,
  logoUrl: true,
  academyId: true,
  competition: { select: { name: true } },
} as const;

/** Case, spacing and punctuation do not make two squad names different people. */
export function squadNameKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type Db = TeamMergeTx | PrismaClient;

async function loadPair(db: Db, sourceTeamId: string, targetTeamId: string) {
  if (!sourceTeamId || !targetTeamId) {
    throw new TeamMergeError("Choose the duplicate team and the team to keep.", "invalid");
  }
  if (sourceTeamId === targetTeamId) {
    throw new TeamMergeError("A team cannot be merged into itself.", "invalid");
  }
  const [source, target] = await Promise.all([
    db.sbTeam.findUnique({ where: { id: sourceTeamId }, select: teamSelect }),
    db.sbTeam.findUnique({ where: { id: targetTeamId }, select: teamSelect }),
  ]);
  if (!source) throw new TeamMergeError("The duplicate team was not found.", "not_found");
  if (!target) throw new TeamMergeError("The team to keep was not found.", "not_found");
  return { source: source as TeamRow, target: target as TeamRow };
}

/** What a merge would do, without writing anything. */
export async function planTeamMerge(
  db: Db,
  args: { sourceTeamId: string; targetTeamId: string }
): Promise<TeamMergePlan> {
  const { source, target } = await loadPair(db, args.sourceTeamId, args.targetTeamId);
  return planFor(db, source, target);
}

async function planFor(db: Db, source: TeamRow, target: TeamRow): Promise<TeamMergePlan> {
  const mode: TeamMergeMode = source.competitionId === target.competitionId ? "absorb" : "link";
  const [fixtures, squad, events, matchSquadPlayers, headToHead] = await Promise.all([
    db.sbMatch.count({ where: { OR: [{ homeTeamId: source.id }, { awayTeamId: source.id }] } }),
    db.sbTeamSquad.count({ where: { teamId: source.id } }),
    db.sbMatchEvent.count({ where: { teamId: source.id } }),
    db.sbMatchSquadPlayer.count({ where: { teamId: source.id } }),
    db.sbMatch.count({
      where: {
        OR: [
          { homeTeamId: source.id, awayTeamId: target.id },
          { homeTeamId: target.id, awayTeamId: source.id },
        ],
      },
    }),
  ]);
  const shirtNumbers: TeamMergePlan["shirtNumbers"] = { clashes: [], renumbered: [] };
  if (mode === "absorb") {
    const [sourceSquad, targetSquad] = await Promise.all([
      db.sbTeamSquad.findMany({ where: { teamId: source.id } }),
      db.sbTeamSquad.findMany({ where: { teamId: target.id } }),
    ]);
    for (const row of sourceSquad) {
      const same = sameSquadMember(row, targetSquad);
      if (same) {
        if (same.shirtNumber != null && row.shirtNumber != null && same.shirtNumber !== row.shirtNumber) {
          shirtNumbers.renumbered.push({
            name: same.displayName,
            kept: same.shirtNumber,
            dropped: row.shirtNumber,
          });
        }
        continue;
      }
      if (row.shirtNumber == null) continue;
      const holder = targetSquad.find((t) => t.shirtNumber === row.shirtNumber);
      if (holder) {
        shirtNumbers.clashes.push({
          number: row.shirtNumber,
          kept: holder.displayName,
          incoming: row.displayName,
        });
      }
    }
    shirtNumbers.clashes.sort((a, b) => a.number - b.number);
  }
  const blocked =
    mode === "absorb" && headToHead > 0
      ? `${source.name} and ${target.name} have ${headToHead} fixture(s) against each other. ` +
        "Merging would make each one a team against itself, so delete or reassign those fixtures first."
      : null;
  return {
    mode,
    source: { id: source.id, name: source.name, competition: source.competition.name },
    target: { id: target.id, name: target.name, competition: target.competition.name },
    blocked,
    counts: { fixtures, squad, events, matchSquadPlayers, headToHead },
    shirtNumbers,
  };
}

type SquadMember = { playerId: string | null; displayName: string };

/** The kept squad's row for the same person: same profile, or same name where neither has one. */
function sameSquadMember<T extends SquadMember>(row: SquadMember, squad: T[]): T | undefined {
  return squad.find((t) =>
    row.playerId
      ? t.playerId === row.playerId
      : !t.playerId && squadNameKey(t.displayName) === squadNameKey(row.displayName)
  );
}

type StatsWithRosters = { matchdayRosters?: Record<string, { teamId?: string } & Record<string, unknown>> };

export async function mergeTeamRecords(
  tx: TeamMergeTx,
  args: { sourceTeamId: string; targetTeamId: string }
): Promise<TeamMergeOutcome> {
  const { source, target } = await loadPair(tx, args.sourceTeamId, args.targetTeamId);
  const plan = await planFor(tx, source, target);
  if (plan.blocked) throw new TeamMergeError(plan.blocked, "conflict");

  const moved: TeamMergeOutcome["moved"] = {
    homeFixtures: 0,
    awayFixtures: 0,
    squadMoved: 0,
    squadFolded: 0,
    events: 0,
    matchSquadPlayers: 0,
    rosters: 0,
    visionTeamSides: 0,
    visionIdentityAssignments: 0,
    visionEventCandidates: 0,
  };
  const academyId = target.academyId ?? source.academyId;

  if (plan.mode === "link") {
    if (academyId && target.academyId !== academyId) {
      await tx.sbTeam.update({ where: { id: target.id }, data: { academyId } });
    }
    await tx.sbTeam.update({
      where: { id: source.id },
      data: {
        name: target.name,
        shortName: target.shortName,
        ...(target.logoUrl ? { logoUrl: target.logoUrl } : {}),
        ...(academyId ? { academyId } : {}),
      },
    });
    return { ...plan, moved, needsClubLink: !academyId };
  }

  /* Rosters first, while the matches still name the source: they are keyed by
     team id inside the match's stats, and nothing else would carry them over. */
  const sourceMatches = await tx.sbMatch.findMany({
    where: { OR: [{ homeTeamId: source.id }, { awayTeamId: source.id }] },
    select: { id: true, stats: true },
  });
  for (const match of sourceMatches) {
    const stats = match.stats as StatsWithRosters | null;
    const roster = stats?.matchdayRosters?.[source.id];
    if (!stats || !roster) continue;
    const rosters = { ...stats.matchdayRosters };
    delete rosters[source.id];
    rosters[target.id] = { ...roster, teamId: target.id };
    await tx.sbMatch.update({
      where: { id: match.id },
      data: { stats: { ...stats, matchdayRosters: rosters } as Prisma.InputJsonValue },
    });
    moved.rosters += 1;
  }

  moved.homeFixtures = (
    await tx.sbMatch.updateMany({ where: { homeTeamId: source.id }, data: { homeTeamId: target.id } })
  ).count;
  moved.awayFixtures = (
    await tx.sbMatch.updateMany({ where: { awayTeamId: source.id }, data: { awayTeamId: target.id } })
  ).count;

  const [sourceSquad, targetSquad] = await Promise.all([
    tx.sbTeamSquad.findMany({ where: { teamId: source.id } }),
    tx.sbTeamSquad.findMany({ where: { teamId: target.id } }),
  ]);
  for (const row of sourceSquad) {
    const same = sameSquadMember(row, targetSquad);
    if (!same) {
      await tx.sbTeamSquad.update({ where: { id: row.id }, data: { teamId: target.id } });
      moved.squadMoved += 1;
      continue;
    }
    /* Already on the target's squad: point the per-match squads at the surviving
       row, keep any detail only the source had, and drop the duplicate. */
    await tx.sbMatchSquadPlayer.updateMany({ where: { squadId: row.id }, data: { squadId: same.id } });
    const fill: Prisma.SbTeamSquadUpdateInput = {};
    if (same.shirtNumber == null && row.shirtNumber != null) fill.shirtNumber = row.shirtNumber;
    if (!same.position && row.position) fill.position = row.position;
    if (Object.keys(fill).length) await tx.sbTeamSquad.update({ where: { id: same.id }, data: fill });
    await tx.sbTeamSquad.delete({ where: { id: row.id } });
    moved.squadFolded += 1;
  }

  moved.matchSquadPlayers = (
    await tx.sbMatchSquadPlayer.updateMany({ where: { teamId: source.id }, data: { teamId: target.id } })
  ).count;
  moved.events = (
    await tx.sbMatchEvent.updateMany({ where: { teamId: source.id }, data: { teamId: target.id } })
  ).count;
  moved.visionTeamSides = (
    await tx.visionTeamSide.updateMany({ where: { sbTeamId: source.id }, data: { sbTeamId: target.id } })
  ).count;
  moved.visionIdentityAssignments = (
    await tx.visionIdentityAssignment.updateMany({
      where: { sbTeamId: source.id },
      data: { sbTeamId: target.id },
    })
  ).count;
  moved.visionEventCandidates = (
    await tx.visionEventCandidate.updateMany({
      where: { sbTeamId: source.id },
      data: { sbTeamId: target.id },
    })
  ).count;

  const keep: Prisma.SbTeamUpdateInput = {};
  if (!target.logoUrl && source.logoUrl) keep.logoUrl = source.logoUrl;
  if (!target.academyId && source.academyId) keep.academy = { connect: { id: source.academyId } };
  if (Object.keys(keep).length) await tx.sbTeam.update({ where: { id: target.id }, data: keep });

  await tx.sbTeam.delete({ where: { id: source.id } });
  return { ...plan, moved, needsClubLink: !academyId };
}
