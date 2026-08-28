import { AdminApiError } from "../../../api/admin";
import { parseApiErrorMessage } from "../../../api/error-message";
import type { SbMatchListItem } from "../../../api/scoreboard";

/** West Africa Time — used for scoreboard kickoffs across Nigeria. */
export const SCOREBOARD_WAT_TZ = "Africa/Lagos";

/** Parse NestJS / API error payloads into a short user-facing string. */
export function formatAdminScoreboardError(err: unknown): string {
  if (err instanceof AdminApiError) {
    const message = parseApiErrorMessage(err.message, "");
    if (message) return message;
    if (err.message && err.message.length < 200) return err.message;
    if (err.status === 403) {
      return "Action blocked — complete matchday rosters and confirm lineup readiness first.";
    }
    return err.message || `Request failed (${err.status})`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export function kickoffAtToWatParts(kickoffAt: string | null | undefined): {
  date: string;
  time: string;
} {
  if (!kickoffAt) return { date: "", time: "" };
  const d = new Date(kickoffAt);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  return {
    date: d.toLocaleDateString("en-CA", { timeZone: SCOREBOARD_WAT_TZ }),
    time: d.toLocaleTimeString("en-GB", {
      timeZone: SCOREBOARD_WAT_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  };
}

export function formatKickoffWat(kickoffAt: string | null | undefined): string {
  if (!kickoffAt) return "Date & time TBD";
  const d = new Date(kickoffAt);
  if (Number.isNaN(d.getTime())) return "Date & time TBD";
  return d.toLocaleString("en-GB", {
    timeZone: SCOREBOARD_WAT_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
}

export function formatMatchOptionLabel(match: SbMatchListItem): string {
  const vs = `${match.homeTeam.name} vs ${match.awayTeam.name}`;
  const when = match.kickoffAt ? formatKickoffWat(match.kickoffAt) : "TBD";
  const venue = match.venue?.trim() ? ` · ${match.venue.trim()}` : "";
  return `${vs} — ${when}${venue} (${match.status})`;
}

/** Upcoming fixtures first (soonest kickoff), then live, then finished. */
export function sortRosterMatches(matches: SbMatchListItem[]): SbMatchListItem[] {
  const priority = (status: string) => {
    if (status === "scheduled" || status === "postponed") return 0;
    if (status === "live" || status === "halftime") return 1;
    return 2;
  };
  return [...matches].sort((a, b) => {
    const pa = priority(a.status);
    const pb = priority(b.status);
    if (pa !== pb) return pa - pb;
    const ta = a.kickoffAt ? new Date(a.kickoffAt).getTime() : Number.MAX_SAFE_INTEGER;
    const tb = b.kickoffAt ? new Date(b.kickoffAt).getTime() : Number.MAX_SAFE_INTEGER;
    if (pa <= 1) return ta - tb;
    return tb - ta;
  });
}
