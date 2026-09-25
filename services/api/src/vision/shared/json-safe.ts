/**
 * Makes Prisma rows JSON-serialisable.
 *
 * `JSON.stringify` throws on a BigInt, so any endpoint returning a row with a
 * BigInt column returns 500 — which is how `GET /vision/jobs/:id` failed the
 * moment a cost row existed to include. Several Vision tables use BigInt
 * deliberately (object sizes, bytes transferred), so this is not a one-off.
 *
 * Deliberately NOT done by patching `BigInt.prototype.toJSON`: that would change
 * serialisation for every module in the process, including ScoreBoard, to fix a
 * problem local to Vision.
 */

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * BigInt becomes a number where that is lossless, and a string where it is not.
 *
 * Object sizes and byte counts sit far below 2^53 — a 6 GB master file is 6e9 —
 * so a number is both safe and what a client actually wants to do arithmetic on.
 * Anything larger degrades to a string rather than silently losing precision.
 */
export function jsonSafe<T>(value: T): unknown {
  if (typeof value === "bigint") {
    return value <= MAX_SAFE && value >= -MAX_SAFE ? Number(value) : value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item));
  if (value !== null && typeof value === "object") {
    // Buffers and other exotic objects are left alone: converting them here
    // would be a surprise, and nothing in Vision returns one from an endpoint.
    if (Buffer.isBuffer(value)) return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)])
    );
  }
  return value;
}
