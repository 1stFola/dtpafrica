/** URL-safe slug from display name (mirrors API `slugifyPlayerName`). */
export function slugifyDisplayName(displayName: string): string {
  const base = displayName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "";
}

export function playerProfilePath(player: {
  slug?: string | null;
  displayName: string;
}): string | null {
  const slug = player.slug?.trim() || slugifyDisplayName(player.displayName);
  return slug ? `/players/${slug}` : null;
}
