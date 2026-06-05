import type { SbTeamRef } from "../../../api/scoreboard";

/** Build up to 3-letter initials from a normalized club name. */
function crestInitials(name: string): string {
  const cleaned = name.replace(/\b(FC|SC|FA|AFC)\b/gi, "").trim() || name;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function TeamCrest({
  team,
  size = "md",
}: {
  team: Pick<SbTeamRef, "name" | "shortName" | "logoUrl">;
  size?: "sm" | "md";
}) {
  const label = team.shortName ?? team.name;
  if (team.logoUrl) {
    return (
      <span className={`sb-crest sb-crest--${size}`}>
        <img src={team.logoUrl} alt="" loading="lazy" width={size === "sm" ? 28 : 40} height={size === "sm" ? 28 : 40} />
      </span>
    );
  }
  return (
    <span className={`sb-crest sb-crest--${size} sb-crest--placeholder`} aria-hidden="true">
      {crestInitials(label)}
    </span>
  );
}
