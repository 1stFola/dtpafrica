/**
 * "Featured" is not a column: it has always been the token `[featured]` inside
 * the competition's description (the CSV import writes it, the admin list reads
 * it). Editing the description in the admin must therefore keep the token, and
 * the description an admin sees must not show it.
 */
const FEATURED_TOKEN = /\s*\[featured\]\s*/gi;

export function readCompetitionDescription(stored: string | null | undefined): {
  text: string;
  featured: boolean;
} {
  const raw = stored ?? "";
  return { text: raw.replace(FEATURED_TOKEN, " ").trim(), featured: /\[featured\]/i.test(raw) };
}

export function writeCompetitionDescription(text: string, featured: boolean): string | null {
  const clean = text.replace(FEATURED_TOKEN, " ").trim();
  if (!featured) return clean || null;
  return clean ? `${clean} [featured]` : "[featured]";
}
