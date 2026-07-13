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

function resolveAlias(index: AliasIndex | undefined, rawName: string | null | undefined) {
  const key = playerLookupKey(rawName ?? "");
  if (!key || !index) return null;
  const matches = index.get(key);
  if (!matches || matches.size !== 1) return null;
  return Array.from(matches)[0] ?? null;
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

export async function syncScoreboardEventPlayerLinks(prisma: PrismaClient) {
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
    },
  });

  let updated = 0;
  for (const event of events) {
    const teamIndex = event.teamId ? byTeam.get(event.teamId) : undefined;
    const playerId =
      event.playerId ??
      resolveAlias(teamIndex, event.playerLabel) ??
      (!event.teamId ? resolveAlias(global, event.playerLabel) : null);
    const assistPlayerId =
      event.assistPlayerId ??
      resolveAlias(teamIndex, event.assistLabel) ??
      (!event.teamId ? resolveAlias(global, event.assistLabel) : null);
    const secondaryPlayerId = resolveAlias(global, event.playerLabel2);
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

    if (Object.keys(data).length === 0) continue;
    await prisma.sbMatchEvent.update({ where: { id: event.id }, data });
    updated += 1;
  }

  return updated;
}
