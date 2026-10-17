import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compares a presented secret with the expected one in time that does not depend on where they
 * first differ, so the key cannot be recovered a character at a time by timing `!==`.
 *
 * Both sides are hashed first: `timingSafeEqual` needs equal lengths, and comparing digests
 * means a wrong-length guess takes the same path as any other wrong guess.
 */
export function safeEqual(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}
