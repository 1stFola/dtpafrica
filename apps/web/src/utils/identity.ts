/**
 * Stable visual identity derived from a name or id, shared by every surface
 * that needs to colour or badge a club or competition the same way each time.
 */

/**
 * Stable hue (0-359) for a seed. Deterministic, so a competition's crest, its
 * Browse card counters and anything else keyed on the same id always agree.
 */
export function stableHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

/** Two-letter badge for a club without a crest: "Box 2 Box FC" -> "B2". */
export function clubInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "AC";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}
