import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  SUBMIT_TOO_EARLY,
  canSubmitYet,
  idleLockMessage,
  quietMinutes,
} from "./recorder-idle";
import { PlayerDirectoryService } from "../scoreboard/player-directory.service";
import { addSquadMembersFromTimeline } from "../scoreboard/squad-from-timeline";
import { planFinalScoreSync } from "./final-score-sync";
import { linkMatchGoals } from "../scoreboard/link-match-goals";
import { hasKickedOff } from "../scoreboard/public-live-state";
import { videoGoals, withVideoGoals } from "../scoreboard/video-goals";
import { reapplyEnrichment } from "../vision/events/reapply-enrichment";
import {
  buildNumberLookup,
  squadNumberLabel,
} from "../scoreboard/squad-number-lookup";
import type { AdminAuthContext } from "./auth/admin-auth.types";
import { assessAutoApprove, danglingNumbers } from "./sheet-auto-approve";
import { mergeRecordedEvents } from "./sheet-event-merge";
import {
  canAccessCompetition,
  competitionScopeWhere,
  hasPermission,
  scopedCompetitions,
} from "./auth/admin-auth.types";
import {
  generateEventComments,
  type RecordedEventInput,
} from "./match-event-comments";
import { ScoreboardLifecycleService } from "../scoreboard/scoreboard-lifecycle.service";

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

/**
 * Statistics an event in the Events tab also counts toward.
 *
 * A recorder logging a corner has already told us a corner happened; making
 * them cross to the Statistics tab and tap it again is duplicate work and a
 * chance for the two figures to disagree. These contributions are added to
 * whatever was tapped by hand rather than replacing it, because the counters
 * remain much the faster way to record volume — a keeper's eight saves are
 * eight taps here, against eight four-step event entries there.
 *
 * `side` is whose column the count lands in. Most are "same", but a saved
 * penalty is a save for the keeper's side and a penalty awarded to the other.
 * Types whose outcome is ambiguous — one_on_one, own_goal, penalty_shootout —
 * are deliberately absent: a guess in a published statistic is worse than a gap.
 */
export const EVENT_STAT_CAPTURE: Record<
  string,
  ReadonlyArray<{ key: string; side: "same" | "opponent" }>
> = {
  corner_kick: [{ key: "corners", side: "same" }],
  foul: [{ key: "fouls", side: "same" }],
  offside: [{ key: "offsides", side: "same" }],
  red_card: [{ key: "redCards", side: "same" }],
  save: [{ key: "saves", side: "same" }],
  yellow_card: [{ key: "yellowCards", side: "same" }],
  goal: [{ key: "shotsOnTarget", side: "same" }],
  shot: [{ key: "shotsOnTarget", side: "same" }],
  goal_penalty: [
    { key: "shotsOnTarget", side: "same" },
    { key: "penaltiesAwarded", side: "same" },
  ],
  penalty_saved: [
    { key: "saves", side: "same" },
    { key: "shotsOnTarget", side: "opponent" },
    { key: "penaltiesAwarded", side: "opponent" },
  ],
  shot_off_target: [{ key: "shotsOffTarget", side: "same" }],
  missed_chance: [{ key: "shotsOffTarget", side: "same" }],
  volley_missed: [{ key: "shotsOffTarget", side: "same" }],
  woodwork: [{ key: "shotsOffTarget", side: "same" }],
};

/** Stat keys any event can feed. Drives the ordering of the Statistics tab. */
export const AUTO_CAPTURED_STAT_KEYS: ReadonlySet<string> = new Set(
  Object.values(EVENT_STAT_CAPTURE).flatMap((list) => list.map((c) => c.key))
);

/**
 * Statistics ordered for the tab: everything needing a human tap first, then
 * the ones the event log already fills in. A recorder works top-down and stops
 * where the automation takes over.
 */
export const ORDERED_STAT_DEFS = [
  ...MATCH_STAT_DEFS.filter((d) => !AUTO_CAPTURED_STAT_KEYS.has(d.key)),
  ...MATCH_STAT_DEFS.filter((d) => AUTO_CAPTURED_STAT_KEYS.has(d.key)),
].map((d) => ({ ...d, autoCaptured: AUTO_CAPTURED_STAT_KEYS.has(d.key) }));

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
  "accurate_cross",
  "aerial_duel_won",
  "blocked_shot",
  "clearance",
  "corner_kick",
  "dribble",
  "foul",
  "freekick",
  "goal",
  "goal_line_clearance",
  "goal_penalty",
  "goalkeeper_claim",
  "goalkeeper_command",
  "goalkeeper_distribution",
  "goalkeeper_intervention",
  "goalkeeper_punch",
  "inaccurate_cross",
  "interception",
  "long_pass",
  "long_throw",
  "midfield_battle",
  "missed_chance",
  "offside",
  "one_on_one",
  "own_goal",
  "penalty_saved",
  "recovery_tackle",
  "red_card",
  "save",
  "shot",
  "shot_off_target",
  "substitution",
  "sustained_pressure",
  "sweeper_keep",
  "tackle_won",
  "through_ball",
  "volley_missed",
  "woodwork",
  "yellow_card",
] as const;

/**
 * Types the grid no longer offers, kept readable so sheets recorded before the
 * change keep their events.
 *
 * `assist` was retired when the goal prompt began capturing the provider on the
 * goal itself; `cross` was split into accurate and inaccurate. Dropping either
 * from the accepted set would make readEvents discard those events silently on
 * the next save, which is data loss disguised as a vocabulary change.
 */
const RETIRED_EVENT_TYPES = [
  "kick_off",
  "assist",
  "cross",
  "full_time",
  "penalty_shootout",
  "shootout_goal",
  "shootout_miss",
] as const;

const EVENT_TYPE_SET = new Set<string>([...MATCH_EVENT_TYPES, ...RETIRED_EVENT_TYPES]);

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

export function penaltyShootoutFromEvents(
  events: RecordedEvent[]
): { home: number; away: number; winner: "home" | "away" } | null {
  let home = 0;
  let away = 0;
  let kicks = 0;
  for (const event of events) {
    if (event.type !== "shootout_goal" && event.type !== "shootout_miss") continue;
    kicks += 1;
    if (event.type !== "shootout_goal") continue;
    if (event.side === "home") home += 1;
    else away += 1;
  }
  if (kicks === 0 || home === away) return null;
  return { home, away, winner: home > away ? "home" : "away" };
}

export type RecordedEvent = {
  id: string;
  type: string;
  minute: number;
  addedMinute: number | null;
  side: "home" | "away";
  playerNumber: number | null;
  /**
   * The second player an event involves: the incoming player on a substitution,
   * or whoever provided the assist on a goal. Null on a solo effort.
   */
  secondaryPlayerNumber: number | null;
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
  | "awaiting_full_time"
  | "penalty_shootout"
  | "finished"
  /* A finished match reopened for corrections. The clock stays stopped at the full-time
     reading and the recorder types each minute, because there is no live play to read
     one from. Only the server enters it (a send-back) and only approval leaves it. */
  | "correction";

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

export type LiveFeatureState = {
  enabled: boolean;
  audioEnabled: boolean;
  updatedAt: string | null;
  audioUpdatedAt: string | null;
};

/**
 * The live-feed switches on a match, with the defaults the competitions are run on.
 *
 * **Approved by default.** Every fixture is meant to be on the feed; the switch exists so an
 * admin can take a particular game off it. It defaulted off, which made approving each match
 * a step somebody had to remember, and a forgotten one meant a recorded game that the public
 * never saw -- no feed, no live score, and no final score either, because the full-time sync
 * is behind the same switch.
 *
 * Only an explicit `false` turns it off. Anything else -- no stats at all, no `liveFeature`
 * key, a key with nothing in it -- means nobody has decided, and the default stands. An
 * admin who switches it off writes `enabled: false`, which is read back as off for good.
 *
 * **Audio is not.** Commentary stays off until somebody turns it on for that game, and it
 * cannot be on while the feed is off.
 *
 * Being approved is not the same as being live: that needs the recorder to kick off. See
 * `hasKickedOff` in `../scoreboard/public-live-state`.
 */
export function readLiveFeature(input: unknown): LiveFeatureState {
  const NOBODY_HAS_DECIDED: LiveFeatureState = {
    enabled: true,
    audioEnabled: false,
    updatedAt: null,
    audioUpdatedAt: null,
  };
  if (!input || typeof input !== "object" || Array.isArray(input)) return NOBODY_HAS_DECIDED;
  const stats = input as Record<string, unknown>;
  const raw = stats.liveFeature;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NOBODY_HAS_DECIDED;
  const live = raw as Record<string, unknown>;
  const timestamp = live.updatedAt ?? live.enabledAt;
  const audioTimestamp = live.audioUpdatedAt ?? live.audioEnabledAt;
  /* An explicit boolean is the admin speaking. Anything else is nobody having spoken. */
  const enabled = typeof live.enabled === "boolean" ? live.enabled : true;
  return {
    enabled,
    audioEnabled: enabled && live.audioEnabled === true,
    updatedAt:
      typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp))
        ? new Date(timestamp).toISOString()
        : null,
    audioUpdatedAt:
      typeof audioTimestamp === "string" && Number.isFinite(Date.parse(audioTimestamp))
        ? new Date(audioTimestamp).toISOString()
        : null,
  };
}

export function readEvents(input: unknown): RecordedEvent[] {
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
    const secondary =
      typeof e.secondaryPlayerNumber === "number" &&
      Number.isFinite(e.secondaryPlayerNumber) &&
      e.secondaryPlayerNumber > 0
        ? Math.floor(e.secondaryPlayerNumber)
        : null;
    out.push({
      id: typeof e.id === "string" && e.id ? e.id : `${type}-${minute}-${out.length}`,
      type,
      minute,
      addedMinute: added,
      side: e.side === "away" ? "away" : "home",
      playerNumber: number,
      secondaryPlayerNumber: secondary,
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
  "awaiting_full_time",
  "penalty_shootout",
  "finished",
  "correction",
]);

export function readClock(input: unknown): ClockState | null {
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

export function readKits(input: unknown): KitColours | null {
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

/**
 * What the event log contributes to each statistic.
 *
 * Recomputed from the events every time rather than accumulated as the events
 * are logged: deleting an event then correctly takes its contribution with it,
 * and no running counter can drift out of step with the log it came from.
 */
export function capturedFromEvents(events: RecordedEvent[]): Tallies {
  const out = emptyTallies();

  for (const event of events) {
    const captures = EVENT_STAT_CAPTURE[event.type];
    if (!captures) continue;

    for (const capture of captures) {
      const def = STAT_BY_KEY.get(capture.key);
      if (!def) continue;

      const side: Side =
        capture.side === "same" ? event.side : event.side === "home" ? "away" : "home";

      if (def.split) {
        const half: Half = event.half === 2 ? "2nd" : "1st";
        const split = out[capture.key] as SplitTally;
        split[half][side] += 1;
      } else {
        (out[capture.key] as SidePair)[side] += 1;
      }
    }
  }

  return out;
}

/**
 * The figures that count: tapped by hand plus captured from the event log.
 *
 * This is what gets published on approval, so the public site sees one number
 * per statistic rather than a manual figure that silently ignores the log.
 */
export function effectiveTallies(tallies: Tallies, events: RecordedEvent[]): Tallies {
  const captured = capturedFromEvents(events);
  const out: Tallies = {};

  for (const def of MATCH_STAT_DEFS) {
    if (def.split) {
      const manual = tallies[def.key] as SplitTally;
      const auto = captured[def.key] as SplitTally;
      out[def.key] = {
        "1st": {
          home: (manual?.["1st"]?.home ?? 0) + auto["1st"].home,
          away: (manual?.["1st"]?.away ?? 0) + auto["1st"].away,
        },
        "2nd": {
          home: (manual?.["2nd"]?.home ?? 0) + auto["2nd"].home,
          away: (manual?.["2nd"]?.away ?? 0) + auto["2nd"].away,
        },
      };
    } else {
      const manual = readPair(tallies[def.key]);
      const auto = captured[def.key] as SidePair;
      out[def.key] = { home: manual.home + auto.home, away: manual.away + auto.away };
    }
  }

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

/** Both tracks, for the actions that now move them as one. */
const SHEET_SECTIONS = ["stats", "events"] as const;

/**
 * Section recorded against a history entry made by a whole-sheet action.
 *
 * The column still holds "stats" and "events" for entries written before the
 * two were submitted together, so old history keeps reading correctly.
 */
export const WHOLE_SHEET = "sheet";

type SheetRow = Record<string, unknown>;

function sectionStatus(sheet: SheetRow | null, section: SheetSection): SheetStatus {
  const value = sheet?.[SECTION_COLUMNS[section].status];
  return (typeof value === "string" ? value : "live") as SheetStatus;
}

/** How far along a status is, so a mixed sheet can be judged by its weakest half. */
const STATUS_RANK: Record<SheetStatus, number> = { live: 0, submitted: 1, approved: 2 };

/**
 * The sheet's single status.
 *
 * Statistics and events are submitted and approved together — the event log
 * feeds the statistics, so approving one without the other would publish
 * figures derived from work nobody had signed off. The two columns are kept
 * because they carry who did what and when, but they move as a pair.
 *
 * Sheets recorded before the merge can still disagree. The lesser of the two
 * wins there, so a half-approved sheet is never treated as finished.
 */
export function sheetStatus(sheet: SheetRow | null): SheetStatus {
  const stats = sectionStatus(sheet, "stats");
  const events = sectionStatus(sheet, "events");
  return STATUS_RANK[stats] <= STATUS_RANK[events] ? stats : events;
}

/** Format type marking the recorder training sandbox. */
const TRAINING_FORMAT_TYPE = "TRAINING_SANDBOX";

/** A competition flagged as a training sandbox in its format config. */
function isTrainingCompetition(competition: { formatConfig?: unknown } | null): boolean {
  const cfg = competition?.formatConfig;
  return Boolean(cfg && typeof cfg === "object" && (cfg as Record<string, unknown>).isTraining);
}

/**
 * Practice fixtures belong to one recorder each.
 *
 * The seeded fixture is a template, not a pitch: when every trainee opened the
 * same match they shared a single sheet, so one person's kick-off reset another
 * person's half and their events landed in the same log. A recorder now gets
 * their own copy of it, recorded in the match's `meta`, and can throw it away
 * and take another whenever they want a clean run.
 */
type TrainingMeta = { trainingOwnerId?: string; trainingOwnerName?: string };

function trainingOwnerId(match: { meta?: unknown } | null): string | null {
  const meta = match?.meta;
  if (!meta || typeof meta !== "object") return null;
  const id = (meta as TrainingMeta).trainingOwnerId;
  return typeof id === "string" && id ? id : null;
}

/** The seeded fixture every practice copy is cloned from. */
function isTrainingTemplate(match: { meta?: unknown } | null): boolean {
  return trainingOwnerId(match) === null;
}

/** Accounts that see and manage every practice match, not just their own. */
function seesAllTraining(ctx: AdminAuthContext): boolean {
  return ctx.method === "api_key" || ctx.roleSlug === "super_admin" || !ctx.userId;
}

/** Half length the competition prefers, if it declares one. */
function competitionHalfLength(competition: { formatConfig?: unknown } | null): number | null {
  const cfg = competition?.formatConfig;
  if (!cfg || typeof cfg !== "object") return null;
  const value = (cfg as Record<string, unknown>).halfLengthMinutes;
  return typeof value === "number" && value > 0 ? Math.floor(value) : null;
}

export type SheetLogAction =
  | "submitted"
  | "resubmitted"
  | "approved"
  | "sent_back"
  | "correction_requested"
  | "correction_approved"
  | "correction_declined"
  /* The sweep stopping a recording left running, and a ScoreBoard admin releasing it.
     Logged like every other change of state so the sheet history tells the whole story
     rather than showing an unexplained gap in the middle of a match. */
  | "idle_locked"
  | "idle_released";

/**
 * A sheet locks itself at full time.
 *
 * Once the clock has run out the record is finished, and editing it afterwards
 * needs someone to sign off — otherwise a "final" sheet quietly changes after
 * the fact. An approved correction request is what lifts the lock.
 */
function isFullTime(clock: ClockState | null): boolean {
  return clock?.phase === "finished";
}

/**
 * A finished match reopened for corrections.
 *
 * Not full time for the lock (the point of reopening is to edit), but full time for
 * everything else: the clock does not run, nothing is live, and the record still
 * describes a match that has ended.
 */
export function isCorrecting(clock: ClockState | null): boolean {
  return clock?.phase === "correction";
}

/** The match has ended: at full time, or reopened after it to be corrected. */
function matchIsOver(clock: ClockState | null): boolean {
  return isFullTime(clock) || isCorrecting(clock);
}

function actorName(ctx: AdminAuthContext): string {
  return ctx.displayName || ctx.email || ctx.roleName || "Admin";
}

/**
 * Who the sheet history and the approved-by columns name when the clock approves.
 *
 * No `userId`, so the approved-by id stays empty the way `autoSubmittedAt` leaves the
 * submitted-by id empty, and the name says what happened instead of naming a person.
 * Holds only the approve permission.
 */
const AUTO_APPROVER: AdminAuthContext = {
  method: "jwt",
  roleSlug: "system",
  roleName: "System",
  permissions: [APPROVE_PERMISSION],
  displayName: "Auto-approval",
};


@Injectable()
export class AdminMatchStatsService {
  private readonly logger = new Logger(AdminMatchStatsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ScoreboardLifecycleService)
    private readonly lifecycle: ScoreboardLifecycleService,
    @Inject(PlayerDirectoryService)
    private readonly playerDirectory: PlayerDirectoryService
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
      include: {
        competition: true,
        squadPlayers: {
          where: { jerseyNumber: { not: null } },
          select: {
            teamId: true,
            playerId: true,
            playerName: true,
            jerseyNumber: true,
          },
        },
        /* The standing squads as well, because the console resolves a shirt number
           client-side and the matchday squad is empty for most fixtures. Without
           these the recorder types 7 and sees `No. 7` rather than the name that is
           sitting in the squad. */
        homeTeam: { include: { squad: { where: { shirtNumber: { not: null } } } } },
        awayTeam: { include: { squad: { where: { shirtNumber: { not: null } } } } },
      },
    });
    if (!match) throw new NotFoundException("Match not found");

    if (isTrainingCompetition(match.competition)) {
      /* Practice matches are personal. Reaching someone else's — or the
         template every copy is cut from — is refused even by match id, so two
         trainees can never end up sharing one sheet again. */
      if (!seesAllTraining(ctx) && trainingOwnerId(match) !== ctx.userId) {
        throw new ForbiddenException(
          isTrainingTemplate(match)
            ? "Start your own practice match from the Training page"
            : "This practice match belongs to another recorder"
        );
      }
      return match;
    }

    /* A scoped recorder must not reach a fixture outside the competitions they
       are assigned to, even by typing the match id straight into the URL. */
    if (!canAccessCompetition(ctx, match.competitionId)) {
      throw new ForbiddenException("This match is outside the competitions you are assigned to");
    }
    return match;
  }

  /**
   * Carry the sheet's score onto the match at full time.
   *
   * Reached on every save, and it writes only once the clock reads full time. The rule for
   * whether the sheet may set the score is in `planFinalScoreSync`: it may, unless it
   * disagrees with a timeline this console did not publish.
   */
  private async syncFinalScoreFromSheet(
    match: Awaited<ReturnType<AdminMatchStatsService["loadMatch"]>>,
    sheet: { events: unknown; clock: unknown }
  ) {
    if (isTrainingCompetition(match.competition)) return;
    if (!readLiveFeature(match.stats).enabled) return;
    if (!isFullTime(readClock(sheet.clock))) return;

    /* A goal added from video is on the timeline and not on the sheet; the score counts it
       wherever the sheet sets the score (scoreboard/video-goals.ts). */
    const fromVideo = await videoGoals(this.prisma, match);
    const score = withVideoGoals(scoreFromEvents(readEvents(sheet.events)), fromVideo);
    const published = { home: match.homeScore, away: match.awayScore };
    /* Counted rather than assumed, and only here -- full time is reached once per match,
       so this is not on the path of a recorder tapping events. */
    const [allEvents, ourEvents] = await Promise.all([
      this.prisma.sbMatchEvent.count({ where: { matchId: match.id } }),
      this.prisma.sbMatchEvent.count({
        where: {
          matchId: match.id,
          metadata: { path: ["source"], equals: "match_recorder" },
        },
      }),
    ]);
    const plan = planFinalScoreSync({
      sheet: score,
      published,
      /* Video rows are accounted for in the score above, so they are not a timeline the
         sheet disagrees with. */
      eventsFromElsewhere: allEvents - ourEvents - fromVideo.events,
    });

    const wasFinished = match.status === "finished";
    if (!plan.follow) {
      /* Finished, but at the score that is published. Logged because a held score is a
         match waiting on a human, and nothing else would say so until somebody ran the
         report. */
      this.logger.warn(
        `Match ${match.id}: kept the published score ${published.home}-${published.away} at ` +
          `full time. The sheet says ${score.home}-${score.away}, and ${allEvents - ourEvents} ` +
          "timeline event(s) here were not published by this console, so the two cannot both " +
          "be right. Approve the sheet or correct the timeline to settle it."
      );
      if (!wasFinished) {
        await this.prisma.sbMatch.update({
          where: { id: match.id },
          data: { status: "finished", minute: match.minute ?? 90 },
        });
        await this.lifecycle.onMatchFinished(match.id);
      }
      return;
    }

    await this.prisma.sbMatch.update({
      where: { id: match.id },
      data: {
        homeScore: score.home,
        awayScore: score.away,
        status: "finished",
        minute: match.minute ?? 90,
      },
    });

    if (!wasFinished) {
      await this.lifecycle.onMatchFinished(match.id);
    } else if (published.home !== score.home || published.away !== score.away) {
      await this.lifecycle.refreshStandingsForFinishedMatch(match.id);
    }
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

    const isTraining = { competition: { formatType: TRAINING_FORMAT_TYPE } };
    const include = {
      homeTeam: true,
      awayTeam: true,
      competition: true,
      statisticsSheet: { select: { status: true, recorderName: true, clock: true } },
    } as const;

    const scope = competitionScopeWhere(ctx);

    /* Training fixtures are fetched separately rather than relying on the take
       below. They are few, their kickoff dates are arbitrary, and once the real
       fixture list grew past the page size they fell out of it entirely. */
    const [trainingRows, real] = await Promise.all([
      this.prisma.sbMatch.findMany({
        where: { isPublished: true, ...isTraining },
        orderBy: [{ kickoffAt: "desc" }],
        include,
      }),
      this.prisma.sbMatch.findMany({
        where: {
          isPublished: true,
          ...scope,
          competition: { formatType: { not: TRAINING_FORMAT_TYPE } },
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
        include,
      }),
    ]);

    /* Practice matches are personal, and the template is nobody's. Filtered
       here rather than in the query: there are only ever a handful, and this
       keeps the ownership rule in one readable place alongside loadMatch's. */
    const training = trainingRows.filter((match) =>
      seesAllTraining(ctx)
        ? !isTrainingTemplate(match)
        : trainingOwnerId(match) === ctx.userId
    );

    // Training first: it is what a trainee came for, and it is never in the way.
    const matches = [...training, ...real];

    return matches.map((match) => ({
      id: match.id,
      kickoffAt: match.kickoffAt,
      venue: match.venue,
      roundLabel: match.roundLabel,
      status: match.status,
      sheetStatus: (match.statisticsSheet?.status ?? null) as SheetStatus | null,
      recorderName: readClock(match.statisticsSheet?.clock)?.firstHalfStartedAt
        ? match.statisticsSheet?.recorderName ?? null : null,
      homeTeam: { name: match.homeTeam.name, logoUrl: match.homeTeam.logoUrl },
      awayTeam: { name: match.awayTeam.name, logoUrl: match.awayTeam.logoUrl },
      competition: {
        id: match.competition.id,
        name: match.competition.name,
        logoUrl: match.competition.logoUrl,
        /** Training fixtures are labelled so nobody mistakes one for a real match. */
        isTraining: isTrainingCompetition(match.competition),
      },
    }));
  }

  /**
   * Start a practice match of your own, cloned from the seeded template.
   *
   * The squad is copied with it, so the generated commentary still resolves
   * "No. 10" to a real name — that is most of what a trainee is here to see.
   */
  async createTrainingMatch(ctx: AdminAuthContext) {
    this.assertCanRecord(ctx);

    const ownerId = ctx.userId ?? ctx.email ?? ctx.roleSlug ?? "super_admin";

    const template = await this.prisma.sbMatch.findFirst({
      where: { competition: { formatType: TRAINING_FORMAT_TYPE } },
      orderBy: [{ createdAt: "asc" }],
      include: { competition: true },
    });
    if (!template) {
      throw new NotFoundException(
        "No practice fixture is set up yet — run the database seed first"
      );
    }

    const squad = await this.prisma.sbMatchSquadPlayer.findMany({
      where: { matchId: template.id },
    });

    const id = randomUUID();
    const owner = actorName(ctx);
    const meta: TrainingMeta & Record<string, unknown> = {
      ...(template.meta && typeof template.meta === "object" ? template.meta : {}),
      trainingOwnerId: ownerId,
      trainingOwnerName: owner,
    };

    await this.prisma.$transaction([
      this.prisma.sbMatch.create({
        data: {
          id,
          // Unique per copy, and never public: these fixtures are unpublished.
          slug: `practice-${id.slice(0, 8)}`,
          competitionId: template.competitionId,
          stageId: template.stageId,
          homeTeamId: template.homeTeamId,
          awayTeamId: template.awayTeamId,
          status: "scheduled",
          kickoffAt: new Date(),
          venue: template.venue,
          roundLabel: `Practice — ${owner}`,
          stageKey: template.stageKey,
          matchday: template.matchday,
          isPublished: template.isPublished,
          meta: meta as Prisma.InputJsonValue,
        },
      }),
      ...(squad.length
        ? [
            this.prisma.sbMatchSquadPlayer.createMany({
              data: squad.map(({ id: _drop, matchId: _m, ...row }) => ({
                ...row,
                matchId: id,
              })),
            }),
          ]
        : []),
    ]);

    return { matchId: id };
  }

  /**
   * Throw a practice match away so a clean one can be started.
   *
   * Only your own, and only a practice one: the guard is the point, since this
   * is the single delete a match recorder is trusted with. Everything hanging
   * off the match — sheet, history log, squad, events — cascades with it.
   */
  async deleteTrainingMatch(matchId: string, ctx: AdminAuthContext) {
    this.assertCanRecord(ctx);

    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      include: { competition: true },
    });
    if (!match) throw new NotFoundException("Match not found");

    if (!isTrainingCompetition(match.competition)) {
      throw new ForbiddenException("Only practice matches can be deleted");
    }
    if (isTrainingTemplate(match)) {
      throw new ForbiddenException("The practice template cannot be deleted");
    }
    if (!seesAllTraining(ctx) && trainingOwnerId(match) !== ctx.userId) {
      throw new ForbiddenException("This practice match belongs to another recorder");
    }

    await this.prisma.sbMatch.delete({ where: { id: matchId } });
    return { deleted: true };
  }

  /**
   * Opening a fixture never claims it. Ownership starts when kickoff is saved.
   */
  async openSheet(matchId: string, ctx: AdminAuthContext) {
    const match = await this.loadMatch(matchId, ctx);
    const existing = await this.prisma.sbMatchStatistics.findUnique({
      where: { matchId },
    });

    let sheet = existing;
    if (!sheet && hasPermission(ctx, RECORD_PERMISSION)) {
      sheet = await this.prisma.sbMatchStatistics.upsert({
        where: { matchId },
        update: {},
        create: {
          matchId,
          status: "live",
          tallies: emptyTallies() as Prisma.InputJsonValue,
        },
      });
    }

    return this.present(match, sheet, ctx);
  }

  async assertLiveAudioAccess(
    matchId: string,
    ctx: AdminAuthContext,
    options: { allowAfterFullTime?: boolean; allowWhenPublicLiveOff?: boolean } = {}
  ) {
    this.assertCanRecord(ctx);
    const match = await this.loadMatch(matchId, ctx);
    const sheet = await this.requireSheet(matchId);
    this.assertOwnsSheet(sheet, ctx, match);
    const liveFeature = readLiveFeature(match.stats);
    if (!options.allowAfterFullTime && (!readClock(sheet.clock)?.firstHalfStartedAt || sheetStatus(sheet) === "approved")) {
      throw new BadRequestException("Live audio requires an active, unlocked recording after kickoff");
    }
    if (!options.allowWhenPublicLiveOff && !liveFeature.enabled) {
      throw new ForbiddenException("Public live must be approved before live audio commentary can start");
    }
    if (!options.allowWhenPublicLiveOff && !liveFeature.audioEnabled) {
      throw new ForbiddenException("Live audio commentary must be approved before it can start");
    }
    if (!options.allowAfterFullTime && matchIsOver(readClock(sheet.clock))) {
      throw new BadRequestException("Live audio commentary is closed after full time");
    }
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
    extras?: { events?: unknown; removedEventIds?: string[]; clock?: unknown; kits?: unknown }
  ) {
    this.assertCanRecord(ctx);
    const match = await this.loadMatch(matchId, ctx);
    const sheet = await this.requireSheet(matchId);

    this.assertOwnsSheet(sheet, ctx, match);

    /* Full time locks the record. Only an admin approving a correction request
       reopens it, which clears the clock's finished phase. */
    if (isFullTime(readClock(sheet.clock)) && !isTrainingCompetition(match.competition)) {
      throw new BadRequestException(
        "This record is locked at full time. Request a correction and a ScoreBoard admin will reopen it."
      );
    }

    /* A third lock, and the only one that happened *to* the recorder rather than
       because of something they did. The sweep stops a recording left running with
       nobody at it; releasing it is a ScoreBoard admin's job, so the message says so
       rather than suggesting a correction request the recorder cannot resolve. */
    if (sheet.idleLockedAt && !isTrainingCompetition(match.competition)) {
      const quietMs =
        sheet.idleLockedAt.getTime() - (sheet.idleLockedSinceAt ?? sheet.idleLockedAt).getTime();
      throw new BadRequestException(idleLockMessage(quietMs));
    }

    /* The sheet locks as one. Statistics and events are approved together, so
       there is no longer a state where half of it accepts edits. */
    if (sheetStatus(sheet) === "approved") {
      throw new BadRequestException(
        "This sheet is approved. Ask a supervisor to send it back before editing."
      );
    }

    const storedClock = readClock(sheet.clock);
    /* The clock of a reopened record is the server's, not the console's. A device holding a
       draft from match day would otherwise send its running clock back and restart the
       match, and a console cannot put itself into correction mode to type its own minutes
       and submit early. Either way the stored clock stands. */
    const sentClock =
      extras?.clock === undefined
        ? undefined
        : isCorrecting(storedClock) || isCorrecting(readClock(extras.clock))
          ? storedClock
          : readClock(extras.clock);
    const nextClock = sentClock !== undefined ? sentClock : storedClock;
    if (storedClock?.firstHalfStartedAt && !nextClock?.firstHalfStartedAt) {
      throw new BadRequestException("Kickoff cannot be cleared after recording has started.");
    }
    const kickedOff = Boolean(nextClock?.firstHalfStartedAt);
    /* Merged by id, never replaced: a console that has not seen everything on the server
       -- a second phone, or one coming back from a dead spot -- must not wipe what it has
       not seen. A deletion arrives as an id in `removedEventIds`. See sheet-event-merge.ts. */
    const storedEvents = readEvents(sheet.events);
    const merged =
      extras?.events !== undefined
        ? mergeRecordedEvents(storedEvents, readEvents(extras.events), extras.removedEventIds ?? [])
        : null;
    if (merged?.kept.length) {
      this.logger.warn(
        `Match ${matchId}: kept ${merged.kept.length} recorded event(s) the save did not carry ` +
          "(another device, or a console that had not seen them yet)."
      );
    }
    const result = await this.prisma.sbMatchStatistics.updateMany({
      // A competing kickoff or supervisor action must not be overwritten.
      where: { matchId, updatedAt: sheet.updatedAt },
      data: {
        ...(!readClock(sheet.clock)?.firstHalfStartedAt
          ? { recorderId: kickedOff ? ctx.userId ?? null : null,
              recorderName: kickedOff ? actorName(ctx) : null }
          : {}),
        tallies: normaliseTallies(talliesInput) as Prisma.InputJsonValue,
        ...(merged
          ? {
              events: merged.events as unknown as Prisma.InputJsonValue,
              /* Only when the log actually grew. Saving the same events again -- which
                 the console does on any change, including a tally -- must not look like
                 somebody filing one, or the idle guard would never trip for a recorder
                 tapping counts. */
              ...(merged.events.length > storedEvents.length
                ? { lastEventAt: new Date() }
                : {}),
            }
          : {}),
        ...(sentClock !== undefined
          ? {
              clock: (sentClock ?? undefined) as Prisma.InputJsonValue,
              /* Stamped on the transition into full time and only then. Inferring it
                 from `updatedAt` works only for as long as nothing else writes to the
                 row, which is not a property to depend on. */
              ...(isFullTime(sentClock) && !isFullTime(storedClock)
                ? { fullTimeAt: new Date() }
                : {}),
            }
          : {}),
        ...(extras?.kits !== undefined
          ? { kits: (readKits(extras.kits) ?? undefined) as Prisma.InputJsonValue }
          : {}),
      },
    });
    if (result.count !== 1) {
      throw new BadRequestException("This sheet changed while saving. Reload the fixture before continuing.");
    }
    const updated = await this.requireSheet(matchId);
    await this.syncFinalScoreFromSheet(match, updated);
    return this.present(match, updated, ctx);
  }

  /**
   * Submit the whole sheet — statistics and event log together.
   *
   * They are one record now: the events feed the statistics, so submitting the
   * figures without the log they came from would send a supervisor half a story.
   */
  async submit(matchId: string, ctx: AdminAuthContext) {
    this.assertCanRecord(ctx);
    const match = await this.loadMatch(matchId, ctx);
    const sheet = await this.requireSheet(matchId);

    const current = sheetStatus(sheet);
    if (current === "approved") {
      throw new BadRequestException("This sheet has already been approved");
    }
    this.assertOwnsSheet(sheet, ctx, match);

    /* Not before the second half. Enforced here and not only on the button, because a
       disabled button is a suggestion -- this is the sheet refusing to be half a match.
       Practice matches are exempt: the sandbox exists to be driven through quickly. */
    if (!canSubmitYet(readClock(sheet.clock)) && !isTrainingCompetition(match.competition)) {
      throw new BadRequestException(SUBMIT_TOO_EARLY);
    }

    const stamp: Record<string, unknown> = {};
    for (const section of SHEET_SECTIONS) {
      const col = SECTION_COLUMNS[section];
      stamp[col.status] = "submitted";
      stamp[col.submittedById] = ctx.userId ?? null;
      stamp[col.submittedByName] = actorName(ctx);
      stamp[col.submittedAt] = new Date();
      // A fresh submission clears the previous send-back note.
      stamp[col.sentBackNote] = null;
    }

    const updated = await this.prisma.sbMatchStatistics.update({
      where: { matchId },
      data: stamp as Prisma.SbMatchStatisticsUpdateInput,
    });

    await this.log(
      sheet,
      WHOLE_SHEET,
      current === "submitted" ? "resubmitted" : "submitted",
      ctx,
      { summary: this.summarise(sheet) as Prisma.InputJsonValue }
    );
    return this.present(match, updated, ctx);
  }

  /** A compact snapshot of what the sheet held, for the history entry. */
  private summarise(sheet: { tallies: unknown; events: unknown }) {
    const events = readEvents(sheet.events);
    const totals = totalsFor(effectiveTallies(normaliseTallies(sheet.tallies), events));
    return {
      events: events.length,
      score: scoreFromEvents(events),
      shots: totals.shots,
      shotsOnTarget: totals.shotsOnTarget,
      corners: totals.corners,
      fouls: totals.fouls,
    };
  }

  /**
   * Approving is the only thing that publishes figures to the public site.
   * Totals are merged into SbMatch.stats so sibling keys the console does not
   * own — spotter data, matchday rosters, possession, goals — survive intact.
   */
  async approve(matchId: string, ctx: AdminAuthContext) {
    this.assertCanApprove(ctx);
    const match = await this.loadMatch(matchId, ctx);
    const sheet = await this.requireSheet(matchId);
    const current = sheetStatus(sheet);

    if (current !== "submitted") {
      throw new BadRequestException(
        current === "approved"
          ? "This sheet has already been approved"
          : "Only a submitted sheet can be approved"
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

    return this.publishSheet(match, sheet, ctx, null);
  }

  /**
   * Approve a submitted sheet as the clock, when `sheet-auto-approve.ts` says it may.
   *
   * Called by `SheetAutoApproveService`. The rule is judged again here on a fresh read,
   * so an approver who acted, a recorder who asked for a correction, or a squad edit
   * since the sweep listed the sheet all count. Returns whether it published.
   */
  async autoApprove(matchId: string, now = new Date()): Promise<boolean> {
    const match = await this.loadMatch(matchId, AUTO_APPROVER);
    const sheet = await this.requireSheet(matchId);
    if (!this.autoApproval(match, sheet, now).approve) return false;
    await this.publishSheet(match, sheet, AUTO_APPROVER, now);
    return true;
  }

  /** Shirt number -> named player from the squads `loadMatch` carries, as `approve` resolves it. */
  private numberLookupFor(match: Awaited<ReturnType<AdminMatchStatsService["loadMatch"]>>) {
    return buildNumberLookup({
      teamSquad: [...match.homeTeam.squad, ...match.awayTeam.squad].map((row) => ({
        teamId: row.teamId,
        number: row.shirtNumber,
        playerName: row.displayName,
        playerId: row.playerId,
      })),
      matchSquad: match.squadPlayers.map((row) => ({
        teamId: row.teamId,
        number: row.jerseyNumber,
        playerName: row.playerName,
        playerId: row.playerId,
      })),
    });
  }

  /** Whether, and when, this sheet approves itself, and what holds it back. */
  private autoApproval(
    match: Awaited<ReturnType<AdminMatchStatsService["loadMatch"]>>,
    sheet: Awaited<ReturnType<PrismaService["sbMatchStatistics"]["findUnique"]>>,
    now: Date
  ) {
    const lookup = this.numberLookupFor(match);
    const dangling = danglingNumbers(readEvents(sheet?.events), (side, number) =>
      lookup.resolve(side === "home" ? match.homeTeamId : match.awayTeamId, number)
    );
    const verdict = assessAutoApprove(
      {
        sheetStatus: sheetStatus(sheet as SheetRow | null),
        submittedAt: sheet?.submittedAt ?? null,
        submittedById: sheet?.submittedById ?? null,
        recorderId: sheet?.recorderId ?? null,
        autoSubmittedAt: sheet?.autoSubmittedAt ?? null,
        idleLockedAt: sheet?.idleLockedAt ?? null,
        idleReleasedAt: sheet?.idleReleasedAt ?? null,
        correctionRequested: Boolean(sheet?.correctionRequestedSection),
        correcting: isCorrecting(readClock(sheet?.clock)),
        isTraining: isTrainingCompetition(match.competition),
        dangling,
      },
      now
    );
    return { ...verdict, dangling };
  }

  /**
   * Publish a submitted sheet: the timeline, the figures and the score, in one
   * transaction. Shared by an approver's `approve` and the clock's `autoApprove`, so a
   * sheet the clock approves lands exactly as one a person approves.
   */
  private async publishSheet(
    match: Awaited<ReturnType<AdminMatchStatsService["loadMatch"]>>,
    sheet: Awaited<ReturnType<AdminMatchStatsService["requireSheet"]>>,
    ctx: AdminAuthContext,
    /** Set when the clock approves; null clears an earlier auto-approval. */
    autoApprovedAt: Date | null
  ) {
    const matchId = match.id;
    const tallies = normaliseTallies(sheet.tallies);
    const recorded = readEvents(sheet.events);

    /* Shirt number -> player, from the team squad first and the matchday squad
       second. It used to read the matchday squad alone, and most fixtures have none,
       so every number fell back to `No. 6` with a null playerId -- the goal reached
       no profile and the timeline showed a number where a person should be, while
       the names sat in `SbTeamSquad` untouched. See `squad-number-lookup.ts` for why
       the team squad wins and why an ambiguous number resolves to nobody. */
    const [matchSquad, teamSquad] = recorded.length
      ? await Promise.all([
          this.prisma.sbMatchSquadPlayer.findMany({
            where: { matchId, jerseyNumber: { not: null } },
            select: { teamId: true, jerseyNumber: true, playerName: true, playerId: true },
          }),
          this.prisma.sbTeamSquad.findMany({
            where: {
              teamId: { in: [match.homeTeamId, match.awayTeamId] },
              shirtNumber: { not: null },
            },
            select: { teamId: true, shirtNumber: true, displayName: true, playerId: true },
          }),
        ])
      : [[], []];
    const lookup = buildNumberLookup({
      teamSquad: teamSquad.map((row) => ({
        teamId: row.teamId,
        number: row.shirtNumber,
        playerName: row.displayName,
        playerId: row.playerId,
      })),
      matchSquad: matchSquad.map((row) => ({
        teamId: row.teamId,
        number: row.jerseyNumber,
        playerName: row.playerName,
        playerId: row.playerId,
      })),
    });
    const teamIdFor = (side: "home" | "away") =>
      side === "home" ? match.homeTeamId : match.awayTeamId;
    const squadFor = (event: RecordedEvent) =>
      lookup.find(teamIdFor(event.side), event.playerNumber);
    /* The assist provider or incoming substitute, resolved the same way. */
    const secondaryFor = (event: RecordedEvent) =>
      lookup.find(teamIdFor(event.side), event.secondaryPlayerNumber);

    const comments = generateEventComments(
      recorded as RecordedEventInput[],
      (event) => {
        const isHome = event.side === "home";
        return {
          teamName: isHome ? match.homeTeam.name : match.awayTeam.name,
          opponentName: isHome ? match.awayTeam.name : match.homeTeam.name,
          playerName: squadFor(event as RecordedEvent)?.playerName ?? null,
          secondaryName: secondaryFor(event as RecordedEvent)?.playerName ?? null,
        };
      }
    );

    const existingStats =
      match.stats && typeof match.stats === "object" && !Array.isArray(match.stats)
        ? (match.stats as Record<string, unknown>)
        : {};
    const existingMeta =
      match.meta && typeof match.meta === "object" && !Array.isArray(match.meta)
        ? (match.meta as Record<string, unknown>)
        : {};

    /* Re-approval must not duplicate the timeline, so this sheet's previously
       published events are cleared first. Only rows this console wrote are
       touched — anything logged by the spotter or match centre is left alone. */
    const eventRows = recorded.map((event, index) => ({
      matchId,
      teamId: teamIdFor(event.side),
      playerId: squadFor(event)?.playerId ?? null,
      playerLabel: squadNumberLabel(squadFor(event), event.playerNumber),
      /* The timeline already has fields for a second player: an assist on a
         goal, the incoming player on a substitution. */
      playerLabel2: squadNumberLabel(secondaryFor(event), event.secondaryPlayerNumber),
      assistPlayerId: event.type === "goal" ? secondaryFor(event)?.playerId ?? null : null,
      assistLabel:
        event.type === "goal"
          ? squadNumberLabel(secondaryFor(event), event.secondaryPlayerNumber)
          : null,
      type: event.type,
      minute: event.minute,
      detail: comments[index],
      metadata: {
        source: "match_recorder",
        sheetId: sheet.id,
        addedMinute: event.addedMinute,
        half: event.half,
        playerNumber: event.playerNumber,
        secondaryPlayerNumber: event.secondaryPlayerNumber,
        recorderSequence: index,
      } as Prisma.InputJsonValue,
    }));

    const stamp: Record<string, unknown> = {};
    for (const section of SHEET_SECTIONS) {
      const col = SECTION_COLUMNS[section];
      stamp[col.status] = "approved";
      stamp[col.approvedById] = ctx.userId ?? null;
      stamp[col.approvedByName] = actorName(ctx);
      stamp[col.approvedAt] = new Date();
    }
    stamp.autoApprovedAt = autoApprovedAt;

    /* One approval publishes both artefacts, in one transaction. The timeline
       and the figures derived from it now reach the public site together or
       not at all — there is no window where they can disagree. */
    /* The approved goal events, and any goal added from video: that row is not this
       console's, survives the rewrite below, and stays on the public timeline. */
    const score = withVideoGoals(scoreFromEvents(recorded), await videoGoals(this.prisma, match));
    const penaltyShootout = penaltyShootoutFromEvents(recorded);
    /* A corrected record is a finished match too: re-approving it must mark the match
       finished and refresh the standings for the corrected score, as the first approval did. */
    const finished = matchIsOver(readClock(sheet.clock));
    /* Approval closes the correction. The record locks at full time again, so a further
       change goes back through a correction request. */
    if (isCorrecting(readClock(sheet.clock))) {
      stamp.clock = { ...readClock(sheet.clock), phase: "finished" };
    }
    const nextMeta = { ...existingMeta };
    if (penaltyShootout) {
      nextMeta.penaltyShootout = penaltyShootout;
      nextMeta.regulationScore = score;
    } else {
      delete nextMeta.penaltyShootout;
      delete nextMeta.regulationScore;
    }
    /* Those cleared events keep their credit unless it is taken back first, and
       `deleteMany` does not hand back what it removed -- so the reversal runs
       before the writes, while the rows can still be read. Re-approving a sheet
       used to leave every scorer on it a goal richer. */
    await this.lifecycle.reverseMatchEventStatsByFilter(
      { matchId, metadata: { path: ["source"], equals: "match_recorder" } },
      match.competitionId
    );
    const writes: Prisma.PrismaPromise<unknown>[] = [
      /* Re-approval must not duplicate the timeline, so this sheet's previously
         published events are cleared first. */
      this.prisma.sbMatchEvent.deleteMany({
        where: { matchId, metadata: { path: ["source"], equals: "match_recorder" } },
      }),
      ...(eventRows.length
        ? [this.prisma.sbMatchEvent.createMany({ data: eventRows })]
        : []),
      this.prisma.sbMatch.update({
        where: { id: matchId },
        data: {
          /* The scoreline follows the approved goal events, so the match score
             and its timeline can never disagree. */
          homeScore: score.home,
          awayScore: score.away,
          ...(finished && !isTrainingCompetition(match.competition)
            ? { status: "finished", minute: match.minute ?? 90 }
            : {}),
          meta: nextMeta as Prisma.InputJsonValue,
          stats: {
            ...existingStats,
            /* Published figures include what the event log captured, so the
               public site never shows a corner count that the match timeline
               beside it contradicts. */
            ...totalsFor(effectiveTallies(tallies, recorded)),
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
      this.prisma.sbMatchStatistics.update({
        where: { matchId },
        data: stamp as Prisma.SbMatchStatisticsUpdateInput,
      }),
    ]);

    // The sheet stamp is always the last write in the transaction.
    const updated = results[results.length - 1] as Awaited<
      ReturnType<PrismaService["sbMatchStatistics"]["update"]>
    >;
    await this.log(sheet, WHOLE_SHEET, "approved", ctx, {
      note: autoApprovedAt
        ? "Approved automatically ten minutes after the recorder submitted it, with every shirt number named."
        : null,
      summary: this.summarise(sheet) as Prisma.InputJsonValue,
    });

    try {
      /* Rows Vision had enriched were deleted with the rest, here or when the sheet was
         sent back, and their candidates left waiting. Each goes back on the rewritten row
         that is the same event. Swallowed like the steps below, and for the same reason: a
         candidate that is not put back stays marked stale, which Vision refuses to promote
         again until it has been reviewed afresh -- a safe place to be left. */
      const put = await reapplyEnrichment(this.prisma, matchId);
      if (put.stale.length) {
        this.logger.warn(
          `Match ${matchId}: ${put.stale.length} video-reviewed event(s) no longer match a ` +
            "row on the approved sheet and were left for review again."
        );
      }
    } catch {
      /* The candidates stay stale; see reapply-enrichment.ts. */
    }

    /* Anybody the timeline named who is not in their team's squad gets a row, with no
       shirt number for staff to fill in later. Outside the transaction and inside a
       try, because this must never be able to fail a publish: the recorder would have
       no idea why, and ninety minutes of captured events are worth more than a squad
       row. `admitSquadName` is what stops a label like `No. 7` or `VIDO 99 FC`
       becoming a person -- see `squad-from-timeline.ts`. */
    try {
      await addSquadMembersFromTimeline(
        {
          db: this.prisma as never,
          resolvePlayer: (displayName) =>
            this.playerDirectory.resolveOrCreatePlayer(displayName),
        },
        eventRows.map((row) => ({
          teamId: row.teamId,
          playerLabel: row.playerLabel,
          playerLabel2: row.playerLabel2,
          assistLabel: row.assistLabel,
        }))
      );
    } catch {
      /* Swallowed on purpose. The sheet is published and correct; a squad row that did
         not get created is picked up by db:sync:squad-from-timeline later. */
    }

    try {
      /* After the squad sync, not before: the people these labels name may have been
         created by the call above, and a goal cannot be linked to a record that does not
         exist yet.

         A published event takes its player from the squad row the recorder picked, so a row
         that is not itself linked to a player record leaves the goal with a name and nobody
         behind it. That was 88 goals on live, seven of them one boy's. Swallowed for the
         same reason as the sync: an unlinked goal is recoverable by script, and failing a
         recorder's publish over it is not. */
      await linkMatchGoals(this.prisma as never, matchId);
    } catch {
      /* db:link:unattributed-goals is the backstop. */
    }
    if (finished && !isTrainingCompetition(match.competition)) {
      if (match.status !== "finished") {
        await this.lifecycle.onMatchFinished(matchId);
      } else if (match.homeScore !== score.home || match.awayScore !== score.away) {
        await this.lifecycle.refreshStandingsForFinishedMatch(matchId);
      }
    }
    return this.present({ ...match }, updated, ctx);
  }

  /**
   * Every recording the idle sweep has stopped, newest first.
   *
   * Feeds the dashboard panel. Carries what a super admin needs to judge it without
   * opening the console: which match, who was recording, and how long it had been
   * quiet -- twenty minutes of silence in a cup final reads very differently from
   * twenty minutes in a friendly nobody was watching.
   */
  async listIdleLocked(ctx: AdminAuthContext) {
    this.assertCanApprove(ctx);
    const rows = await this.prisma.sbMatchStatistics.findMany({
      where: { idleLockedAt: { not: null } },
      orderBy: { idleLockedAt: "desc" },
      select: {
        matchId: true,
        idleLockedAt: true,
        idleLockedSinceAt: true,
        lastEventAt: true,
        recorderName: true,
        clock: true,
        match: {
          select: {
            slug: true,
            kickoffAt: true,
            homeTeam: { select: { name: true } },
            awayTeam: { select: { name: true } },
            competition: { select: { name: true } },
          },
        },
      },
    });

    return rows.map((row) => {
      const lockedAt = row.idleLockedAt!;
      const since = row.idleLockedSinceAt ?? lockedAt;
      return {
        matchId: row.matchId,
        matchSlug: row.match.slug,
        competitionName: row.match.competition.name,
        homeTeam: row.match.homeTeam.name,
        awayTeam: row.match.awayTeam.name,
        kickoffAt: row.match.kickoffAt,
        recorderName: row.recorderName,
        lockedAt,
        quietSinceAt: since,
        quietMinutes: quietMinutes(lockedAt.getTime() - since.getTime()),
        /* Null means nothing was ever filed, so the recording was left from kick-off --
           a different story from one that stopped mid-match. */
        lastEventAt: row.lastEventAt,
        clockPhase: readClock(row.clock)?.phase ?? null,
      };
    });
  }

  /**
   * Release a stopped recording, with a note saying why.
   *
   * The note is required rather than optional: releasing a lock leaves no other trace
   * of the judgement somebody made, and "the recorder was there all along, only tapping
   * tallies" is exactly the sentence the next person needs.
   *
   * `lastEventAt` moves to now on the way out, so the sweep does not lock it again a
   * minute later on the strength of the same silence it was just released for.
   */
  async releaseIdleLock(matchId: string, note: string | undefined, ctx: AdminAuthContext) {
    this.assertCanApprove(ctx);
    const sheet = await this.requireSheet(matchId);
    if (!sheet.idleLockedAt) {
      throw new BadRequestException("This recording is not stopped.");
    }
    const trimmed = note?.trim();
    if (!trimmed) {
      throw new BadRequestException("Say why you are releasing this recording.");
    }

    const updated = await this.prisma.sbMatchStatistics.update({
      where: { matchId },
      data: {
        idleLockedAt: null,
        idleLockedSinceAt: null,
        idleReleasedById: ctx.userId ?? null,
        idleReleasedByName: ctx.displayName ?? null,
        idleReleasedAt: new Date(),
        idleReleaseNote: trimmed,
        lastEventAt: new Date(),
      },
    });
    await this.log(sheet, WHOLE_SHEET, "idle_released", ctx, { note: trimmed });
    const match = await this.loadMatch(matchId, ctx);
    return this.present(match, updated, ctx);
  }
  /**
   * Send back for edits, returning the sheet to `live`. Only a submitted sheet
   * can be sent back, so nothing already published to the public site is
   * affected — approved figures are withdrawn by re-approving a corrected
   * sheet, never by this path.
   */
  async sendBack(matchId: string, note: string | undefined, ctx: AdminAuthContext) {
    this.assertCanApprove(ctx);
    const match = await this.loadMatch(matchId, ctx);
    const sheet = await this.requireSheet(matchId);

    const current = sheetStatus(sheet);
    const answersCorrection = Boolean(sheet.correctionRequestedSection);
    /* Except to answer a correction request. A record locks at full time while still
       `live`, and a pending request holds back the auto-submit, so refusing here left a
       request nobody could approve. */
    if (current === "live" && !answersCorrection) {
      throw new BadRequestException("This sheet is already open for edits");
    }

    /* An approved sheet can be pulled back too. Without this a supervisor who
       approves the wrong figures has no way to correct them, and the mistake
       stays on the public site permanently. */
    const wasApproved = current === "approved";

    const stamp: Record<string, unknown> = {};
    for (const section of SHEET_SECTIONS) {
      const col = SECTION_COLUMNS[section];
      stamp[col.status] = "live";
      if (wasApproved) {
        stamp[col.approvedById] = null;
        stamp[col.approvedByName] = null;
        stamp[col.approvedAt] = null;
      }
      stamp[col.sentBackById] = ctx.userId ?? null;
      stamp[col.sentBackByName] = actorName(ctx);
      stamp[col.sentBackAt] = new Date();
      stamp[col.sentBackNote] = note?.trim() ? note.trim() : null;
      stamp[col.submittedById] = null;
      stamp[col.submittedByName] = null;
      stamp[col.submittedAt] = null;
    }

    /* The match is over, so it reopens for corrections rather than for recording. It used
       to go back to `running` on its original anchors: the clock then read hours past full
       time, jumped straight to the added-time prompt, and the public page could show the
       match as live again. An approved sheet is a finished match even when its clock never
       reached full time, since approving published the result. */
    const clock = readClock(sheet.clock);
    const reopensForCorrection =
      isFullTime(clock) || (wasApproved && hasKickedOff(clock) && !isCorrecting(clock));

    const updated = await this.prisma.sbMatchStatistics.update({
      where: { matchId },
      data: {
        ...stamp,
        /* A send-back answers any pending correction request and reopens the
           record, so the full-time lock lifts with it. */
        ...(answersCorrection
          ? {
              correctionRequestedSection: null,
              correctionRequestedById: null,
              correctionRequestedByName: null,
              correctionRequestedAt: null,
              correctionRequestNote: null,
            }
          : {}),
        ...(reopensForCorrection && clock
          ? { clock: { ...clock, phase: "correction" } as Prisma.InputJsonValue }
          : {}),
      } as Prisma.SbMatchStatisticsUpdateInput,
    });

    await this.log(
      sheet,
      WHOLE_SHEET,
      answersCorrection ? "correction_approved" : "sent_back",
      ctx,
      { note: note?.trim() || null }
    );

    /* Withdraw the published event log so the public timeline matches the
       sheet's state. The statistics merged into SbMatch.stats cannot be unwound
       the same way — they stay until a corrected sheet is approved over them. */
    if (wasApproved) {
      // Same reason as above: withdraw the credit with the log.
      await this.lifecycle.reverseMatchEventStatsByFilter(
        { matchId, metadata: { path: ["source"], equals: "match_recorder" } },
        match.competitionId
      );
      await this.prisma.sbMatchEvent.deleteMany({
        where: { matchId, metadata: { path: ["source"], equals: "match_recorder" } },
      });
      /* The score follows the approved log, so withdrawing the log has to
         withdraw the scoreline too — otherwise the public match would show
         goals with an empty timeline behind them. */
      const reopenedMeta =
        match.meta && typeof match.meta === "object" && !Array.isArray(match.meta)
          ? { ...(match.meta as Record<string, unknown>) }
          : {};
      delete reopenedMeta.penaltyShootout;
      delete reopenedMeta.regulationScore;
      /* Nil, but for any goal added from video: that row was not withdrawn with the
         log and is still on the timeline. */
      const fromVideo = await videoGoals(this.prisma, match);
      await this.prisma.sbMatch.update({
        where: { id: matchId },
        data: {
          homeScore: fromVideo.home,
          awayScore: fromVideo.away,
          meta: reopenedMeta as Prisma.InputJsonValue,
        },
      });
    }

    return this.present(match, updated, ctx);
  }

  /**
   * A recorder asking for a locked record back.
   *
   * This only records the ask — the sheet stays locked until a ScoreBoard admin
   * approves it by sending the section back.
   */
  async requestCorrection(matchId: string, note: string | undefined, ctx: AdminAuthContext) {
    this.assertCanRecord(ctx);
    const match = await this.loadMatch(matchId, ctx);
    const sheet = await this.requireSheet(matchId);
    this.assertOwnsSheet(sheet, ctx, match);

    if (sheet.correctionRequestedSection) {
      throw new BadRequestException(
        "A correction request is already pending on this sheet"
      );
    }

    const updated = await this.prisma.sbMatchStatistics.update({
      where: { matchId },
      data: {
        correctionRequestedSection: WHOLE_SHEET,
        correctionRequestedById: ctx.userId ?? null,
        correctionRequestedByName: actorName(ctx),
        correctionRequestedAt: new Date(),
        correctionRequestNote: note?.trim() ? note.trim() : null,
      },
    });

    await this.log(sheet, WHOLE_SHEET, "correction_requested", ctx, {
      note: note?.trim() || null,
    });
    return this.present(match, updated, ctx);
  }

  /** An admin turning down a correction request, leaving the record locked. */
  async declineCorrection(
    matchId: string,
    note: string | undefined,
    ctx: AdminAuthContext
  ) {
    this.assertCanApprove(ctx);
    const match = await this.loadMatch(matchId, ctx);
    const sheet = await this.requireSheet(matchId);

    if (!sheet.correctionRequestedSection) {
      throw new BadRequestException("There is no correction request to decline");
    }
    /* Older requests name a single section; newer ones name the whole sheet.
       The history entry records whichever the request was raised against. */
    const section = sheet.correctionRequestedSection as SheetSection | typeof WHOLE_SHEET;

    const updated = await this.prisma.sbMatchStatistics.update({
      where: { matchId },
      data: {
        correctionRequestedSection: null,
        correctionRequestedById: null,
        correctionRequestedByName: null,
        correctionRequestedAt: null,
        correctionRequestNote: null,
      },
    });

    await this.log(sheet, section, "correction_declined", ctx, {
      note: note?.trim() || null,
    });
    return this.present(match, updated, ctx);
  }

  /**
   * Headline numbers for the recorder's landing page: how much of their work
   * has been signed off. Counts only — no match detail.
   */
  async myTotals(ctx: AdminAuthContext) {
    if (!hasPermission(ctx, RECORD_PERMISSION) && !hasPermission(ctx, APPROVE_PERMISSION)) {
      throw new ForbiddenException("You cannot view match statistics totals");
    }

    /* Scoped to the recorder's own sheets where they have one, so the numbers
       describe their work rather than the whole competition. */
    const mine = ctx.userId ? { recorderId: ctx.userId } : {};
    const scoped = scopedCompetitions(ctx);
    const scope = scoped ? { match: { competitionId: { in: scoped } } } : {};
    const where = { ...mine, ...scope };

    /* Statistics and events are approved together, so one count covers both.
       The AND on the two columns keeps older half-approved sheets honest. */
    const [approved, submitted, fixturesRecorded, pending] = await Promise.all([
      this.prisma.sbMatchStatistics.count({
        where: { ...where, status: "approved", eventsStatus: "approved" },
      }),
      this.prisma.sbMatchStatistics.count({
        where: {
          ...where,
          OR: [{ status: "submitted" }, { eventsStatus: "submitted" }],
        },
      }),
      this.prisma.sbMatchStatistics.count({ where }),
      this.prisma.sbMatchStatistics.count({
        where: { ...where, correctionRequestedSection: { not: null } },
      }),
    ]);

    return {
      sheetsApproved: approved,
      awaitingApproval: submitted,
      fixturesRecorded,
      correctionsPending: pending,
    };
  }

  /** Supervisor queue: everything waiting on a decision. */
  async listSubmitted(ctx: AdminAuthContext) {
    this.assertCanApprove(ctx);
    const sheets = await this.prisma.sbMatchStatistics.findMany({
      where: {
        OR: [{ status: "submitted" }, { eventsStatus: "submitted" }],
        ...(scopedCompetitions(ctx) ? { match: { competitionId: { in: scopedCompetitions(ctx)! } } } : {}),
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
      status: sheetStatus(sheet as SheetRow),
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

  /** Append one entry to the sheet's history. Never updates, only appends. */
  private async log(
    sheet: { id: string; matchId: string },
    /** "sheet" for whole-sheet actions; the old values still appear in history. */
    section: SheetSection | typeof WHOLE_SHEET,
    action: SheetLogAction,
    ctx: AdminAuthContext,
    extra?: { note?: string | null; summary?: Prisma.InputJsonValue }
  ) {
    await this.prisma.sbMatchSheetLog.create({
      data: {
        sheetId: sheet.id,
        matchId: sheet.matchId,
        section,
        action,
        actorId: ctx.userId ?? null,
        actorName: actorName(ctx),
        actorRole: ctx.roleName ?? ctx.roleSlug ?? null,
        note: extra?.note ?? null,
        summary: extra?.summary,
      },
    });
  }

  /** The sheet's history, newest first. */
  async history(matchId: string, ctx: AdminAuthContext) {
    const match = await this.loadMatch(matchId, ctx);
    void match;
    const rows = await this.prisma.sbMatchSheetLog.findMany({
      where: { matchId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      section: r.section as SheetSection | typeof WHOLE_SHEET,
      action: r.action as SheetLogAction,
      actorName: r.actorName,
      actorRole: r.actorRole,
      note: r.note,
      summary: r.summary,
      createdAt: r.createdAt,
    }));
  }

  private async requireSheet(matchId: string) {
    const sheet = await this.prisma.sbMatchStatistics.findUnique({ where: { matchId } });
    if (!sheet) throw new NotFoundException("No statistics sheet has been opened for this match");
    return sheet;
  }

  /**
   * Sheets belong to the recorder who claimed them.
   *
   * Training sheets are exempt: a practice fixture is shared equipment, and
   * the first trainee to open one would otherwise lock out everybody else.
   */
  private assertOwnsSheet(
    sheet: { recorderId: string | null; clock?: unknown },
    ctx: AdminAuthContext,
    match?: { competition?: { formatConfig?: unknown } | null }
  ) {
    if (match && isTrainingCompetition(match.competition ?? null)) return;
    // Ignore ownership left by the former claim-on-open workflow.
    if (!readClock(sheet.clock)?.firstHalfStartedAt) return;
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
    /* One status for the whole sheet: statistics and events are submitted and
       approved together, so there is nothing left to report separately. */
    const status = sheetStatus(row);
    const tallies = normaliseTallies(sheet?.tallies);
    const canRecord = hasPermission(ctx, RECORD_PERMISSION);
    const canApprove = hasPermission(ctx, APPROVE_PERMISSION);
    const ownsSheet =
      !readClock(sheet?.clock)?.firstHalfStartedAt ||
      isTrainingCompetition(match.competition) ||
      ctx.method === "api_key" || ctx.roleSlug === "super_admin" ||
      !sheet?.recorderId || !ctx.userId || sheet.recorderId === ctx.userId;

    const recorded = readEvents(sheet?.events);
    /* The idle lock is the one the recorder cannot lift, so the console needs to say so
       and offer the release to whoever can. Same training exemption as the save guard. */
    const idleLockedAt = !isTrainingCompetition(match.competition) ? sheet?.idleLockedAt ?? null : null;
    const idleSince = idleLockedAt ? sheet?.idleLockedSinceAt ?? idleLockedAt : null;
    const lockedForEditing = !isTrainingCompetition(match.competition) &&
      (isFullTime(readClock(sheet?.clock)) || Boolean(idleLockedAt));

    return {
      matchId: match.id,
      status,
      /** What was tapped by hand. The console edits this and nothing else. */
      tallies,
      /** What the event log contributed, shown alongside but never edited. */
      captured: capturedFromEvents(recorded),
      totals: totalsFor(effectiveTallies(tallies, recorded)),
      /* Manual stats first, event-fed ones last: the recorder's attention
         belongs on the rows only they can fill. */
      stats: ORDERED_STAT_DEFS,
      /* What the read-only views show. Total shots appears here but not in
         MATCH_STAT_DEFS, because it is derived rather than tapped. */
      displayStats: [
        { key: "shots", label: "Total shots", split: false, derived: true, autoCaptured: false },
        ...ORDERED_STAT_DEFS.map((d) => ({ ...d, derived: false })),
      ],
      /** Which event types feed which statistic, so the console can say so. */
      eventCapture: EVENT_STAT_CAPTURE,
      events: recorded,
      /** Live scoreline implied by the logged goal events. */
      derivedScore: scoreFromEvents(recorded),
      clock: readClock(sheet?.clock),
      kits: readKits(sheet?.kits) ?? { home: "#4c9ffe", away: "#f5a524" },
      eventTypes: MATCH_EVENT_TYPES,
      /* The statistics columns carry the sheet's audit trail. Both column sets
         are written together, so either tells the same story. */
      audit: {
        recorderId: readClock(sheet?.clock)?.firstHalfStartedAt ? sheet?.recorderId ?? null : null,
        recorderName: readClock(sheet?.clock)?.firstHalfStartedAt ? sheet?.recorderName ?? null : null,
        submittedByName: sheet?.submittedByName ?? null,
        submittedAt: sheet?.submittedAt ?? null,
        approvedByName: sheet?.approvedByName ?? null,
        approvedAt: sheet?.approvedAt ?? null,
        /** Set when the clock approved it; the console says so instead of naming a person. */
        autoApprovedAt: sheet?.autoApprovedAt ?? null,
        autoSubmittedAt: sheet?.autoSubmittedAt ?? null,
        sentBackByName: sheet?.sentBackByName ?? null,
        sentBackAt: sheet?.sentBackAt ?? null,
        sentBackNote: sheet?.sentBackNote ?? null,
      },
      /** Full time locks the record until a correction is approved. */
      lockedAtFullTime: isFullTime(readClock(sheet?.clock)),
      correctionRequest: sheet?.correctionRequestedSection
        ? {
            byName: sheet.correctionRequestedByName,
            at: sheet.correctionRequestedAt,
            note: sheet.correctionRequestNote,
          }
        : null,
      /**
       * Whether this submitted sheet will approve and publish itself ten minutes after
       * submission, and if not, why not. See `sheet-auto-approve.ts`.
       */
      autoApproval: (() => {
        const verdict = this.autoApproval(match, sheet, new Date());
        return { dueAt: verdict.dueAt, blocks: verdict.blocks, dangling: verdict.dangling };
      })(),
      /** Set when the idle sweep stopped this recording; null otherwise. */
      idleLock:
        idleLockedAt && idleSince
          ? {
              lockedAt: idleLockedAt,
              quietSinceAt: idleSince,
              quietMinutes: quietMinutes(idleLockedAt.getTime() - idleSince.getTime()),
            }
          : null,
      /** Mirrors the server rules exactly, so the UI never offers a control
       *  the API would reject. */
      permissions: {
        canRecord,
        canApprove,
        canEdit: canRecord && status !== "approved" && ownsSheet && !lockedForEditing,
        canSubmit: canRecord && status !== "approved" && ownsSheet,
        canApproveThis: canApprove && status === "submitted",
        canReleaseIdleLock: canApprove && Boolean(idleLockedAt),
      },
      match: {
        id: match.id,
        kickoffAt: match.kickoffAt,
        venue: match.venue,
        roundLabel: match.roundLabel,
        matchday: match.matchday,
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        liveFeature: readLiveFeature(match.stats),
        squadPlayers: match.squadPlayers.map((player) => ({
          teamId: player.teamId,
          playerId: player.playerId,
          playerName: player.playerName,
          jerseyNumber: player.jerseyNumber,
        })),
        /* Sent separately rather than merged into `squadPlayers`, so the console can
           apply the same precedence the server does and show which source a name came
           from. Merging them would hide a disagreement between the two. */
        teamSquad: [...match.homeTeam.squad, ...match.awayTeam.squad].map((row) => ({
          teamId: row.teamId,
          playerId: row.playerId,
          playerName: row.displayName,
          jerseyNumber: row.shirtNumber,
        })),
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
          isTraining: isTrainingCompetition(match.competition),
          /** Preselects the half length at kick-off (5 for training). */
          halfLengthMinutes: competitionHalfLength(match.competition),
        },
      },
    };
  }
}
