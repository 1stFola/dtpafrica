import type {
  ClockState,
  KitColours,
  MatchStatsSheet,
  RecordedEvent,
  TallyValue,
} from "../../../api/adminMatchStats";

/**
 * Local-first draft storage for the recorder console.
 *
 * Pitches have poor signal. Every change is mirrored to localStorage the moment
 * it happens, so the working sheet belongs to the device, not the network: a
 * dropped connection, a closed tab or a dead battery cannot lose taps. The API
 * save becomes a background sync that retries, rather than the only copy.
 */

export type SheetDraft = {
  tallies: Record<string, TallyValue>;
  events: RecordedEvent[];
  clock: ClockState | null;
  kits: KitColours;
  /**
   * Events deleted here that the server has not yet been told about. The server merges the
   * log by id and keeps anything a save leaves out, so a deletion has to be sent by name.
   */
  removedEventIds: string[];
  /** When this device last changed the sheet. */
  updatedAt: number;
  /** False until the API has accepted this exact draft. */
  synced: boolean;
};

const KEY_PREFIX = "dtp_match_sheet_";

function keyFor(matchId: string): string {
  return `${KEY_PREFIX}${matchId}`;
}

export function readDraft(matchId: string): SheetDraft | null {
  try {
    const raw = localStorage.getItem(keyFor(matchId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SheetDraft;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      tallies: parsed.tallies ?? {},
      events: Array.isArray(parsed.events) ? parsed.events : [],
      clock: parsed.clock ?? null,
      kits: parsed.kits ?? { home: "#4c9ffe", away: "#f5a524" },
      removedEventIds: Array.isArray(parsed.removedEventIds) ? parsed.removedEventIds : [],
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
      synced: parsed.synced === true,
    };
  } catch {
    // A corrupt or unavailable store must never block recording.
    return null;
  }
}

/**
 * Write the draft. False when the device would not store it even after making room, which
 * the console must say: the taps then live only in the open page.
 */
export function writeDraft(matchId: string, draft: Omit<SheetDraft, "updatedAt">): boolean {
  const payload = JSON.stringify({ ...draft, updatedAt: Date.now() } satisfies SheetDraft);
  try {
    localStorage.setItem(keyFor(matchId), payload);
    return true;
  } catch {
    /* Usually a full quota: every match recorded on this phone leaves its sheet behind.
       Clear what the server already holds and try once more. */
  }
  pruneStoredSheets(matchId, 0);
  try {
    localStorage.setItem(keyFor(matchId), payload);
    return true;
  } catch {
    return false;
  }
}

/** Mark the stored draft as accepted by the API, without touching its content. */
export function markSynced(matchId: string, serverEvents?: RecordedEvent[]): void {
  const existing = readDraft(matchId);
  if (!existing) return;
  try {
    /* The deletions went with it, and the log becomes the server's merged one when given:
       it may hold events another device filed. */
    localStorage.setItem(
      keyFor(matchId),
      JSON.stringify({
        ...existing,
        events: serverEvents ?? existing.events,
        removedEventIds: [],
        synced: true,
      })
    );
  } catch {
    /* ignore */
  }
}

export function clearDraft(matchId: string): void {
  try {
    localStorage.removeItem(keyFor(matchId));
  } catch {
    /* ignore */
  }
}

/**
 * Whether the local draft should win over what the server returned.
 *
 * Only an unsynced draft can be ahead: once the API has accepted a draft, the
 * server copy is authoritative and may include a supervisor's send-back.
 */
export function draftIsAhead(draft: SheetDraft | null): boolean {
  return Boolean(draft && !draft.synced);
}

/**
 * Deletions still to be sent: the ones already waiting, plus any event in `before` that is
 * not in `after`. An event that comes back (an undo, or a kick-off chosen again under the
 * same id) is no longer a deletion.
 */
export function removedSince(
  before: RecordedEvent[],
  after: RecordedEvent[],
  waiting: readonly string[]
): string[] {
  const present = new Set(after.map((event) => event.id));
  const out = new Set(waiting.filter((id) => !present.has(id)));
  for (const event of before) if (!present.has(event.id)) out.add(event.id);
  return [...out];
}

/** Events this device holds that the server's copy does not, for the console to count. */
export function eventsNotOnServer(local: RecordedEvent[], server: RecordedEvent[]): number {
  const onServer = new Set(server.map((event) => event.id));
  return local.filter((event) => !onServer.has(event.id)).length;
}

/*
 * The last sheet the server sent, kept so the console can open with no signal. Without it a
 * reload in a dead spot showed "Match console unavailable" and the recorder could neither
 * see what they had logged nor log anything more until the network came back.
 */
const SERVER_COPY_PREFIX = "dtp_match_sheet_server_";

type ServerCopy = { savedAt: number; sheet: MatchStatsSheet };

export function readServerCopy(matchId: string): MatchStatsSheet | null {
  try {
    const raw = localStorage.getItem(`${SERVER_COPY_PREFIX}${matchId}`);
    return raw ? ((JSON.parse(raw) as ServerCopy).sheet ?? null) : null;
  } catch {
    return null;
  }
}

export function writeServerCopy(matchId: string, sheet: MatchStatsSheet): void {
  try {
    const copy: ServerCopy = { savedAt: Date.now(), sheet };
    localStorage.setItem(`${SERVER_COPY_PREFIX}${matchId}`, JSON.stringify(copy));
  } catch {
    /* A full quota: the console then needs the network to open, as before. The draft
       matters more and is written first. */
  }
}

/** How long another match's server copy is worth keeping for opening with no signal. */
const SERVER_COPY_KEEP_MS = 3 * 24 * 3600_000;

/**
 * Make room in this device's storage, never at the cost of an unsent tap.
 *
 * For matches other than `currentMatchId`: a draft the server has accepted goes (the server
 * holds it), and so does a server copy older than `keepCopiesMs`. An unsynced draft is the
 * only copy of what was recorded and is always kept.
 */
export function pruneStoredSheets(currentMatchId: string, keepCopiesMs = SERVER_COPY_KEEP_MS): void {
  try {
    const now = Date.now();
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(
      (key): key is string => Boolean(key)
    );
    for (const key of keys) {
      if (key.startsWith(SERVER_COPY_PREFIX)) {
        if (key === `${SERVER_COPY_PREFIX}${currentMatchId}`) continue;
        let savedAt = 0;
        try {
          savedAt = (JSON.parse(localStorage.getItem(key) ?? "{}") as ServerCopy).savedAt ?? 0;
        } catch {
          /* Unreadable: nothing worth keeping. */
        }
        if (now - savedAt >= keepCopiesMs) localStorage.removeItem(key);
      } else if (key.startsWith(KEY_PREFIX)) {
        const matchId = key.slice(KEY_PREFIX.length);
        if (matchId === currentMatchId) continue;
        const draft = readDraft(matchId);
        if (!draft || draft.synced) localStorage.removeItem(key);
      }
    }
  } catch {
    /* Storage unavailable: nothing to prune. */
  }
}
