import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { normalizeClubName, normalizePlayerName, playerLookupKey } from "@dtp/engines";
import { isAllowedImageMediaUrl, normalizeVideoMediaUrl } from "../shared/media-url";
import type { CreateAdminHighlightDto } from "./dto/create-admin-highlight.dto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  applyTimelineNumberFixes,
  planTimelineNumberFixes,
} from "../scoreboard/resolve-timeline-numbers";
import { getRosterReadiness } from "../scoreboard/roster-guard";
import { PlayerDirectoryService } from "../scoreboard/player-directory.service";
import { CompetitionEngineService } from "../scoreboard/competition-engine.service";
import { ScoreboardService } from "../scoreboard/scoreboard.service";
import { ScoreboardLifecycleService } from "../scoreboard/scoreboard-lifecycle.service";
import { LiveAudioCommentaryService } from "../scoreboard/live-audio-commentary.service";
import { CreateMatchEventDto } from "../scoreboard/dto/create-event.dto";
import { UpdateMatchDto } from "../scoreboard/dto/update-match.dto";
import type { CreateCompetitionFromTemplateInput } from "../scoreboard/competition-engine.service";
import type { UpsertAdminTeamDto } from "./dto/upsert-admin-team.dto";
import { linkTeamsToClubsQuietly } from "../academy/club-sync";
import {
  academyFieldsForTeamSync,
  scoreboardTeamSlugForAcademy,
} from "../academy/academy-team-sync.util";
import type { CreateAdminMatchDto } from "./dto/create-admin-match.dto";
import type { PatchMatchGamedayDto } from "./dto/patch-match-gameday.dto";
import type { PatchMatchScoreDto } from "./dto/patch-match-score.dto";
import type {
  MatchStatsSideDto,
  UpdateMatchStatsDto,
} from "./dto/update-match-stats.dto";
import { presentScoreboardPayload } from "../scoreboard/present-scoreboard";
import {
  FRIENDLY_COMPETITION_NAME,
  FRIENDLY_COMPETITION_SLUG,
  FRIENDLY_FORMAT_TYPE,
} from "../scoreboard/friendly";
import {
  resolveUniqueMatchSlug,
  type MatchSlugLeg,
} from "../scoreboard/match-slug";
import { parseKickoffAtIso, parseWatKickoff } from "../shared/wat-datetime";
import { parseMatchSquadCsv, type ParsedMatchSquadCsvRow } from "./match-squad-csv";
import type { UpdateAdminCompetitionDto } from "./dto/update-admin-competition.dto";
import type { UpsertScoreboardSquadRowDto } from "./dto/upsert-scoreboard-squad-row.dto";
import { CreateFriendlyMatchDto } from "./dto/create-friendly-match.dto";
import {
  readClock,
  readEvents,
  readLiveFeature,
  scoreFromEvents,
} from "./admin-match-stats.service";
import { PlaceholderPlayerNameError } from "../players/placeholder-names";
import { mergePlayerRecords } from "../players/merge-player-records";

const SCOREBOARD_TIMEZONE = "Africa/Lagos";
const DEFAULT_FORMATION = "4-3-3";

const KNOCKOUT_ROUND_LABELS: Record<string, string> = {
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-final",
  SF: "Semi-final",
  F: "Final",
};

function deriveRoundLabel(
  knockoutRound: string | undefined,
  leg: MatchSlugLeg | undefined,
  explicit?: string
): string | null {
  if (explicit?.trim()) return explicit.trim();
  if (!knockoutRound) return null;
  const base = KNOCKOUT_ROUND_LABELS[knockoutRound] ?? knockoutRound;
  return leg === "second_leg" ? `${base} — Leg 2` : base;
}

export type SbCompetitionStatus = "active" | "upcoming" | "draft" | "archived";

export type MatchdayRosterSlot = {
  squadId: string;
  displayName: string;
  position: string | null;
  shirtNumber: number | null;
  playerId: string | null;
  playerSlug: string | null;
  role: "xi" | "sub";
  cleanSheets?: number;
};

export type MatchdayRosterPayload = {
  teamId: string;
  xi: MatchdayRosterSlot[];
  subs: MatchdayRosterSlot[];
};

export type SpotterOpsState = {
  lineupsLocked: boolean;
  officialsConfirmed: number;
  addedTime: number;
  offlineQueueCount: number;
  lastUndoAt: string | null;
};

type SpotterStatsStored = {
  lineupsLocked: boolean;
  officialsConfirmed: number;
  addedTime: number;
  formation?: { home: string; away: string };
  pitchSelection?: { teamId: string; squadId: string } | null;
  offlineQueue?: Array<{ id: string; type: string; minute: number; at: string }>;
};

type MatchStatsJson = {
  matchdayRosters?: Record<string, MatchdayRosterPayload>;
  spotter?: SpotterStatsStored;
  possession?: { home: number; away: number };
  goals?: { home: number; away: number };
  shots?: { home: number; away: number };
  shotsOnTarget?: { home: number; away: number };
  shotsOffTarget?: { home: number; away: number };
  blockedShots?: { home: number; away: number };
  corners?: { home: number; away: number };
  fouls?: { home: number; away: number };
  offsides?: { home: number; away: number };
  yellowCards?: { home: number; away: number };
  redCards?: { home: number; away: number };
  saves?: { home: number; away: number };
  penaltiesAwarded?: { home: number; away: number };
  manualStatsMeta?: {
    source: "manual" | "csv" | "json";
    updatedAt: string;
  };
};

const MATCH_STAT_KEYS = [
  "goals",
  "shots",
  "shotsOnTarget",
  "shotsOffTarget",
  "blockedShots",
  "corners",
  "fouls",
  "offsides",
  "yellowCards",
  "redCards",
  "saves",
  "penaltiesAwarded",
] as const;

type MatchStatKey = (typeof MATCH_STAT_KEYS)[number];
type MatchStatsSide = Partial<Record<MatchStatKey, number>>;

const MATCH_STAT_ALIASES: Record<string, MatchStatKey> = {
  goals: "goals",
  goal: "goals",
  totalshots: "shots",
  shots: "shots",
  shotstotal: "shots",
  shotsontarget: "shotsOnTarget",
  shotson: "shotsOnTarget",
  sot: "shotsOnTarget",
  shotsofftarget: "shotsOffTarget",
  shotsoff: "shotsOffTarget",
  blockedshots: "blockedShots",
  blockedshot: "blockedShots",
  corners: "corners",
  cornerkicks: "corners",
  fouls: "fouls",
  foulscommitted: "fouls",
  offsides: "offsides",
  offside: "offsides",
  yellowcards: "yellowCards",
  yellowcard: "yellowCards",
  reds: "redCards",
  redcards: "redCards",
  redcard: "redCards",
  saves: "saves",
  save: "saves",
  penaltyawarded: "penaltiesAwarded",
  penaltiesawarded: "penaltiesAwarded",
  penalties: "penaltiesAwarded",
};

function defaultSpotterState(): SpotterStatsStored {
  return {
    lineupsLocked: false,
    officialsConfirmed: 0,
    addedTime: 0,
    offlineQueue: [],
  };
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function splitPlayerName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? displayName,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : "",
  };
}

function normalizeFormation(value?: string | null) {
  const raw = value?.trim();
  if (!raw) return DEFAULT_FORMATION;
  const parts = raw
    .split("-")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((part) => Number.isFinite(part) && part > 0);
  if (parts.length < 2 || parts.reduce((sum, part) => sum + part, 0) !== 10) {
    return DEFAULT_FORMATION;
  }
  return parts.join("-");
}

function sideForTeam(match: { homeTeamId: string; awayTeamId: string }, teamId: string): "home" | "away" {
  if (match.homeTeamId === teamId) return "home";
  if (match.awayTeamId === teamId) return "away";
  throw new BadRequestException("Team not in this match");
}

function deriveCompetitionStatus(
  isPublished: boolean,
  matchStatuses: string[]
): SbCompetitionStatus {
  if (!isPublished) return "draft";
  if (matchStatuses.some((s) => s === "live" || s === "halftime")) return "active";
  if (
    matchStatuses.length > 0 &&
    matchStatuses.every((s) => s === "finished" || s === "cancelled")
  ) {
    return "archived";
  }
  return "upcoming";
}

function normalizeCompetitionStatus(value: string | undefined | null): SbCompetitionStatus {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "ongoing") return "active";
  if (normalized === "active" || normalized === "upcoming" || normalized === "draft" || normalized === "archived") {
    return normalized;
  }
  throw new BadRequestException("Competition status must be active, upcoming, draft, archived, or ongoing");
}

function parseCsv(input: string): string[][] {
  /*
   * Excel's "CSV UTF-8" export prefixes a byte-order mark. Left in, it glues
   * itself to the first header, so whichever column came first silently failed
   * to match in every importer.
   */
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((c) => c.length)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell.trim());
  if (row.some((c) => c.length)) rows.push(row);
  return rows;
}

/** Accepted headers for a squad list. Matched after normalizedHeader(). */
const SQUAD_CSV_COLUMNS = {
  name: ["displayName", "name", "fullName", "playerName", "player"],
  shirtNumber: ["shirtNumber", "number", "jerseyNumber", "jersey", "shirt", "no"],
  position: ["position", "pos"],
};
const SQUAD_CSV_MAX_ROWS = 200;
const SQUAD_CSV_MAX_REPORTED_ERRORS = 10;

/** Rejects a squad file as a whole, listing the first few problems by row. */
function squadImportRejected(errors: string[]): BadRequestException {
  const shown = errors.slice(0, SQUAD_CSV_MAX_REPORTED_ERRORS);
  const more = errors.length - shown.length;
  return csvError(
    "Squad import",
    `nothing was imported. ${shown.join("; ")}${more > 0 ? `; and ${more} more` : ""}`
  );
}

function describeSquadConflict(
  conflict: { playerId: string | null; displayName: string; team: { name: string } },
  lineByPlayerId: Map<string, number | undefined>
): string {
  const line = lineByPlayerId.get(conflict.playerId ?? "") ?? "?";
  return `row ${line}: ${conflict.displayName} is already registered for ${normalizeClubName(
    conflict.team.name
  )} in this competition`;
}

function csvError(label: string, detail: string): BadRequestException {
  return new BadRequestException(`${label}: ${detail}`);
}

function normalizedHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function readCsvCell(
  row: string[],
  header: string[],
  aliases: string[]
): string | undefined {
  for (const alias of aliases.map(normalizedHeader)) {
    const idx = header.indexOf(alias);
    if (idx >= 0) return row[idx];
  }
  return undefined;
}

function parseOptionalStatNumber(value: unknown, label: string): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const num = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(num) || num < 0) {
    throw new BadRequestException(`${label} must be a non-negative number`);
  }
  return Math.round(num);
}

function normalizeStatSide(
  raw: MatchStatsSideDto | MatchStatsSide | undefined,
  label: string
): MatchStatsSide {
  const out: MatchStatsSide = {};
  if (!raw) return out;
  for (const key of MATCH_STAT_KEYS) {
    const parsed = parseOptionalStatNumber(raw[key], `${label}.${key}`);
    if (parsed !== undefined) out[key] = parsed;
  }
  return out;
}

function hasStatSideValues(side: MatchStatsSide) {
  return MATCH_STAT_KEYS.some((key) => side[key] !== undefined);
}

@Injectable()
export class AdminScoreboardService {
  private statsCache: { at: number; payload: Awaited<ReturnType<AdminScoreboardService["fetchStats"]>> } | null =
    null;
  private readonly statsTtlMs = 30_000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ScoreboardService) private readonly scoreboard: ScoreboardService,
    @Inject(CompetitionEngineService)
    private readonly competitionEngine: CompetitionEngineService,
    @Inject(PlayerDirectoryService)
    private readonly playerDirectory: PlayerDirectoryService,
    @Inject(LiveAudioCommentaryService)
    private readonly liveAudio: LiveAudioCommentaryService,
    @Inject(ScoreboardLifecycleService)
    private readonly lifecycle: ScoreboardLifecycleService
  ) {}

  async stats() {
    const now = Date.now();
    if (this.statsCache && now - this.statsCache.at < this.statsTtlMs) {
      return this.statsCache.payload;
    }
    const payload = await this.fetchStats();
    this.statsCache = { at: now, payload };
    return payload;
  }

  private async fetchStats() {
    const [competitions, teams, squadRows, matches, highlights, liveMatches] =
      await Promise.all([
        this.prisma.sbCompetition.count(),
        this.prisma.sbTeam.count(),
        this.prisma.sbTeamSquad.count(),
        this.prisma.sbMatch.count(),
        this.prisma.sbHighlight.count(),
        this.prisma.sbMatch.count({
          where: { status: { in: ["live", "halftime"] } },
        }),
      ]);
    return {
      competitions,
      teams,
      squadRows,
      matches,
      highlights,
      liveMatches,
    };
  }

  /** Lightweight list for seeders / dropdowns (no match status derivation). */
  async listCompetitionPicker() {
    await this.ensureFriendlyCompetition();
    return this.prisma.sbCompetition.findMany({
      select: { id: true, name: true, slug: true, season: true },
      orderBy: { name: "asc" },
    });
  }

  async listCompetitions(filters?: { status?: string; type?: string; q?: string }) {
    const where: Prisma.SbCompetitionWhereInput = {};
    if (filters?.q?.trim()) {
      const q = filters.q.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
        { country: { contains: q, mode: "insensitive" } },
      ];
    }
    if (filters?.type?.trim()) {
      where.type = { equals: filters.type.trim(), mode: "insensitive" };
    }

    const rows = await this.prisma.sbCompetition.findMany({
      where,
      include: { _count: { select: { teams: true, matches: true } } },
      orderBy: { name: "asc" },
    });

    const compIds = rows.map((c) => c.id);
    const statusByComp = new Map<string, string[]>();
    if (compIds.length) {
      const statusRows = await this.prisma.sbMatch.findMany({
        where: { competitionId: { in: compIds } },
        select: { competitionId: true, status: true },
      });
      for (const row of statusRows) {
        const list = statusByComp.get(row.competitionId) ?? [];
        list.push(row.status);
        statusByComp.set(row.competitionId, list);
      }
    }

    return rows
      .map((c) => {
        const status = deriveCompetitionStatus(
          c.isPublished,
          statusByComp.get(c.id) ?? []
        );
        return {
          id: c.id,
          slug: c.slug,
          name: c.name,
          type: c.type,
          region: c.country,
          season: c.season,
          teamsCount: c._count.teams,
          matchesCount: c._count.matches,
          status: (c as { status?: SbCompetitionStatus }).status ?? status,
          isPublished: c.isPublished,
          isFeatured: (c.description ?? "").includes("[featured]"),
          formatType: c.formatType,
          logoUrl: null as string | null,
        };
      })
      .filter((c) => !filters?.status || c.status === filters.status);
  }

  async updateCompetition(competitionId: string, dto: UpdateAdminCompetitionDto) {
    const existing = await this.prisma.sbCompetition.findUnique({
      where: { id: competitionId },
      include: { _count: { select: { teams: true, matches: true } } },
    });
    if (!existing) throw new NotFoundException("Competition not found");

    const data: Prisma.SbCompetitionUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException("Competition name is required");
      data.name = name;
    }
    if (dto.slug !== undefined) {
      const slug = dto.slug.trim() || slugify(String(data.name ?? existing.name));
      data.slug = slug;
    }
    if (dto.season !== undefined) {
      const season = dto.season.trim();
      if (!season) throw new BadRequestException("Season is required");
      data.season = season;
    }
    if (dto.type !== undefined) data.type = dto.type.trim() || existing.type;
    if (dto.status !== undefined) (data as { status?: SbCompetitionStatus }).status = normalizeCompetitionStatus(dto.status);
    if (dto.formatType !== undefined) data.formatType = dto.formatType.trim() || null;
    if (dto.country !== undefined) data.country = dto.country.trim() || null;
    if (dto.description !== undefined) data.description = dto.description.trim() || null;
    if (dto.isPublished !== undefined) data.isPublished = dto.isPublished;

    try {
      const row = await this.prisma.sbCompetition.update({
        where: { id: competitionId },
        data,
        include: { _count: { select: { teams: true, matches: true } } },
      });
      this.statsCache = null;
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        type: row.type,
        region: row.country,
        season: row.season,
        teamsCount: row._count.teams,
        matchesCount: row._count.matches,
        status: (row as { status?: SbCompetitionStatus }).status ?? deriveCompetitionStatus(row.isPublished, []),
        isPublished: row.isPublished,
        isFeatured: (row.description ?? "").includes("[featured]"),
        formatType: row.formatType,
        logoUrl: null as string | null,
      };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("A competition with this slug already exists");
      }
      throw err;
    }
  }

  async deleteCompetition(competitionId: string) {
    const competition = await this.prisma.sbCompetition.findUnique({
      where: { id: competitionId },
      include: {
        _count: {
          select: { teams: true, matches: true, highlights: true, playerStats: true },
        },
      },
    });
    if (!competition) throw new NotFoundException("Competition not found");
    const linked =
      competition._count.teams +
      competition._count.matches +
      competition._count.highlights +
      competition._count.playerStats;
    if (linked > 0) {
      throw new BadRequestException(
        "Cannot delete a competition with teams, fixtures, highlights, or player stats. Remove those records first."
      );
    }
    await this.prisma.sbCompetition.delete({ where: { id: competitionId } });
    this.statsCache = null;
    return { ok: true };
  }

  async listTeams(filters?: { q?: string; competitionId?: string }) {
    const where: Prisma.SbTeamWhereInput = {};
    if (filters?.competitionId) where.competitionId = filters.competitionId;
    if (filters?.q?.trim()) {
      const q = filters.q.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
      ];
    }

    const rows = await this.prisma.sbTeam.findMany({
      where,
      include: {
        competition: { select: { id: true, name: true, slug: true } },
        _count: { select: { squad: true } },
      },
      orderBy: { name: "asc" },
    });
    return rows.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: normalizeClubName(t.name),
      shortName: t.shortName,
      region: t.city,
      logoUrl: t.logoUrl,
      groupKey: t.groupKey,
      competition: t.competition,
      squadCount: t._count.squad,
    }));
  }

  private presentTeamRow(
    t: {
      id: string;
      slug: string;
      name: string;
      shortName: string | null;
      city: string | null;
      logoUrl: string | null;
      groupKey: string | null;
      competition: { id: string; name: string; slug: string };
      _count: { squad: number };
    }
  ) {
    return {
      id: t.id,
      slug: t.slug,
      name: normalizeClubName(t.name),
      shortName: t.shortName,
      region: t.city,
      logoUrl: t.logoUrl,
      groupKey: t.groupKey,
      competition: t.competition,
      squadCount: t._count.squad,
    };
  }

  private teamInclude = {
    competition: { select: { id: true, name: true, slug: true } },
    _count: { select: { squad: true } },
  } as const;

  private cleanTeamField(value?: string) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private validateTeamLogoUrl(logoUrl?: string | null) {
    const url = logoUrl?.trim();
    if (!url) return null;
    if (!isAllowedImageMediaUrl(url)) {
      throw new BadRequestException("logoUrl must be a valid image URL");
    }
    return url;
  }

  async getTeam(teamId: string) {
    const team = await this.prisma.sbTeam.findUnique({
      where: { id: teamId },
      include: this.teamInclude,
    });
    if (!team) throw new NotFoundException("Team not found");
    return this.presentTeamRow(team);
  }

  async createTeam(dto: UpsertAdminTeamDto) {
    const competition = await this.prisma.sbCompetition.findUnique({
      where: { id: dto.competitionId },
    });
    if (!competition) throw new NotFoundException("Competition not found");

    const name = normalizeClubName(dto.name.trim());
    if (!name) throw new BadRequestException("Team name is required");
    const slug = this.cleanTeamField(dto.slug) ?? slugify(name);

    try {
      const team = await this.prisma.sbTeam.create({
        data: {
          competitionId: dto.competitionId,
          name,
          slug,
          shortName: this.cleanTeamField(dto.shortName),
          city: this.cleanTeamField(dto.city),
          logoUrl: this.validateTeamLogoUrl(dto.logoUrl),
          groupKey: this.cleanTeamField(dto.groupKey),
        },
        include: this.teamInclude,
      });
      this.statsCache = null;
      // Tie this competition entry to its club, creating the profile if needed.
      await linkTeamsToClubsQuietly(this.prisma, [team.id]);
      return this.presentTeamRow(team);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("A team with this slug already exists in the competition");
      }
      throw err;
    }
  }

  async updateTeam(teamId: string, dto: UpsertAdminTeamDto) {
    const existing = await this.prisma.sbTeam.findUnique({ where: { id: teamId } });
    if (!existing) throw new NotFoundException("Team not found");

    const competitionId = dto.competitionId ?? existing.competitionId;
    if (dto.competitionId) {
      const competition = await this.prisma.sbCompetition.findUnique({
        where: { id: dto.competitionId },
      });
      if (!competition) throw new NotFoundException("Competition not found");
    }

    const name = dto.name?.trim() ? normalizeClubName(dto.name.trim()) : existing.name;
    const slug =
      dto.slug !== undefined
        ? this.cleanTeamField(dto.slug) ?? slugify(name)
        : existing.slug;

    try {
      const team = await this.prisma.sbTeam.update({
        where: { id: teamId },
        data: {
          competitionId,
          name,
          slug,
          ...(dto.shortName !== undefined
            ? { shortName: this.cleanTeamField(dto.shortName) }
            : {}),
          ...(dto.city !== undefined ? { city: this.cleanTeamField(dto.city) } : {}),
          ...(dto.logoUrl !== undefined
            ? { logoUrl: this.validateTeamLogoUrl(dto.logoUrl) }
            : {}),
          ...(dto.groupKey !== undefined
            ? { groupKey: this.cleanTeamField(dto.groupKey) }
            : {}),
        },
        include: this.teamInclude,
      });
      this.statsCache = null;
      return this.presentTeamRow(team);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("A team with this slug already exists in the competition");
      }
      throw err;
    }
  }

  async deleteTeam(teamId: string) {
    const team = await this.prisma.sbTeam.findUnique({
      where: { id: teamId },
      include: {
        _count: {
          select: {
            homeMatches: true,
            awayMatches: true,
          },
        },
      },
    });
    if (!team) throw new NotFoundException("Team not found");
    const matchCount = team._count.homeMatches + team._count.awayMatches;
    if (matchCount > 0) {
      throw new BadRequestException(
        "Cannot delete a team that is linked to matches. Remove fixtures first."
      );
    }

    await this.prisma.sbTeam.delete({ where: { id: teamId } });
    this.statsCache = null;
    return { ok: true };
  }

  /**
   * Push a club profile's name, crest and city to every one of its teams, in
   * every competition.
   *
   * Teams are the ones linked by academyId. An unlinked team whose slug matches
   * the profile — the convention this relied on before academyId existed — is
   * linked first, so the two stay in step. A team already linked to a different
   * club is never touched.
   */
  async syncTeamsFromAcademy(academy: {
    id: string;
    slug: string;
    name: string;
    logoUrl: string | null;
    city: string | null;
  }) {
    const teamSlug = scoreboardTeamSlugForAcademy(academy);
    const linkedBySlug = teamSlug
      ? await this.prisma.sbTeam.updateMany({
          where: { slug: teamSlug, academyId: null },
          data: { academyId: academy.id },
        })
      : { count: 0 };

    const result = await this.prisma.sbTeam.updateMany({
      where: { academyId: academy.id },
      data: academyFieldsForTeamSync(academy),
    });
    if (result.count > 0) this.statsCache = null;
    return { updated: result.count, linked: linkedBySlug.count, teamSlug };
  }

  async listScoreboardPlayers(q?: string) {
    const needle = q?.trim();
    const squad = await this.prisma.sbTeamSquad.findMany({
      where: needle
        ? {
            OR: [
              { displayName: { contains: needle, mode: "insensitive" } },
              { player: { displayName: { contains: needle, mode: "insensitive" } } },
            ],
          }
        : undefined,
      include: {
        team: {
          select: {
            id: true,
            name: true,
            slug: true,
            competition: { select: { name: true, slug: true } },
          },
        },
        player: {
          select: {
            id: true,
            slug: true,
            displayName: true,
            positionPrimary: true,
            positionSecondary: true,
            playerPhotoUrl: true,
            isPublic: true,
          },
        },
      },
      orderBy: { displayName: "asc" },
      take: needle ? 500 : undefined,
    });

    const byPlayer = new Map<
      string,
      {
        playerId: string | null;
        slug: string | null;
        displayName: string;
        positionPrimary: string | null;
        teams: Array<{
          squadId: string;
          teamId: string;
          teamName: string;
          competitionSlug: string;
          competitionName: string;
          position: string | null;
          shirtNumber: number | null;
        }>;
      }
    >();

    for (const row of squad) {
      const key = row.playerId ?? `squad:${row.id}`;
      const displayName = row.player?.displayName ?? row.displayName;
      const slug = row.player?.slug ?? slugify(displayName);
      const existing = byPlayer.get(key) ?? {
        playerId: row.playerId,
        slug,
        displayName,
        positionPrimary: row.position ?? row.player?.positionPrimary ?? null,
        teams: [],
      };
      existing.teams.push({
        squadId: row.id,
        teamId: row.team.id,
        teamName: normalizeClubName(row.team.name),
        competitionSlug: row.team.competition.slug,
        competitionName: row.team.competition.name,
        position: row.position,
        shirtNumber: row.shirtNumber,
      });
      byPlayer.set(key, existing);
    }

    return [...byPlayer.values()];
  }

  async mergeScoreboardPlayers(body: {
    sourcePlayerId?: string;
    targetPlayerId?: string;
    sourceSquadId?: string;
    targetSquadId?: string;
    removeSource?: boolean;
  }) {
    const sourceSquadId = body.sourceSquadId?.trim();
    const targetSquadId = body.targetSquadId?.trim();
    let sourcePlayerId = body.sourcePlayerId?.trim() || "";
    let targetPlayerId = body.targetPlayerId?.trim() || "";

    if (sourceSquadId && !sourcePlayerId) {
      const sourceSquad = await this.prisma.sbTeamSquad.findUnique({
        where: { id: sourceSquadId },
        select: { playerId: true },
      });
      sourcePlayerId = sourceSquad?.playerId ?? "";
    }

    if (targetSquadId && !targetPlayerId) {
      const targetSquad = await this.prisma.sbTeamSquad.findUnique({
        where: { id: targetSquadId },
        select: { playerId: true },
      });
      targetPlayerId = targetSquad?.playerId ?? "";
    }

    if (!sourcePlayerId || !targetPlayerId) {
      throw new BadRequestException(
        "Select two linked player profiles before merging. Use Edit name first for unlinked squad rows."
      );
    }
    if (sourcePlayerId === targetPlayerId) {
      throw new BadRequestException("Source and target players must be different");
    }

    return this.prisma.$transaction(async (tx) =>
      mergePlayerRecords(tx, {
        sourcePlayerId,
        targetPlayerId,
        removeSource: body.removeSource,
      })
    );
  }

  async updateSquadRow(squadId: string, dto: UpsertScoreboardSquadRowDto) {
    const existing = await this.prisma.sbTeamSquad.findUnique({
      where: { id: squadId },
      include: { team: { include: { competition: true } }, player: true },
    });
    if (!existing) throw new NotFoundException("Squad row not found");

    const displayName = normalizePlayerName(dto.displayName?.trim() ?? "");
    if (!displayName) throw new BadRequestException("displayName is required");
    const normalizedName = playerLookupKey(displayName);
    const nameParts = splitPlayerName(displayName);
    const targetTeamId = dto.teamId ?? existing.teamId;
    let targetCompetitionId = existing.team.competitionId;

    if (dto.teamId && dto.teamId !== existing.teamId) {
      const team = await this.prisma.sbTeam.findUnique({
        where: { id: dto.teamId },
        select: { id: true, name: true, competitionId: true },
      });
      if (!team) throw new NotFoundException("Target team not found");
      targetCompetitionId = team.competitionId;
      if (existing.playerId) {
        const conflict = await this.prisma.sbTeamSquad.findFirst({
          where: {
            id: { not: existing.id },
            playerId: existing.playerId,
            team: { competitionId: targetCompetitionId },
          },
          include: { team: true },
        });
        if (conflict) {
          throw new BadRequestException(
            `${existing.player?.displayName ?? existing.displayName} is already registered for ${normalizeClubName(
              conflict.team.name
            )} in this competition.`
          );
        }
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      let playerId = existing.playerId;
      const matchingPlayer = normalizedName
        ? await tx.player.findUnique({
            where: { normalizedName },
            select: { id: true, displayName: true },
          })
        : null;

      if (matchingPlayer && matchingPlayer.id !== existing.playerId) {
        const conflict = await tx.sbTeamSquad.findFirst({
          where: {
            id: { not: existing.id },
            playerId: matchingPlayer.id,
            team: { competitionId: targetCompetitionId },
          },
          include: { team: true },
        });
        if (conflict) {
          throw new BadRequestException(
            `${matchingPlayer.displayName} is already registered for ${normalizeClubName(
              conflict.team.name
            )} in this competition.`
          );
        }
        playerId = matchingPlayer.id;
      } else if (existing.playerId) {
        await tx.player.update({
          where: { id: existing.playerId },
          data: {
            firstName: nameParts.firstName,
            lastName: nameParts.lastName,
            displayName,
            normalizedName: normalizedName || null,
            ...(dto.position?.trim() ? { positionPrimary: dto.position.trim() } : {}),
          },
        });
      }

      return tx.sbTeamSquad.update({
        where: { id: squadId },
        data: {
          teamId: targetTeamId,
          playerId,
          displayName,
          position: dto.position?.trim() || null,
          shirtNumber: Number.isFinite(dto.shirtNumber) ? dto.shirtNumber : null,
        },
        include: {
          team: { include: { competition: true } },
          player: { select: { id: true, slug: true, displayName: true, positionPrimary: true } },
        },
      });
    });
    this.statsCache = null;
    return {
      squadId: updated.id,
      playerId: updated.playerId,
      slug: updated.player?.slug ?? null,
      displayName: updated.player?.displayName ?? updated.displayName,
      positionPrimary: updated.position ?? updated.player?.positionPrimary ?? null,
      teams: [
        {
          squadId: updated.id,
          teamId: updated.team.id,
          teamName: normalizeClubName(updated.team.name),
          competitionSlug: updated.team.competition.slug,
          competitionName: updated.team.competition.name,
          position: updated.position,
          shirtNumber: updated.shirtNumber,
        },
      ],
    };
  }

  async deleteSquadRow(squadId: string) {
    const existing = await this.prisma.sbTeamSquad.findUnique({
      where: { id: squadId },
      include: { _count: { select: { matchSquadPlayers: true } } },
    });
    if (!existing) throw new NotFoundException("Squad row not found");
    if (existing._count.matchSquadPlayers > 0) {
      await this.prisma.sbMatchSquadPlayer.updateMany({
        where: { squadId },
        data: { squadId: null },
      });
    }
    await this.prisma.sbTeamSquad.delete({ where: { id: squadId } });
    this.statsCache = null;
    return { ok: true };
  }

  async createSquadRow(dto: UpsertScoreboardSquadRowDto) {
    // Validate teamId if provided
    let targetTeamId: string | undefined = undefined;
    if (dto.teamId) {
      const team = await this.prisma.sbTeam.findUnique({
        where: { id: dto.teamId },
        select: { id: true, competitionId: true },
      });
      if (!team) throw new NotFoundException("Team not found");
      targetTeamId = team.id;
    }

    const displayName = normalizePlayerName(dto.displayName?.trim() ?? "");
    if (!displayName) throw new BadRequestException("displayName is required");

    // Find or create player
    const normalizedName = playerLookupKey(displayName);
    let playerId: string | null = null;
    let player: { id: string; displayName: string; normalizedName: string | null } | null = null;

    if (normalizedName) {
      player = await this.prisma.player.findUnique({
        where: { normalizedName },
        select: { id: true, displayName: true, normalizedName: true },
      });
    }

    if (player) {
      playerId = player.id;
    } else {
      // Create new player
      const nameParts = splitPlayerName(displayName);
      const createdPlayer = await this.prisma.player.create({
        data: {
          firstName: nameParts.firstName,
          lastName: nameParts.lastName,
          displayName,
          normalizedName,
          slug: slugify(displayName),
          positionPrimary: dto.position?.trim() ?? '',
          registrationStatus: "approved",
          isPublic: true,
        },
      });
      playerId = createdPlayer.id;
    }

    // Check if player already exists in squad for the same team/competition
    let finalTeamId = targetTeamId;
    let finalCompetitionId: string | undefined = undefined;

    if (finalTeamId) {
      const team = await this.prisma.sbTeam.findUnique({
        where: { id: finalTeamId },
        select: { id: true, competitionId: true },
      });
      if (!team) throw new NotFoundException("Team not found");
      finalCompetitionId = team.competitionId;
    } else {
      // If no team specified, check if player already exists in any squad
      const existingSquad = await this.prisma.sbTeamSquad.findFirst({
        where: {
          playerId,
          // We'll need to get the team to check competition
        },
        include: {
          team: {
            select: {
              id: true,
              competitionId: true,
            },
          },
        },
      });

      if (existingSquad) {
        finalTeamId = existingSquad.teamId;
        finalCompetitionId = existingSquad.team.competitionId;
      }
    }

    // If still no team, throw error
    if (!finalTeamId) {
      throw new BadRequestException("teamId is required when creating a new squad row");
    }

    // Check for duplicate squad entry (same player in same team/competition)
    const duplicateSquad = await this.prisma.sbTeamSquad.findFirst({
      where: {
        playerId,
        teamId: finalTeamId,
        id: { not: undefined }, // Not checking against a specific ID since we're creating
      },
    });

    if (duplicateSquad) {
      throw new BadRequestException(
        `${displayName} is already registered for a team in this competition.`,
      );
    }

    // Create squad row
    const squadRow = await this.prisma.sbTeamSquad.create({
      data: {
        teamId: finalTeamId,
        playerId,
        displayName,
        position: dto.position?.trim() || null,
        shirtNumber: Number.isFinite(dto.shirtNumber) ? dto.shirtNumber : null,
      },
      include: {
        team: {
          include: {
            competition: true,
          },
        },
        player: {
          select: {
            id: true,
            slug: true,
            displayName: true,
            positionPrimary: true,
          },
        },
      },
    });

    this.statsCache = null;

    return {
      squadId: squadRow.id,
      playerId: squadRow.playerId,
      slug: squadRow.player?.slug ?? null,
      displayName: squadRow.player?.displayName ?? squadRow.displayName,
      positionPrimary: squadRow.position ?? squadRow.player?.positionPrimary ?? null,
      teams: [
        {
          squadId: squadRow.id,
          teamId: squadRow.team.id,
          teamName: normalizeClubName(squadRow.team.name),
          competitionSlug: squadRow.team.competition.slug,
          competitionName: squadRow.team.competition.name,
          position: squadRow.position,
          shirtNumber: squadRow.shirtNumber,
        },
      ],
    };
  }

  async listSquads(
    filters?: {
      q?: string;
      teamId?: string;
      competitionId?: string;
      position?: string;
      shirtNumber?: number;
    }
  ) {
    const where: Prisma.SbTeamSquadWhereInput = {};

    if (filters?.q?.trim()) {
      const q = filters.q.trim();
      where.OR = [
        { displayName: { contains: q, mode: "insensitive" } },
        { player: { displayName: { contains: q, mode: "insensitive" } } },
        // The search box is labelled "name or slug", so match the slug too.
        { player: { slug: { contains: q, mode: "insensitive" } } },
      ];
    }

    if (filters?.teamId) {
      where.teamId = filters.teamId;
    }

    if (filters?.competitionId) {
      where.team = {
        competitionId: filters.competitionId,
      };
    }

    if (filters?.position?.trim()) {
      where.position = {
        contains: filters.position.trim(),
        mode: "insensitive",
      };
    }

    // Guard on the value being a real number, not just "not undefined": NaN
    // slips past a `!== undefined` check and Prisma rejects it on an Int column.
    if (typeof filters?.shirtNumber === "number" && Number.isFinite(filters.shirtNumber)) {
      where.shirtNumber = filters.shirtNumber;
    }

    const squadRows = await this.prisma.sbTeamSquad.findMany({
      where,
      include: {
        team: {
          include: {
            competition: true,
          },
        },
        player: true,
      },
      orderBy: [
        { shirtNumber: { sort: "asc", nulls: "last" } },
        { displayName: "asc" },
      ],
    });

    return squadRows.map((row) => ({
      squadId: row.id,
      teamId: row.teamId,
      playerId: row.playerId,
      displayName: row.player?.displayName ?? row.displayName,
      slug: row.player?.slug ?? slugify(row.displayName),
      positionPrimary: row.position ?? row.player?.positionPrimary ?? null,
      shirtNumber: row.shirtNumber,
      team: {
        id: row.team.id,
        name: normalizeClubName(row.team.name),
        slug: row.team.slug,
        competition: {
          id: row.team.competition.id,
          name: row.team.competition.name,
          slug: row.team.competition.slug,
        },
      },
    }));
  }

  async bulkDeleteSquads(squadIds: string[]) {
    if (!squadIds.length) {
      return { deleted: 0 };
    }

    // First, update any match squad players that reference these squad rows
    await this.prisma.sbMatchSquadPlayer.updateMany({
      where: {
        squadId: {
          in: squadIds,
        },
      },
      data: {
        squadId: null,
      },
    });

    // Then delete the squad rows
    const result = await this.prisma.sbTeamSquad.deleteMany({
      where: {
        id: {
          in: squadIds,
        },
      },
    });

    this.statsCache = null;
    return { deleted: result.count };
  }

  async listMatches(competitionId?: string) {
    return this.scoreboard.listMatches({
      competitionId,
      publicOnly: false,
    });
  }

  /**
   * Fixtures for the admin calendar. Deliberately `publicOnly: true` — the
   * calendar is a staff view of the *published* schedule, so drafts and
   * fixtures under an unpublished competition stay out of it.
   */
  async fixturesCalendar(query: {
    from?: Date;
    to?: Date;
    competitionId?: string;
    status?: string;
  }) {
    return this.scoreboard.listMatches({
      from: query.from,
      to: query.to,
      competitionId: query.competitionId,
      status: query.status,
      publicOnly: true,
      order: "asc",
    });
  }

  async supervisorLive() {
    return this.scoreboard.supervisorFeed();
  }

  async createMatch(dto: CreateAdminMatchDto) {
    if (dto.homeTeamId === dto.awayTeamId) {
      throw new BadRequestException("Home and away teams must be different");
    }

    const competition = await this.prisma.sbCompetition.findUnique({
      where: { id: dto.competitionId },
      include: { stages: true },
    });
    if (!competition) throw new NotFoundException("Competition not found");

    const teams = await this.prisma.sbTeam.findMany({
      where: {
        id: { in: [dto.homeTeamId, dto.awayTeamId] },
        competitionId: dto.competitionId,
      },
      select: { id: true, slug: true },
    });
    if (teams.length !== 2) {
      throw new BadRequestException("Both teams must belong to the selected competition");
    }

    const homeTeam = teams.find((t) => t.id === dto.homeTeamId);
    const awayTeam = teams.find((t) => t.id === dto.awayTeamId);
    if (!homeTeam || !awayTeam) {
      throw new BadRequestException("Both teams must belong to the selected competition");
    }

    const kickoffAt = parseWatKickoff(dto.kickoffDate, dto.kickoffTime);
    const venue = dto.venue?.trim() ? dto.venue.trim() : null;
    const leg = dto.leg ?? null;
    const stageKey = dto.stageKey?.trim() || null;
    const stage = stageKey
      ? competition.stages.find((s) => s.key === stageKey)
      : undefined;
    if (stageKey && !stage) {
      throw new BadRequestException(`Unknown stageKey "${stageKey}" for this competition`);
    }

    const roundLabel = deriveRoundLabel(dto.knockoutRound, leg ?? undefined, dto.roundLabel);
    const meta: Prisma.InputJsonValue | undefined =
      dto.knockoutRound || leg
        ? {
            ...(dto.knockoutRound
              ? { knockoutRound: dto.knockoutRound, round: dto.knockoutRound }
              : {}),
            timezone: SCOREBOARD_TIMEZONE,
            ...(leg ? { leg } : {}),
          }
        : undefined;

    const slug = await resolveUniqueMatchSlug(
      this.prisma,
      homeTeam.slug,
      awayTeam.slug,
      { leg }
    );

    try {
      const created = await this.prisma.sbMatch.create({
        data: {
          slug,
          competitionId: dto.competitionId,
          stageId: stage?.id,
          stageKey,
          homeTeamId: dto.homeTeamId,
          awayTeamId: dto.awayTeamId,
          kickoffAt,
          venue,
          roundLabel,
          matchday: dto.matchday ?? null,
          status: dto.status ?? "scheduled",
          meta,
        },
        include: {
          homeTeam: true,
          awayTeam: true,
          competition: true,
          _count: { select: { events: true } },
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
      this.statsCache = null;
      return { ok: true, match: presentScoreboardPayload(created) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException("A match with this slug already exists");
      }
      throw err;
    }
  }

  /**
   * The competition that holds every friendly, created on first use.
   *
   * Made on demand rather than seeded so the feature works the moment it ships,
   * without waiting on a database seed run.
   */
  private async ensureFriendlyCompetition() {
    const existing = await this.prisma.sbCompetition.findUnique({
      where: { slug: FRIENDLY_COMPETITION_SLUG },
    });
    if (existing) return existing;

    return this.prisma.sbCompetition.create({
      data: {
        slug: FRIENDLY_COMPETITION_SLUG,
        name: FRIENDLY_COMPETITION_NAME,
        season: String(new Date().getUTCFullYear()),
        type: "friendly",
        status: "active",
        formatType: FRIENDLY_FORMAT_TYPE,
        formatConfig: { isFriendly: true } as Prisma.InputJsonValue,
        description:
          "One-off fixtures that count toward no league table, including matches between teams from different competitions.",
        isPublished: true,
      },
    });
  }

  /**
   * Create a friendly, tied to no competition of its own.
   *
   * Unlike a league fixture, the two teams need not share a competition — a
   * friendly between a RAK side and a DSL side is the ordinary case, and is
   * exactly what the regular fixture form refuses to create.
   */
  async createFriendlyMatch(dto: CreateFriendlyMatchDto) {
    if (dto.homeTeamId === dto.awayTeamId) {
      throw new BadRequestException("Home and away teams must be different");
    }

    const teams = await this.prisma.sbTeam.findMany({
      where: { id: { in: [dto.homeTeamId, dto.awayTeamId] } },
      select: { id: true, slug: true, name: true },
    });
    const homeTeam = teams.find((t) => t.id === dto.homeTeamId);
    const awayTeam = teams.find((t) => t.id === dto.awayTeamId);
    if (!homeTeam || !awayTeam) {
      throw new BadRequestException("Both teams must exist");
    }

    const competition = await this.ensureFriendlyCompetition();
    const kickoffAt = parseWatKickoff(dto.kickoffDate, dto.kickoffTime);
    const slug = await resolveUniqueMatchSlug(
      this.prisma,
      homeTeam.slug,
      awayTeam.slug,
      {}
    );

    const created = await this.prisma.sbMatch.create({
      data: {
        slug,
        competitionId: competition.id,
        homeTeamId: dto.homeTeamId,
        awayTeamId: dto.awayTeamId,
        kickoffAt,
        venue: dto.venue?.trim() || null,
        roundLabel: dto.roundLabel?.trim() || "Friendly",
        status: "scheduled",
        meta: { friendly: true, timezone: SCOREBOARD_TIMEZONE } as Prisma.InputJsonValue,
      },
      include: {
        homeTeam: true,
        awayTeam: true,
        competition: true,
        _count: { select: { events: true } },
        events: { where: { type: { in: ["goal", "own_goal"] } }, orderBy: { minute: "asc" } },
      },
    });

    this.statsCache = null;
    return { ok: true, match: presentScoreboardPayload(created) };
  }

  patchMatchScore(matchId: string, dto: PatchMatchScoreDto) {
    return this.scoreboard.patchMatchScore(matchId, dto);
  }

  private buildMatchStatsPatch(
    home: MatchStatsSide,
    away: MatchStatsSide,
    source: "manual" | "csv" | "json",
    narrative?: string
  ): Record<string, unknown> {
    if (!hasStatSideValues(home) && !hasStatSideValues(away)) {
      throw new BadRequestException("At least one match statistic is required");
    }

    const patch: Record<string, unknown> = {
      manualStatsMeta: { source, updatedAt: new Date().toISOString() },
    };
    for (const key of MATCH_STAT_KEYS) {
      if (home[key] !== undefined || away[key] !== undefined) {
        patch[key] = { home: home[key] ?? 0, away: away[key] ?? 0 };
      }
    }
    if (narrative !== undefined) patch.narrative = narrative.trim() || null;
    return patch;
  }

  async updateMatchStats(matchId: string, dto: UpdateMatchStatsDto) {
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: {
        homeTeam: true,
        awayTeam: true,
        competition: true,
        _count: { select: { events: true } },
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
    if (!match) throw new NotFoundException("Match not found");

    const home = normalizeStatSide(dto.home, "home");
    const away = normalizeStatSide(dto.away, "away");
    const existingStats =
      match.stats && typeof match.stats === "object" && !Array.isArray(match.stats)
        ? (match.stats as Record<string, unknown>)
        : {};
    const patch = this.buildMatchStatsPatch(
      home,
      away,
      dto.source ?? "manual",
      dto.narrative
    );
    const updated = await this.prisma.sbMatch.update({
      where: { id: matchId },
      data: { stats: { ...existingStats, ...patch } as Prisma.InputJsonValue },
      include: {
        homeTeam: true,
        awayTeam: true,
        competition: true,
        _count: { select: { events: true } },
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
    return { ok: true, match: presentScoreboardPayload(updated) };
  }

  private normalizeCsvTeamName(value: string | undefined) {
    return normalizeClubName(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  private splitCsvMatchLabel(label: string | undefined) {
    const parts = (label ?? "").split(/\s+v(?:s\.?)?\s+/i);
    if (parts.length !== 2) return null;
    return { homeTeam: parts[0].trim(), awayTeam: parts[1].trim() };
  }

  private async resolveStatsCsvMatch(args: {
    matchId?: string;
    matchLabel?: string;
    homeTeam?: string;
    awayTeam?: string;
  }) {
    if (args.matchId) {
      const match = await this.prisma.sbMatch.findUnique({
        where: { id: args.matchId },
        include: { homeTeam: true, awayTeam: true },
      });
      if (!match) throw new NotFoundException(`Match not found: ${args.matchId}`);
      return match;
    }

    const split = this.splitCsvMatchLabel(args.matchLabel);
    const homeTeam = args.homeTeam || split?.homeTeam;
    const awayTeam = args.awayTeam || split?.awayTeam;
    const normalizedHome = this.normalizeCsvTeamName(homeTeam);
    const normalizedAway = this.normalizeCsvTeamName(awayTeam);
    if (!normalizedHome || !normalizedAway) {
      throw csvError(
        "Match stats import",
        'each row needs matchId, match ("Home vs Away"), or homeTeam and awayTeam'
      );
    }

    const candidates = await this.prisma.sbMatch.findMany({
      where: {
        OR: [
          {
            homeTeam: { name: { contains: homeTeam, mode: "insensitive" } },
            awayTeam: { name: { contains: awayTeam, mode: "insensitive" } },
          },
          {
            homeTeam: { name: { contains: awayTeam, mode: "insensitive" } },
            awayTeam: { name: { contains: homeTeam, mode: "insensitive" } },
          },
        ],
      },
      include: { homeTeam: true, awayTeam: true },
      orderBy: [{ kickoffAt: "desc" }, { createdAt: "desc" }],
      take: 10,
    });

    const exact = candidates.filter((match) => {
      const home = this.normalizeCsvTeamName(match.homeTeam.name);
      const away = this.normalizeCsvTeamName(match.awayTeam.name);
      return (
        (home === normalizedHome && away === normalizedAway) ||
        (home === normalizedAway && away === normalizedHome)
      );
    });
    if (exact.length === 0) {
      throw new NotFoundException(`Match not found: ${homeTeam} vs ${awayTeam}`);
    }
    if (exact.length > 1) {
      throw new BadRequestException(
        `Multiple matches found for ${homeTeam} vs ${awayTeam}; use matchId`
      );
    }
    return exact[0];
  }

  private readStatsFromCsvRow(row: string[], header: string[]) {
    const stats: MatchStatsSide = {};
    for (const [alias, key] of Object.entries(MATCH_STAT_ALIASES)) {
      const idx = header.indexOf(alias);
      if (idx < 0) continue;
      const value = parseOptionalStatNumber(row[idx], key);
      if (value !== undefined) stats[key] = value;
    }
    return stats;
  }

  async importMatchStatsCsv(csv: string) {
    const table = parseCsv(csv);
    if (table.length < 2) {
      throw csvError("Match stats import", "file must include a header row and at least one data row");
    }
    const header = table[0].map(normalizedHeader);
    const grouped = new Map<
      string,
      {
        match: Awaited<ReturnType<AdminScoreboardService["resolveStatsCsvMatch"]>>;
        home: MatchStatsSide;
        away: MatchStatsSide;
      }
    >();

    for (const [i, row] of table.slice(1).entries()) {
      const rowNum = i + 2;
      const match = await this.resolveStatsCsvMatch({
        matchId: readCsvCell(row, header, ["matchId", "id"]),
        matchLabel: readCsvCell(row, header, ["match"]),
        homeTeam: readCsvCell(row, header, ["homeTeam", "home"]),
        awayTeam: readCsvCell(row, header, ["awayTeam", "away"]),
      });
      const sideRaw = readCsvCell(row, header, ["side", "teamSide"]);
      const teamRaw = readCsvCell(row, header, ["team", "teamName"]);
      const side =
        sideRaw?.toLowerCase() === "home" || sideRaw?.toLowerCase() === "away"
          ? sideRaw.toLowerCase()
          : this.normalizeCsvTeamName(teamRaw) === this.normalizeCsvTeamName(match.homeTeam.name)
            ? "home"
            : this.normalizeCsvTeamName(teamRaw) === this.normalizeCsvTeamName(match.awayTeam.name)
              ? "away"
              : null;
      if (side !== "home" && side !== "away") {
        throw csvError("Match stats import", `row ${rowNum} needs side or team`);
      }
      const stats = this.readStatsFromCsvRow(row, header);
      if (!hasStatSideValues(stats)) {
        throw csvError("Match stats import", `row ${rowNum} has no statistic values`);
      }
      const current = grouped.get(match.id) ?? { match, home: {}, away: {} };
      current[side] = { ...current[side], ...stats };
      grouped.set(match.id, current);
    }

    let updated = 0;
    for (const [matchId, item] of grouped) {
      await this.updateMatchStats(matchId, {
        home: item.home,
        away: item.away,
        source: "csv",
      });
      updated++;
    }

    return { ok: true, updated, rows: table.length - 1 };
  }

  updateMatch(matchId: string, dto: UpdateMatchDto) {
    return this.scoreboard.updateMatch(matchId, dto);
  }

  async setMatchLiveFeature(
    matchId: string,
    patch: { enabled?: boolean; audioEnabled?: boolean }
  ) {
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        status: true,
        homeScore: true,
        awayScore: true,
        minute: true,
        stats: true,
        competition: { select: { formatType: true } },
        statisticsSheet: { select: { events: true, clock: true } },
      },
    });
    if (!match) throw new NotFoundException("Match not found");

    const existingStats =
      match.stats && typeof match.stats === "object" && !Array.isArray(match.stats)
        ? (match.stats as Record<string, unknown>)
        : {};
    const existingLive =
      existingStats.liveFeature &&
      typeof existingStats.liveFeature === "object" &&
      !Array.isArray(existingStats.liveFeature)
        ? (existingStats.liveFeature as Record<string, unknown>)
        : {};
    const updatedAt = new Date().toISOString();
    const liveEnabled = patch.enabled ?? existingLive.enabled === true;
    const audioEnabled = liveEnabled && (patch.audioEnabled ?? existingLive.audioEnabled === true);
    const stats = {
      ...existingStats,
      liveFeature: {
        ...existingLive,
        enabled: liveEnabled,
        audioEnabled,
        updatedAt,
        ...(patch.audioEnabled !== undefined
          ? {
              audioUpdatedAt: updatedAt,
              ...(audioEnabled ? { audioEnabledAt: updatedAt } : { audioDisabledAt: updatedAt }),
            }
          : {}),
        ...(patch.enabled !== undefined
          ? liveEnabled
            ? { enabledAt: updatedAt }
            : { disabledAt: updatedAt, audioDisabledAt: updatedAt, audioUpdatedAt: updatedAt }
          : {}),
      },
    };

    await this.prisma.sbMatch.update({
      where: { id: matchId },
      data: { stats: stats as Prisma.InputJsonValue },
    });
    if (!liveEnabled || !audioEnabled) this.liveAudio.endPublicStream(matchId);
    if (
      liveEnabled &&
      match.competition.formatType !== "TRAINING_SANDBOX" &&
      readClock(match.statisticsSheet?.clock)?.phase === "finished"
    ) {
      const score = scoreFromEvents(readEvents(match.statisticsSheet?.events));
      await this.prisma.sbMatch.update({
        where: { id: matchId },
        data: {
          homeScore: score.home,
          awayScore: score.away,
          status: "finished",
          minute: match.minute ?? 90,
        },
      });
      if (match.status !== "finished") {
        await this.lifecycle.onMatchFinished(matchId);
      } else if (match.homeScore !== score.home || match.awayScore !== score.away) {
        await this.lifecycle.refreshStandingsForFinishedMatch(matchId);
      }
    }

    return { ok: true, liveFeature: readLiveFeature(stats) };
  }

  async deleteMatch(matchId: string) {
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: { _count: { select: { highlights: true } } },
    });
    if (!match) throw new NotFoundException("Match not found");
    if (match.status === "live" || match.status === "halftime") {
      throw new BadRequestException("Cannot delete a live match");
    }
    await this.prisma.sbHighlight.updateMany({
      where: { matchId },
      data: { matchId: null, eventId: null },
    });
    await this.prisma.sbMatch.delete({ where: { id: matchId } });
    this.statsCache = null;
    return { ok: true };
  }

  ingestSipMetrics(matchId: string) {
    return this.scoreboard.ingestSipMetricsFromMatch(matchId);
  }

  async patchMatchGameday(matchId: string, dto: PatchMatchGamedayDto) {
    const match = await this.prisma.sbMatch.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException("Match not found");

    const data: Prisma.SbMatchUpdateInput = {};

    if (dto.venue !== undefined) {
      const trimmed = dto.venue.trim();
      data.venue = trimmed.length ? trimmed : null;
    }

    if (dto.roundLabel !== undefined) {
      const trimmed = dto.roundLabel.trim();
      data.roundLabel = trimmed.length ? trimmed : null;
    }

    const hasDate = dto.kickoffDate !== undefined;
    const hasTime = dto.kickoffTime !== undefined;
    if (hasDate !== hasTime) {
      throw new BadRequestException("kickoffDate and kickoffTime must be sent together");
    }

    if (dto.kickoffAt !== undefined) {
      if (dto.kickoffAt === null || dto.kickoffAt === "") {
        data.kickoffAt = null;
      } else {
        if (hasDate) {
          throw new BadRequestException(
            "Send either kickoffAt or kickoffDate+kickoffTime, not both"
          );
        }
        data.kickoffAt = parseKickoffAtIso(dto.kickoffAt);
      }
    } else if (hasDate && hasTime) {
      data.kickoffAt = parseWatKickoff(dto.kickoffDate!, dto.kickoffTime!);
    }

    if (!Object.keys(data).length) {
      throw new BadRequestException("No gameday fields to update");
    }

    const updated = await this.prisma.sbMatch.update({
      where: { id: matchId },
      data,
      select: {
        id: true,
        venue: true,
        kickoffAt: true,
        roundLabel: true,
        status: true,
        homeTeam: { select: { id: true, name: true } },
        awayTeam: { select: { id: true, name: true } },
      },
    });

    return {
      ok: true,
      match: {
        id: updated.id,
        venue: updated.venue,
        kickoffAt: updated.kickoffAt?.toISOString() ?? null,
        status: updated.status,
        homeTeam: { id: updated.homeTeam.id, name: updated.homeTeam.name },
        awayTeam: { id: updated.awayTeam.id, name: updated.awayTeam.name },
      },
    };
  }

  async getMatchRoster(matchId: string, teamId: string) {
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: {
        homeTeam: { include: { squad: { include: { player: { select: { id: true, slug: true } } } } } },
        awayTeam: { include: { squad: { include: { player: { select: { id: true, slug: true } } } } } },
      },
    });
    if (!match) throw new NotFoundException("Match not found");
    const team =
      match.homeTeamId === teamId
        ? match.homeTeam
        : match.awayTeamId === teamId
          ? match.awayTeam
          : null;
    if (!team) throw new BadRequestException("Team not in this match");

    const stats = (match.stats ?? {}) as MatchStatsJson;
    const saved = stats.matchdayRosters?.[teamId];

    return {
      matchId,
      teamId,
      directory: team.squad.map((s) => ({
        squadId: s.id,
        displayName: s.displayName,
        position: s.position,
        shirtNumber: s.shirtNumber,
        playerId: s.playerId,
        playerSlug: s.player?.slug ?? (s.playerId ? null : slugify(s.displayName)),
      })),
      roster: saved ?? { teamId, xi: [], subs: [] },
    };
  }

  async saveMatchRoster(matchId: string, payload: MatchdayRosterPayload) {
    if (payload.xi.length > 11) {
      throw new BadRequestException("Starting XI cannot exceed 11 players");
    }
    if (payload.xi.length + payload.subs.length > 20) {
      throw new BadRequestException("Matchday roster cannot exceed 20 players");
    }
    const match = await this.prisma.sbMatch.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException("Match not found");
    if (match.homeTeamId !== payload.teamId && match.awayTeamId !== payload.teamId) {
      throw new BadRequestException("Team not in this match");
    }

    const resolved = await this.resolveRosterPlayerIds(payload);

    const stats = ((match.stats ?? {}) as MatchStatsJson) ?? {};
    const side = sideForTeam(match, payload.teamId);
    const currentFormation = {
      home: match.formationHome ?? stats.spotter?.formation?.home ?? DEFAULT_FORMATION,
      away: match.formationAway ?? stats.spotter?.formation?.away ?? DEFAULT_FORMATION,
    };
    const nextFormation = {
      home: normalizeFormation(currentFormation.home),
      away: normalizeFormation(currentFormation.away),
      [side]: normalizeFormation(currentFormation[side]),
    };
    stats.matchdayRosters = {
      ...(stats.matchdayRosters ?? {}),
      [payload.teamId]: resolved,
    };
    stats.spotter = {
      ...(stats.spotter ?? defaultSpotterState()),
      formation: nextFormation,
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.sbMatch.update({
        where: { id: matchId },
        data: {
          stats: stats as Prisma.InputJsonValue,
          formationHome: nextFormation.home,
          formationAway: nextFormation.away,
        },
      });
      await this.syncMatchSquadPlayers(tx, matchId, payload.teamId, resolved);
    });
    return { ok: true, roster: resolved };
  }

  async uploadMatchSquadCsv(matchId: string, teamId: string, csv: string) {
    const rows = parseMatchSquadCsv(csv);
    if (rows.filter((row) => row.isStarter).length > 11) {
      throw new BadRequestException("CSV cannot contain more than 11 starters.");
    }
    if (rows.length > 30) {
      throw new BadRequestException("CSV cannot contain more than 30 players for one team.");
    }

    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        stats: true,
        homeTeamId: true,
        awayTeamId: true,
        formationHome: true,
        formationAway: true,
      },
    });
    if (!match) throw new NotFoundException("Match not found");
    if (match.homeTeamId !== teamId && match.awayTeamId !== teamId) {
      throw new BadRequestException("Team not in this match");
    }

    const roster = await this.prisma.$transaction(async (tx) => {
      const slots = await Promise.all(
        rows.map(async (row) => {
          const squad = await this.findOrCreateTeamSquadRow(tx, teamId, row);
          return {
            squadId: squad.id,
            displayName: squad.displayName,
            position: squad.position,
            shirtNumber: squad.shirtNumber,
            playerId: squad.playerId,
            playerSlug: null,
            role: row.isStarter ? "xi" : "sub",
          } satisfies MatchdayRosterSlot;
        })
      );

      const resolved: MatchdayRosterPayload = {
        teamId,
        xi: slots.filter((slot) => slot.role === "xi"),
        subs: slots.filter((slot) => slot.role === "sub"),
      };
      const stats = ((match.stats ?? {}) as MatchStatsJson) ?? {};
      const side = sideForTeam(match, teamId);
      const currentFormation = {
        home: match.formationHome ?? stats.spotter?.formation?.home ?? DEFAULT_FORMATION,
        away: match.formationAway ?? stats.spotter?.formation?.away ?? DEFAULT_FORMATION,
      };
      const nextFormation = {
        home: normalizeFormation(currentFormation.home),
        away: normalizeFormation(currentFormation.away),
        [side]: normalizeFormation(currentFormation[side]),
      };
      stats.matchdayRosters = {
        ...(stats.matchdayRosters ?? {}),
        [teamId]: resolved,
      };
      stats.spotter = {
        ...(stats.spotter ?? defaultSpotterState()),
        formation: nextFormation,
      };

      await tx.sbMatch.update({
        where: { id: matchId },
        data: {
          stats: stats as Prisma.InputJsonValue,
          formationHome: nextFormation.home,
          formationAway: nextFormation.away,
        },
      });
      await this.syncMatchSquadPlayers(tx, matchId, teamId, resolved);
      return resolved;
    });

    return {
      ok: true,
      matchId,
      teamId,
      imported: rows.length,
      starters: roster.xi.length,
      bench: roster.subs.length,
    };
  }

  private async findOrCreateTeamSquadRow(
    tx: Prisma.TransactionClient,
    teamId: string,
    row: ParsedMatchSquadCsvRow
  ) {
    const player = await this.findOrCreateCsvSquadPlayer(tx, row);
    const targetTeam = await tx.sbTeam.findUnique({
      where: { id: teamId },
      select: { competitionId: true, name: true },
    });
    if (!targetTeam) throw new NotFoundException("Target team not found");

    const activeSquad = await tx.sbTeamSquad.findFirst({
      where: {
        playerId: player.id,
        team: { competitionId: targetTeam.competitionId },
      },
      include: { team: true },
    });
    if (activeSquad && activeSquad.teamId !== teamId) {
      throw new BadRequestException(
        `${player.displayName} is already registered for ${normalizeClubName(
          activeSquad.team.name
        )} in this competition. Remove that squad row before assigning another team.`
      );
    }
    if (activeSquad) {
      return tx.sbTeamSquad.update({
        where: { id: activeSquad.id },
        data: {
          displayName: row.playerName,
          position: row.position,
          shirtNumber: row.jerseyNumber,
        },
      });
    }
    const existing = await tx.sbTeamSquad.findFirst({
      where: {
        teamId,
        displayName: { equals: row.playerName, mode: "insensitive" },
        ...(row.jerseyNumber == null ? {} : { shirtNumber: row.jerseyNumber }),
      },
    });
    if (existing) {
      if (existing.position !== row.position || existing.shirtNumber !== row.jerseyNumber) {
        return tx.sbTeamSquad.update({
          where: { id: existing.id },
          data: {
            playerId: player.id,
            position: row.position,
            shirtNumber: row.jerseyNumber,
          },
        });
      }
      if (existing.playerId !== player.id) {
        return tx.sbTeamSquad.update({
          where: { id: existing.id },
          data: { playerId: player.id },
        });
      }
      return existing;
    }

    return tx.sbTeamSquad.create({
      data: {
        teamId,
        playerId: player.id,
        displayName: row.playerName,
        position: row.position,
        shirtNumber: row.jerseyNumber,
      },
    });
  }

  private async findOrCreateCsvSquadPlayer(
    tx: Prisma.TransactionClient,
    row: ParsedMatchSquadCsvRow
  ) {
    const displayName = normalizePlayerName(row.playerName);
    const normalizedName = playerLookupKey(displayName);
    const nameParts = splitPlayerName(displayName);
    const existing = await tx.player.findUnique({ where: { normalizedName } });
    const data = {
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
      displayName,
      positionPrimary: row.position || "MF",
      ...(row.dateOfBirth ? { dateOfBirth: row.dateOfBirth } : {}),
      ...(row.imageUrl ? { playerPhotoUrl: row.imageUrl } : {}),
      registrationStatus: "approved",
      isPublic: true,
    };

    if (existing) {
      return tx.player.update({
        where: { id: existing.id },
        data,
      });
    }

    return tx.player.create({
      data: {
        ...data,
        normalizedName,
        slug: await this.resolveUniqueCsvPlayerSlug(tx, displayName),
      },
    });
  }

  private async resolveUniqueCsvPlayerSlug(tx: Prisma.TransactionClient, displayName: string) {
    const base = slugify(displayName) || "player";
    let slug = base;
    let n = 0;
    while (true) {
      const clash = await tx.player.findFirst({ where: { slug }, select: { id: true } });
      if (!clash) return slug;
      n += 1;
      slug = `${base}-${n}`;
    }
  }

  private async syncMatchSquadPlayers(
    tx: Prisma.TransactionClient,
    matchId: string,
    teamId: string,
    roster: MatchdayRosterPayload
  ) {
    const slots = [
      ...roster.xi.map((slot, index) => ({ ...slot, isStarter: true, sortOrder: index })),
      ...roster.subs.map((slot, index) => ({ ...slot, isStarter: false, sortOrder: index })),
    ];
    const squadRows = await tx.sbTeamSquad.findMany({
      where: { id: { in: slots.map((slot) => slot.squadId) } },
      select: {
        id: true,
        playerId: true,
        displayName: true,
        position: true,
        shirtNumber: true,
      },
    });
    const squadById = new Map(squadRows.map((row) => [row.id, row]));

    await tx.sbMatchSquadPlayer.deleteMany({ where: { matchId, teamId } });
    if (!slots.length) return;

    await tx.sbMatchSquadPlayer.createMany({
      data: slots.map((slot) => {
        const squad = squadById.get(slot.squadId);
        return {
          matchId,
          teamId,
          squadId: slot.squadId,
          playerId: slot.playerId ?? squad?.playerId ?? null,
          playerName: slot.displayName || squad?.displayName || "Unknown player",
          jerseyNumber: slot.shirtNumber ?? squad?.shirtNumber ?? null,
          position: slot.position ?? squad?.position ?? null,
          isStarter: slot.isStarter,
          sortOrder: slot.sortOrder,
        };
      }),
    });
  }

  private async resolveRosterPlayerIds(payload: MatchdayRosterPayload) {
    const slots = [...payload.xi, ...payload.subs];
    const squadRows = await this.prisma.sbTeamSquad.findMany({
      where: { id: { in: slots.map((s) => s.squadId) } },
      select: { id: true, playerId: true, position: true, displayName: true },
    });
    const squadById = new Map(squadRows.map((s) => [s.id, s]));

    const linkSlot = async (slot: MatchdayRosterSlot) => {
      if (slot.playerId) return slot;
      const squad = squadById.get(slot.squadId);
      if (squad?.playerId) {
        return { ...slot, playerId: squad.playerId };
      }
      let player;
      try {
        player = await this.playerDirectory.resolveOrCreatePlayer(
          slot.displayName,
          slot.position ?? squad?.position
        );
      } catch (error) {
        /* An unnamed slot stays unnamed. Refusing the whole roster over one would
           be worse than the slot carrying a label and no player -- which is the
           same state every `Unknown` on a timeline is already in. */
        if (error instanceof PlaceholderPlayerNameError) return slot;
        throw error;
      }
      await this.prisma.sbTeamSquad.update({
        where: { id: slot.squadId },
        data: { playerId: player.id },
      });
      return {
        ...slot,
        playerId: player.id,
        playerSlug: player.slug,
      };
    };

    const xi = await Promise.all(payload.xi.map(linkSlot));
    const subs = await Promise.all(payload.subs.map(linkSlot));
    const stripCleanSheets = (slot: MatchdayRosterSlot) => {
      const pos = squadById.get(slot.squadId)?.position ?? slot.position;
      if (!pos || !pos.toUpperCase().includes("GK")) {
        const { cleanSheets: _cs, ...rest } = slot;
        return rest;
      }
      return slot;
    };
    return {
      ...payload,
      xi: xi.map(stripCleanSheets),
      subs: subs.map(stripCleanSheets),
    };
  }

  async getSpotterOps(matchId: string) {
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: {
        homeTeam: { include: { squad: true } },
        awayTeam: { include: { squad: true } },
        events: { orderBy: { minute: "asc" } },
      },
    });
    if (!match) throw new NotFoundException("Match not found");
    const stats = (match.stats ?? {}) as MatchStatsJson;
    const spotter = stats.spotter ?? defaultSpotterState();
    return {
      match: {
        id: match.id,
        status: match.status,
        minute: match.minute,
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        events: match.events,
      },
      ops: {
        lineupsLocked: spotter.lineupsLocked ?? false,
        officialsConfirmed: spotter.officialsConfirmed ?? 0,
        addedTime: spotter.addedTime ?? 0,
        offlineQueueCount: spotter.offlineQueue?.length ?? 0,
        lastUndoAt: null,
        formation: {
          home: normalizeFormation(match.formationHome ?? spotter.formation?.home),
          away: normalizeFormation(match.formationAway ?? spotter.formation?.away),
        },
        pitchSelection: spotter.pitchSelection ?? null,
      } satisfies SpotterOpsState & {
        formation: { home: string; away: string };
        pitchSelection: { teamId: string; squadId: string } | null;
      },
      matchdayRosters: stats.matchdayRosters ?? {},
      rosterReadiness: getRosterReadiness(
        stats,
        match.homeTeamId,
        match.awayTeamId
      ),
    };
  }

  async patchSpotterOps(
    matchId: string,
    patch: Partial<SpotterOpsState> & {
      lockLineups?: boolean;
      pushOfflineEvent?: { type: string; minute: number };
      popOfflineQueue?: boolean;
    }
  ) {
    const match = await this.prisma.sbMatch.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException("Match not found");
    const stats = ((match.stats ?? {}) as MatchStatsJson) ?? {};
    const spotter: SpotterStatsStored = { ...(stats.spotter ?? defaultSpotterState()) };

    if (patch.lockLineups !== undefined) spotter.lineupsLocked = patch.lockLineups;
    if (patch.lineupsLocked !== undefined) spotter.lineupsLocked = patch.lineupsLocked;
    if (patch.officialsConfirmed !== undefined) {
      spotter.officialsConfirmed = Math.min(4, Math.max(0, patch.officialsConfirmed));
    }
    if (patch.addedTime !== undefined) spotter.addedTime = patch.addedTime;
    if ((patch as { formation?: { home?: string; away?: string } }).formation) {
      const formation = (patch as { formation?: { home?: string; away?: string } }).formation;
      spotter.formation = {
        home: normalizeFormation(formation?.home ?? match.formationHome ?? spotter.formation?.home),
        away: normalizeFormation(formation?.away ?? match.formationAway ?? spotter.formation?.away),
      };
    }
    if (patch.pushOfflineEvent) {
      spotter.offlineQueue = [
        ...(spotter.offlineQueue ?? []),
        {
          id: `${Date.now()}`,
          ...patch.pushOfflineEvent,
          at: new Date().toISOString(),
        },
      ];
    }
    if (patch.popOfflineQueue && spotter.offlineQueue?.length) {
      spotter.offlineQueue = spotter.offlineQueue.slice(0, -1);
    }

    stats.spotter = spotter;
    await this.prisma.sbMatch.update({
      where: { id: matchId },
      data: {
        stats: stats as Prisma.InputJsonValue,
        formationHome: normalizeFormation(spotter.formation?.home ?? match.formationHome),
        formationAway: normalizeFormation(spotter.formation?.away ?? match.formationAway),
      },
    });
    return this.getSpotterOps(matchId);
  }

  async createHighlight(body: CreateAdminHighlightDto) {
    const match = await this.prisma.sbMatch.findUnique({ where: { id: body.matchId } });
    if (!match) throw new NotFoundException("Match not found");

    const mediaType = body.type ?? "video";
    const storedUrl = this.resolveHighlightMediaUrl(mediaType, body);

    const detail =
      body.timelineMinute != null ? `minute:${body.timelineMinute}` : undefined;
    const highlight = await this.prisma.sbHighlight.create({
      data: {
        competitionId: match.competitionId,
        matchId: body.matchId,
        eventId: body.eventId,
        title: body.title,
        youtubeUrl: storedUrl,
        mediaType,
        isPublished: false,
      } as Prisma.SbHighlightUncheckedCreateInput,
    });
    if (body.thumbnailUrl && detail) {
      await this.prisma.sbMatch.update({
        where: { id: match.id },
        data: {
          stats: {
            ...((match.stats as object) ?? {}),
            highlightMeta: { [highlight.id]: { thumbnailUrl: body.thumbnailUrl, detail } },
          } as Prisma.InputJsonValue,
        },
      });
    }
    return highlight;
  }

  private highlightInclude = {
    competition: { select: { id: true, name: true, slug: true } },
    match: {
      select: {
        id: true,
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
      },
    },
  } as const;

  async listAdminHighlights() {
    return this.prisma.sbHighlight.findMany({
      orderBy: [{ createdAt: "desc" }],
      include: this.highlightInclude,
    });
  }

  async createLandingHighlight(body: {
    title: string;
    youtubeUrl: string;
    duration: string;
    competitionId: string;
  }) {
    const competition = await this.prisma.sbCompetition.findUnique({
      where: { id: body.competitionId },
    });
    if (!competition) throw new BadRequestException("Competition not found");

    const video = normalizeVideoMediaUrl(body.youtubeUrl);
    return this.prisma.sbHighlight.create({
      data: {
        title: body.title.trim(),
        youtubeUrl: video.embedUrl ?? video.sourceUrl,
        duration: body.duration.trim(),
        competitionId: body.competitionId,
        isPublished: false,
      },
      include: this.highlightInclude,
    });
  }

  async updateHighlight(
    id: string,
    body: {
      title?: string;
      type?: "video" | "photo";
      youtubeUrl?: string;
      imageUrl?: string;
      duration?: string;
      competitionId?: string;
    }
  ) {
    const existing = await this.prisma.sbHighlight.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Highlight not found");

    if (body.competitionId) {
      const competition = await this.prisma.sbCompetition.findUnique({
        where: { id: body.competitionId },
      });
      if (!competition) throw new BadRequestException("Competition not found");
    }

    const existingMediaType =
      (existing as { mediaType?: "video" | "photo" }).mediaType ?? "video";
    const mediaType = body.type ?? existingMediaType;
    const storedUrl =
      body.youtubeUrl || body.imageUrl
        ? this.resolveHighlightMediaUrl(mediaType, body)
        : undefined;

    return this.prisma.sbHighlight.update({
      where: { id },
      data: {
        title: body.title?.trim(),
        youtubeUrl: storedUrl,
        mediaType: body.type,
        duration: body.duration?.trim(),
        competitionId: body.competitionId,
      } as Prisma.SbHighlightUncheckedUpdateInput,
      include: this.highlightInclude,
    });
  }

  private resolveHighlightMediaUrl(
    mediaType: "video" | "photo",
    body: { youtubeUrl?: string; imageUrl?: string }
  ) {
    if (mediaType === "photo") {
      const imageUrl = body.imageUrl?.trim();
      if (!imageUrl || !isAllowedImageMediaUrl(imageUrl)) {
        throw new BadRequestException("A valid image URL is required for photo highlights");
      }
      return imageUrl;
    }

    const videoUrl = body.youtubeUrl?.trim();
    if (!videoUrl) {
      throw new BadRequestException("A valid video URL is required for video highlights");
    }
    const video = normalizeVideoMediaUrl(videoUrl);
    return video.embedUrl ?? video.sourceUrl;
  }

  async setHighlightPublished(id: string, isPublished: boolean) {
    const existing = await this.prisma.sbHighlight.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Highlight not found");

    return this.prisma.sbHighlight.update({
      where: { id },
      data: {
        isPublished,
        publishedAt: isPublished ? new Date() : existing.publishedAt,
      },
      include: this.highlightInclude,
    });
  }

  async deleteHighlight(id: string) {
    const existing = await this.prisma.sbHighlight.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Highlight not found");
    await this.prisma.sbHighlight.delete({ where: { id } });
    return { ok: true };
  }

  exportCompetitionsCsv() {
    return this.exportEntityCsv("competitions");
  }

  exportTeamsCsv(competitionId?: string) {
    return this.exportEntityCsv("teams", competitionId);
  }

  private async exportEntityCsv(kind: "competitions" | "teams", competitionId?: string) {
    if (kind === "competitions") {
      const rows = await this.listCompetitions();
      const header = ["name", "type", "region", "status", "logo", "isFeatured"];
      const lines = [
        header.join(","),
        ...rows.map((r) =>
          [
            r.name,
            r.type,
            r.region ?? "",
            r.status,
            r.logoUrl ?? "",
            r.isFeatured,
          ]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(",")
        ),
      ];
      return lines.join("\n");
    }
    const rows = await this.listTeams({ competitionId });
    const header = ["name", "slug", "region", "competitionSlug", "logo"];
    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [r.name, r.slug, r.region ?? "", r.competition.slug, r.logoUrl ?? ""]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      ),
    ];
    return lines.join("\n");
  }

  async importCompetitionsCsv(csv: string) {
    const table = parseCsv(csv);
    if (table.length < 2) {
      throw csvError("Competition import", "file must include a header row and at least one data row");
    }
    const header = table[0].map((h) => h.toLowerCase());
    const nameIdx = header.indexOf("name");
    const typeIdx = header.indexOf("type");
    const regionIdx = header.indexOf("region");
    const statusIdx = header.indexOf("status");
    const featuredIdx = header.indexOf("isfeatured");
    if (nameIdx < 0) {
      throw csvError("Competition import", 'missing required column "name"');
    }

    let imported = 0;
    for (const row of table.slice(1)) {
      const name = row[nameIdx];
      if (!name) continue;
      const slug = slugify(name);
      const type = typeIdx >= 0 ? row[typeIdx] || "tournament" : "tournament";
      const region = regionIdx >= 0 ? row[regionIdx] : "Nigeria";
      const status = statusIdx >= 0 ? row[statusIdx] : "upcoming";
      const competitionStatus = normalizeCompetitionStatus(status);
      const isFeatured = featuredIdx >= 0 && row[featuredIdx]?.toLowerCase() === "true";
      const isPublished = competitionStatus !== "draft";

      const createData = {
        slug,
        name,
        season: new Date().getFullYear().toString(),
        type,
        status: competitionStatus,
        country: region || "Nigeria",
        isPublished,
        description: isFeatured ? "[featured]" : null,
      } as Prisma.SbCompetitionCreateInput;
      const updateData = {
        name,
        type,
        status: competitionStatus,
        country: region || "Nigeria",
        isPublished,
        description: isFeatured ? "[featured]" : undefined,
      } as Prisma.SbCompetitionUpdateInput;

      await this.prisma.sbCompetition.upsert({
        where: { slug },
        create: createData,
        update: updateData,
      });
      imported++;
    }
    return { imported };
  }

  listCompetitionTemplates() {
    return this.competitionEngine.listTemplates();
  }

  previewCompetitionTemplate(formatType: string) {
    return this.competitionEngine.previewTemplate(formatType as never);
  }

  createCompetitionFromTemplate(input: CreateCompetitionFromTemplateInput) {
    return this.competitionEngine.createFromTemplate(input);
  }

  groupStandings(competitionId: string) {
    return this.competitionEngine.standings(competitionId);
  }

  async listMatchEvents(matchId: string) {
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: {
        events: {
          orderBy: { minute: "asc" },
          include: {
            team: { select: { id: true, name: true } },
            player: { select: { id: true, slug: true, displayName: true } },
            assistPlayer: { select: { id: true, slug: true, displayName: true } },
          },
        },
      },
    });
    if (!match) throw new NotFoundException("Match not found");
    return match.events;
  }

  addMatchEvent(matchId: string, dto: CreateMatchEventDto) {
    return this.scoreboard.addEvent(matchId, dto);
  }

  ingestMatchTimelineCsv(
    matchId: string,
    csv: string,
    replace?: boolean,
    matchComment?: string
  ) {
    return this.scoreboard.ingestMatchTimelineCsv(
      matchId,
      csv,
      replace,
      matchComment
    );
  }

  ingestShortMatchEventsCsv(matchId: string, csv: string) {
    return this.scoreboard.ingestShortMatchEventsCsv(matchId, csv);
  }

  async deleteMatchEvent(matchId: string, eventId: string) {
    const event = await this.prisma.sbMatchEvent.findFirst({
      where: { id: eventId, matchId },
      include: { match: { select: { competitionId: true } } },
    });
    if (!event) throw new NotFoundException("Event not found");
    /* Before the row goes, or the goal it credited stays counted for good.
       Nothing used to do this, and a deleted goal left a phantom behind. */
    await this.lifecycle.reverseMatchEventStats([event], event.match.competitionId);
    await this.prisma.sbMatchEvent.delete({ where: { id: eventId } });
    return { ok: true };
  }

  async exportCompetitionSquad(competitionId: string, format: "json" | "csv" = "json") {
    const comp = await this.prisma.sbCompetition.findUnique({
      where: { id: competitionId },
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
                    normalizedName: true,
                    positionPrimary: true,
                    careerGoals: true,
                    careerAssists: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!comp) throw new NotFoundException("Competition not found");

    const rows = comp.teams.flatMap((team) =>
      team.squad.map((s) => ({
        competitionSlug: comp.slug,
        competitionName: comp.name,
        teamId: team.id,
        teamName: normalizeClubName(team.name),
        teamSlug: team.slug,
        squadId: s.id,
        shirtNumber: s.shirtNumber,
        displayName: s.displayName,
        position: s.position,
        playerId: s.playerId,
        playerSlug: s.player?.slug ?? null,
        normalizedName: s.player?.normalizedName ?? null,
        careerGoals: s.player?.careerGoals ?? 0,
        careerAssists: s.player?.careerAssists ?? 0,
      }))
    );

    if (format === "json") {
      return { format: "json", competitionId, rows };
    }

    const header = [
      "competitionSlug",
      "teamSlug",
      "shirtNumber",
      "displayName",
      "position",
      "playerId",
      "playerSlug",
      "normalizedName",
    ];
    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [
          r.competitionSlug,
          r.teamSlug,
          r.shirtNumber ?? "",
          r.displayName,
          r.position ?? "",
          r.playerId ?? "",
          r.playerSlug ?? "",
          r.normalizedName ?? "",
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",")
      ),
    ];
    return { format: "csv", competitionId, csv: lines.join("\n") };
  }

  /**
   * Imports a team's squad list from CSV.
   *
   * Validates every row before writing anything: a bad shirt number, a missing
   * name, a player listed twice, or a player already registered to another team
   * in the competition rejects the whole file with row numbers, and no rows are
   * written. The previous version wrote row by row and threw mid-loop, so a
   * failure at row 12 left rows 1-11 committed behind an error message.
   *
   * Duplicate shirt numbers are reported as warnings rather than rejected: they
   * are usually a data-entry slip the operator wants to see, not a reason to
   * refuse an otherwise good squad.
   */
  async importSquadCsv(teamId: string, csv: string) {
    const team = await this.prisma.sbTeam.findUnique({
      where: { id: teamId },
      include: { competition: true },
    });
    if (!team) throw new NotFoundException("Team not found");

    const table = parseCsv(csv);
    if (table.length < 2) {
      throw csvError("Squad import", "file must include a header row and at least one data row");
    }
    const header = table[0].map(normalizedHeader);
    const nameAliases = SQUAD_CSV_COLUMNS.name.map(normalizedHeader);
    if (!nameAliases.some((alias) => header.includes(alias))) {
      throw csvError(
        "Squad import",
        `missing a player name column (one of: ${SQUAD_CSV_COLUMNS.name.join(", ")})`
      );
    }
    const dataRows = table.slice(1);
    if (dataRows.length > SQUAD_CSV_MAX_ROWS) {
      throw csvError(
        "Squad import",
        `a squad file can hold at most ${SQUAD_CSV_MAX_ROWS} players (got ${dataRows.length})`
      );
    }

    type SquadCsvRow = {
      line: number;
      displayName: string;
      key: string;
      position: string | null;
      shirtNumber: number | null;
    };
    const rows: SquadCsvRow[] = [];
    const errors: string[] = [];
    const firstLineByKey = new Map<string, number>();

    dataRows.forEach((cells, index) => {
      // +2: one for the header row, one because spreadsheets number from 1.
      const line = index + 2;
      const displayName = normalizePlayerName(
        readCsvCell(cells, header, SQUAD_CSV_COLUMNS.name) ?? ""
      );
      const key = playerLookupKey(displayName);
      if (!key) {
        errors.push(`row ${line}: player name is empty`);
        return;
      }
      const seenAt = firstLineByKey.get(key);
      if (seenAt !== undefined) {
        errors.push(`row ${line}: ${displayName} is already listed on row ${seenAt}`);
        return;
      }
      firstLineByKey.set(key, line);

      const rawShirt = (readCsvCell(cells, header, SQUAD_CSV_COLUMNS.shirtNumber) ?? "").trim();
      let shirtNumber: number | null = null;
      if (rawShirt) {
        const parsed = Number(rawShirt);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 999) {
          errors.push(`row ${line}: shirt number "${rawShirt}" must be a whole number from 0 to 999`);
          return;
        }
        shirtNumber = parsed;
      }
      const position =
        (readCsvCell(cells, header, SQUAD_CSV_COLUMNS.position) ?? "").trim() || null;
      rows.push({ line, displayName, key, position, shirtNumber });
    });

    if (!rows.length && !errors.length) {
      throw csvError("Squad import", "no player rows found");
    }

    // Read-only conflict check for players who already exist.
    const knownPlayers = await this.prisma.player.findMany({
      where: { normalizedName: { in: rows.map((row) => row.key) } },
      select: { id: true, normalizedName: true },
    });
    const lineByKnownPlayer = new Map(
      knownPlayers.map((player) => [player.id, firstLineByKey.get(player.normalizedName ?? "")])
    );
    const conflicts = await this.findSquadConflicts(
      knownPlayers.map((player) => player.id),
      team.competitionId,
      teamId
    );
    errors.push(...conflicts.map((conflict) => describeSquadConflict(conflict, lineByKnownPlayer)));

    if (errors.length) throw squadImportRejected(errors);

    // Resolve (or create draft) players. Idempotent, so safe outside the
    // transaction: a later failure leaves at most reusable draft players.
    const resolved: Array<SquadCsvRow & { playerId: string }> = [];
    const placeholderRows: string[] = [];
    for (const row of rows) {
      try {
        const player = await this.playerDirectory.resolveOrCreatePlayer(
          row.displayName,
          row.position
        );
        resolved.push({ ...row, playerId: player.id });
      } catch (error) {
        /* A squad list naming somebody `Unknown` is bad data, and the import
           already knows how to report a bad row. Better here than a phantom in
           the scoring charts a season later. */
        if (error instanceof PlaceholderPlayerNameError) {
          placeholderRows.push(`line ${row.line}: ${error.message}`);
          continue;
        }
        throw error;
      }
    }
    if (placeholderRows.length) throw squadImportRejected(placeholderRows);

    // Re-check now that every player has an id: resolveOrCreatePlayer also
    // matches legacy rows by display name, which the key lookup above cannot.
    const lineByResolved = new Map(resolved.map((row) => [row.playerId, row.line]));
    const lateConflicts = await this.findSquadConflicts(
      resolved.map((row) => row.playerId),
      team.competitionId,
      teamId
    );
    if (lateConflicts.length) {
      throw squadImportRejected(
        lateConflicts.map((conflict) => describeSquadConflict(conflict, lineByResolved))
      );
    }

    const warnings: string[] = [];
    const lineByShirt = new Map<number, number>();
    for (const row of resolved) {
      if (row.shirtNumber === null) continue;
      const other = lineByShirt.get(row.shirtNumber);
      if (other !== undefined) {
        warnings.push(`shirt #${row.shirtNumber} is used on rows ${other} and ${row.line}`);
      } else {
        lineByShirt.set(row.shirtNumber, row.line);
      }
    }

    let created = 0;
    let updated = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const row of resolved) {
        const existing =
          (await tx.sbTeamSquad.findFirst({ where: { teamId, playerId: row.playerId } })) ??
          (await tx.sbTeamSquad.findFirst({
            where: { teamId, displayName: { equals: row.displayName, mode: "insensitive" } },
          }));
        if (existing) {
          await tx.sbTeamSquad.update({
            where: { id: existing.id },
            data: {
              playerId: row.playerId,
              // A blank cell keeps what is already recorded rather than wiping it.
              position: row.position ?? existing.position,
              shirtNumber: row.shirtNumber ?? existing.shirtNumber,
            },
          });
          updated++;
        } else {
          await tx.sbTeamSquad.create({
            data: {
              teamId,
              playerId: row.playerId,
              displayName: row.displayName,
              position: row.position,
              shirtNumber: row.shirtNumber,
            },
          });
          created++;
        }
      }
    });

    this.statsCache = null;

    /* The numbers this upload just brought in are what the timeline has been waiting
       for. Events recorded as `No. 7` with nobody attached can now name a person, so
       they are resolved here rather than leaving it to somebody to remember a script.

       Scoped to this team's own season: `SbTeam` is per-competition, so a team row
       already implies one season, and a shirt number uploaded today does not describe
       who wore it two seasons ago.

       Inside a try, because a CSV import must not fail over this. The squad rows are
       already written and correct; an unresolved timeline is what
       `db:sync:timeline-squad-numbers` is for. */
    let timelineEventsResolved = 0;
    try {
      const matches = await this.prisma.sbMatch.findMany({
        where: {
          status: "finished",
          OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
          competition: { season: team.competition.season },
        },
        select: {
          id: true,
          homeTeamId: true,
          awayTeamId: true,
          homeTeam: { select: { name: true } },
          awayTeam: { select: { name: true } },
        },
      });
      const plan = await planTimelineNumberFixes(
        this.prisma as never,
        matches.map((m) => ({
          id: m.id,
          homeTeamId: m.homeTeamId,
          awayTeamId: m.awayTeamId,
          label: `${m.homeTeam.name} v ${m.awayTeam.name}`,
        }))
      );
      /* Only the fill-ins. A re-attribution moves somebody's goal to somebody else and
         is not something a CSV upload should do quietly -- those stay for
         `db:sync:timeline-squad-numbers`, where they are listed and read first. */
      const fills = plan.fixes.filter((fix) => !fix.reattribution);
      const applied = await applyTimelineNumberFixes(this.prisma as never, fills);
      timelineEventsResolved = applied.written;
    } catch {
      /* Left at zero. The import itself stands. */
    }

    return {
      imported: created + updated,
      created,
      updated,
      warnings,
      teamId,
      competitionId: team.competitionId,
      /**
       * Timeline events whose shirt number now names a player.
       *
       * Reported so an operator can see the upload did more than add squad rows. The
       * goals behind these still need crediting: `db:repair:player-stats` does that,
       * and it is deliberately not done inside an HTTP upload.
       */
      timelineEventsResolved,
    };
  }

  /** Squad rows placing any of these players in another team of the competition. */
  private findSquadConflicts(playerIds: string[], competitionId: string, teamId: string) {
    if (!playerIds.length) return Promise.resolve([]);
    return this.prisma.sbTeamSquad.findMany({
      where: {
        playerId: { in: playerIds },
        teamId: { not: teamId },
        team: { competitionId },
      },
      include: { team: true },
    });
  }

  async importTeamsCsv(csv: string, competitionId: string) {
    const comp = await this.prisma.sbCompetition.findUnique({ where: { id: competitionId } });
    if (!comp) throw new NotFoundException("Competition not found");
    const table = parseCsv(csv);
    if (table.length < 2) {
      throw csvError("Team import", "file must include a header row and at least one data row");
    }
    const header = table[0].map((h) => h.toLowerCase());
    const nameIdx = header.indexOf("name");
    if (nameIdx < 0) {
      throw csvError("Team import", 'missing required column "name"');
    }
    const slugIdx = header.indexOf("slug");
    const regionIdx = header.indexOf("region");
    const logoIdx = header.indexOf("logo");

    let imported = 0;
    const importedIds: string[] = [];
    for (const row of table.slice(1)) {
      const rawName = row[nameIdx];
      if (!rawName) continue;
      const name = normalizeClubName(rawName);
      const slug = slugIdx >= 0 && row[slugIdx] ? row[slugIdx] : slugify(name);
      const upserted = await this.prisma.sbTeam.upsert({
        where: { competitionId_slug: { competitionId, slug } },
        create: {
          competitionId,
          slug,
          name,
          city: regionIdx >= 0 ? row[regionIdx] : null,
          logoUrl: logoIdx >= 0 ? row[logoIdx] : null,
        },
        update: {
          name,
          city: regionIdx >= 0 ? row[regionIdx] : undefined,
          logoUrl: logoIdx >= 0 ? row[logoIdx] : undefined,
        },
        select: { id: true },
      });
      importedIds.push(upserted.id);
      imported++;
    }
    // One pass for the whole file rather than a club lookup per row.
    await linkTeamsToClubsQuietly(this.prisma, importedIds);
    return { imported };
  }
}
