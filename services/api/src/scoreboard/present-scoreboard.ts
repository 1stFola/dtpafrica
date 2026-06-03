import { normalizeClubName } from "@dtp/engines";

type Named = { name: string };

function isSbTeamShape(value: unknown): value is Named & Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.name === "string" &&
    ("slug" in o || "shortName" in o || "groupKey" in o || "competitionId" in o)
  );
}

/** Normalize `name` on scoreboard team records (read path). */
export function presentSbTeam<T extends Named>(team: T): T {
  return { ...team, name: normalizeClubName(team.name) };
}

/** Deep-normalize team names and `teamName` fields in API payloads. */
export function presentScoreboardPayload<T>(value: T): T {
  if (value === null || value === undefined) return value;
  // Dates are objects; Object.entries(date) is empty and would become `{}` in JSON.
  if (value instanceof Date) return value;

  if (Array.isArray(value)) {
    return value.map((item) => presentScoreboardPayload(item)) as T;
  }

  if (typeof value !== "object") return value;

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(obj)) {
    if (key === "teamName" && typeof raw === "string") {
      out[key] = normalizeClubName(raw);
      continue;
    }
    if ((key === "homeTeam" || key === "awayTeam" || key === "team") && isSbTeamShape(raw)) {
      out[key] = presentSbTeam(raw);
      continue;
    }
    if (key === "teams" && Array.isArray(raw)) {
      out[key] = raw.map((t) => (isSbTeamShape(t) ? presentSbTeam(t) : presentScoreboardPayload(t)));
      continue;
    }
    if (key === "rows" && Array.isArray(raw)) {
      out[key] = raw.map((row) => {
        if (row && typeof row === "object" && "teamName" in row) {
          const r = row as { teamName?: string };
          return {
            ...row,
            teamName:
              typeof r.teamName === "string" ? normalizeClubName(r.teamName) : r.teamName,
          };
        }
        return presentScoreboardPayload(row);
      });
      continue;
    }
    out[key] = presentScoreboardPayload(raw);
  }

  return out as T;
}
