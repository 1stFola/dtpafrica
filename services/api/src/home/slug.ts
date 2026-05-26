export function slugifyDisplayName(displayName: string, idSuffix?: string): string {
  const base = displayName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!idSuffix) return base || "player";
  return `${base}-${idSuffix.slice(0, 8)}`;
}
