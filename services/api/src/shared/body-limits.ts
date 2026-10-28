import { json, urlencoded } from "body-parser";

/** What any route accepts: Express's own default, kept for everything a person or the public sends. */
export const DEFAULT_BODY_LIMIT = "100kb";

/**
 * What a vision worker's calls accept. A completion carries one compact row per track
 * (or segment, or event) inline, and a 2 min 25 s clip's tracks passed 100 kB
 * (docs/vision/97). Only worker routes get it, and they are token-guarded.
 */
export const WORKER_BODY_LIMIT = "16mb";

export const WORKER_ROUTE_PREFIX = "/api/v1/vision/worker/";

/**
 * What a recorder's match-sheet save accepts. Each save carries the whole event log, about
 * 190 bytes an event, so 100 kB is reached near 500 events -- a busy match logged in detail.
 * Past it every later save is refused and the rest of the match stays on the recorder's
 * phone. One megabyte is room for some 5,000 events. Recorder routes are permission-guarded.
 */
export const MATCH_SHEET_BODY_LIMIT = "1mb";

export const MATCH_SHEET_ROUTE_PREFIX = "/api/v1/admin/scoreboard/match-stats/";

/**
 * What a FairPlay Edge's sync batch accepts: up to 200 outbox items, an evidence record
 * with its video check being the largest at a few kilobytes. Device-token guarded.
 */
export const FAIRPLAY_SYNC_BODY_LIMIT = "2mb";

export const FAIRPLAY_SYNC_ROUTE = "/api/v1/fairplay/sync/batch";

type UsesMiddleware = { use: (...handlers: unknown[]) => unknown };

/**
 * The body parsers, in the order they must run: the worker routes' larger limit first,
 * then the default for every other route. A body the first parser read is not read
 * again. Nest's own parser must be off (`bodyParser: false`) or it would refuse first.
 */
export function applyBodyLimits(app: UsesMiddleware): void {
  const worker = json({ limit: WORKER_BODY_LIMIT });
  app.use((req: { url?: string }, res: unknown, next: (err?: unknown) => void) =>
    req.url?.startsWith(WORKER_ROUTE_PREFIX) ? worker(req as never, res as never, next) : next()
  );
  const matchSheet = json({ limit: MATCH_SHEET_BODY_LIMIT });
  app.use((req: { url?: string }, res: unknown, next: (err?: unknown) => void) =>
    req.url?.startsWith(MATCH_SHEET_ROUTE_PREFIX) ? matchSheet(req as never, res as never, next) : next()
  );
  const fairplaySync = json({ limit: FAIRPLAY_SYNC_BODY_LIMIT });
  app.use((req: { url?: string }, res: unknown, next: (err?: unknown) => void) =>
    req.url === FAIRPLAY_SYNC_ROUTE ? fairplaySync(req as never, res as never, next) : next()
  );
  app.use(json({ limit: DEFAULT_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT }));
}
