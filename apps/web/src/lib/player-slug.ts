/** Client mirror of API `slugifyPlayerName` for slug preview. */
export function slugifyPlayerName(displayName: string): string {
  const base = displayName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "player";
}
