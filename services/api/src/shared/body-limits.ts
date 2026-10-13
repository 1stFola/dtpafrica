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
  app.use(json({ limit: DEFAULT_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT }));
}
