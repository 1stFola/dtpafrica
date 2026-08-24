import { adminFetch } from "./admin";

export type SheetStatus = "live" | "submitted" | "approved";

/** Statistics and the event log are reviewed independently. */
export type SheetSection = "stats" | "events";

export type SectionPermissions = {
  canRecord: boolean;
  canApprove: boolean;
  canEdit: boolean;
  canSubmit: boolean;
  canApproveThis: boolean;
};

export type SectionAudit = {
  submittedByName: string | null;
  submittedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  sentBackByName: string | null;
  sentBackAt: string | null;
  sentBackNote: string | null;
};
export type Half = "1st" | "2nd";
export type Side = "home" | "away";

export type SidePair = { home: number; away: number };
export type SplitTally = Record<Half, SidePair>;
export type TallyValue = SidePair | SplitTally;

export type MatchStatDef = { key: string; label: string; split: boolean };

/** One tapped pitch event. `minute` is the logged minute; added time is separate. */
export type RecordedEvent = {
  id: string;
  type: string;
  minute: number;
  addedMinute: number | null;
  side: Side;
  playerNumber: number | null;
  half: 1 | 2;
};

export type ClockPhase =
  | "pre_kickoff"
  | "running"
  | "awaiting_added"
  | "added_running"
  | "awaiting_second_half"
  | "finished";

/**
 * Match clock. Holds wall-clock anchors rather than an elapsed count, so the
 * running time is derived on render — it keeps ticking across tab switches and
 * survives a reload. Half length is chosen at kick-off because competitions run
 * anywhere from 30- to 45-minute halves.
 */
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

export type MatchStatsSheet = {
  matchId: string;
  status: SheetStatus;
  eventsStatus: SheetStatus;
  tallies: Record<string, TallyValue>;
  totals: Record<string, SidePair>;
  /** Stat vocabulary comes from the server so the two cannot drift. */
  stats: MatchStatDef[];
  events: RecordedEvent[];
  /** Live scoreline implied by the logged goal events. */
  derivedScore: { home: number; away: number };
  clock: ClockState | null;
  kits: KitColours;
  /** Event types offered on the tap grid, already alphabetical. */
  eventTypes: string[];
  audit: SectionAudit & { recorderId: string | null; recorderName: string | null };
  eventsAudit: SectionAudit;
  permissions: SectionPermissions;
  eventsPermissions: SectionPermissions;
  match: {
    id: string;
    kickoffAt: string | null;
    venue: string | null;
    roundLabel: string | null;
    matchday: number | null;
    homeScore: number;
    awayScore: number;
    homeTeam: { id: string; name: string; shortName: string | null; logoUrl: string | null };
    awayTeam: { id: string; name: string; shortName: string | null; logoUrl: string | null };
    competition: {
      id: string;
      name: string;
      logoUrl: string | null;
      /** Training fixtures never reach the public site. */
      isTraining?: boolean;
      /** Half length the competition prefers, preselected at kick-off. */
      halfLengthMinutes?: number | null;
    };
  };
};

/** A fixture the signed-in account may record for, already competition-scoped. */
export type MatchStatsFixture = {
  id: string;
  kickoffAt: string | null;
  venue: string | null;
  roundLabel: string | null;
  status: string;
  sheetStatus: SheetStatus | null;
  recorderName: string | null;
  homeTeam: { name: string; logoUrl: string | null };
  awayTeam: { name: string; logoUrl: string | null };
  competition: {
    id: string;
    name: string;
    logoUrl: string | null;
    isTraining?: boolean;
  };
};

export type MatchStatsQueueItem = {
  matchId: string;
  status: SheetStatus;
  eventsStatus: SheetStatus;
  /** Which tracks are actually waiting on this supervisor. */
  awaiting: SheetSection[];
  submittedAt: string | null;
  submittedByName: string | null;
  recorderName: string | null;
  match: {
    id: string;
    kickoffAt: string | null;
    roundLabel: string | null;
    homeTeam: { name: string; logoUrl: string | null };
    awayTeam: { name: string; logoUrl: string | null };
    competition: { name: string; logoUrl: string | null };
  };
};

const base = "/admin/scoreboard/match-stats";

export const matchStatsApi = {
  open: (matchId: string) => adminFetch<MatchStatsSheet>(`${base}/${matchId}`),

  save: (
    matchId: string,
    tallies: Record<string, TallyValue>,
    extras?: {
      events?: RecordedEvent[];
      clock?: ClockState | null;
      kits?: KitColours | null;
    }
  ) =>
    adminFetch<MatchStatsSheet>(`${base}/${matchId}`, {
      method: "PUT",
      body: JSON.stringify({
        tallies,
        ...(extras?.events ? { events: extras.events } : {}),
        ...(extras?.clock ? { clock: extras.clock } : {}),
        ...(extras?.kits ? { kits: extras.kits } : {}),
      }),
    }),

  submit: (matchId: string, section: SheetSection) =>
    adminFetch<MatchStatsSheet>(`${base}/${matchId}/${section}/submit`, { method: "POST" }),

  approve: (matchId: string, section: SheetSection) =>
    adminFetch<MatchStatsSheet>(`${base}/${matchId}/${section}/approve`, { method: "POST" }),

  sendBack: (matchId: string, section: SheetSection, note?: string) =>
    adminFetch<MatchStatsSheet>(`${base}/${matchId}/${section}/send-back`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  queue: () => adminFetch<MatchStatsQueueItem[]>(`${base}/queue`),

  fixtures: (range: { from?: string; to?: string }) => {
    const params = new URLSearchParams();
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    const qs = params.toString();
    return adminFetch<MatchStatsFixture[]>(`${base}/fixtures${qs ? `?${qs}` : ""}`);
  },
};
