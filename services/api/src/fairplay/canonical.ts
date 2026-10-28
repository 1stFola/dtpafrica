import { createHash } from "node:crypto";

/**
 * The Edge's canonical JSON, byte for byte: Python's
 * `json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`.
 *
 * Bundles are signed over it and audit entries are hashed over it, on two sides in two
 * languages, so they must agree exactly. They do for what those documents hold: strings,
 * integers, booleans, null, arrays and objects. JSON.stringify escapes strings as Python
 * does with ensure_ascii off (quote, backslash and control characters only, `\u00xx` in
 * lower case), and both sort ASCII keys alike. Floats are where they part: Python writes
 * `1.0`, and JSON.parse has already turned that into the integer 1 before anything here
 * sees it. So a fraction is refused, and nothing that may hold a float is re-encoded at
 * all: the audit check hashes the Edge's own text (`detail_text`), never the parsed detail.
 * Parity is tested against vectors the Edge's Python wrote (canonical.spec.ts).
 */
export function canonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new CanonicalError(`not an integer: ${value}`);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  throw new CanonicalError(`cannot encode ${typeof value}`);
}

export class CanonicalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalError";
  }
}

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
