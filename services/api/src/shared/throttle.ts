import { applyDecorators, UseGuards, type ExecutionContext } from "@nestjs/common";
import { Throttle, ThrottlerGuard, type ThrottlerModuleOptions } from "@nestjs/throttler";

/**
 * Per-address rate limits on the routes a stranger can hit without signing in: the two logins,
 * which a password guesser would otherwise try as fast as bcrypt answers, and the public forms,
 * which write a row (and some send an email) per request.
 *
 * Nothing else is throttled. The guard is applied route by route, not globally, so scoreboard
 * polling and recorders' live event posts are never slowed by it.
 *
 * Two windows on every throttled route: a per-minute one that stops a burst, and a per-hour one
 * that stops a slow, steady guesser the minute window would let through. Limits are per client
 * address; see TRUSTED_PROXIES for how that address is found behind CloudFront and nginx.
 *
 * A request from the machine itself is not limited. That is the Vision DB gates and local
 * development, which sign in a dozen accounts a run against localhost. Deployed, every request
 * reaches the API through nginx with the visitor's address, so none of them is loopback.
 */
export const THROTTLE_MODULE_OPTIONS: ThrottlerModuleOptions = {
  throttlers: [
    { name: "minute", ttl: 60_000, limit: 5 },
    { name: "hour", ttl: 3_600_000, limit: 20 },
  ],
  errorMessage: "Too many requests from this address. Wait a little and try again.",
  skipIf: (context: ExecutionContext) =>
    isLoopback(context.switchToHttp().getRequest<{ ip?: string }>().ip),
};

export function isLoopback(ip: string | undefined): boolean {
  if (!ip) return false;
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  return v4 === "::1" || v4.startsWith("127.");
}

/**
 * Logins. A whole club's match recorders may sign in from one stadium connection, so the
 * hourly window leaves room for that; a guesser gets 10 tries a minute and 30 an hour.
 */
export const LoginThrottle = () =>
  applyDecorators(
    UseGuards(ThrottlerGuard),
    Throttle({
      minute: { limit: 10, ttl: 60_000 },
      hour: { limit: 30, ttl: 3_600_000 },
    })
  );

/** Support reports, contact, register and newsletter: 5 a minute, 20 an hour per address. */
export const PublicFormThrottle = () =>
  applyDecorators(
    UseGuards(ThrottlerGuard),
    Throttle({
      minute: { limit: 5, ttl: 60_000 },
      hour: { limit: 20, ttl: 3_600_000 },
    })
  );

/**
 * Which hops Express may believe about the client address (`trust proxy`).
 *
 * The API is reached only through nginx in the web container, on Docker's private network.
 * nginx has already resolved the visitor's address from CloudFront's X-Forwarded-For (it
 * trusts CloudFront's ranges only; infra/nginx.staging.conf) and appends it as the last entry.
 * Trusting private and loopback hops makes `req.ip` that last entry; a connection from any
 * public address is taken at its own address and its X-Forwarded-For is ignored.
 */
export const TRUSTED_PROXIES = "loopback, linklocal, uniquelocal";
