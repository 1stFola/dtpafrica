/** ScoreBoard admin domain types (legacy admin-entities / admin-roster aligned). */

export type SbCompetitionStatus = "active" | "upcoming" | "draft" | "archived";
export type SbCompetitionType = "league" | "tournament" | "cup";

export type CompetitionFormat =
  | "STANDARD_LEAGUE"
  | "KNOCKOUT_CUP"
  | "HYBRID_CHAMPIONS_LEAGUE"
  | "SINGLE_FRIENDLY_MATCH"
  | "JAGABAN_CUP_STANDARD"
  | "COMBINATION_TOURNAMENT"
  | "CHALLENGE_LADDER";

export type CompetitionTemplatePreview = {
  format: CompetitionFormat;
  label: string;
  description: string;
  category: string;
  implementationStatus: "complete" | "skeleton";
  stages: Array<{ key: string; name: string; type: string; sortOrder: number }>;
  progressionRules: Array<{ id: string; description: string }>;
  progressionPreview?: string[];
  defaultConfig?: Record<string, unknown>;
};

export type AdminSbCompetition = {
  id: string;
  slug: string;
  name: string;
  type: string;
  formatType: string | null;
  region: string | null;
  season: string;
  teamsCount: number;
  matchesCount: number;
  status: SbCompetitionStatus;
  isPublished: boolean;
  isFeatured: boolean;
  logoUrl: string | null;
};

export type AdminSbTeam = {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  region: string | null;
  logoUrl: string | null;
  competition: { id: string; name: string; slug: string };
  squadCount: number;
};

export type AdminSbPlayerDirectoryRow = {
  playerId: string | null;
  slug: string | null;
  displayName: string;
  positionPrimary: string | null;
  teams: Array<{ teamId: string; teamName: string; competitionSlug: string }>;
};

export type MatchdayRosterSlot = {
  squadId: string;
  displayName: string;
  position: string | null;
  shirtNumber: number | null;
  playerId: string | null;
  playerSlug: string | null;
  role: "xi" | "sub";
  cleanSheets?: number;
};

export type MatchdayRoster = {
  teamId: string;
  xi: MatchdayRosterSlot[];
  subs: MatchdayRosterSlot[];
};

export type SpotterOps = {
  lineupsLocked: boolean;
  officialsConfirmed: number;
  addedTime: number;
  offlineQueueCount: number;
  lastUndoAt: string | null;
  formation: { home: string; away: string };
  pitchSelection: { teamId: string; squadId: string } | null;
};

export type AdminSbStats = {
  competitions: number;
  teams: number;
  squadRows: number;
  matches: number;
  highlights: number;
  liveMatches: number;
};

export const COMPETITION_STATUSES: SbCompetitionStatus[] = [
  "active",
  "upcoming",
  "draft",
  "archived",
];

export const COMPETITION_TYPES: SbCompetitionType[] = ["league", "tournament", "cup"];

export const POSITION_TAGS = ["GK", "DF", "MF", "FW"] as const;

export type PositionTag = (typeof POSITION_TAGS)[number];

export function positionTag(pos: string | null | undefined): PositionTag {
  const p = (pos ?? "").toUpperCase();
  if (p.includes("GK") || p.includes("GOAL")) return "GK";
  if (p.includes("DF") || p.includes("DEF")) return "DF";
  if (p.includes("FW") || p.includes("FOR") || p.includes("ST")) return "FW";
  return "MF";
}

export function isGoalkeeper(pos: string | null | undefined) {
  return positionTag(pos) === "GK";
}
