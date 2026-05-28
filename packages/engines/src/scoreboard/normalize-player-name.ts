const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;

function preprocess(name: string): string {
  return name
    .replace(ZERO_WIDTH_RE, "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Lowercase lookup key: collapsed whitespace, punctuation stripped. */
export function playerLookupKey(name: string): string {
  return preprocess(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize display names for master Player directory matching.
 * Preserves original casing for display; use `playerLookupKey` for equality checks.
 */
export function normalizePlayerName(name: string): string {
  return preprocess(name);
}
