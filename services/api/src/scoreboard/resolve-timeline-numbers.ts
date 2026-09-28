/**
 * Resolving the shirt numbers already stored on a timeline, for a given set of matches.
 *
 * Extracted from `db:sync:timeline-squad-numbers` so the squad CSV import can run the
 * same pass the moment a team's numbers arrive. Two implementations of this would drift,
 * and the cost of drift is a goal on the wrong profile.
 *
 * The caller chooses the matches. That is deliberate: the script passes every finished
 * fixture, while the import passes only the uploaded team's own season, and neither
 * scoping rule belongs in here.
 *
 * See `squad-number-lookup.ts` for the resolution rules themselves — team squad first,
 * matchday squad second, an ambiguous number resolving to nobody.
 */
import { buildNumberLookup, squadNumberLabel, type SquadRow } from "./squad-number-lookup";

export type MatchToResolve = {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  label: string;
};

export type TimelineFix = {
  eventId: string;
  matchLabel: string;
  minute: number;
  type: string;
  number: number | null;
  /** Only the columns that actually change. */
  data: Record<string, string | null>;
  wasPlayerId: string | null;
  nowPlayerId: string | null;
  /** Carried so a report can name the change without a second lookup. */
  wasLabel: string | null;
  nowLabel: string | null;
  /** The link moves from one real player to another: somebody's goal becomes somebody else's. */
  reattribution: boolean;
};

export type TimelinePlan = {
  fixes: TimelineFix[];
  conflicts: { matchLabel: string; number: number; team: string; matchday: string }[];
  ambiguous: { matchLabel: string; number: number; source: string; names: string[] }[];
  unresolved: { matchLabel: string; number: number; minute: number }[];
  noTeam: { matchLabel: string; number: number; minute: number }[];
  matchesWithNumbers: number;
  eventsSeen: number;
};

/** Only the calls this needs, so the script's raw client and the Nest service both fit. */
export type TimelineDb = {
  sbTeamSquad: { findMany: (args: unknown) => Promise<unknown[]> };
  sbMatchSquadPlayer: { findMany: (args: unknown) => Promise<unknown[]> };
  sbMatchEvent: {
    findMany: (args: unknown) => Promise<unknown[]>;
    update: (args: unknown) => Promise<unknown>;
  };
};

const ASSIST_TYPES = ["goal"];

function numberFrom(metadata: unknown, key: string): number | null {
  const value = (metadata as Record<string, unknown> | null)?.[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

type EventRow = {
  id: string;
  teamId: string | null;
  type: string;
  minute: number;
  playerId: string | null;
  playerLabel: string | null;
  playerLabel2: string | null;
  assistPlayerId: string | null;
  assistLabel: string | null;
  metadata: unknown;
};

export async function planTimelineNumberFixes(
  db: TimelineDb,
  matches: MatchToResolve[]
): Promise<TimelinePlan> {
  const plan: TimelinePlan = {
    fixes: [],
    conflicts: [],
    ambiguous: [],
    unresolved: [],
    noTeam: [],
    matchesWithNumbers: 0,
    eventsSeen: 0,
  };
  if (!matches.length) return plan;

  const teamIds = [...new Set(matches.flatMap((m) => [m.homeTeamId, m.awayTeamId]))];
  const teamRows = (await db.sbTeamSquad.findMany({
    where: { teamId: { in: teamIds }, shirtNumber: { not: null } },
    select: { teamId: true, shirtNumber: true, displayName: true, playerId: true },
  })) as { teamId: string; shirtNumber: number | null; displayName: string; playerId: string | null }[];

  const teamSquadByTeam = new Map<string, SquadRow[]>();
  for (const row of teamRows) {
    const list = teamSquadByTeam.get(row.teamId) ?? [];
    list.push({
      teamId: row.teamId,
      number: row.shirtNumber,
      playerName: row.displayName,
      playerId: row.playerId,
    });
    teamSquadByTeam.set(row.teamId, list);
  }

  for (const match of matches) {
    const events = (await db.sbMatchEvent.findMany({
      where: { matchId: match.id },
      select: {
        id: true,
        teamId: true,
        type: true,
        minute: true,
        playerId: true,
        playerLabel: true,
        playerLabel2: true,
        assistPlayerId: true,
        assistLabel: true,
        metadata: true,
      },
      orderBy: { minute: "asc" },
    })) as EventRow[];

    const numbered = events.filter(
      (e) =>
        numberFrom(e.metadata, "playerNumber") || numberFrom(e.metadata, "secondaryPlayerNumber")
    );
    if (!numbered.length) continue;
    plan.matchesWithNumbers += 1;

    const matchRows = (await db.sbMatchSquadPlayer.findMany({
      where: { matchId: match.id, jerseyNumber: { not: null } },
      select: { teamId: true, jerseyNumber: true, playerName: true, playerId: true },
    })) as { teamId: string; jerseyNumber: number | null; playerName: string; playerId: string | null }[];

    const lookup = buildNumberLookup({
      teamSquad: [
        ...(teamSquadByTeam.get(match.homeTeamId) ?? []),
        ...(teamSquadByTeam.get(match.awayTeamId) ?? []),
      ],
      matchSquad: matchRows.map((row) => ({
        teamId: row.teamId,
        number: row.jerseyNumber,
        playerName: row.playerName,
        playerId: row.playerId,
      })),
    });
    for (const c of lookup.conflicts) {
      plan.conflicts.push({
        matchLabel: match.label,
        number: c.number,
        team: c.fromTeamSquad,
        matchday: c.fromMatchSquad,
      });
    }
    for (const a of lookup.ambiguous) {
      plan.ambiguous.push({
        matchLabel: match.label,
        number: a.number,
        source: a.source,
        names: a.names,
      });
    }

    for (const event of numbered) {
      plan.eventsSeen += 1;
      const number = numberFrom(event.metadata, "playerNumber");
      const secondaryNumber = numberFrom(event.metadata, "secondaryPlayerNumber");

      /* A shirt number means nothing without a side: both teams have a number 7, and
         resolving without knowing which would put an away goal on a home player. */
      if (!event.teamId) {
        if (number) plan.noTeam.push({ matchLabel: match.label, number, minute: event.minute });
        continue;
      }

      const primary = lookup.find(event.teamId, number);
      const secondary = lookup.find(event.teamId, secondaryNumber);

      const isAmbiguous = lookup.ambiguous.some(
        (a) => a.number === number && a.teamId === event.teamId
      );
      if (number && !primary && !isAmbiguous) {
        plan.unresolved.push({ matchLabel: match.label, number, minute: event.minute });
      }

      /* Only ever an improvement: a column is written when there is something better to
         put in it, never to clear one. A number that resolves to nobody leaves the label
         and the link exactly as they were, rather than blanking work done by hand. */
      const data: Record<string, string | null> = {};
      const wantLabel = squadNumberLabel(primary, number);
      if (wantLabel && wantLabel !== event.playerLabel) data.playerLabel = wantLabel;
      if (primary?.playerId && primary.playerId !== event.playerId) {
        data.playerId = primary.playerId;
      }
      const wantLabel2 = squadNumberLabel(secondary, secondaryNumber);
      if (wantLabel2 && wantLabel2 !== event.playerLabel2) data.playerLabel2 = wantLabel2;
      if (ASSIST_TYPES.includes(event.type)) {
        if (wantLabel2 && wantLabel2 !== event.assistLabel) data.assistLabel = wantLabel2;
        if (secondary?.playerId && secondary.playerId !== event.assistPlayerId) {
          data.assistPlayerId = secondary.playerId;
        }
      }
      if (!Object.keys(data).length) continue;

      plan.fixes.push({
        eventId: event.id,
        matchLabel: match.label,
        minute: event.minute,
        type: event.type,
        number,
        data,
        wasPlayerId: event.playerId,
        nowPlayerId: primary?.playerId ?? event.playerId,
        wasLabel: event.playerLabel,
        nowLabel: wantLabel ?? event.playerLabel,
        reattribution: Boolean(
          event.playerId && primary?.playerId && event.playerId !== primary.playerId
        ),
      });
    }
  }

  return plan;
}

/**
 * Write the planned fixes, and report which players' totals now need recomputing.
 *
 * Both the player losing a link and the one gaining it are returned, because a goal that
 * moved has to come off one total as well as onto the other.
 */
export async function applyTimelineNumberFixes(db: TimelineDb, fixes: TimelineFix[]) {
  const touched = new Set<string>();
  let written = 0;
  for (const fix of fixes) {
    await db.sbMatchEvent.update({ where: { id: fix.eventId }, data: fix.data });
    written += 1;
    if (fix.wasPlayerId) touched.add(fix.wasPlayerId);
    if (fix.nowPlayerId) touched.add(fix.nowPlayerId);
    const assist = fix.data.assistPlayerId;
    if (assist) touched.add(assist);
  }
  return { written, touched: [...touched] };
}
