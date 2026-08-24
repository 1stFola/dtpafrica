import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { AdminAuthContext } from "./auth/admin-auth.types";
import { hasPermission } from "./auth/admin-auth.types";
import {
  generateEventComments,
  type RecordedEventInput,
} from "./match-event-comments";

export type SheetStatus = "live" | "submitted" | "approved";

/**
 * The stat vocabulary the console records.
 *
 * Keys deliberately match the ones already stored in SbMatch.stats, so an
 * approved sheet publishes into the shape the public Statistics tab reads
 * without any translation layer.
 *
 * `split` marks the stats worth keeping a half-by-half breakdown for. Cards,
 * saves and penalties are recorded as match totals — splitting them adds taps
 * pitch-side without answering a question anyone asks later.
 */
export const MATCH_STAT_DEFS = [
  { key: "shotsOnTarget", label: "Shots on target", split: true },
  { key: "shotsOffTarget", label: "Shots off target", split: true },
  { key: "corners", label: "Corners", split: true },
  { key: "fouls", label: "Fouls committed", split: true },
  { key: "offsides", label: "Offsides", split: true },
  { key: "yellowCards", label: "Yellow cards", split: false },
  { key: "redCards", label: "Red cards", split: false },
  { key: "saves", label: "Goalkeeper saves", split: false },
  { key: "penaltiesAwarded", label: "Penalties awarded", split: false },
] as const;

export const HALVES = ["1st", "2nd"] as const;
type Half = (typeof HALVES)[number];
type Side = "home" | "away";

const STAT_BY_KEY = new Map(MATCH_STAT_DEFS.map((d) => [d.key as string, d]));

type SidePair = { home: number; away: number };
type SplitTally = Record<Half, SidePair>;
type Tallies = Record<string, SidePair | SplitTally>;

const RECORD_PERMISSION = "scoreboard.stats.record";
const APPROVE_PERMISSION = "scoreboard.stats.approve";

/**
 * Event types the console offers, alphabetical — that is the order they are
 * laid out on the tap grid, so a recorder always finds one in the same place.
 */
export const MATCH_EVENT_TYPES = [
  "assist",
  "clearance",
  "corner_kick",
  "cross",
  "dribble",
  "freekick",
  "goal",
  "goal_line_clearance",
  "goal_penalty",
  "goalkeeper_claim",
  "goalkeeper_command",
  "goalkeeper_distribution",
  "goalkeeper_intervention",
  "interception",
  "long_throw",
  "midfield_battle",
  "missed_chance",
  "offside",
  "one_on_one",
  "own_goal",
  "penalty_saved",
  "penalty_shootout",
  "recovery_tackle",
  "save",
  "shot_off_target",
  "sustained_pressure",
  "volley_missed",
  "woodwork",
] as const;

const EVENT_TYPE_SET = new Set<string>(MATCH_EVENT_TYPES);

/** Event types that put a goal on the board for the side that logged them. */
const SCORING_TYPES = new Set(["goal", "goal_penalty"]);

/**
 * The score, derived from the recorder's own goal events.
 *
 * The recorder is the source of truth for what happened on the pitch, so the
 * scoreline follows the log rather than being typed separately — there is then
 * no way for the two to disagree. An own goal counts for the opposition.
 */
export function scoreFromEvents(events: RecordedEvent[]): { home: number; away: number } {
  let home = 0;
  let away = 0;
  for (const event of events) {
    const scoringSide =
      event.type === "own_goal"
        ? event.side === "home"
          ? "away"
          : "home"
        : SCORING_TYPES.has(event.type)
          ? event.side
          : null;
    if (scoringSide === "home") home += 1;
    else if (scoringSide === "away") away += 1;
  }
  return { home, away };
}

export type RecordedEvent = {
  id: string;
  type: string;
  minute: number;
  addedMinute: number | null;
  side: "home" | "away";
  playerNumber: number | null;
  half: 1 | 2;
};

/**
 * Match clock. Deliberately stores wall-clock anchors, not an elapsed count:
 * the console derives running time from them, so the clock keeps ticking
 * across tab switches and survives a reload or the phone locking.
 */
export type ClockPhase =
  | "pre_kickoff"
  | "running"
  | "awaiting_added"
  | "added_running"
  | "awaiting_second_half"
  | "finished";

export type ClockState = {
  halfLength: number;
  half: 1 | 2;
  phase: ClockPhase;
  addedFirst: number | null;
  addedSecond: number | null;
  firstHalfStartedAt: string | null;
  secondHalfStartedAt: string | null;
};

/** Kit colours the recorder picked for each side today. */
export type KitColours = { home: string; away: string };

function readEvents(input: unknown): RecordedEvent[] {
  if (!Array.isArray(input)) return [];
  const out: RecordedEvent[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const type = typeof e.type === "string" ? e.type : "";
    if (!EVENT_TYPE_SET.has(type)) continue;
    const minute = typeof e.minute === "number" && Number.isFinite(e.minute)
      ? Math.max(0, Math.floor(e.minute))
      : 0;
    const added =
      typeof e.addedMinute === "number" && Number.isFinite(e.addedMinute) && e.addedMinute > 0
        ? Math.floor(e.addedMinute)
        : null;
    const number =
      typeof e.playerNumber === "number" && Number.isFinite(e.playerNumber) && e.playerNumber > 0
        ? Math.floor(e.playerNumber)
        : null;
    out.push({
      id: typeof e.id === "string" && e.id ? e.id : `${type}-${minute}-${out.length}`,
      type,
      minute,
      addedMinute: added,
      side: e.side === "away" ? "away" : "home",
      playerNumber: number,
      half: e.half === 2 ? 2 : 1,
    });
  }
  return out;
}

const CLOCK_PHASES = new Set<string>([
  "pre_kickoff",
  "running",
  "awaiting_added",
  "added_running",
  "awaiting_second_half",
  "finished",
]);

function readClock(input: unknown): ClockState | null {
  if (!input || typeof input !== "object") return null;
  const c = input as Record<string, unknown>;
  const halfLength =
    typeof c.halfLength === "number" && c.halfLength > 0 ? Math.floor(c.halfLength) : 45;
  const phase =
    typeof c.phase === "string" && CLOCK_PHASES.has(c.phase)
      ? (c.phase as ClockPhase)
      : "pre_kickoff";
  return {
    halfLength,
    half: c.half === 2 ? 2 : 1,
    phase,
    addedFirst: typeof c.addedFirst === "number" ? Math.max(0, Math.floor(c.addedFirst)) : null,
    addedSecond: typeof c.addedSecond === "number" ? Math.max(0, Math.floor(c.addedSecond)) : null,
    firstHalfStartedAt: readAnchor(c.firstHalfStartedAt),
    secondHalfStartedAt: readAnchor(c.secondHalfStartedAt),
  };
}

/**
 * Clock anchors must be real timestamps: the console derives the running
 * minute from them, so an unparseable value would silently freeze the clock.
 */
function readAnchor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function readKits(input: unknown): KitColours | null {
  if (!input || typeof input !== "object") return null;
  const k = input as Record<string, unknown>;
  const pick = (v: unknown, fallback: string) =>
    typeof v === "string" && HEX.test(v) ? v : fallback;
  return { home: pick(k.home, "#4c9ffe"), away: pick(k.away, "#f5a524") };
}

function emptyPair(): SidePair {
  return { home: 0, away: 0 };
}

/** A sheet always carries every stat, so the console never sees holes. */
export function emptyTallies(): Tallies {
  const out: Tallies = {};
  for (const def of MATCH_STAT_DEFS) {
    out[def.key] = def.split
      ? { "1st": emptyPair(), "2nd": emptyPair() }
      : emptyPair();
  }
  return out;
}

function readCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  // Counts only: a negative or fractional tally is a client bug, not data.
  return Math.max(0, Math.floor(value));
}

function readPair(value: unknown): SidePair {
  if (!value || typeof value !== "object") return emptyPair();
  const raw = value as Record<string, unknown>;
  return { home: readCount(raw.home), away: readCount(raw.away) };
}

/**
 * Normalise whatever the client sent into the canonical shape. Unknown keys are
 * dropped rather than rejected so a newer console cannot wedge an older API.
 */
export function normaliseTallies(input: unknown): Tallies {
  const out = emptyTallies();
  if (!input || typeof input !== "object") return out;
  const raw = input as Record<string, unknown>;

  for (const def of MATCH_STAT_DEFS) {
    const value = raw[def.key];
    if (value === undefined) continue;
    if (def.split) {
      const source = (value ?? {}) as Record<string, unknown>;
      out[def.key] = {
        "1st": readPair(source["1st"]),
        "2nd": readPair(source["2nd"]),
      };
    } else {
      out[def.key] = readPair(value);
    }
  }
  return out;
}

/**
 * Collapse the half split into the totals the public site displays.
 *
 * Total shots is derived rather than tapped: it is on-target plus off-target by
 * definition, so counting it separately only creates a figure that can disagree
 * with its own parts. Blocked shots are recorded as off-target.
 */
export function totalsFor(tallies: Tallies): Record<string, SidePair> {
  const out: Record<string, SidePair> = {};
  for (const def of MATCH_STAT_DEFS) {
    const value = tallies[def.key];
    if (def.split) {
      const split = value as SplitTally;
      out[def.key] = {
        home: (split?.["1st"]?.home ?? 0) + (split?.["2nd"]?.home ?? 0),
        away: (split?.["1st"]?.away ?? 0) + (split?.["2nd"]?.away ?? 0),
      };
    } else {
      out[def.key] = readPair(value);
    }
  }

  const on = out.shotsOnTarget ?? { home: 0, away: 0 };
  const off = out.shotsOffTarget ?? { home: 0, away: 0 };
  out.shots = { home: on.home + off.home, away: on.away + off.away };

  return out;
}

export type SheetSection = "stats" | "events";

/**
 * Column names per track. Statistics keeps the original unprefixed columns;
 * events mirrors them. Keeping both queryable (rather than one JSON blob) is
 * what lets the supervisor queue find each section independently.
 */
const SECTION_COLUMNS = {
  stats: {
    status: "status",
    submittedById: "submittedById",
    submittedByName: "submittedByName",
    submittedAt: "submittedAt",
    approvedById: "approvedById",
    approvedByName: "approvedByName",
    approvedAt: "approvedAt",
    sentBackById: "sentBackById",
    sentBackByName: "sentBackByName",
    sentBackAt: "sentBackAt",
    sentBackNote: "sentBackNote",
  },
  events: {
    status: "eventsStatus",
    submittedById: "eventsSubmittedById",
    submittedByName: "eventsSubmittedByName",
    submittedAt: "eventsSubmittedAt",
    approvedById: "eventsApprovedById",
    approvedByName: "eventsApprovedByName",
    approvedAt: "eventsApprovedAt",
    sentBackById: "eventsSentBackById",
    sentBackByName: "eventsSentBackByName",
    sentBackAt: "eventsSentBackAt",
    sentBackNote: "eventsSentBackNote",
  },
} as const;

const SECTION_LABEL: Record<SheetSection, string> = {
  stats: "statistics",
  events: "event log",
};

type SheetRow = Record<string, unknown>;

function sectionStatus(sheet: SheetRow | null, section: SheetSection): SheetStatus {
  const value = sheet?.[SECTION_COLUMNS[section].status];
  return (typeof value === "string" ? value : "live") as SheetStatus;
}

function actorName(ctx: AdminAuthContext): string {
  return ctx.displayName || ctx.email || ctx.roleName || "Admin";
}

@Injectable()
export class AdminMatchStatsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService
  ) {}

  private assertCanRecord(ctx: AdminAuthContext) {
    if (!hasPermission(ctx, RECORD_PERMISSION)) {
      throw new ForbiddenException("You cannot record match statistics");
    }
  }

  private assertCanApprove(ctx: AdminAuthContext) {
    if (!hasPermission(ctx, APPROVE_PERMISSION)) {
      throw new ForbiddenException("You cannot approve match statistics");
    }
  }

  private async loadMatch(matchId: string, ctx: AdminAuthContext) {
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: { homeTeam: true, awayTeam: true, competition: true },
    });
    if (!match) throw new NotFoundException("Match not found");
    /* A scoped recorder must not reach a fixture outside their competition,
       even by typing the match id straight into the URL. */
    if (ctx.competitionId && match.competitionId !== ctx.competitionId) {
      throw new ForbiddenException("This match is outside the competition you are assigned to");
    }
    return match;
  }

  /**
   * Fixtures a recorder may open a sheet for. Scoped recorders see only their
   * own competition; an unscoped account sees everything published.
   *
   * This exists so recorders never need `scoreboard.read` — that permission
   * also unlocks the Fixtures and ScoreBoard Operations views, which
   * contractors should not have.
   */
  async listFixtures(ctx: AdminAuthContext, range: { from?: Date; to?: Date }) {
    if (!hasPermission(ctx, RECORD_PERMISSION) && !hasPermission(ctx, APPROVE_PERMISSION)) {
      throw new ForbiddenException("You cannot view match statistics fixtures");
    }

    const matches = await this.prisma.sbMatch.findMany({
      where: {
        isPublished: true,
        competition: { isPublished: true },
        ...(ctx.competitionId ? { competitionId: ctx.competitionId } : {}),
        ...(range.from || range.to
          ? {
              kickoffAt: {
                ...(range.from ? { gte: range.from } : {}),
                ...(range.to ? { lte: range.to } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ kickoffAt: "desc" }],
      take: 200,
      include: {
        homeTeam: true,
        awayTeam: true,
        competition: true,
        statisticsSheet: { select: { status: true, recorderName: true } },
      },
    });

    return matches.map((match) => ({
      id: match.id,
      kickoffAt: match.kickoffAt,
      venue: match.venue,
      roundLabel: match.roundLabel,
      status: match.status,
      sheetStatus: (match.statisticsSheet?.status ?? null) as SheetStatus | null,
      recorderName: match.statisticsSheet?.recorderName ?? null,
      homeTeam: { name: match.homeTeam.name, logoUrl: match.homeTeam.logoUrl },
      awayTeam: { name: match.awayTeam.name, logoUrl: match.awayTeam.logoUrl },
      competition: { id: match.competition.id, name: match.competition.name, logoUrl: match.competition.logoUrl },
    }));
  }

  /**
   * Open the console for a fixture. The first recorder to open an un-owned
   * sheet claims it; everyone else can still read it.
   */
  async openSheet(matchId: string, ctx: AdminAuthContext) {
    const match = await this.loadMatch(matchId, ctx);
    const existing = await this.prisma.sbMatchStatistics.findUnique({
      where: { matchId },
    });

    let sheet = existing;
    if (!sheet && hasPermission(ctx, RECORD_PERMISSION)) {
      sheet = await this.prisma.sbMatchStatistics.create({
        data: {
          matchId,
          status: "live",
          tallies: emptyTallies() as Prisma.InputJsonValue,
          recorderId: ctx.userId ?? null,
          recorderName: ctx.userId ? actorName(ctx) : null,
        },
      });
    } else if (
      sheet &&
      !sheet.recorderId &&
      sheet.status === "live" &&
      ctx.userId &&
      hasPermission(ctx, RECORD_PERMISSION)
    ) {
      sheet = await this.prisma.sbMatchStatistics.update({
        where: { matchId },
        data: { recorderId: ctx.userId, recorderName: actorName(ctx) },
      });
    }

    return this.present(match, sheet, ctx);
  }

  /**
   * Recorders keep their own sheet. Deliberately still writable while
   * `submitted`: a recorder who spots a mis-tap after submitting must be able
   * to fix it without a supervisor round-trip. Approval is the lock.
   */
  async saveTallies(
    matchId: string,
    talliesInput: unknown,
    ctx: AdminAuthContext,
    extras?: { events?: unknown; clock?: unknown; kits?: unknown }
  ) {
    this.assertCanRecord(ctx);
    const match = await this.loadMatch(matchId, ctx);
    const sheet = await this.requireSheet(matchId);

    this.assertOwnsSheet(sheet, ctx);

    /* Sections lock independently: an approved stat sheet stops accepting
       tallies while the event log is still being tidied, and vice versa. */
    const statsLocked = sectionStatus(sheet, "stats") === "approved";
    const eventsLocked = sectionStatus(sheet, "events") === "approved";
    if (statsLocked && eventsLocked) {
      throw new BadRequestException(
        "This sheet is approved. Ask a supervisor to send it back before editing."
      );
    }

    const updated = await this.prisma.sbMatchStatistics.update({
      where: { matchId },
      data: {
        ...(statsLocked
          ? {}
          : { tallies: normaliseTallies(talliesInput) as Prisma.InputJsonValue }),
        ...(extras?.events !== undefined && !eventsLocked
          ? { events: readEvents(extras.events) as unknown as Prisma.InputJsonValue }
          : {}),
        ...(extras?.clock !== undefined
          ? { clock: (readClock(extras.clock) ?? undefined) as Prisma.InputJsonValue }
          : {}),
        ...(extras?.kits !== undefined
          ? { kits: (readKits(extras.kits) ?? undefined) as Prisma.InputJsonValue }
          : {}),
      },
    });
    return this.present(match, updated, ctx);
  }

  async submit(matchId: string, section: SheetSection, ctx: AdminAuthContext) {
    this.assertCanRecord(ctx);
    const match = await this.loadMatch(matchId, ctx);
    const sheet = await this.requireSheet(matchId);
    const col = SECTION_COLUMNS[section];

    if (sectionStatus(sheet, section) === "approved") {
      throw new BadRequestException(
        `The ${SECTION_LABEL[section]} has already been approved`
      );
    }
    this.assertOwnsSheet(sheet, ctx);

    const updated = await this.prisma.sbMatchStatistics.update({
      where: { matchId },
      data: {
        [col.status]: "submitted",
        [col.submittedById]: ctx.userId ?? null,
        [col.submittedByName]: actorName(ctx),
        [col.submittedAt]: new Date(),
        // A fresh submission clears the previous send-back note.
        [col.sentBackNote]: null,
      } as Prisma.SbMatchStatisticsUpdateInput,
    });
    return this.present(match, updated, ctx);
  }

  /**
   * Approving is the only thing that publishes figures to the public site.
   * Totals are merged into SbMatch.stats so sibling keys the console does not
   * own — spotter data, matchday rosters, possession, goals — survive intact.
   */
  async approve(matchId: string, section: SheetSection, ctx: AdminAuthContext) {
    this.assertCanApprove(ctx);
    const match = await this.loadMatch(matchId, ctx);
    const sheet = await this.requireSheet(matchId);
    const col = SECTION_COLUMNS[section];
    const current = sectionStatus(sheet, section);

    if (current !== "submitted") {
      throw new BadRequestException(
        current === "approved"
          ? `The ${SECTION_LABEL[section]} has already been approved`
          : `Only a submitted ${SECTION_LABEL[section]} can be approved`
      );
    }

    /* Separation of duty: holding both permissions must not let someone
       rubber-stamp a sheet they tallied themselves. Super admins and the API
       key are exempt so a one-person ops team is never locked out. */
    const isSuperAdmin = ctx.method === "api_key" || ctx.roleSlug === "super_admin";
    if (!isSuperAdmin && ctx.userId && ctx.userId === sheet.recorderId) {
      throw new ForbiddenException(
        "A sheet must be approved by someone other than the recorder who logged it"
      );
    }

    const tallies = normaliseTallies(sheet.tallies);
    const recorded = readEvents(sheet.events);

    /* Shirt number -> player, from the matchday squad when one exists. Most
       RAK fixtures have no squad loaded, so comments fall back to "No. 6",
       which still reads correctly. */
    const squad = recorded.length
      ? await this.prisma.sbMatchSquadPlayer.findMany({
          where: { matchId, jerseyNumber: { not: null } },
          select: { teamId: true, jerseyNumber: true, playerName: true, playerId: true },
        })
      : [];
    const squadByKey = new Map(
      squad.map((row) => [`${row.teamId}:${row.jerseyNumber}`, row])
    );
    const teamIdFor = (side: "home" | "away") =>
      side === "home" ? match.homeTeamId : match.awayTeamId;
    const squadFor = (event: RecordedEvent) =>
      event.playerNumber
        ? squadByKey.get(`${teamIdFor(event.side)}:${event.playerNumber}`)
        : undefined;

    const comments = generateEventComments(
      recorded as RecordedEventInput[],
      (event) => {
        const isHome = event.side === "home";
        return {
          teamName: isHome ? match.homeTeam.name : match.awayTeam.name,
          opponentName: isHome ? match.awayTeam.name : match.homeTeam.name,
          playerName: squadFor(event as RecordedEvent)?.playerName ?? null,
        };
      }
    );

    const existingStats =
      match.stats && typeof match.stats === "object" && !Array.isArray(match.stats)
        ? (match.stats as Record<string, unknown>)
        : {};

    /* Re-approval must not duplicate the timeline, so this sheet's previously
       published events are cleared first. Only rows this console wrote are
       touched — anything logged by the spotter or match centre is left alone. */
    const eventRows = recorded.map((event, index) => ({
      matchId,
      teamId: teamIdFor(event.side),
      playerId: squadFor(event)?.playerId ?? null,
      playerLabel:
        squadFor(event)?.playerName ??
        (event.playerNumber ? `No. ${event.playerNumber}` : null),
      type: event.type,
      minute: event.minute,
      detail: comments[index],
      metadata: {
        source: "match_recorder",
        sheetId: sheet.id,
        addedMinute: event.addedMinute,
        half: event.half,
        playerNumber: event.playerNumber,
      } as Prisma.InputJsonValue,
    }));

    const stamp = {
      [col.status]: "approved",
      [col.approvedById]: ctx.userId ?? null,
      [col.approvedByName]: actorName(ctx),
      [col.approvedAt]: new Date(),
    } as Prisma.SbMatchStatisticsUpdateInput;

    /* Each section publishes only its own artefact, so approving one never
       pushes the other's half-finished work to the public site. */
    const score = scoreFromEvents(recorded);
    const writes: Prisma.PrismaPromise<unknown>[] =
      section === "events"
        ? [
            this.prisma.sbMatchEvent.deleteMany({
              where: {
                matchId,
                metadata: { path: ["source"], equals: "match_recorder" },
              },
            }),
            ...(eventRows.length
              ? [this.prisma.sbMatchEvent.createMany({ data: eventRows })]
              : []),
            /* The scoreline follows the approved goal events, so the match
               score and its timeline can never disagree. */
            this.prisma.sbMatch.update({
              where: { id: matchId },
              data: { homeScore: score.home, awayScore: score.away },
            }),
          ]
        : [
            this.prisma.sbMatch.update({
              where: { id: matchId },
              data: {
                stats: {
                  ...existingStats,
                  ...totalsFor(tallies),
                  manualStatsMeta: {
                    source: "manual",
                    updatedAt: new Date().toISOString(),
                  },
                } as Prisma.InputJsonValue,
              },
            }),
          ];

    const results = await this.prisma.$transaction([
      ...writes,
      this.prisma.sbMatchStatistics.update({ where: { matchId }, data: stamp }),
    ]);

    // The sheet stamp is always the last write in the transaction.
    const updated = results[results.length - 1] as Awaited<
      ReturnType<PrismaService["sbMatchStatistics"]["update"]>
    >;
    return this.present({ ...match }, updated, ctx);
  }

  /**
   * Send back for edits, returning the sheet to `live`. Only a submitted sheet
   * can be sent back, so nothing already published to the public site is
   * affected — approved figures are withdrawn by re-approving a corrected
   * sheet, never by this path.
   */
  async sendBack(
    matchId: string,
    section: SheetSection,
    note: string | undefined,
    ctx: AdminAuthContext
  ) {
    this.assertCanApprove(ctx);
    const match = await this.loadMatch(matchId, ctx);
    const sheet = await this.requireSheet(matchId);
    const col = SECTION_COLUMNS[section];

    const current = sectionStatus(sheet, section);
    if (current === "live") {
      throw new BadRequestException(
        `The ${SECTION_LABEL[section]} is already open for edits`
      );
    }

    /* An approved section can be pulled back too. Without this a supervisor who
       approves the wrong figures has no way to correct them, and the mistake
       stays on the public site permanently. */
    const wasApproved = current === "approved";

    const updated = await this.prisma.sbMatchStatistics.update({
      where: { matchId },
      data: {
        [col.status]: "live",
        ...(wasApproved
          ? {
              [col.approvedById]: null,
              [col.approvedByName]: null,
              [col.approvedAt]: null,
            }
          : {}),
        [col.sentBackById]: ctx.userId ?? null,
        [col.sentBackByName]: actorName(ctx),
        [col.sentBackAt]: new Date(),
        [col.sentBackNote]: note?.trim() ? note.trim() : null,
        [col.submittedById]: null,
        [col.submittedByName]: null,
        [col.submittedAt]: null,
      } as Prisma.SbMatchStatisticsUpdateInput,
    });

    /* Withdraw the published event log so the public timeline matches the
       sheet's state. Statistics cannot be unwound the same way — the totals
       were merged into SbMatch.stats and stay until a corrected sheet is
       approved over them. */
    if (wasApproved && section === "events") {
      await this.prisma.sbMatchEvent.deleteMany({
        where: { matchId, metadata: { path: ["source"], equals: "match_recorder" } },
      });
      /* The score follows the approved log, so withdrawing the log has to
         withdraw the scoreline too — otherwise the public match would show
         goals with an empty timeline behind them. */
      await this.prisma.sbMatch.update({
        where: { id: matchId },
        data: { homeScore: 0, awayScore: 0 },
      });
    }

    return this.present(match, updated, ctx);
  }

  /** Supervisor queue: everything waiting on a decision. */
  async listSubmitted(ctx: AdminAuthContext) {
    this.assertCanApprove(ctx);
    const sheets = await this.prisma.sbMatchStatistics.findMany({
      where: {
        OR: [{ status: "submitted" }, { eventsStatus: "submitted" }],
        ...(ctx.competitionId ? { match: { competitionId: ctx.competitionId } } : {}),
      },
      orderBy: { updatedAt: "asc" },
      include: {
        match: {
          include: { homeTeam: true, awayTeam: true, competition: true },
        },
      },
    });
    return sheets.map((sheet) => ({
      matchId: sheet.matchId,
      status: sheet.status as SheetStatus,
      eventsStatus: sheet.eventsStatus as SheetStatus,
      /** Which tracks are actually waiting on this supervisor. */
      awaiting: [
        ...(sheet.status === "submitted" ? ["stats" as const] : []),
        ...(sheet.eventsStatus === "submitted" ? ["events" as const] : []),
      ],
      submittedAt: sheet.submittedAt ?? sheet.eventsSubmittedAt,
      submittedByName: sheet.submittedByName ?? sheet.eventsSubmittedByName,
      recorderName: sheet.recorderName,
      match: {
        id: sheet.match.id,
        kickoffAt: sheet.match.kickoffAt,
        roundLabel: sheet.match.roundLabel,
        homeTeam: { name: sheet.match.homeTeam.name, logoUrl: sheet.match.homeTeam.logoUrl },
        awayTeam: { name: sheet.match.awayTeam.name, logoUrl: sheet.match.awayTeam.logoUrl },
        competition: { name: sheet.match.competition.name, logoUrl: sheet.match.competition.logoUrl },
      },
    }));
  }

  private async requireSheet(matchId: string) {
    const sheet = await this.prisma.sbMatchStatistics.findUnique({ where: { matchId } });
    if (!sheet) throw new NotFoundException("No statistics sheet has been opened for this match");
    return sheet;
  }

  /** Sheets belong to the recorder who claimed them. */
  private assertOwnsSheet(
    sheet: { recorderId: string | null },
    ctx: AdminAuthContext
  ) {
    const isSuperAdmin = ctx.method === "api_key" || ctx.roleSlug === "super_admin";
    if (isSuperAdmin || !sheet.recorderId || !ctx.userId) return;
    if (sheet.recorderId !== ctx.userId) {
      throw new ForbiddenException("Another recorder owns this sheet");
    }
  }

  private present(
    match: Awaited<ReturnType<AdminMatchStatsService["loadMatch"]>>,
    sheet: Awaited<ReturnType<PrismaService["sbMatchStatistics"]["findUnique"]>>,
    ctx: AdminAuthContext
  ) {
    const row = sheet as SheetRow | null;
    const status = sectionStatus(row, "stats");
    const eventsStatus = sectionStatus(row, "events");
    const tallies = normaliseTallies(sheet?.tallies);
    const canRecord = hasPermission(ctx, RECORD_PERMISSION);
    const canApprove = hasPermission(ctx, APPROVE_PERMISSION);
    const ownsSheet =
      !sheet?.recorderId || !ctx.userId || sheet.recorderId === ctx.userId;

    /** Per-track permissions, mirroring the server rules exactly so the UI
     *  never offers a control the API would reject. */
    const sectionPerms = (sectionState: SheetStatus) => ({
      canEdit: canRecord && sectionState !== "approved" && ownsSheet,
      canSubmit: canRecord && sectionState !== "approved" && ownsSheet,
      canApproveThis: canApprove && sectionState === "submitted",
    });

    return {
      matchId: match.id,
      status,
      eventsStatus,
      tallies,
      totals: totalsFor(tallies),
      stats: MATCH_STAT_DEFS,
      events: readEvents(sheet?.events),
      /** Live scoreline implied by the logged goal events. */
      derivedScore: scoreFromEvents(readEvents(sheet?.events)),
      clock: readClock(sheet?.clock),
      kits: readKits(sheet?.kits) ?? { home: "#4c9ffe", away: "#f5a524" },
      eventTypes: MATCH_EVENT_TYPES,
      audit: {
        recorderId: sheet?.recorderId ?? null,
        recorderName: sheet?.recorderName ?? null,
        submittedByName: sheet?.submittedByName ?? null,
        submittedAt: sheet?.submittedAt ?? null,
        approvedByName: sheet?.approvedByName ?? null,
        approvedAt: sheet?.approvedAt ?? null,
        sentBackByName: sheet?.sentBackByName ?? null,
        sentBackAt: sheet?.sentBackAt ?? null,
        sentBackNote: sheet?.sentBackNote ?? null,
      },
      eventsAudit: {
        submittedByName: sheet?.eventsSubmittedByName ?? null,
        submittedAt: sheet?.eventsSubmittedAt ?? null,
        approvedByName: sheet?.eventsApprovedByName ?? null,
        approvedAt: sheet?.eventsApprovedAt ?? null,
        sentBackByName: sheet?.eventsSentBackByName ?? null,
        sentBackAt: sheet?.eventsSentBackAt ?? null,
        sentBackNote: sheet?.eventsSentBackNote ?? null,
      },
      permissions: {
        canRecord,
        canApprove,
        ...sectionPerms(status),
      },
      eventsPermissions: {
        canRecord,
        canApprove,
        ...sectionPerms(eventsStatus),
      },
      match: {
        id: match.id,
        kickoffAt: match.kickoffAt,
        venue: match.venue,
        roundLabel: match.roundLabel,
        matchday: match.matchday,
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        homeTeam: {
          id: match.homeTeam.id,
          name: match.homeTeam.name,
          shortName: match.homeTeam.shortName,
          logoUrl: match.homeTeam.logoUrl,
        },
        awayTeam: {
          id: match.awayTeam.id,
          name: match.awayTeam.name,
          shortName: match.awayTeam.shortName,
          logoUrl: match.awayTeam.logoUrl,
        },
        competition: {
          id: match.competition.id,
          name: match.competition.name,
          logoUrl: match.competition.logoUrl,
        },
      },
    };
  }
}
