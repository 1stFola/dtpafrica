/** ScoreBoard competition format identifiers. */
export type CompetitionFormat =
  | "STANDARD_LEAGUE"
  | "KNOCKOUT_CUP"
  | "HYBRID_CHAMPIONS_LEAGUE"
  | "SINGLE_FRIENDLY_MATCH"
  | "JAGABAN_CUP_STANDARD"
  | "COMBINATION_TOURNAMENT"
  | "CHALLENGE_LADDER";

export type ProgressionRuleKind =
  | "group_rank_to_knockout"
  | "group_winners_final"
  | "group_runners_up_third_place"
  | "eliminate_group_third_fourth"
  | "league_table_only"
  | "knockout_bracket"
  | "hybrid_group_to_knockout"
  | "friendly_single"
  | "ladder_challenge"
  | "multi_stage_chain";

export type ProgressionRule = {
  id: string;
  kind: ProgressionRuleKind;
  description: string;
  /** e.g. { groupA: 1, groupB: 1 } → grand final */
  source?: Record<string, number | string>;
  targetStageKey?: string;
};

export type StageConfiguration = {
  key: string;
  name: string;
  type: "group" | "league" | "knockout" | "friendly" | "ladder";
  sortOrder: number;
  teamCount?: number;
  groups?: string[];
  matchdays?: number;
  legs?: 1 | 2;
  knockoutRound?: "R32" | "R16" | "QF" | "SF" | "F" | "3P";
};

export type JagabanCupConfig = {
  editionLabel: string;
  groupCount: 2;
  teamsPerGroup: number;
  groupLabels: [string, string];
  /** Clone source template slug for future cycles */
  cloneFromFormat?: "JAGABAN_CUP_STANDARD";
};

export type CompetitionTemplate = {
  format: CompetitionFormat;
  label: string;
  description: string;
  category: "league" | "cup" | "hybrid" | "friendly" | "showcase" | "experimental";
  stages: StageConfiguration[];
  progressionRules: ProgressionRule[];
  defaultConfig?: Record<string, unknown>;
  /** skeleton = documented placeholder; complete = fixture gen supported */
  implementationStatus: "complete" | "skeleton";
};

export type FixtureTeamInput = {
  id: string;
  name: string;
  groupKey?: string | null;
};

export type GeneratedFixture = {
  stageKey: string;
  roundLabel: string;
  matchday: number;
  homeTeamId: string;
  awayTeamId: string;
  sortOrder: number;
};

export type CompetitionFormatConfig = {
  jagaban?: JagabanCupConfig;
  knockout?: { teamCount: 8 | 16 | 32; legs: 1 | 2 };
  league?: { homeAndAway: boolean };
  hybrid?: { groups: number; teamsPerGroup: number; advancePerGroup: number };
  combination?: { stageKeys: string[] };
  ladder?: { maxRungs: number };
};
