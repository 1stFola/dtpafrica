const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;

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
  return name.replace(ZERO_WIDTH_RE, "").trim().replace(/\s+/g, " ");
}

function clubLookupKey(name: string): string {
  return preprocessClubName(name)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Client mirror of `@dtp/engines` normalizeClubName for admin feedback. */
export function normalizeClubName(name: string): string {
  const cleaned = preprocessClubName(name);
  if (!cleaned) return cleaned;
  return CLUB_ALIASES[clubLookupKey(cleaned)] ?? cleaned;
}
