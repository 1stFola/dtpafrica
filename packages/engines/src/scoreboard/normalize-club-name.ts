const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;

/** Legacy / alternate spellings → official Nigerian club names (exact casing). */
const CLUB_ALIASES: Readonly<Record<string, string>> = {
  "fc bethel": "FC Bethel Sporting",
  "bethel fc": "FC Bethel Sporting",
  "fc bethel sporting": "FC Bethel Sporting",

  "ikorodu city": "Ikorodu City FC",
  "ikorodu city fc": "Ikorodu City FC",

  "sgfc athletics": "SGFC Athletics SC",
  "sgfc athletic sc": "SGFC Athletics SC",
  "sgfc athletic": "SGFC Athletics SC",
  "sgfc athletics sc": "SGFC Athletics SC",

  "klassisch fc": "Klassisch FA",
  "klassisc fc": "Klassisch FA",
  "klassisc": "Klassisch FA",
  "klassisch fa": "Klassisch FA",
};

function preprocessClubName(name: string): string {
  return name
    .replace(ZERO_WIDTH_RE, "")
    .trim()
    .replace(/\s+/g, " ");
}

/** Lowercase lookup key: collapsed whitespace, punctuation stripped. */
function clubLookupKey(name: string): string {
  return preprocessClubName(name)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize Nigerian scoreboard club names to official spellings.
 * Trims input, collapses whitespace, strips zero-width characters, and maps known aliases.
 */
export function normalizeClubName(name: string): string {
  const cleaned = preprocessClubName(name);
  if (!cleaned) return cleaned;

  const official = CLUB_ALIASES[clubLookupKey(cleaned)];
  return official ?? cleaned;
}

/**
 * Identity of a club across competitions: alias-resolved, then compared
 * without case, spacing or punctuation. "Ikorodu City" and "IKORODU CITY FC"
 * share one. "Ikorodu City FA" does not — add an alias above if a differently
 * suffixed name is genuinely the same club.
 */
export function clubIdentityKey(name: string): string {
  return clubLookupKey(normalizeClubName(name));
}
