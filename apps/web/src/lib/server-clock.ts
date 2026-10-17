/**
 * The server's time, as this browser best knows it.
 *
 * The live match clock counts from anchors such as "first half started at 15:02:11".
 * Stamped with the recorder's Date.now() and read with each viewer's, it inherited both
 * devices' errors: a phone a minute fast showed a clock a minute ahead, and a recorder a
 * minute slow put every viewer a minute behind. Phones are usually close, but "usually"
 * includes the one pitch-side with its network time switched off.
 *
 * So both ends use serverNow(): Date.now() corrected by this browser's measured offset
 * from the API's clock (GET /api/v1/time). Until a measurement lands, or if it never
 * does, the offset is 0 and the clock behaves exactly as it did before.
 */

export type ClockSample = {
  /** Date.now() just before the request. */
  sentAt: number;
  /** Date.now() when the answer arrived. */
  receivedAt: number;
  /** The server's clock, read somewhere in between. */
  serverNow: number;
};

/**
 * Offset (server minus local, ms) from the sample with the shortest round trip, as NTP
 * does: assuming the server read its clock halfway through, the error is at most half that
 * round trip, so the fastest exchange is the most trustworthy one.
 */
export function estimateOffset(samples: ClockSample[]): number | null {
  const usable = samples.filter(
    (s) =>
      Number.isFinite(s.sentAt) &&
      Number.isFinite(s.receivedAt) &&
      Number.isFinite(s.serverNow) &&
      s.receivedAt >= s.sentAt
  );
  if (usable.length === 0) return null;
  const best = usable.reduce((a, b) => (b.receivedAt - b.sentAt < a.receivedAt - a.sentAt ? b : a));
  return Math.round(best.serverNow - (best.sentAt + best.receivedAt) / 2);
}

let offsetMs = 0;
let syncing: Promise<void> | null = null;
let syncedAt = 0;

/** Re-measure at most this often: drift between two clocks is seconds a day, not a minute. */
const RESYNC_MS = 10 * 60 * 1000;
/** A few exchanges, keeping the fastest. */
const SAMPLES = 3;

/** Now, on the server's clock. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** The current correction, for display or tests. */
export function serverOffsetMs(): number {
  return offsetMs;
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Measure the offset, once per page and again after RESYNC_MS. Safe to call on every
 * render: concurrent callers share one measurement, and a failure leaves the old offset.
 */
export function syncServerClock(fetcher: Fetcher = (input, init) => fetch(input, init)): Promise<void> {
  if (syncing) return syncing;
  if (syncedAt && Date.now() - syncedAt < RESYNC_MS) return Promise.resolve();
  syncing = (async () => {
    const samples: ClockSample[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      try {
        const sentAt = Date.now();
        const res = await fetcher("/api/v1/time", { cache: "no-store", signal: AbortSignal.timeout(5000) });
        const receivedAt = Date.now();
        if (!res.ok) break;
        const body = (await res.json()) as { now?: unknown };
        if (typeof body.now === "number") samples.push({ sentAt, receivedAt, serverNow: body.now });
      } catch {
        break;
      }
    }
    const estimate = estimateOffset(samples);
    if (estimate !== null) {
      offsetMs = estimate;
      syncedAt = Date.now();
    }
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

/** For tests: forget any measurement. */
export function resetServerClock(): void {
  offsetMs = 0;
  syncing = null;
  syncedAt = 0;
}
