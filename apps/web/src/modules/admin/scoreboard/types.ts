/** ScoreBoard admin domain types (legacy admin-entities / admin-roster aligned). */

export type SbCompetitionStatus = "scheduled" | "ongoing" | "draft" | "archived";
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
  /** Without the "[featured]" token, which the API reads into isFeatured. */
  description?: string;
};

export type AdminSbCompetitionInput = {
  name: string;
  slug?: string;
  season: string;
  type: string;
  status?: SbCompetitionStatus;
  formatType?: string;
  country?: string;
  description?: string;
  isPublished?: boolean;
  /** Empty string clears the crest. */
  logoUrl?: string;
  isFeatured?: boolean;
};

export type AdminSbTeamInput = {
  competitionId: string;
  name: string;
  slug?: string;
  shortName?: string;
  logoUrl?: string;
  city?: string;
  groupKey?: string;
};

export type AdminSbMatchInput = {
  competitionId: string;
  homeTeamId: string;
  awayTeamId: string;
  kickoffDate: string;
  kickoffTime: string;
  venue?: string;
  stageKey?: string;
  knockoutRound?: "R32" | "R16" | "QF" | "SF" | "F";
  leg?: "first_leg" | "second_leg";
  roundLabel?: string;
  matchday?: number;
  status?: "scheduled" | "postponed";
};

export type AdminSbTeam = {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  region: string | null;
  logoUrl: string | null;
  groupKey: string | null;
  competition: { id: string; name: string; slug: string };
  squadCount: number;
};

export type AdminSbTeamMergePlan = {
  /** absorb: same competition, the duplicate is folded in and deleted. link: different competitions, both kept as one club. */
  mode: "absorb" | "link";
  source: { id: string; name: string; competition: string };
  target: { id: string; name: string; competition: string };
  blocked: string | null;
  counts: {
    fixtures: number;
    squad: number;
    events: number;
    matchSquadPlayers: number;
    headToHead: number;
  };
};

export type AdminSbTeamMergeOutcome = AdminSbTeamMergePlan & {
  moved: {
    homeFixtures: number;
    awayFixtures: number;
    squadMoved: number;
    squadFolded: number;
    events: number;
    matchSquadPlayers: number;
    rosters: number;
    visionTeamSides: number;
    visionIdentityAssignments: number;
    visionEventCandidates: number;
  };
};

export type AdminSbPlayerDirectoryRow = {
  playerId: string | null;
  slug: string | null;
  displayName: string;
  positionPrimary: string | null;
  teams: Array<{
    squadId: string;
    teamId: string;
    teamName: string;
    competitionSlug: string;
    competitionName: string;
    position: string | null;
    shirtNumber: number | null;
  }>;
};

export type AdminSbSquadRowInput = {
  teamId?: string;
  displayName: string;
  position?: string;
  shirtNumber?: number | null;
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

export type MatchFormation = "4-3-3" | "4-2-3-1" | "4-1-2-3" | "4-4-2" | "3-5-2" | "3-4-3" | "5-3-2";

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

/**
 * Ordered as a competition moves through them, which is also how the picker reads.
 *
 * Only Scheduled and Ongoing appear on the public ScoreBoard. Draft is not ready and
 * Archived is finished with, and choosing either takes the competition off the site.
 */
export const COMPETITION_STATUSES: SbCompetitionStatus[] = [
  "scheduled",
  "ongoing",
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
