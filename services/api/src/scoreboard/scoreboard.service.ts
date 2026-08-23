import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type PlayerMatchMetrics, type SbMatchEvent } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SipRecalculationService } from "../sip/sip-recalculation.service";
import { CreateMatchEventDto } from "./dto/create-event.dto";
import { UpdateMatchDto } from "./dto/update-match.dto";
import type { PatchMatchScoreDto } from "../admin/dto/patch-match-score.dto";
import {
  computeGroupStandings,
  normalizeClubName,
  normalizePlayerName,
  playerLookupKey,
} from "@dtp/engines";
import {
  buildSkeletonProfile,
  presentProfileStats,
  type SkeletonProfileQuery,
} from "../home/player-profile.presenter";
import { resolvePlayerBySlugOrId } from "../players/player-resolve";
import { resolveMatchBySlugOrId } from "./match-resolve";
import { resolveUniquePlayerSlug, slugifyPlayerName } from "../players/player-slug";
import { presentHighlight, presentMatchDetail } from "./present-media";
import { presentScoreboardPayload } from "./present-scoreboard";
import { CompetitionEngineService } from "./competition-engine.service";
import { assertMatchReadyForLiveEvents } from "./roster-guard";
import { ScoreboardLifecycleService } from "./scoreboard-lifecycle.service";
import { deriveMatchStatsFromCsvEvents } from "./match-csv-events";
import { parseMatchTimelineCsv } from "./match-csv-ingest";
import { parseShortMatchEventsCsv } from "./short-event-csv";
import { computeStandings } from "./standings";
import {
  resolvePlayerNameCandidate,
  type PlayerNameCandidate,
} from "./player-name-normalization";

const MATCH_INCLUDE = {
  homeTeam: {
    include: {
      squad: {
        orderBy: [{ shirtNumber: "asc" as const }, { displayName: "asc" as const }],
        include: {
          player: {
            select: {
              id: true,
              slug: true,
              displayName: true,
              positionPrimary: true,
              positionSecondary: true,
              playerPhotoUrl: true,
              overallRating: true,
              isPublic: true,
            },
          },
        },
      },
    },
  },
  awayTeam: {
    include: {
      squad: {
        orderBy: [{ shirtNumber: "asc" as const }, { displayName: "asc" as const }],
        include: {
          player: {
            select: {
              id: true,
              slug: true,
              displayName: true,
              positionPrimary: true,
              positionSecondary: true,
              playerPhotoUrl: true,
              overallRating: true,
              isPublic: true,
            },
          },
        },
      },
    },
  },
  competition: true,
  events: {
    orderBy: [{ minute: "asc" as const }, { createdAt: "asc" as const }],
    include: {
      player: {
        select: {
          id: true,
          slug: true,
          displayName: true,
          positionPrimary: true,
          playerPhotoUrl: true,
        },
      },
      assistPlayer: {
        select: {
          id: true,
          slug: true,
          displayName: true,
          positionPrimary: true,
          playerPhotoUrl: true,
        },
      },
      highlights: {
        where: { isPublished: true },
        orderBy: { publishedAt: "desc" as const },
      },
    },
  },
  highlights: {
    where: { isPublished: true },
    orderBy: { publishedAt: "desc" as const },
    include: { event: true },
  },
} satisfies Prisma.SbMatchInclude;

/** Public team profile match rows — goal events power cards + scorer stats. */
const TEAM_MATCH_LIST_INCLUDE = {
  homeTeam: true,
  awayTeam: true,
  competition: true,
  events: {
    where: { type: { in: ["goal", "own_goal"] } },
    orderBy: { minute: "asc" as const },
    select: {
      id: true,
      minute: true,
      type: true,
      teamId: true,
      playerLabel: true,
      player: { select: { displayName: true, slug: true } },
    },
  },
} satisfies Prisma.SbMatchInclude;

const LIVE_STATUSES = ["live", "halftime"];
const SCOREBOARD_EXTERNAL_REF_PREFIX = "scoreboard:";
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
const PLACEHOLDER_TIMELINE_LABELS = new Set([
  "player",
  "goalkeeper",
  "keeper",
  "unknown",
  "unknown player",
  "n/a",
  "na",
]);

type ScoreboardEventPlayerResolver = {
  resolvePrimary: (
    label: string | null | undefined,
    teamId: string | null | undefined
  ) => string | null;
  resolveAssist: (
    label: string | null | undefined,
    teamId: string | null | undefined
  ) => string | null;
  resolveSecondary: (
    label: string | null | undefined,
    teamId: string | null | undefined
  ) => string | null;
  resolveAny: (label: string | null | undefined) => string | null;
};

type ScoreboardRosterAliasRow = {
  teamId: string;
  playerId: string | null;
  displayName: string;
  player?: {
    id: string;
    displayName: string;
    normalizedName: string | null;
    slug: string;
  } | null;
};
const EVENT_TYPES = new Set([
  "goal",
  "own_goal",
  "yellow_card",
  "red_card",
  "substitution",
  "injury",
]);

type EventSnapshot = { minute: number; type: string; playerId: string };
type MatchWithCompetition = Prisma.SbMatchGetPayload<{
  include: { competition: true };
}>;
type SipIngestPlayerResult =
  | { playerId: string; status: "created" | "updated" }
  | { playerId: string; status: "skipped"; reason: string };

type ManualGoalScorer = {
  name: string;
  minute: number | null;
  teamSide: "home" | "away";
};

type ScoreboardTeamLabelSource = {
  name: string;
  shortName: string | null;
  slug?: string | null;
};

function normalizeScorerTeamLabel(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactScorerTeamLabel(value: string | null | undefined): string {
  return normalizeScorerTeamLabel(value).replace(/\s+/g, "");
}

function genericTeamLabel(value: string | null | undefined): string {
  return normalizeScorerTeamLabel(value)
    .split(" ")
    .filter((part) => !["fc", "fa", "football", "academy", "club", "sc"].includes(part))
    .join(" ")
    .trim();
}

function scorerTeamLabelVariants(team: ScoreboardTeamLabelSource, side?: "home" | "away") {
  const raw = [
    team.name,
    team.shortName,
    team.slug?.replace(/-/g, " "),
    side,
    side ? `${side} team` : null,
  ].filter(Boolean) as string[];
  const variants = new Set<string>();
  for (const label of raw) {
    const normalized = normalizeScorerTeamLabel(label);
    const compact = compactScorerTeamLabel(label);
    const generic = genericTeamLabel(label);
    if (normalized) variants.add(normalized);
    if (compact) variants.add(compact);
    if (generic) variants.add(generic);
    if (generic) variants.add(generic.replace(/\s+/g, ""));
  }
  return [...variants];
}

function scorerTeamLabels(match: {
  homeTeam: ScoreboardTeamLabelSource;
  awayTeam: ScoreboardTeamLabelSource;
}) {
  return {
    home: scorerTeamLabelVariants(match.homeTeam, "home"),
    away: scorerTeamLabelVariants(match.awayTeam, "away"),
  };
}

function scoreTeamLabelMatch(input: string, candidates: string[]) {
  const normalized = normalizeScorerTeamLabel(input);
  const compact = compactScorerTeamLabel(input);
  const generic = genericTeamLabel(input);
  const genericCompact = generic.replace(/\s+/g, "");
  let score = 0;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate === normalized) score = Math.max(score, 100);
    if (candidate === compact) score = Math.max(score, 95);
    if (generic && candidate === generic) score = Math.max(score, 90);
    if (genericCompact && candidate === genericCompact) score = Math.max(score, 85);
    if (normalized.length >= 5 && candidate.includes(normalized)) score = Math.max(score, 75);
    if (compact.length >= 5 && candidate.includes(compact)) score = Math.max(score, 72);
    if (generic.length >= 5 && candidate.includes(generic)) score = Math.max(score, 70);
    if (genericCompact.length >= 5 && candidate.includes(genericCompact)) {
      score = Math.max(score, 68);
    }
  }
  return score;
}

function parseManualScorerMinute(raw: string): number | null {
  const match = raw.match(/(?:^|[\s(])(\d{1,3})(?:\s*\+\s*(\d{1,2}))?\s*(?:'|min\b|m\b)?/i);
  return match ? Number(match[1]) + Number(match[2] ?? 0) : null;
}

function parseManualGoalScorersForMatch(
  match: {
    homeTeam: { name: string; shortName: string | null };
    awayTeam: { name: string; shortName: string | null };
  },
  value: unknown
): ManualGoalScorer[] {
  if (typeof value !== "string" || !value.trim()) return [];
  const labels = scorerTeamLabels(match);
  const scorers: ManualGoalScorer[] = [];

  for (const row of value.split(/\r?\n/)) {
    const [maybeTeam, ...rest] = row.split(":");
    if (!rest.length) continue;
    const normalizedTeam = normalizeScorerTeamLabel(maybeTeam);
    const teamSide = labels.home.includes(normalizedTeam)
      ? "home"
      : labels.away.includes(normalizedTeam)
        ? "away"
        : null;
    if (!teamSide) continue;

    for (const item of rest.join(":").split(/[,;|]+/)) {
      const cleaned = item.replace(/\s+/g, " ").trim();
      if (!cleaned) continue;
      const name = cleaned
        .replace(/(?:^|[\s(])\d{1,3}(?:\s*\+\s*\d{1,2})?\s*(?:'|min\b|m\b)?/i, " ")
        .replace(/\([^)]*(?:pen|penalty|pk|og|own goal|p)[^)]*\)/gi, "")
        .replace(/\b(?:pen|penalty|pk|og|own goal)\b/gi, "")
        .replace(/[,;|\-\u2013\u2014]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (name) scorers.push({ name, minute: parseManualScorerMinute(cleaned), teamSide });
    }
  }

  return scorers;
}

@Injectable()
export class ScoreboardService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SipRecalculationService)
    private readonly sipRecalc: SipRecalculationService,
    @Inject(ScoreboardLifecycleService)
    private readonly lifecycle: ScoreboardLifecycleService,
    @Inject(CompetitionEngineService)
    private readonly competitionEngine: CompetitionEngineService
  ) {}

  private splitTimelineDisplayName(displayName: string) {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { firstName: "Player", lastName: "Profile" };
    if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
    return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
  }

  private reversedTwoPartLookupKey(displayName: string) {
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    if (parts.length !== 2) return null;
    return playerLookupKey(`${parts[1]} ${parts[0]}`);
  }

  private isUsableTimelinePlayerLabel(rawName: string | null | undefined) {
    const normalized = normalizePlayerName(rawName ?? "");
    const lookupKey = playerLookupKey(normalized);
    if (!lookupKey) return false;
    if (normalized.split(/\s+/).filter(Boolean).length < 2) return false;
    if (PLACEHOLDER_TIMELINE_LABELS.has(lookupKey)) return false;
    if (/^no\.?\s*\d+$/i.test(normalized)) return false;
    if (/^#?\d+$/.test(normalized)) return false;
    return true;
  }

  private inferTimelinePosition(role: "primary" | "assist" | "secondary", eventType: string) {
    const type = eventType.toLowerCase();
    if (role === "secondary" && /save|goalkeeper/.test(type)) return "GK";
    if (/save|goalkeeper/.test(type) && role === "primary") return "GK";
    if (/goal|shot|chance|penalty|offside/.test(type)) return "FW";
    if (/assist|cross|corner|freekick|throw_in|long_throw/.test(type)) return "MF";
    if (/clearance|interception|tackle|blocked|defense/.test(type)) return "DF";
    return "MF";
  }

  private inferSecondaryTeamId(
    eventType: string,
    teamId: string | null | undefined,
    match: { homeTeamId: string; awayTeamId: string }
  ) {
    if (!teamId || !SECONDARY_OPPONENT_EVENT_TYPES.has(eventType.toLowerCase())) return null;
    if (teamId === match.homeTeamId) return match.awayTeamId;
    if (teamId === match.awayTeamId) return match.homeTeamId;
    return null;
  }

  private async resolveOrCreateTimelinePlayer(args: {
    label: string | null | undefined;
    teamId: string | null | undefined;
    role: "primary" | "assist" | "secondary";
    eventType: string;
  }) {
    if (!this.isUsableTimelinePlayerLabel(args.label)) return null;
    const displayName = normalizePlayerName(args.label ?? "");
    const normalizedName = playerLookupKey(displayName);
    const position = this.inferTimelinePosition(args.role, args.eventType);
    const nameParts = this.splitTimelineDisplayName(displayName);

    const reversedLookupKey = this.reversedTwoPartLookupKey(displayName);
    let player = await this.prisma.player.findFirst({
      where: {
        OR: [
          { normalizedName },
          ...(reversedLookupKey ? [{ normalizedName: reversedLookupKey }] : []),
        ],
      },
    });
    if (player) {
      const isDirectNameMatch = player.normalizedName === normalizedName;
      player = await this.prisma.player.update({
        where: { id: player.id },
        data: {
          firstName: isDirectNameMatch ? player.firstName || nameParts.firstName : player.firstName,
          lastName: isDirectNameMatch ? player.lastName || nameParts.lastName : player.lastName,
          displayName: isDirectNameMatch ? displayName : player.displayName,
          positionPrimary: player.positionPrimary || position,
          registrationStatus: "approved",
          isPublic: true,
        },
      });
    } else {
      player = await this.prisma.player.create({
        data: {
          firstName: nameParts.firstName,
          lastName: nameParts.lastName,
          displayName,
          normalizedName,
          slug: await resolveUniquePlayerSlug(this.prisma, displayName),
          positionPrimary: position,
          registrationStatus: "approved",
          isPublic: true,
        },
      });
    }

    if (args.teamId) {
      await this.ensureTimelinePlayerSquadLink({
        teamId: args.teamId,
        playerId: player.id,
        displayName,
        position,
      });
    }

    return player;
  }

  private async ensureTimelinePlayerSquadLink(args: {
    teamId: string;
    playerId: string;
    displayName: string;
    position: string;
  }) {
    const targetTeam = await this.prisma.sbTeam.findUnique({
      where: { id: args.teamId },
      select: { competitionId: true },
    });
    if (!targetTeam) return;

    const existingForPlayer = await this.prisma.sbTeamSquad.findFirst({
      where: {
        playerId: args.playerId,
        team: { competitionId: targetTeam.competitionId },
      },
      select: { id: true, teamId: true },
    });
    if (existingForPlayer) return;

    const existingByName = await this.prisma.sbTeamSquad.findFirst({
      where: {
        teamId: args.teamId,
        displayName: { equals: args.displayName, mode: "insensitive" },
      },
      select: { id: true, playerId: true },
    });
    if (existingByName) {
      if (existingByName.playerId) return;
      await this.prisma.sbTeamSquad.update({
        where: { id: existingByName.id },
        data: { playerId: args.playerId, position: args.position },
      });
      return;
    }

    await this.prisma.sbTeamSquad.create({
      data: {
        teamId: args.teamId,
        playerId: args.playerId,
        displayName: args.displayName,
        position: args.position,
      },
    });
  }

  private async buildMatchEventPlayerResolver(
    matchId: string,
    teamIds: string[],
    prisma: Pick<PrismaService, "sbTeamSquad" | "sbMatchSquadPlayer" | "player"> =
      this.prisma
  ): Promise<ScoreboardEventPlayerResolver> {
    const teamSquadRows = await prisma.sbTeamSquad.findMany({
      where: { teamId: { in: teamIds }, playerId: { not: null } },
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
      where: { matchId, teamId: { in: teamIds }, playerId: { not: null } },
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

    const aliasesByTeam = new Map<string, Map<string, Set<string>>>();
    const aliasesGlobal = new Map<string, Set<string>>();
    const candidatesByTeam = new Map<string, PlayerNameCandidate[]>();

    const addAlias = (
      index: Map<string, Set<string>>,
      rawName: string | null | undefined,
      playerId: string
    ) => {
      const key = playerLookupKey(rawName ?? "");
      if (!key) return;
      const existing = index.get(key) ?? new Set<string>();
      existing.add(playerId);
      index.set(key, existing);
    };

    const addRow = (row: ScoreboardRosterAliasRow) => {
      const playerId = row.playerId ?? row.player?.id ?? null;
      if (!playerId) return;

      const teamIndex = aliasesByTeam.get(row.teamId) ?? new Map<string, Set<string>>();
      aliasesByTeam.set(row.teamId, teamIndex);

      const aliases = [
        row.displayName,
        row.player?.displayName,
        row.player?.normalizedName,
        row.player?.slug?.replace(/-/g, " "),
      ];

      for (const alias of aliases) {
        addAlias(teamIndex, alias, playerId);
        addAlias(aliasesGlobal, alias, playerId);
      }
      candidatesByTeam.set(row.teamId, [
        ...(candidatesByTeam.get(row.teamId) ?? []),
        { playerId, displayName: row.displayName, aliases },
      ]);

      const displayParts = row.displayName.trim().split(/\s+/);
      if (displayParts.length === 2) {
        const reversed = `${displayParts[1]} ${displayParts[0]}`;
        addAlias(teamIndex, reversed, playerId);
        addAlias(aliasesGlobal, reversed, playerId);
      }
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
    const players = await prisma.player.findMany({
      select: {
        id: true,
        displayName: true,
        normalizedName: true,
        slug: true,
      },
    });
    for (const player of players) {
      const aliases = [
        player.displayName,
        player.normalizedName,
        player.slug?.replace(/-/g, " "),
      ];
      for (const alias of aliases) addAlias(aliasesGlobal, alias, player.id);

      const displayParts = player.displayName.trim().split(/\s+/);
      if (displayParts.length === 2) {
        addAlias(aliasesGlobal, `${displayParts[1]} ${displayParts[0]}`, player.id);
      }
    }

    const resolveFromIndex = (
      index: Map<string, Set<string>> | undefined,
      label: string | null | undefined
    ) => {
      if (!this.isUsableTimelinePlayerLabel(label)) return null;
      const key = playerLookupKey(label ?? "");
      if (!key || !index) return null;
      const matches = index.get(key);
      if (!matches || matches.size !== 1) return null;
      return Array.from(matches)[0] ?? null;
    };

    const resolveFuzzyFromTeam = (
      teamId: string | null | undefined,
      label: string | null | undefined
    ) => {
      if (!teamId || !this.isUsableTimelinePlayerLabel(label)) return null;
      return resolvePlayerNameCandidate(label, candidatesByTeam.get(teamId) ?? [])?.playerId ?? null;
    };

    const resolveWithTeamPreference = (
      label: string | null | undefined,
      teamId: string | null | undefined
    ) => {
      return (
        resolveFromIndex(teamId ? aliasesByTeam.get(teamId) : undefined, label) ??
        resolveFuzzyFromTeam(teamId, label) ??
        (!teamId ? resolveFromIndex(aliasesGlobal, label) : null)
      );
    };

    return {
      resolvePrimary: resolveWithTeamPreference,
      resolveAssist: resolveWithTeamPreference,
      resolveSecondary: resolveWithTeamPreference,
      resolveAny: (label) => resolveFromIndex(aliasesGlobal, label),
    };
  }

  async competitions() {
    const rows = await this.prisma.sbCompetition.findMany({
      where: { isPublished: true },
      orderBy: { name: "asc" },
      include: {
        _count: { select: { teams: true, matches: true } },
      },
    });
    return presentScoreboardPayload(rows);
  }

  /**
   * All teams that belong to a published competition, with their competition,
   * squad size, and match counts. Powers the public "Featured Teams" grid on
   * the Deep Browse page. Names are normalized to official club spellings.
   */
  async teams() {
    const rows = await this.prisma.sbTeam.findMany({
      where: { competition: { isPublished: true } },
      orderBy: { name: "asc" },
      include: {
        competition: true,
        _count: { select: { squad: true, homeMatches: true, awayMatches: true } },
      },
    });
    return presentScoreboardPayload(rows);
  }

  /**
   * Landing hub: aggregate stats + recent published matches with goal events.
   * No response caching — each request reads fresh match rows and goal events from
   * the database so admin match-center writes appear immediately on the homepage widget.
   */
  /**
   * Match Centre feed for the ScoreBoard overview.
   *
   * Ordering purely by kickoff let whichever competition had the furthest-out
   * fixtures take every slot, so the panel showed one competition at a time.
   * Live matches still lead; the remainder is interleaved a match at a time
   * per competition so the columns span the whole ScoreBoard.
   */
  async overview() {
    const OVERVIEW_TAKE = 12;
    const stats = await this.stats();
    const published = { isPublished: true, competition: { isPublished: true } };

    const live = await this.prisma.sbMatch.findMany({
      where: { ...published, status: { in: LIVE_STATUSES } },
      orderBy: [{ kickoffAt: "desc" }],
      take: OVERVIEW_TAKE,
      include: TEAM_MATCH_LIST_INCLUDE,
    });

    /* Pull per competition rather than one global "most recent" slice: a
       competition whose fixtures sit further out would otherwise push every
       older competition out of the window entirely. */
    const competitions = await this.prisma.sbCompetition.findMany({
      where: { isPublished: true },
      select: { id: true },
    });
    const excluded = live.map((m) => m.id);
    const queues = (
      await Promise.all(
        competitions.map((competition) =>
          this.prisma.sbMatch.findMany({
            where: { ...published, competitionId: competition.id, id: { notIn: excluded } },
            orderBy: [{ kickoffAt: "desc" }],
            take: OVERVIEW_TAKE,
            include: TEAM_MATCH_LIST_INCLUDE,
          })
        )
      )
    )
      .filter((queue) => queue.length > 0)
      // Competitions with the most recent action lead the grid.
      .sort((a, b) => (b[0].kickoffAt?.getTime() ?? 0) - (a[0].kickoffAt?.getTime() ?? 0));

    // Take each competition's nth match on the nth pass, so no single
    // competition can monopolise the grid.
    const interleaved: (typeof queues)[number] = [];
    const deepest = Math.max(0, ...queues.map((q) => q.length));
    for (let depth = 0; depth < deepest && interleaved.length < OVERVIEW_TAKE; depth += 1) {
      for (const queue of queues) {
        if (interleaved.length >= OVERVIEW_TAKE) break;
        if (queue[depth]) interleaved.push(queue[depth]);
      }
    }

    const recentMatches = [...live, ...interleaved].slice(0, OVERVIEW_TAKE);
    return presentScoreboardPayload({ stats, recentMatches });
  }

  private async resolvePublishedCompetition(competitionIdOrSlug: string) {
    const competition = await this.prisma.sbCompetition.findFirst({
      where: {
        isPublished: true,
        OR: [{ id: competitionIdOrSlug }, { slug: competitionIdOrSlug }],
      },
      include: {
        teams: true,
        _count: { select: { teams: true, matches: true } },
      },
    });
    if (!competition) throw new NotFoundException("Competition not found");
    return competition;
  }

  /**
   * Premium competition hub: meta, group standings (A/B when applicable),
   * and competition top scorers from persisted stats.
   */
  async competitionHub(competitionIdOrSlug: string) {
    const competition = await this.resolvePublishedCompetition(competitionIdOrSlug);
    const competitionId = competition.id;

    const standingsPayload = await this.competitionEngine.groupStandings(competitionId);
    const rows = (standingsPayload as { rows?: Array<{ groupKey: string }> }).rows ?? [];
    const groupKeys = [...new Set(rows.map((r) => r.groupKey))].sort();
    const groups: Record<string, typeof rows> = {};
    for (const key of groupKeys) {
      const label = key.replace(/^group_/i, "").toUpperCase() || key;
      groups[label] = rows.filter((r) => r.groupKey === key);
    }

    const topScorers = await this.prisma.sbPlayerCompetitionStats.findMany({
      where: {
        competitionId,
        goals: { gt: 0 },
        player: { isPublic: true },
      },
      orderBy: [{ goals: "desc" }, { assists: "desc" }],
      take: 10,
      include: {
        player: {
          select: {
            id: true,
            slug: true,
            displayName: true,
            positionPrimary: true,
            playerPhotoUrl: true,
            scoreboardSquad: {
              where: { team: { competitionId } },
              take: 1,
              include: { team: true },
            },
          },
        },
      },
    });

    const scorerRows = topScorers.map((row) => ({
      playerId: row.playerId,
      slug: row.player.slug,
      displayName: row.player.displayName,
      positionPrimary: row.player.positionPrimary,
      playerPhotoUrl: row.player.playerPhotoUrl,
      goals: row.goals,
      assists: row.assists,
      team: row.player.scoreboardSquad[0]?.team
        ? presentScoreboardPayload(row.player.scoreboardSquad[0].team)
        : null,
    }));

    const formatConfig =
      competition.formatConfig && typeof competition.formatConfig === "object"
        ? (competition.formatConfig as Record<string, unknown>)
        : null;

    const teams = [...competition.teams]
      .map((team) => {
        const seed = team.groupKey ? Number(team.groupKey) : null;
        return {
          ...presentScoreboardPayload(team),
          seed: Number.isFinite(seed) ? seed : null,
        };
      })
      .sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99));

    return presentScoreboardPayload({
      meta: {
        id: competition.id,
        slug: competition.slug,
        name: competition.name,
        season: competition.season,
        type: competition.type,
        formatType: competition.formatType,
        formatConfig,
        country: competition.country,
        logoUrl: competition.logoUrl,
        description: competition.description,
        teamCount: competition._count.teams,
        matchCount: competition._count.matches,
        standingsUpdatedAt: competition.standingsUpdatedAt,
        bracketImageUrl:
          (formatConfig?.bracketImageUrl as string | undefined) ??
          (formatConfig?.bannerUrl as string | undefined) ??
          null,
      },
      teams,
      groups,
      topScorers: scorerRows,
    });
  }

  static readonly STAT_LEADER_METRICS = ["goals", "assists", "yellow", "red"] as const;

  /**
   * Top-N stat leaders for a competition, aggregated from published match events.
   */
  async statLeaders(
    competitionSlugOrId: string,
    metric: (typeof ScoreboardService.STAT_LEADER_METRICS)[number],
    limit = 10
  ) {
    const competition = await this.resolvePublishedCompetition(competitionSlugOrId);
    const take = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : 10;

    const matchScope = {
      isPublished: true,
      competitionId: competition.id,
    } as const;

    type TeamPick = {
      id: string;
      name: string;
      shortName: string | null;
      slug: string;
      logoUrl: string | null;
    };

    type LeaderAgg = {
      playerId: string | null;
      playerName: string;
      playerSlug: string;
      photoUrl: string | null;
      team: TeamPick | null;
      count: number;
    };

    const bump = (
      map: Map<string, LeaderAgg>,
      key: string,
      row: Omit<LeaderAgg, "count">
    ) => {
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        return;
      }
      map.set(key, { ...row, count: 1 });
    };

    const eventSelect = {
      type: true,
      playerId: true,
      playerLabel: true,
      assistPlayerId: true,
      assistLabel: true,
      teamId: true,
      player: {
        select: {
          id: true,
          slug: true,
          displayName: true,
          playerPhotoUrl: true,
        },
      },
      assistPlayer: {
        select: {
          id: true,
          slug: true,
          displayName: true,
          playerPhotoUrl: true,
        },
      },
      team: {
        select: {
          id: true,
          name: true,
          shortName: true,
          slug: true,
          logoUrl: true,
        },
      },
    } as const;

    const byKey = new Map<string, LeaderAgg>();

    if (metric === "assists") {
      const events = await this.prisma.sbMatchEvent.findMany({
        where: {
          type: "goal",
          match: matchScope,
          OR: [{ assistPlayerId: { not: null } }, { assistLabel: { not: null } }],
        },
        select: eventSelect,
      });

      for (const event of events) {
        const name = event.assistPlayer?.displayName ?? event.assistLabel?.trim();
        if (!name) continue;
        const playerId = event.assistPlayerId;
        const playerSlug = event.assistPlayer?.slug ?? slugifyPlayerName(name);
        const key = `${playerId ?? playerSlug}::${event.teamId ?? "free"}`;
        bump(byKey, key, {
          playerId,
          playerName: name,
          playerSlug,
          photoUrl: event.assistPlayer?.playerPhotoUrl ?? null,
          team: event.team,
        });
      }
    } else {
      const type =
        metric === "goals"
          ? "goal"
          : metric === "yellow"
            ? "yellow_card"
            : "red_card";

      const events = await this.prisma.sbMatchEvent.findMany({
        where: { type, match: matchScope },
        select: eventSelect,
      });

      for (const event of events) {
        const name = event.player?.displayName ?? event.playerLabel?.trim();
        if (!name) continue;
        const playerId = event.playerId;
        const playerSlug = event.player?.slug ?? slugifyPlayerName(name);
        const key = `${playerId ?? playerSlug}::${event.teamId ?? "free"}`;
        bump(byKey, key, {
          playerId,
          playerName: name,
          playerSlug,
          photoUrl: event.player?.playerPhotoUrl ?? null,
          team: event.team,
        });
      }

      if (metric === "goals") {
        const manualMatches = await this.prisma.sbMatch.findMany({
          where: matchScope,
          select: {
            id: true,
            meta: true,
            homeTeamId: true,
            awayTeamId: true,
            homeTeam: {
              select: {
                id: true,
                name: true,
                shortName: true,
                slug: true,
                logoUrl: true,
              },
            },
            awayTeam: {
              select: {
                id: true,
                name: true,
                shortName: true,
                slug: true,
                logoUrl: true,
              },
            },
            events: {
              where: { type: { in: ["goal", "own_goal"] } },
              select: { id: true },
            },
          },
        });

        for (const match of manualMatches) {
          if (match.events.length > 0) continue;
          const meta = (match.meta ?? {}) as Record<string, unknown>;
          if (typeof meta.goalScorers !== "string" || !meta.goalScorers.trim()) {
            continue;
          }
          const scorers = parseManualGoalScorersForMatch(match, meta.goalScorers);
          for (const scorer of scorers) {
            const team = scorer.teamSide === "home" ? match.homeTeam : match.awayTeam;
            const teamId = scorer.teamSide === "home" ? match.homeTeamId : match.awayTeamId;
            const playerSlug = slugifyPlayerName(scorer.name);
            bump(byKey, `${playerSlug}::${teamId}`, {
              playerId: null,
              playerName: scorer.name,
              playerSlug,
              photoUrl: null,
              team,
            });
          }
        }
      }
    }

    const leaders = [...byKey.values()]
      .sort(
        (a, b) =>
          b.count - a.count || a.playerName.localeCompare(b.playerName)
      )
      .slice(0, take)
      .map((row, index) => ({
        rank: index + 1,
        playerId: row.playerId,
        playerName: row.playerName,
        playerSlug: row.playerSlug,
        photoUrl: row.photoUrl,
        count: row.count,
        team: row.team ? presentScoreboardPayload(row.team) : null,
      }));

    return presentScoreboardPayload({
      metric,
      competitionId: competition.id,
      competitionSlug: competition.slug,
      leaders,
    });
  }

  /** Public scoreboard player card (slug/name); skeleton when not published. */
  async playerProfile(slugOrId: string, query: SkeletonProfileQuery = {}) {
    const resolved = await resolvePlayerBySlugOrId(this.prisma, slugOrId);
    if (!resolved || !resolved.isPublic) {
      return buildSkeletonProfile(slugOrId, query, resolved ?? undefined);
    }

    const player = await this.prisma.player.findUnique({
      where: { id: resolved.id },
      select: {
        id: true,
        slug: true,
        displayName: true,
        positionPrimary: true,
        positionSecondary: true,
        playerPhotoUrl: true,
        overallRating: true,
        isPublic: true,
        careerGoals: true,
        careerAssists: true,
        careerAppearances: true,
        careerMinutes: true,
        careerCleanSheets: true,
        scoreboardSquad: {
          take: 1,
          orderBy: { team: { name: "asc" } },
          include: {
            team: {
              include: { competition: true },
            },
          },
        },
      },
    });
    if (!player) {
      return buildSkeletonProfile(slugOrId, query);
    }

    const role = query.role?.trim().toUpperCase() || player.positionPrimary;
    const squadTeam = player.scoreboardSquad[0]?.team;

    return presentScoreboardPayload({
      isSkeleton: false,
      id: player.id,
      slug: player.slug,
      displayName: player.displayName,
      positionPrimary: player.positionPrimary,
      positionSecondary: player.positionSecondary,
      playerPhotoUrl: player.playerPhotoUrl,
      overallRating: player.overallRating,
      club:
        query.club?.trim() ||
        (squadTeam ? normalizeClubName(squadTeam.name) : null),
      competition:
        query.competition?.trim() || squadTeam?.competition.name || null,
      role,
      stats: presentProfileStats(player, role),
    });
  }

  /**
   * Lightweight public aggregate counts that power the landing-page metrics
   * banner. Everything is scoped to published competitions so the figures match
   * what the public can actually browse.
   */
  async stats() {
    const publishedComp = { competition: { isPublished: true } } as const;
    const [competitions, teams, matches, squadEntries, linkedPlayers] =
      await this.prisma.$transaction([
        this.prisma.sbCompetition.count({ where: { isPublished: true } }),
        this.prisma.sbTeam.count({ where: publishedComp }),
        this.prisma.sbMatch.count({
          where: { isPublished: true, ...publishedComp },
        }),
        this.prisma.sbTeamSquad.count({ where: { team: publishedComp } }),
        this.prisma.player.count({
          where: {
            scoreboardSquad: { some: { team: publishedComp } },
          },
        }),
      ]);

    return {
      competitions,
      teams,
      matches,
      // Total roster rows tracked across published competitions. Falls back to
      // the count of linked public players if no roster rows exist yet.
      playersTracked: squadEntries || linkedPlayers,
    };
  }

  async competitionBySlug(slug: string) {
    const comp = await this.prisma.sbCompetition.findFirst({
      where: { slug, isPublished: true },
      include: {
        teams: {
          orderBy: { name: "asc" },
          include: {
            squad: {
              orderBy: [{ shirtNumber: "asc" }, { displayName: "asc" }],
              include: {
                player: {
                  select: {
                    id: true,
                    slug: true,
                    displayName: true,
                    positionPrimary: true,
                    positionSecondary: true,
                    playerPhotoUrl: true,
                    overallRating: true,
                    isPublic: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!comp) throw new NotFoundException("Competition not found");
    return presentScoreboardPayload(comp);
  }

  async teamById(id: string) {
    const team = await this.prisma.sbTeam.findFirst({
      where: { id, competition: { isPublished: true } },
      include: {
        competition: true,
        squad: {
          orderBy: [{ shirtNumber: "asc" }, { displayName: "asc" }],
          include: {
            player: {
              select: {
                id: true,
                slug: true,
                displayName: true,
                positionPrimary: true,
                positionSecondary: true,
                playerPhotoUrl: true,
                overallRating: true,
                isPublic: true,
              },
            },
          },
        },
        homeMatches: {
          where: { isPublished: true },
          orderBy: { kickoffAt: "desc" },
          include: TEAM_MATCH_LIST_INCLUDE,
        },
        awayMatches: {
          where: { isPublished: true },
          orderBy: { kickoffAt: "desc" },
          include: TEAM_MATCH_LIST_INCLUDE,
        },
      },
    });
    if (!team) throw new NotFoundException("Team not found");

    const matches = [...team.homeMatches, ...team.awayMatches]
      .sort((a, b) => (b.kickoffAt?.getTime() ?? 0) - (a.kickoffAt?.getTime() ?? 0))
      .slice(0, 12);
    const { homeMatches, awayMatches, ...rest } = team;
    return presentScoreboardPayload({ ...rest, matches });
  }

  async search(query: string) {
    const q = query.trim();
    if (q.length < 2) {
      return { query: q, competitions: [], teams: [], matches: [], players: [] };
    }

    const contains = { contains: q, mode: "insensitive" as const };
    const [competitions, teams, matches, players] = await this.prisma.$transaction([
      this.prisma.sbCompetition.findMany({
        where: { isPublished: true, OR: [{ name: contains }, { season: contains }] },
        take: 6,
        orderBy: { name: "asc" },
      }),
      this.prisma.sbTeam.findMany({
        where: {
          competition: { isPublished: true },
          OR: [{ name: contains }, { shortName: contains }, { city: contains }],
        },
        take: 8,
        include: { competition: true, _count: { select: { squad: true } } },
        orderBy: { name: "asc" },
      }),
      this.prisma.sbMatch.findMany({
        where: {
          isPublished: true,
          competition: { isPublished: true },
          OR: [
            { slug: contains },
            { venue: contains },
            { roundLabel: contains },
            { homeTeam: { name: contains } },
            { awayTeam: { name: contains } },
            { competition: { name: contains } },
          ],
        },
        take: 8,
        include: { homeTeam: true, awayTeam: true, competition: true },
        orderBy: { kickoffAt: "desc" },
      }),
      this.prisma.player.findMany({
        where: {
          isPublic: true,
          scoreboardSquad: { some: { team: { competition: { isPublished: true } } } },
          OR: [
            { displayName: contains },
            { slug: contains },
            { positionPrimary: contains },
          ],
        },
        take: 8,
        select: {
          id: true,
          slug: true,
          displayName: true,
          positionPrimary: true,
          playerPhotoUrl: true,
          overallRating: true,
        },
        orderBy: [{ overallRating: "desc" }, { displayName: "asc" }],
      }),
    ]);

    return presentScoreboardPayload({ query: q, competitions, teams, matches, players });
  }

  async listMatches(query: {
    status?: string;
    competitionId?: string;
    limit?: number;
    publicOnly?: boolean;
    /** Inclusive kickoff window, used by the admin fixtures calendar. */
    from?: Date;
    to?: Date;
    /** Calendar reads ascending so a day's fixtures run earliest-first. */
    order?: "asc" | "desc";
  }) {
    const where: Prisma.SbMatchWhereInput = {};
    if (query.publicOnly !== false) {
      where.isPublished = true;
      where.competition = { isPublished: true };
    }
    if (query.competitionId) {
      where.competitionId = query.competitionId;
    }
    if (query.status === "live") {
      where.status = { in: LIVE_STATUSES };
    } else if (query.status) {
      where.status = query.status;
    }
    if (query.from || query.to) {
      where.kickoffAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      };
    }

    const rows = await this.prisma.sbMatch.findMany({
      where,
      orderBy: [{ kickoffAt: query.order ?? "desc" }],
      ...(query.limit ? { take: query.limit } : {}),
      include: {
        homeTeam: true,
        awayTeam: true,
        competition: true,
        _count: { select: { events: true } },
        // Goal events power the scorer snippet on Match Center cards.
        events: {
          where: { type: { in: ["goal", "own_goal"] } },
          orderBy: { minute: "asc" },
          select: {
            id: true,
            minute: true,
            type: true,
            teamId: true,
            playerLabel: true,
            player: { select: { displayName: true, slug: true } },
          },
        },
      },
    });
    return presentScoreboardPayload(rows);
  }

  async matchBySlugOrId(slugOrId: string, publicOnly = true) {
    const resolved = await resolveMatchBySlugOrId(this.prisma, slugOrId);
    if (!resolved) throw new NotFoundException("Match not found");
    return this.matchById(resolved.id, publicOnly);
  }

  async matchById(id: string, publicOnly = true) {
    const match = await this.prisma.sbMatch.findFirst({
      where: {
        id,
        ...(publicOnly
          ? { isPublished: true, competition: { isPublished: true } }
          : {}),
      },
      include: MATCH_INCLUDE,
    });
    if (!match) throw new NotFoundException("Match not found");
    const stats =
      match.stats && typeof match.stats === "object" && !Array.isArray(match.stats)
        ? (match.stats as Record<string, unknown>)
        : {};
    const spotter =
      stats.spotter && typeof stats.spotter === "object" && !Array.isArray(stats.spotter)
        ? (stats.spotter as Record<string, unknown>)
        : {};
    return presentMatchDetail(
      presentScoreboardPayload({
        ...match,
        stats: {
          ...stats,
          spotter: {
            ...spotter,
            formation: {
              home: match.formationHome || "4-3-3",
              away: match.formationAway || "4-3-3",
            },
          },
        },
      })
    );
  }

  async matchSquadsBySlugOrId(slugOrId: string, publicOnly = true) {
    const resolved = await resolveMatchBySlugOrId(this.prisma, slugOrId);
    if (!resolved) throw new NotFoundException("Match not found");

    const match = await this.prisma.sbMatch.findFirst({
      where: {
        id: resolved.id,
        ...(publicOnly
          ? { isPublished: true, competition: { isPublished: true } }
          : {}),
      },
      select: {
        id: true,
        homeTeamId: true,
        awayTeamId: true,
        homeTeam: true,
        awayTeam: true,
        squadPlayers: {
          orderBy: [
            { isStarter: "desc" },
            { sortOrder: "asc" },
            { jerseyNumber: "asc" },
            { playerName: "asc" },
          ],
          include: {
            player: {
              select: {
                id: true,
                slug: true,
                displayName: true,
                positionPrimary: true,
                positionSecondary: true,
                playerPhotoUrl: true,
                overallRating: true,
                isPublic: true,
              },
            },
          },
        },
      },
    });
    if (!match) throw new NotFoundException("Match not found");

    type MatchSquadRow = (typeof match.squadPlayers)[number];
    const isGoalkeeperRow = (row: MatchSquadRow) => {
      const position = `${row.position ?? ""} ${row.player?.positionPrimary ?? ""}`.toUpperCase();
      return /(^|[^A-Z])GK([^A-Z]|$)/.test(position) || position.includes("GOAL");
    };
    const normalizeStartingRows = (rows: MatchSquadRow[]) => {
      const starting: MatchSquadRow[] = [];
      const bench: MatchSquadRow[] = [];
      let hasGoalkeeper = false;

      for (const row of rows) {
        if (!row.isStarter) {
          bench.push(row);
          continue;
        }
        if (isGoalkeeperRow(row)) {
          if (hasGoalkeeper) {
            bench.push(row);
            continue;
          }
          hasGoalkeeper = true;
        }
        if (starting.length < 11) {
          starting.push(row);
        } else {
          bench.push(row);
        }
      }

      if (!hasGoalkeeper) {
        const benchGkIndex = bench.findIndex(isGoalkeeperRow);
        if (benchGkIndex >= 0) {
          const [goalkeeper] = bench.splice(benchGkIndex, 1);
          if (starting.length >= 11) {
            let demoteIndex = 0;
            for (let index = starting.length - 1; index >= 0; index -= 1) {
              if (!isGoalkeeperRow(starting[index])) {
                demoteIndex = index;
                break;
              }
            }
            bench.unshift(starting.splice(demoteIndex, 1)[0]);
          }
          starting.unshift(goalkeeper);
          hasGoalkeeper = true;
        }
      }

      while (starting.length < 11 && bench.length > 0) {
        const nextIndex = bench.findIndex((row) => !isGoalkeeperRow(row));
        if (nextIndex < 0) break;
        const [next] = bench.splice(nextIndex, 1);
        starting.push(next);
      }

      return { starting, bench };
    };

    const toPlayer = (row: MatchSquadRow) => ({
      id: row.id,
      teamId: row.teamId,
      playerId: row.playerId,
      shirtNumber: row.jerseyNumber,
      displayName: row.playerName,
      position: row.position,
      isStarter: row.isStarter,
      player: row.player,
    });
    const teamPayload = (teamId: string, team: typeof match.homeTeam) => {
      const rows = match.squadPlayers.filter((row) => row.teamId === teamId);
      const normalized = normalizeStartingRows(rows);
      const starting = normalized.starting.map(toPlayer);
      const bench = normalized.bench.map(toPlayer);
      return {
        team: presentScoreboardPayload(team),
        starting,
        bench,
        players: [...starting, ...bench],
      };
    };

    return presentScoreboardPayload({
      matchId: match.id,
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      teams: {
        [match.homeTeamId]: teamPayload(match.homeTeamId, match.homeTeam),
        [match.awayTeamId]: teamPayload(match.awayTeamId, match.awayTeam),
      },
    });
  }

  async standings(competitionId: string) {
    const competition = await this.prisma.sbCompetition.findFirst({
      where: { id: competitionId, isPublished: true },
      include: { teams: true },
    });
    if (!competition) throw new NotFoundException("Competition not found");

    const groupFormats = new Set(["JAGABAN_CUP_STANDARD", "HYBRID_CHAMPIONS_LEAGUE"]);
    const isKnockoutCup = competition.formatType === "KNOCKOUT_CUP";
    const useGroups =
      !isKnockoutCup &&
      (groupFormats.has(competition.formatType ?? "") ||
        competition.teams.some((t) => t.groupKey));

    const finished = await this.prisma.sbMatch.findMany({
      where: {
        competitionId,
        status: "finished",
        isPublished: true,
        ...(useGroups && competition.formatType === "JAGABAN_CUP_STANDARD"
          ? { stageKey: { startsWith: "group_" } }
          : {}),
      },
      select: {
        homeTeamId: true,
        awayTeamId: true,
        homeScore: true,
        awayScore: true,
        kickoffAt: true,
      },
    });

    const normalizedTeams = competition.teams.map((t) => ({
      id: t.id,
      name: normalizeClubName(t.name),
      shortName: t.shortName,
      groupKey: t.groupKey,
    }));

    if (useGroups) {
      const groupRows = computeGroupStandings(normalizedTeams, finished);
      return presentScoreboardPayload({
        competitionId,
        competitionName: competition.name,
        season: competition.season,
        formatType: competition.formatType,
        groups: [...new Set(groupRows.map((r) => r.groupKey))].sort(),
        rows: groupRows,
      });
    }

    return presentScoreboardPayload({
      competitionId,
      competitionName: competition.name,
      season: competition.season,
      formatType: competition.formatType,
      rows: computeStandings(normalizedTeams, finished),
    });
  }

  async highlights(competitionId?: string) {
    const rows = await this.prisma.sbHighlight.findMany({
      where: {
        isPublished: true,
        mediaType: "video",
        ...(competitionId ? { competitionId } : {}),
      } as Prisma.SbHighlightWhereInput,
      orderBy: { publishedAt: "desc" },
      include: {
        match: {
          include: { homeTeam: true, awayTeam: true },
        },
        competition: true,
        event: true,
      },
    });
    return presentScoreboardPayload(rows.map((row) => presentHighlight(row)));
  }

  async addEvent(matchId: string, dto: CreateMatchEventDto) {
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: { homeTeam: true, awayTeam: true, competition: true },
    });
    if (!match) throw new NotFoundException("Match not found");
    const rosterCheck = assertMatchReadyForLiveEvents(
      (match.stats ?? {}) as Parameters<typeof assertMatchReadyForLiveEvents>[0],
      match.homeTeamId,
      match.awayTeamId
    );
    if (!rosterCheck.ok) {
      throw new ForbiddenException(rosterCheck.reason);
    }
    if (!EVENT_TYPES.has(dto.type)) {
      throw new BadRequestException("Invalid event type");
    }
    if (dto.teamId && ![match.homeTeamId, match.awayTeamId].includes(dto.teamId)) {
      throw new BadRequestException("Event team must belong to the match");
    }
    const linkedPlayerIds = [dto.playerId, dto.assistPlayerId].filter(
      (id): id is string => Boolean(id)
    );
    if (linkedPlayerIds.length) {
      const found = await this.prisma.player.count({
        where: { id: { in: linkedPlayerIds } },
      });
      if (found !== linkedPlayerIds.length) {
        throw new BadRequestException("One or more linked players were not found");
      }
    }

    const primaryTeamId = dto.teamId ?? null;
    const secondaryTeamId = this.inferSecondaryTeamId(dto.type, primaryTeamId, match);
    await this.resolveOrCreateTimelinePlayer({
      label: dto.playerLabel,
      teamId: primaryTeamId,
      role: "primary",
      eventType: dto.type,
    });
    await this.resolveOrCreateTimelinePlayer({
      label: dto.assistLabel,
      teamId: primaryTeamId,
      role: "assist",
      eventType: dto.type,
    });
    await this.resolveOrCreateTimelinePlayer({
      label: dto.playerLabel2,
      teamId: secondaryTeamId,
      role: "secondary",
      eventType: dto.type,
    });
    const playerResolver = await this.buildMatchEventPlayerResolver(matchId, [
      match.homeTeamId,
      match.awayTeamId,
    ]);
    const resolvedPlayerId =
      dto.playerId ?? playerResolver.resolvePrimary(dto.playerLabel, primaryTeamId);
    const resolvedAssistPlayerId =
      dto.assistPlayerId ?? playerResolver.resolveAssist(dto.assistLabel, primaryTeamId);
    const secondaryPlayerId = playerResolver.resolveSecondary(
      dto.playerLabel2,
      secondaryTeamId
    ) ?? playerResolver.resolveAny(dto.playerLabel2);
    const metadata = {
      ...((dto.metadata ?? {}) as Record<string, unknown>),
      ...(secondaryPlayerId ? { secondaryPlayerId } : {}),
    };

    const eventData = {
      matchId,
      type: dto.type,
      minute: dto.minute,
      teamId: dto.teamId,
      playerId: resolvedPlayerId ?? undefined,
      assistPlayerId: resolvedAssistPlayerId ?? undefined,
      playerLabel: dto.playerLabel?.trim() || undefined,
      playerLabel2: dto.playerLabel2?.trim() || undefined,
      assistLabel: dto.assistLabel?.trim() || undefined,
      detail: dto.detail?.trim() || undefined,
      metadata: Object.keys(metadata).length ? (metadata as Prisma.InputJsonValue) : undefined,
    };
    const duplicate = await this.prisma.sbMatchEvent.findFirst({
      where: {
        matchId,
        type: dto.type,
        minute: dto.minute,
        teamId: dto.teamId ?? null,
        playerId: resolvedPlayerId ?? null,
        assistPlayerId: resolvedAssistPlayerId ?? null,
      },
    });
    if (duplicate) {
      return { ...duplicate, duplicate: true };
    }

    const event = await this.prisma.$transaction(async (tx) => {
      const created = await tx.sbMatchEvent.create({ data: eventData });
      if (dto.type === "goal" && dto.teamId) {
        const homeGoal = dto.teamId === match.homeTeamId;
        const awayGoal = dto.teamId === match.awayTeamId;
        if (homeGoal || awayGoal) {
          await tx.sbMatch.update({
            where: { id: matchId },
            data: {
              homeScore: homeGoal ? match.homeScore + 1 : match.homeScore,
              awayScore: awayGoal ? match.awayScore + 1 : match.awayScore,
              minute: dto.minute,
            },
          });
        }
      }
      return created;
    });

    await this.lifecycle.applyMatchEventToPlayerStats(event, match.competitionId);

    if (dto.playerId) {
      void this.ingestSipMetricsFromMatch(matchId).catch(() => undefined);
    }

    return event;
  }

  async ingestShortMatchEventsCsv(matchId: string, csv: string) {
    const parsed = parseShortMatchEventsCsv(csv);
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: { homeTeam: true, awayTeam: true, competition: true },
    });
    if (!match) throw new NotFoundException("Match not found");

    const labels = scorerTeamLabels(match);
    const resolveTeamId = (teamName: string) => {
      const homeScore = scoreTeamLabelMatch(teamName, labels.home);
      const awayScore = scoreTeamLabelMatch(teamName, labels.away);
      if (homeScore >= 68 && homeScore > awayScore) return match.homeTeamId;
      if (awayScore >= 68 && awayScore > homeScore) return match.awayTeamId;
      if (homeScore === awayScore && homeScore >= 68) {
        throw new BadRequestException(
          `Team "${teamName}" matches both fixture teams. Use ${match.homeTeam.name} or ${match.awayTeam.name}.`
        );
      }
      throw new BadRequestException(
        `Team "${teamName}" does not match ${match.homeTeam.name} or ${match.awayTeam.name}`
      );
    };

    for (const ev of parsed) {
      const teamId = ev.teamName ? resolveTeamId(ev.teamName) : null;
      await this.resolveOrCreateTimelinePlayer({
        label: ev.playerLabel,
        teamId,
        role: "primary",
        eventType: ev.type,
      });
      await this.resolveOrCreateTimelinePlayer({
        label: ev.assistLabel,
        teamId,
        role: "assist",
        eventType: ev.type,
      });
    }

    const playerResolver = await this.buildMatchEventPlayerResolver(matchId, [
      match.homeTeamId,
      match.awayTeamId,
    ]);

    const createdEvents: SbMatchEvent[] = [];
    let skippedDuplicates = 0;

    for (const ev of parsed) {
      const teamId = ev.teamName ? resolveTeamId(ev.teamName) : null;

      const resolvedPlayerId = playerResolver.resolvePrimary(ev.playerLabel, teamId);
      const resolvedAssistPlayerId = playerResolver.resolveAssist(ev.assistLabel, teamId);
      const metadata = {
        ...(ev.metadata ?? {}),
        source: "quick-score-csv",
      };

      const duplicate = await this.prisma.sbMatchEvent.findFirst({
        where: {
          matchId,
          type: ev.type,
          minute: ev.minute,
          teamId,
          playerLabel: ev.playerLabel?.trim() || null,
          assistLabel: ev.assistLabel?.trim() || null,
        },
      });
      if (duplicate) {
        skippedDuplicates++;
        continue;
      }

      const created = await this.prisma.sbMatchEvent.create({
        data: {
          matchId,
          type: ev.type,
          minute: ev.minute,
          teamId,
          playerId: resolvedPlayerId ?? undefined,
          assistPlayerId: resolvedAssistPlayerId ?? undefined,
          playerLabel: ev.playerLabel?.trim() || undefined,
          assistLabel: ev.assistLabel?.trim() || undefined,
          detail: ev.detail?.trim() || undefined,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
      createdEvents.push(created);
    }

    for (const event of createdEvents) {
      if (event.playerId) {
        await this.lifecycle.applyMatchEventToPlayerStats(event, match.competitionId);
      }
    }

    if (createdEvents.some((event) => event.playerId)) {
      void this.ingestSipMetricsFromMatch(matchId).catch(() => undefined);
    }

    return {
      matchId,
      eventsCreated: createdEvents.length,
      skippedDuplicates,
      events: await this.prisma.sbMatchEvent.findMany({
        where: { id: { in: createdEvents.map((event) => event.id) } },
        orderBy: { minute: "asc" },
        include: {
          team: { select: { id: true, name: true } },
          player: { select: { id: true, slug: true, displayName: true } },
          assistPlayer: { select: { id: true, slug: true, displayName: true } },
        },
      }),
    };
  }

  async updateMatch(matchId: string, dto: UpdateMatchDto) {
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
    });
    if (!match) throw new NotFoundException("Match not found");

    if (dto.status === "live" || dto.status === "halftime") {
      const rosterCheck = assertMatchReadyForLiveEvents(
        (match.stats ?? {}) as Parameters<typeof assertMatchReadyForLiveEvents>[0],
        match.homeTeamId,
        match.awayTeamId
      );
      if (!rosterCheck.ok) {
        throw new ForbiddenException(rosterCheck.reason);
      }
    }

    if (
      dto.status &&
      !["scheduled", "live", "halftime", "finished", "postponed"].includes(
        dto.status
      )
    ) {
      throw new BadRequestException("Invalid match status");
    }

    const updated = await this.prisma.sbMatch.update({
      where: { id: matchId },
      data: {
        status: dto.status,
        minute: dto.minute,
        homeScore: dto.homeScore,
        awayScore: dto.awayScore,
      },
      include: MATCH_INCLUDE,
    });

    if (dto.status || dto.minute) {
      await this.ingestSipMetricsFromMatch(matchId);
    }

    if (dto.status === "finished" && match.status !== "finished") {
      await this.lifecycle.onMatchFinished(matchId);
    }

    return presentScoreboardPayload(updated);
  }

  async ingestMatchTimelineCsv(
    matchId: string,
    csv: string,
    replace = false,
    matchComment?: string
  ) {
    const parsed = parseMatchTimelineCsv(csv);
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: { homeTeam: true, awayTeam: true, competition: true, events: true },
    });
    if (!match) throw new NotFoundException("Match not found");

    if (match.status === "finished" && match.events.length > 0 && !replace) {
      throw new BadRequestException(
        "Match is already finished with events. Re-upload with replace=true or clear events first."
      );
    }

    const existingMeta = (match.meta ?? {}) as Record<string, unknown>;
    const existingStats = (match.stats ?? {}) as Record<string, unknown>;
    const wasFinished = match.status === "finished";

    const meta: Record<string, unknown> = { ...existingMeta };
    if (parsed.penaltyShootout) {
      meta.penaltyShootout = {
        home: parsed.penaltyShootout.home,
        away: parsed.penaltyShootout.away,
        winner: parsed.penaltyShootout.winner,
      };
      meta.regulationScore = { home: parsed.homeScore, away: parsed.awayScore };
    }

    const derivedStats = deriveMatchStatsFromCsvEvents(parsed.events, {
      narrative: parsed.narrative,
    });

    for (const ev of parsed.events) {
      const teamId = ev.teamSide
        ? ev.teamSide === "home"
          ? match.homeTeamId
          : match.awayTeamId
        : null;
      const secondaryTeamId = this.inferSecondaryTeamId(ev.type, teamId, match);
      await this.resolveOrCreateTimelinePlayer({
        label: ev.playerLabel,
        teamId,
        role: "primary",
        eventType: ev.type,
      });
      await this.resolveOrCreateTimelinePlayer({
        label: ev.assistLabel,
        teamId,
        role: "assist",
        eventType: ev.type,
      });
      await this.resolveOrCreateTimelinePlayer({
        label: ev.playerLabel2,
        teamId: secondaryTeamId,
        role: "secondary",
        eventType: ev.type,
      });
    }

    const playerResolver = await this.buildMatchEventPlayerResolver(matchId, [
      match.homeTeamId,
      match.awayTeamId,
    ]);

    const createdEvents = await this.prisma.$transaction(async (tx) => {
      await tx.sbMatchEvent.deleteMany({ where: { matchId } });

      const rows = [];
      for (const ev of parsed.events) {
        const teamId = ev.teamSide
          ? ev.teamSide === "home"
            ? match.homeTeamId
            : match.awayTeamId
          : null;
        const playerId = playerResolver.resolvePrimary(ev.playerLabel, teamId);
        const assistPlayerId = playerResolver.resolveAssist(ev.assistLabel, teamId);
        const secondaryTeamId = this.inferSecondaryTeamId(ev.type, teamId, match);
        const secondaryPlayerId = playerResolver.resolveSecondary(
          ev.playerLabel2,
          secondaryTeamId
        ) ?? playerResolver.resolveAny(ev.playerLabel2);
        const created = await tx.sbMatchEvent.create({
          data: {
            matchId,
            type: ev.type,
            minute: ev.minute,
            teamId,
            playerId: playerId ?? undefined,
            assistPlayerId: assistPlayerId ?? undefined,
            playerLabel2: ev.playerLabel2,
            playerLabel: ev.playerLabel,
            assistLabel: ev.assistLabel,
            detail: ev.detail,
            metadata: {
              ...(ev.metadata ?? { source: "csv-ingest" }),
              ...(secondaryPlayerId ? { secondaryPlayerId } : {}),
            } as Prisma.InputJsonValue,
          },
        });
        rows.push(created);
      }

      const statsPayload = {
        ...existingStats,
        ...derivedStats,
        ...(wasFinished ? { lifecycle: undefined } : {}),
      };

      const commentTrimmed = matchComment?.trim();
      await tx.sbMatch.update({
        where: { id: matchId },
        data: {
          homeScore: parsed.homeScore,
          awayScore: parsed.awayScore,
          minute: 90,
          status: "finished",
          matchComment: commentTrimmed || null,
          meta: meta as Prisma.InputJsonValue,
          stats: statsPayload as Prisma.InputJsonValue,
        },
      });

      return rows;
    });

    for (const event of createdEvents) {
      if (event.playerId) {
        await this.lifecycle.applyMatchEventToPlayerStats(
          event,
          match.competitionId
        );
      }
    }

    await this.lifecycle.onMatchFinished(matchId);

    return {
      matchId,
      status: "finished" as const,
      homeScore: parsed.homeScore,
      awayScore: parsed.awayScore,
      eventsCreated: createdEvents.length,
      penaltyShootout: parsed.penaltyShootout ?? null,
      standingsRefresh: "scheduled" as const,
    };
  }

  async patchMatchScore(matchId: string, dto: PatchMatchScoreDto) {
    const hasPenaltyHome = dto.penaltyHome !== undefined;
    const hasPenaltyAway = dto.penaltyAway !== undefined;
    if (hasPenaltyHome !== hasPenaltyAway) {
      throw new BadRequestException("penaltyHome and penaltyAway must be sent together");
    }

    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: { homeTeam: true, awayTeam: true, competition: true },
    });
    if (!match) throw new NotFoundException("Match not found");

    const newStatus = dto.status ?? "finished";
    const wasFinished = match.status === "finished";
    const scoresChanged =
      match.homeScore !== dto.homeScore || match.awayScore !== dto.awayScore;

    const existingMeta = (match.meta ?? {}) as Record<string, unknown>;
    const meta: Record<string, unknown> = { ...existingMeta };
    let goalScorers =
      typeof meta.goalScorers === "string" ? meta.goalScorers : null;
    if (dto.goalScorers !== undefined) {
      const nextGoalScorers = dto.goalScorers.trim();
      if (nextGoalScorers) {
        meta.goalScorers = nextGoalScorers;
        goalScorers = nextGoalScorers;
      } else {
        delete meta.goalScorers;
        goalScorers = null;
      }
    }

    let penaltyShootout: { home: number; away: number; winner: "home" | "away" } | null =
      (meta.penaltyShootout as { home: number; away: number; winner: "home" | "away" } | undefined) ??
      null;

    if (hasPenaltyHome && hasPenaltyAway) {
      const home = dto.penaltyHome!;
      const away = dto.penaltyAway!;
      if (home === away) {
        throw new BadRequestException("Penalty shootout cannot end in a draw");
      }
      const winner: "home" | "away" = home > away ? "home" : "away";
      penaltyShootout = { home, away, winner };
      meta.penaltyShootout = penaltyShootout;
      meta.regulationScore = { home: dto.homeScore, away: dto.awayScore };
    } else {
      delete meta.penaltyShootout;
      delete meta.regulationScore;
      penaltyShootout = null;
    }

    const updated = await this.prisma.sbMatch.update({
      where: { id: matchId },
      data: {
        homeScore: dto.homeScore,
        awayScore: dto.awayScore,
        status: newStatus,
        minute: newStatus === "finished" ? (match.minute ?? 90) : match.minute,
        meta: meta as Prisma.InputJsonValue,
      },
      include: MATCH_INCLUDE,
    });

    if (newStatus === "finished") {
      if (!wasFinished) {
        await this.lifecycle.onMatchFinished(matchId);
      } else if (scoresChanged || hasPenaltyHome) {
        await this.lifecycle.refreshStandingsForFinishedMatch(matchId);
      }
    }

    return {
      ok: true,
      matchId,
      status: updated.status,
      homeScore: updated.homeScore,
      awayScore: updated.awayScore,
      penaltyShootout,
      goalScorers,
      standingsRefresh: newStatus === "finished" ? ("scheduled" as const) : null,
      match: presentScoreboardPayload(updated),
    };
  }

  async supervisorFeed() {
    const rows = await this.prisma.sbMatch.findMany({
      where: { status: { in: LIVE_STATUSES } },
      orderBy: { kickoffAt: "asc" },
      include: {
        homeTeam: true,
        awayTeam: true,
        competition: true,
        events: { orderBy: { minute: "desc" }, take: 5 },
      },
    });
    return presentScoreboardPayload(rows);
  }

  async ingestSipMetricsFromMatch(matchId: string) {
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: {
        competition: true,
        events: {
          where: { playerId: { not: null } },
          orderBy: { minute: "asc" },
        },
      },
    });
    if (!match) throw new NotFoundException("Match not found");

    const eventsByPlayer = new Map<string, EventSnapshot[]>();
    for (const event of match.events) {
      if (!event.playerId) continue;
      const events = eventsByPlayer.get(event.playerId) ?? [];
      events.push({
        minute: event.minute,
        type: event.type,
        playerId: event.playerId,
      });
      eventsByPlayer.set(event.playerId, events);
    }

    if (eventsByPlayer.size === 0) {
      const result = {
        scoreboardMatchId: match.id,
        sipMatchId: match.sipMatchId,
        status: "skipped" as const,
        reason: "no_player_events",
        playersIngested: 0,
        playersSkipped: 0,
        players: [],
      };
      await this.recordSipIngest(match.id, result.status, result.reason, result);
      return result;
    }

    const sipMatchId = await this.ensureSipMatch(match);
    const players: SipIngestPlayerResult[] = [];
    for (const [playerId, events] of eventsByPlayer.entries()) {
      players.push(
        await this.upsertEventDerivedMetrics(playerId, sipMatchId, match, events)
      );
    }

    const playersIngested = players.filter((p) => p.status !== "skipped").length;
    const playersSkipped = players.length - playersIngested;
    const status = playersIngested > 0 ? "success" : "skipped";
    const result = {
      scoreboardMatchId: match.id,
      sipMatchId,
      status,
      playersIngested,
      playersSkipped,
      players,
    };
    await this.recordSipIngest(match.id, status, undefined, result);
    return result;
  }

  private async recordSipIngest(
    matchId: string,
    status: string,
    message: string | undefined,
    summary: Prisma.InputJsonValue
  ) {
    await this.prisma.$transaction([
      this.prisma.sbMatch.update({
        where: { id: matchId },
        data: {
          sipIngestStatus: status,
          sipIngestedAt: new Date(),
          sipIngestSummary: summary,
        },
      }),
      this.prisma.sbSipIngestAudit.create({
        data: {
          matchId,
          status,
          message,
          summary,
        },
      }),
    ]);
  }

  private async ensureSipMatch(match: MatchWithCompetition) {
    if (match.sipMatchId) return match.sipMatchId;

    const externalRef = `${SCOREBOARD_EXTERNAL_REF_PREFIX}${match.id}`;
    const existing = await this.prisma.match.findFirst({
      where: { externalRef },
    });

    const sipMatch =
      existing ??
      (await this.prisma.match.create({
        data: {
          externalRef,
          competition: match.competition.name,
          season: match.competition.season,
          playedAt: match.kickoffAt ?? new Date(),
        },
      }));

    await this.prisma.sbMatch.update({
      where: { id: match.id },
      data: { sipMatchId: sipMatch.id },
    });

    return sipMatch.id;
  }

  private async upsertEventDerivedMetrics(
    playerId: string,
    sipMatchId: string,
    match: Pick<MatchWithCompetition, "status" | "minute">,
    events: EventSnapshot[]
  ): Promise<SipIngestPlayerResult> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { id: true },
    });
    if (!player) {
      return { playerId, status: "skipped", reason: "player_not_found" };
    }

    const existing = await this.prisma.playerMatchMetrics.findUnique({
      where: { playerId_matchId: { playerId, matchId: sipMatchId } },
    });
    const data = this.metricsFromEvents(match, events);

    let status: "created" | "updated";
    if (!existing) {
      await this.prisma.playerMatchMetrics.create({
        data: { playerId, matchId: sipMatchId, ...data },
      });
      status = "created";
    } else if (this.canUpdateEventDerivedMetrics(existing)) {
      await this.prisma.playerMatchMetrics.update({
        where: { playerId_matchId: { playerId, matchId: sipMatchId } },
        data,
      });
      status = "updated";
    } else {
      return { playerId, status: "skipped", reason: "manual_metrics_present" };
    }

    await this.sipRecalc.recalculatePlayer(playerId);
    return { playerId, status };
  }

  private metricsFromEvents(
    match: Pick<MatchWithCompetition, "status" | "minute">,
    events: EventSnapshot[]
  ) {
    const latestEventMinute = events.reduce(
      (max, event) => Math.max(max, event.minute),
      0
    );
    const minutesPlayed = Math.max(
      1,
      match.status === "finished" ? 90 : 0,
      match.minute ?? 0,
      latestEventMinute
    );
    const goalEvents = events.filter((event) => event.type === "goal").length;

    return {
      minutesPlayed,
      ballTouches: events.length,
      oneTouchPossessions: events.length,
      multiTouchPossessions: 0,
      possessionDurationSeconds: 0,
      releaseLacesCount: goalEvents,
      releaseInsideFootCount: Math.max(events.length - goalEvents, 0),
      releaseOtherFootzoneCount: 0,
      leftFootTouchCount: 0,
      rightFootTouchCount: 0,
      leftFootReleaseCount: 0,
      rightFootReleaseCount: 0,
      leftFootReceiveCount: 0,
      rightFootReceiveCount: 0,
      totalDistanceMiles: 0,
      sprintDistanceYards: 0,
      firstStepAccelerations: 0,
      intenseAccelerations: 0,
      sprints: 0,
      intenseTurns: 0,
      leftTurns: 0,
      rightTurns: 0,
      backTurns: 0,
      distanceWithBallYards: 0,
      intenseTurnsWithBall: 0,
    };
  }

  private canUpdateEventDerivedMetrics(row: PlayerMatchMetrics) {
    return (
      row.totalDistanceMiles === 0 &&
      row.sprintDistanceYards === 0 &&
      row.firstStepAccelerations === 0 &&
      row.intenseAccelerations === 0 &&
      row.leftFootTouchCount === 0 &&
      row.rightFootTouchCount === 0 &&
      row.leftFootReceiveCount === 0 &&
      row.rightFootReceiveCount === 0 &&
      row.sprints === 0 &&
      row.intenseTurns === 0 &&
      row.distanceWithBallYards === 0 &&
      row.intenseTurnsWithBall === 0 &&
      (row.kickingPowerMph ?? 0) === 0 &&
      (row.topSpeedMph ?? 0) === 0 &&
      (row.avgTurnEntrySpeedMph ?? 0) === 0 &&
      (row.avgTurnExitSpeedMph ?? 0) === 0
    );
  }
}
