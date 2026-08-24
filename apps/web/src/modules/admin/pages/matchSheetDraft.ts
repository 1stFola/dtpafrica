import type {
  ClockState,
  KitColours,
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
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
      synced: parsed.synced === true,
    };
  } catch {
    // A corrupt or unavailable store must never block recording.
    return null;
  }
}

export function writeDraft(matchId: string, draft: Omit<SheetDraft, "updatedAt">): void {
  try {
    const payload: SheetDraft = { ...draft, updatedAt: Date.now() };
    localStorage.setItem(keyFor(matchId), JSON.stringify(payload));
  } catch {
    /* Private mode or a full quota: recording continues in memory. */
  }
}

/** Mark the stored draft as accepted by the API, without touching its content. */
export function markSynced(matchId: string): void {
  const existing = readDraft(matchId);
  if (!existing) return;
  try {
    localStorage.setItem(keyFor(matchId), JSON.stringify({ ...existing, synced: true }));
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
