import { adminFetch } from "./admin";

export type LiveAudioStatus = {
  active: boolean;
  sequence: number;
  startedAt: string | null;
  mimeType: string | null;
};

export type LiveAudioTicket = {
  ticket: string;
  expiresAt: string;
  wsPath: string;
};

export type LiveAudioHttpSession = {
  sessionId: string;
  status: LiveAudioStatus;
};

export type SheetStatus = "live" | "submitted" | "approved";

/** Statistics and the event log are reviewed independently. */
/**
 * Where a history entry or correction request was raised.
 *
 * "sheet" is what whole-sheet actions record now that statistics and events
 * are submitted together; the older values still appear in existing history.
 */
export type SheetSection = "stats" | "events" | "sheet";

export type SectionPermissions = {
  canRecord: boolean;
  canApprove: boolean;
  canEdit: boolean;
  canSubmit: boolean;
  canApproveThis: boolean;
  /** An approver looking at a recording the idle sweep stopped. */
  canReleaseIdleLock?: boolean;
};

export type SectionAudit = {
  submittedByName: string | null;
  submittedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  sentBackByName: string | null;
  sentBackAt: string | null;
  sentBackNote: string | null;
  /** Set when the clock approved the sheet rather than an approver. */
  autoApprovedAt?: string | null;
  /** Set when the clock submitted the sheet at full time rather than the recorder. */
  autoSubmittedAt?: string | null;
};

/** Why a submitted sheet will not approve itself; see `sheet-auto-approve.ts` on the API. */
export type AutoApproveBlock =
  | "not_submitted"
  | "training"
  | "submitted_by_clock"
  | "not_submitted_by_recorder"
  | "idle_locked"
  | "correction_requested"
  | "dangling_numbers";

/**
 * Whether a submitted sheet approves and publishes itself ten minutes after submission.
 * No `blocks` means it will, at `dueAt`.
 */
export type AutoApproval = {
  dueAt: string | null;
  blocks: AutoApproveBlock[];
  /**
   * Shirt numbers on the sheet that name nobody: either no squad row wears it
   * (`sharedBy` empty) or several players do (`sharedBy` names them).
   */
  dangling: Array<{
    side: "home" | "away";
    number: number;
    sharedBy: string[];
    eventType: string;
    minute: number;
  }>;
};
export type Half = "1st" | "2nd";
export type Side = "home" | "away";

export type SidePair = { home: number; away: number };
export type SplitTally = Record<Half, SidePair>;
export type TallyValue = SidePair | SplitTally;

/**
 * Event type to the statistics it also counts toward.
 *
 * `side` is whose column the count lands in: "opponent" covers cases like a
 * saved penalty, which is a save for one side and a penalty awarded the other.
 */
export type EventCaptureMap = Record<
  string,
  ReadonlyArray<{ key: string; side: "same" | "opponent" }>
>;

export type MatchStatDef = {
  key: string;
  label: string;
  split: boolean;
  /** True when the event log can feed this statistic on its own. */
  autoCaptured?: boolean;
};

/** One tapped pitch event. `minute` is the logged minute; added time is separate. */
export type RecordedEvent = {
  id: string;
  type: string;
  minute: number;
  addedMinute: number | null;
  side: Side;
  playerNumber: number | null;
  /** Incoming player on a substitution, or the assist provider on a goal. */
  secondaryPlayerNumber: number | null;
  half: 1 | 2;
};

export type SheetLogAction =
  | "submitted"
  | "resubmitted"
  | "approved"
  | "sent_back"
  | "correction_requested"
  | "correction_approved"
  | "correction_declined"
  | "idle_locked"
  | "idle_released";

export type SheetLogEntry = {
  id: string;
  section: SheetSection;
  action: SheetLogAction;
  actorName: string | null;
  actorRole: string | null;
  note: string | null;
  summary: Record<string, unknown> | null;
  createdAt: string;
};

export type CorrectionRequest = {
  byName: string | null;
  at: string | null;
  note: string | null;
};

/** Headline counts for the recorder's landing page. */
export type MatchStatsTotals = {
  /** Statistics and events are approved together, so one count covers both. */
  sheetsApproved: number;
  awaitingApproval: number;
  fixturesRecorded: number;
  correctionsPending: number;
};

export type ClockPhase =
  | "pre_kickoff"
  | "running"
  | "awaiting_added"
  | "added_running"
  | "awaiting_second_half"
  | "awaiting_full_time"
  | "penalty_shootout"
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
  /** One status for the whole sheet: statistics and events move together. */
  status: SheetStatus;
  tallies: Record<string, TallyValue>;
  /** The event log's contribution, kept apart from what was tapped by hand. */
  captured: Record<string, TallyValue>;
  /** Which event types feed which statistic. The server owns this definition. */
  eventCapture: EventCaptureMap;
  totals: Record<string, SidePair>;
  /** Stat vocabulary comes from the server so the two cannot drift. */
  stats: MatchStatDef[];
  /** What the read-only views show, including derived figures like total shots. */
  displayStats: Array<MatchStatDef & { derived: boolean }>;
  /** True once the clock reaches full time; edits need a correction approved. */
  lockedAtFullTime: boolean;
  correctionRequest: CorrectionRequest | null;
  /** Set when the idle sweep stopped this recording: no event for twenty minutes. */
  idleLock?: { lockedAt: string; quietSinceAt: string; quietMinutes: number } | null;
  autoApproval?: AutoApproval;
  events: RecordedEvent[];
  /** Live scoreline implied by the logged goal events. */
  derivedScore: { home: number; away: number };
  clock: ClockState | null;
  kits: KitColours;
  /** Event types offered on the tap grid, already alphabetical. */
  eventTypes: string[];
  audit: SectionAudit & { recorderId: string | null; recorderName: string | null };
  permissions: SectionPermissions;
  match: {
    id: string;
    kickoffAt: string | null;
    venue: string | null;
    roundLabel: string | null;
    matchday: number | null;
    homeScore: number;
    awayScore: number;
    liveFeature?: {
      enabled: boolean;
      audioEnabled: boolean;
      updatedAt: string | null;
      audioUpdatedAt: string | null;
    };
    /** The matchday squad, when one was entered for this fixture. */
    squadPlayers?: Array<{
      teamId: string;
      playerId: string | null;
      playerName: string;
      jerseyNumber: number | null;
    }>;
    /**
     * Each team's standing squad, which is where the names actually are.
     *
     * Most fixtures have no matchday squad, and the console used to resolve a shirt
     * number against that alone -- so a recorder typed 7 and the timeline read
     * `No. 7` while the squad knew the name all along.
     */
    teamSquad?: Array<{
      teamId: string;
      playerId: string | null;
      playerName: string;
      jerseyNumber: number | null;
    }>;
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

/**
 * A live recording the idle sweep stopped.
 *
 * Carries enough for a super admin to judge it without opening the console: which match,
 * who was recording, and how long it had been quiet -- twenty minutes of silence in a cup
 * final reads very differently from twenty minutes in a friendly nobody was watching.
 */
export type IdleLockedRecording = {
  matchId: string;
  matchSlug: string | null;
  competitionName: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string | null;
  recorderName: string | null;
  lockedAt: string;
  quietSinceAt: string;
  quietMinutes: number;
  /** Null means nothing was ever filed, so it was left from kick-off. */
  lastEventAt: string | null;
  clockPhase: string | null;
};
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

  /** Submits the whole sheet — statistics and event log together. */
  submit: (matchId: string) =>
    adminFetch<MatchStatsSheet>(`${base}/${matchId}/submit`, { method: "POST" }),

  approve: (matchId: string) =>
    adminFetch<MatchStatsSheet>(`${base}/${matchId}/approve`, { method: "POST" }),

  sendBack: (matchId: string, note?: string) =>
    adminFetch<MatchStatsSheet>(`${base}/${matchId}/send-back`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  /** Every recording the idle sweep stopped, newest first. */
  idleLocked: () => adminFetch<IdleLockedRecording[]>(`${base}/idle-locked`),

  /** Release a stopped recording. The note is required — it is the only record of why. */
  releaseIdleLock: (matchId: string, note: string) =>
    adminFetch<MatchStatsSheet>(`${base}/${matchId}/release-idle-lock`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  queue: () => adminFetch<MatchStatsQueueItem[]>(`${base}/queue`),

  history: (matchId: string) => adminFetch<SheetLogEntry[]>(`${base}/${matchId}/history`),

  totals: () => adminFetch<MatchStatsTotals>(`${base}/totals`),

  /** Start a practice match of your own, cloned from the seeded template. */
  startTraining: () =>
    adminFetch<{ matchId: string }>(`${base}/training`, { method: "POST" }),

  /** Throw your own practice match away so a clean one can be started. */
  deleteTraining: (matchId: string) =>
    adminFetch<{ deleted: boolean }>(`${base}/training/${matchId}`, { method: "DELETE" }),

  requestCorrection: (matchId: string, note?: string) =>
    adminFetch<MatchStatsSheet>(`${base}/${matchId}/request-correction`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  declineCorrection: (matchId: string, note?: string) =>
    adminFetch<MatchStatsSheet>(`${base}/${matchId}/decline-correction`, {
      method: "POST",
      body: JSON.stringify({ note }),
    }),

  fixtures: (range: { from?: string; to?: string }) => {
    const params = new URLSearchParams();
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    const qs = params.toString();
    return adminFetch<MatchStatsFixture[]>(`${base}/fixtures${qs ? `?${qs}` : ""}`);
  },

  createLiveAudioTicket: (matchId: string) =>
    adminFetch<LiveAudioTicket>(`${base}/${matchId}/live-audio/ticket`, { method: "POST" }),

  startLiveAudioHttp: (matchId: string, body: { ticket: string; mimeType: string }) =>
    adminFetch<LiveAudioHttpSession>(`${base}/${matchId}/live-audio/http/start`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  sendLiveAudioHttpChunk: (
    matchId: string,
    body: { sessionId: string; mimeType: string; data: string }
  ) =>
    adminFetch<LiveAudioStatus>(`${base}/${matchId}/live-audio/http/chunk`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  stopLiveAudioHttp: (matchId: string, sessionId: string) =>
    adminFetch<{ stopped: boolean }>(`${base}/${matchId}/live-audio/http/stop`, {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    }),
};
