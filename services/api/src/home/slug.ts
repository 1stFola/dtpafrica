import { resolveUniquePlayerSlug, slugifyPlayerName } from "../players/player-slug";

/** @deprecated Prefer `slugifyPlayerName` from `../players/player-slug`. */
export function slugifyDisplayName(displayName: string, idSuffix?: string): string {
  const base = slugifyPlayerName(displayName);
  if (!idSuffix) return base;
  return `${base}-${idSuffix.slice(0, 8)}`;
}

export { resolveUniquePlayerSlug };
