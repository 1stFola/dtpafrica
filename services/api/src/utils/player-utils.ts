export function splitPlayerName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? displayName,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : "",
  };
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizePosition(position: string): string {
  if (!position) return "";
  
  const normalized = position.trim().toUpperCase();
  
  // Map common position variations
  const positionMap: Record<string, string> = {
    "GOALKEEPER": "GK",
    "GK": "GK",
    "RIGHT BACK": "RB",
    "RB": "RB",
    "LEFT BACK": "LB",
    "LB": "LB",
    "CENTER BACK": "CB",
    "CB": "CB",
    "CENTRE BACK": "CB",
    "DEFENSIVE MIDFIELD": "CDM",
    "CDM": "CDM",
    "CENTRAL MIDFIELD": "CM",
    "CM": "CM",
    "ATTACKING MIDFIELD": "CAM",
    "CAM": "CAM",
    "RIGHT WING": "RW",
    "RW": "RW",
    "LEFT WING": "LW",
    "LW": "LW",
    "CENTER FORWARD": "CF",
    "CF": "CF",
    "STRIKER": "ST",
    "ST": "ST",
    "FORWARD": "FW",
    "FW": "FW"
  };
  
  return positionMap[normalized] || normalized;
}
