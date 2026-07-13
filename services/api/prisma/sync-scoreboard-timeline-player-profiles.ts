import type { PrismaClient } from "@prisma/client";
import { normalizePlayerName, playerLookupKey } from "@dtp/engines";
import { resolveUniquePlayerSlug } from "../src/players/player-slug";

type TimelineLabelRole = "primary" | "assist" | "secondary";

type TimelineLabel = {
  rawName: string;
  normalizedName: string;
  lookupKey: string;
  teamId: string | null;
  role: TimelineLabelRole;
  eventType: string;
};

const PLACEHOLDER_LABELS = new Set([
  "player",
  "goalkeeper",
  "keeper",
  "unknown",
  "unknown player",
  "n/a",
  "na",
]);

function splitDisplayName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Player", lastName: "Profile" };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function reversedTwoPartLookupKey(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 2) return null;
  return playerLookupKey(`${parts[1]} ${parts[0]}`);
}

function isUsableTimelineName(rawName: string | null | undefined) {
  const normalized = normalizePlayerName(rawName ?? "");
  const lookupKey = playerLookupKey(normalized);
  if (!lookupKey) return false;
  if (PLACEHOLDER_LABELS.has(lookupKey)) return false;
  if (/^no\.?\s*\d+$/i.test(normalized)) return false;
  if (/^#?\d+$/.test(normalized)) return false;
  return true;
}

function inferPosition(label: Pick<TimelineLabel, "role" | "eventType">) {
  const type = label.eventType.toLowerCase();
  if (label.role === "secondary" && /save|goalkeeper/.test(type)) return "GK";
  if (/save|goalkeeper/.test(type) && label.role === "primary") return "GK";
  if (/goal|shot|chance|penalty|offside/.test(type)) return "FW";
  if (/assist|cross|corner|freekick|throw_in|long_throw/.test(type)) return "MF";
  if (/clearance|interception|tackle|blocked|defense/.test(type)) return "DF";
  return "MF";
}

function collectLabel(
  labels: Map<string, TimelineLabel>,
  args: {
    rawName: string | null | undefined;
    teamId: string | null;
    role: TimelineLabelRole;
    eventType: string;
  }
) {
  if (!isUsableTimelineName(args.rawName)) return;
  const normalizedName = normalizePlayerName(args.rawName ?? "");
  const lookupKey = playerLookupKey(normalizedName);
  const existing = labels.get(lookupKey);
  if (existing?.teamId || !args.teamId) return;
  labels.set(lookupKey, {
    rawName: args.rawName ?? "",
    normalizedName,
    lookupKey,
    teamId: args.teamId,
    role: args.role,
    eventType: args.eventType,
  });
}

async function createOrUpdateTimelinePlayer(
  prisma: PrismaClient,
  label: TimelineLabel
) {
  const nameParts = splitDisplayName(label.normalizedName);
  const data = {
    firstName: nameParts.firstName,
    lastName: nameParts.lastName,
    displayName: label.normalizedName,
    positionPrimary: inferPosition(label),
    registrationStatus: "approved",
    isPublic: true,
  };

  const reversedLookupKey = reversedTwoPartLookupKey(label.normalizedName);
  const existing = await prisma.player.findFirst({
    where: {
      OR: [
        { normalizedName: label.lookupKey },
        ...(reversedLookupKey ? [{ normalizedName: reversedLookupKey }] : []),
      ],
    },
    select: {
      id: true,
      positionPrimary: true,
      registrationStatus: true,
      isPublic: true,
      firstName: true,
      lastName: true,
      displayName: true,
      normalizedName: true,
    },
  });

  if (existing) {
    const isDirectNameMatch = existing.normalizedName === label.lookupKey;
    return prisma.player.update({
      where: { id: existing.id },
      data: {
        firstName: isDirectNameMatch ? data.firstName : existing.firstName,
        lastName: isDirectNameMatch ? data.lastName : existing.lastName,
        displayName: isDirectNameMatch ? data.displayName : existing.displayName,
        registrationStatus: data.registrationStatus,
        isPublic: data.isPublic,
        positionPrimary: existing.positionPrimary || data.positionPrimary,
      },
    });
  }

  return prisma.player.create({
    data: {
      ...data,
      normalizedName: label.lookupKey,
      slug: await resolveUniquePlayerSlug(prisma, label.normalizedName),
    },
  });
}

async function ensureTeamSquadLink(
  prisma: PrismaClient,
  args: { teamId: string | null; playerId: string; displayName: string; position: string }
) {
  if (!args.teamId) return false;

  const existingForPlayer = await prisma.sbTeamSquad.findUnique({
    where: { playerId: args.playerId },
    select: { id: true, teamId: true },
  });
  if (existingForPlayer) {
    if (existingForPlayer.teamId === args.teamId) return false;
    return false;
  }

  const existingByName = await prisma.sbTeamSquad.findFirst({
    where: {
      teamId: args.teamId,
      displayName: { equals: args.displayName, mode: "insensitive" },
    },
    select: { id: true, playerId: true },
  });

  if (existingByName) {
    if (existingByName.playerId === args.playerId) return false;
    if (existingByName.playerId) return false;
    await prisma.sbTeamSquad.update({
      where: { id: existingByName.id },
      data: { playerId: args.playerId, position: args.position },
    });
    return true;
  }

  await prisma.sbTeamSquad.create({
    data: {
      teamId: args.teamId,
      playerId: args.playerId,
      displayName: args.displayName,
      position: args.position,
    },
  });
  return true;
}

export async function syncScoreboardTimelinePlayerProfiles(prisma: PrismaClient) {
  const events = await prisma.sbMatchEvent.findMany({
    where: {
      OR: [
        { playerLabel: { not: null } },
        { assistLabel: { not: null } },
        { playerLabel2: { not: null } },
      ],
    },
    select: {
      teamId: true,
      type: true,
      playerLabel: true,
      assistLabel: true,
      playerLabel2: true,
      match: {
        select: {
          homeTeamId: true,
          awayTeamId: true,
        },
      },
    },
  });

  const labels = new Map<string, TimelineLabel>();
  for (const event of events) {
    collectLabel(labels, {
      rawName: event.playerLabel,
      teamId: event.teamId,
      role: "primary",
      eventType: event.type,
    });
    collectLabel(labels, {
      rawName: event.assistLabel,
      teamId: event.teamId,
      role: "assist",
      eventType: event.type,
    });
    collectLabel(labels, {
      rawName: event.playerLabel2,
      teamId: inferSecondaryTeamId(event.type, event.teamId, event.match),
      role: "secondary",
      eventType: event.type,
    });
  }

  let createdOrUpdated = 0;
  let squadLinks = 0;
  for (const label of labels.values()) {
    const player = await createOrUpdateTimelinePlayer(prisma, label);
    createdOrUpdated += 1;

    const linked = await ensureTeamSquadLink(prisma, {
      teamId: label.teamId,
      playerId: player.id,
      displayName: player.displayName,
      position: player.positionPrimary,
    });
    if (linked) squadLinks += 1;
  }

  return {
    labels: labels.size,
    createdOrUpdated,
    squadLinks,
  };
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
