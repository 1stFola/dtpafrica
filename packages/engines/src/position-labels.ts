/** Abbreviation → full position title (homepage cards, admin). */
export const POSITION_FULL_LABELS: Record<string, string> = {
  GK: "GOALKEEPER",
  GKP: "GOALKEEPER",
  CB: "CENTRAL BACK",
  FB: "FULL BACK",
  LB: "LEFT BACK",
  RB: "RIGHT BACK",
  LWB: "LEFT WING BACK",
  RWB: "RIGHT WING BACK",
  DM: "DEFENSIVE MIDFIELDER",
  CDM: "DEFENSIVE MIDFIELDER",
  CM: "CENTRAL MIDFIELDER",
  AM: "ATTACKING MIDFIELDER",
  CAM: "ATTACKING MIDFIELDER",
  LW: "LEFT WINGER",
  RW: "RIGHT WINGER",
  WINGER: "WINGER",
  ST: "STRIKER",
  CF: "CENTER FORWARD",
};

export function positionAbbreviationOptions(): { value: string; label: string }[] {
  const seen = new Set<string>();
  const options: { value: string; label: string }[] = [];
  for (const [abbr, full] of Object.entries(POSITION_FULL_LABELS)) {
    if (abbr === "WINGER" || abbr === "FB") continue;
    if (seen.has(abbr)) continue;
    seen.add(abbr);
    options.push({ value: abbr, label: `${abbr} — ${full}` });
  }
  return options.sort((a, b) => a.value.localeCompare(b.value));
}

export function positionFullFromAbbreviation(
  abbrev: string | null | undefined
): string | null {
  if (!abbrev?.trim()) return null;
  const key = abbrev.trim().toUpperCase();
  return POSITION_FULL_LABELS[key] ?? abbrev.trim().toUpperCase();
}
