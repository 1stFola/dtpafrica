import type { Prisma, PrismaClient } from "@prisma/client";
import { playerLookupKey } from "@dtp/engines";

type AliasIndex = Map<string, Set<string>>;

function addAlias(index: AliasIndex, rawName: string | null | undefined, playerId: string) {
  const key = playerLookupKey(rawName ?? "");
  if (!key) return;
  const matches = index.get(key) ?? new Set<string>();
  matches.add(playerId);
  index.set(key, matches);
}

/**
 * Why a label did not become a link.
 *
 * The distinction is the whole value of reporting it. "No squad row" means somebody
 * has to add the player; "two players share this name" means the label is ambiguous
 * and no amount of squad data will settle it. Guessing either way would attribute a
 * goal to the wrong person, which is worse than leaving it unattributed.
 */
export type LinkFailure = { reason: "no_match" | "ambiguous"; candidates: number };
type Resolution = { playerId: string } | LinkFailure;

function lookupAlias(
  index: AliasIndex | undefined,
  rawName: string | null | undefined
): Resolution {
  const key = playerLookupKey(rawName ?? "");
  if (!key || !index) return { reason: "no_match", candidates: 0 };
  const matches = index.get(key);
  if (!matches || matches.size === 0) return { reason: "no_match", candidates: 0 };
  if (matches.size > 1) return { reason: "ambiguous", candidates: matches.size };
  return { playerId: Array.from(matches)[0]! };
}

function resolveAlias(index: AliasIndex | undefined, rawName: string | null | undefined) {
  const found = lookupAlias(index, rawName);
  return "playerId" in found ? found.playerId : null;
}

function addReversedTwoPartAlias(
  index: AliasIndex,
  rawName: string | null | undefined,
  playerId: string
) {
  const parts = (rawName ?? "").trim().split(/\s+/);
  if (parts.length !== 2) return;
  addAlias(index, `${parts[1]} ${parts[0]}`, playerId);
}

/** A label that stayed unlinked, with enough context to act on it. */
export type UnresolvedLink = LinkFailure & {
  eventId: string;
  label: string;
  /** Which side of the event: the scorer, or the assist. */
  field: "player" | "assist";
  competition: string | null;
  team: string | null;
  minute: number | null;
};

export type EventLinkSyncResult = {
  updated: number;
  /**
   * Labels no squad could resolve.
   *
   * Reported rather than counted, because an unlinked scorer is invisible in the
   * product — the goal shows on the fixture and never reaches the player's profile
   * or the stat leaders — so the only way anyone finds out is if something says so.
   */
  unresolved: UnresolvedLink[];
};

export async function syncScoreboardEventPlayerLinks(
  prisma: PrismaClient,
  options: { dryRun?: boolean } = {}
): Promise<EventLinkSyncResult> {
  const dryRun = options.dryRun === true;
  const teamSquadRows = await prisma.sbTeamSquad.findMany({
    where: { playerId: { not: null } },
    include: {
      player: {
        select: {
          id: true,
          displayName: true,
          normalizedName: true,
          slug: true,
        },
      },
    },
  });
  const matchSquadRows = await prisma.sbMatchSquadPlayer.findMany({
    where: { playerId: { not: null } },
    include: {
      player: {
        select: {
          id: true,
          displayName: true,
          normalizedName: true,
          slug: true,
        },
      },
    },
  });
  const players = await prisma.player.findMany({
    select: {
      id: true,
      displayName: true,
      normalizedName: true,
      slug: true,
    },
  });

  const byTeam = new Map<string, AliasIndex>();
  const global = new Map<string, Set<string>>();

  const addRow = (args: {
    teamId: string;
    playerId: string | null;
    displayName: string;
    player?: {
      id: string;
      displayName: string;
      normalizedName: string | null;
      slug: string;
    } | null;
  }) => {
    const playerId = args.playerId ?? args.player?.id ?? null;
    if (!playerId) return;
    const teamIndex = byTeam.get(args.teamId) ?? new Map<string, Set<string>>();
    byTeam.set(args.teamId, teamIndex);

    const aliases = [
      args.displayName,
      args.player?.displayName,
      args.player?.normalizedName,
      args.player?.slug?.replace(/-/g, " "),
    ];

    for (const alias of aliases) {
      addAlias(teamIndex, alias, playerId);
      addAlias(global, alias, playerId);
    }

    addReversedTwoPartAlias(teamIndex, args.displayName, playerId);
    addReversedTwoPartAlias(global, args.displayName, playerId);
  };

  for (const row of teamSquadRows) addRow(row);
  for (const row of matchSquadRows) {
    addRow({
      teamId: row.teamId,
      playerId: row.playerId,
      displayName: row.playerName,
      player: row.player,
    });
  }
  for (const player of players) {
    const aliases = [
      player.displayName,
      player.normalizedName,
      player.slug?.replace(/-/g, " "),
    ];
    for (const alias of aliases) addAlias(global, alias, player.id);
    addReversedTwoPartAlias(global, player.displayName, player.id);
  }

  const events = await prisma.sbMatchEvent.findMany({
    where: {
      OR: [
        { playerId: null, playerLabel: { not: null } },
        { assistPlayerId: null, assistLabel: { not: null } },
        { playerLabel2: { not: null } },
      ],
    },
    select: {
      id: true,
      teamId: true,
      playerId: true,
      assistPlayerId: true,
      playerLabel: true,
      assistLabel: true,
      playerLabel2: true,
      metadata: true,
      type: true,
      minute: true,
      team: { select: { name: true } },
      match: {
        select: {
          homeTeamId: true,
          awayTeamId: true,
          competition: { select: { name: true } },
        },
      },
    },
  });

  let updated = 0;
  const unresolved: UnresolvedLink[] = [];
  for (const event of events) {
    const teamIndex = event.teamId ? byTeam.get(event.teamId) : undefined;
    const secondaryTeamId = inferSecondaryTeamId(event.type, event.teamId, event.match);
    const secondaryTeamIndex = secondaryTeamId ? byTeam.get(secondaryTeamId) : undefined;
    const playerId =
      event.playerId ??
      resolveAlias(teamIndex, event.playerLabel) ??
      (!event.teamId ? resolveAlias(global, event.playerLabel) : null);
    const assistPlayerId =
      event.assistPlayerId ??
      resolveAlias(teamIndex, event.assistLabel) ??
      (!event.teamId ? resolveAlias(global, event.assistLabel) : null);
    const secondaryPlayerId =
      resolveAlias(secondaryTeamIndex, event.playerLabel2) ??
      resolveAlias(global, event.playerLabel2);
    const metadata = (event.metadata ?? {}) as Record<string, unknown>;

    const data: Prisma.SbMatchEventUpdateInput = {};
    if (!event.playerId && playerId) data.player = { connect: { id: playerId } };
    if (!event.assistPlayerId && assistPlayerId) {
      data.assistPlayer = { connect: { id: assistPlayerId } };
    }
    if (secondaryPlayerId && metadata.secondaryPlayerId !== secondaryPlayerId) {
      data.metadata = {
        ...metadata,
        secondaryPlayerId,
      } as Prisma.InputJsonValue;
    }

    /* Recorded before the early return below, so a label that resolved to nothing
       is reported whether or not anything else about the event changed. */
    const note = (field: "player" | "assist", label: string, teamIndex?: AliasIndex) => {
      const failure = lookupAlias(teamIndex, label);
      if ("playerId" in failure) return;
      unresolved.push({
        ...failure,
        eventId: event.id,
        label,
        field,
        competition: event.match?.competition?.name ?? null,
        team: event.team?.name ?? null,
        minute: event.minute,
      });
    };
    if (!playerId && event.playerLabel) note("player", event.playerLabel, teamIndex);
    if (!assistPlayerId && event.assistLabel) note("assist", event.assistLabel, teamIndex);

    if (Object.keys(data).length === 0) continue;
    if (!dryRun) await prisma.sbMatchEvent.update({ where: { id: event.id }, data });
    updated += 1;
  }

  return { updated, unresolved };
}

const SECONDARY_OPPONENT_EVENT_TYPES = new Set([
  "save",
  "penalty_saved",
  "double_save",
  "goalkeeper_claim",
  "goalkeeper_distribution",
  "goalkeeper_error",
  "goalkeeper_intervention",
  "goalkeeper_command",
  "one_on_one",
]);

function inferSecondaryTeamId(
  eventType: string,
  teamId: string | null,
  match: { homeTeamId: string; awayTeamId: string }
) {
  if (!teamId || !SECONDARY_OPPONENT_EVENT_TYPES.has(eventType.toLowerCase())) return null;
  if (teamId === match.homeTeamId) return match.awayTeamId;
  if (teamId === match.awayTeamId) return match.homeTeamId;
  return null;
}
