import type {
  CompetitionFormat,
  CompetitionTemplate,
  JagabanCupConfig,
} from "./competition-types";

const JAGABAN_PROGRESSION = [
  {
    id: "jagaban-grand-final",
    kind: "group_winners_final" as const,
    description: "Group A 1st vs Group B 1st → Grand Finale",
    source: { groupA: 1, groupB: 1 },
    targetStageKey: "grand_final",
  },
  {
    id: "jagaban-third-place",
    kind: "group_runners_up_third_place" as const,
    description: "Group A 2nd vs Group B 2nd → Third-Place Playoff",
    source: { groupA: 2, groupB: 2 },
    targetStageKey: "third_place",
  },
  {
    id: "jagaban-eliminate-34",
    kind: "eliminate_group_third_fourth" as const,
    description: "3rd and 4th in each group eliminated after group stage",
  },
];

export function buildJagabanCupStages(config: JagabanCupConfig): CompetitionTemplate["stages"] {
  const [ga, gb] = config.groupLabels;
  return [
    {
      key: `group_${ga.toLowerCase()}`,
      name: `Group ${ga}`,
      type: "group",
      sortOrder: 1,
      teamCount: config.teamsPerGroup,
      groups: [ga],
      matchdays: config.teamsPerGroup - 1,
    },
    {
      key: `group_${gb.toLowerCase()}`,
      name: `Group ${gb}`,
      type: "group",
      sortOrder: 2,
      teamCount: config.teamsPerGroup,
      groups: [gb],
      matchdays: config.teamsPerGroup - 1,
    },
    {
      key: "third_place",
      name: "Third-Place Playoff",
      type: "knockout",
      sortOrder: 3,
      knockoutRound: "3P",
      legs: 1,
    },
    {
      key: "grand_final",
      name: "Grand Finale",
      type: "knockout",
      sortOrder: 4,
      knockoutRound: "F",
      legs: 1,
    },
  ];
}

export const COMPETITION_TEMPLATES: Record<CompetitionFormat, CompetitionTemplate> = {
  STANDARD_LEAGUE: {
    format: "STANDARD_LEAGUE",
    label: "Standard League",
    description: "Round robin home/away; Pts, GD, GF, W-D-L form; no knockout.",
    category: "league",
    implementationStatus: "complete",
    stages: [
      {
        key: "league",
        name: "League",
        type: "league",
        sortOrder: 1,
        legs: 2,
      },
    ],
    progressionRules: [
      {
        id: "league-table",
        kind: "league_table_only",
        description: "Final table determines champion; no knockout phase.",
      },
    ],
    defaultConfig: { league: { homeAndAway: true } },
  },

  KNOCKOUT_CUP: {
    format: "KNOCKOUT_CUP",
    label: "Knockout Cup",
    description: "8/16/32 teams; single or two-leg aggregate; ET/penalty metadata on ties.",
    category: "cup",
    implementationStatus: "complete",
    stages: [
      { key: "r32", name: "Round of 32", type: "knockout", sortOrder: 0, knockoutRound: "R32" },
      { key: "r16", name: "Round of 16", type: "knockout", sortOrder: 1, knockoutRound: "R16" },
      { key: "qf", name: "Quarter-Finals", type: "knockout", sortOrder: 2, knockoutRound: "QF" },
      { key: "sf", name: "Semi-Finals", type: "knockout", sortOrder: 3, knockoutRound: "SF" },
      { key: "final", name: "Final", type: "knockout", sortOrder: 4, knockoutRound: "F" },
    ],
    progressionRules: [
      {
        id: "knockout-bracket",
        kind: "knockout_bracket",
        description: "Winners advance; losers eliminated. Ties may use ET/penalties.",
      },
    ],
    defaultConfig: { knockout: { teamCount: 16, legs: 2 } },
  },

  HYBRID_CHAMPIONS_LEAGUE: {
    format: "HYBRID_CHAMPIONS_LEAGUE",
    label: "Hybrid (Champions League style)",
    description: "Group stage then knockout with configurable advance rules.",
    category: "hybrid",
    implementationStatus: "complete",
    stages: [
      {
        key: "groups",
        name: "Group Stage",
        type: "group",
        sortOrder: 1,
        groups: ["A", "B", "C", "D"],
        matchdays: 6,
      },
      { key: "r16", name: "Round of 16", type: "knockout", sortOrder: 2, knockoutRound: "R16" },
      { key: "qf", name: "Quarter-Finals", type: "knockout", sortOrder: 3, knockoutRound: "QF" },
      { key: "sf", name: "Semi-Finals", type: "knockout", sortOrder: 4, knockoutRound: "SF" },
      { key: "final", name: "Final", type: "knockout", sortOrder: 5, knockoutRound: "F" },
    ],
    progressionRules: [
      {
        id: "hybrid-advance",
        kind: "hybrid_group_to_knockout",
        description: "Top N per group advance to knockout bracket.",
        source: { advancePerGroup: 2 },
      },
    ],
    defaultConfig: { hybrid: { groups: 4, teamsPerGroup: 4, advancePerGroup: 2 } },
  },

  SINGLE_FRIENDLY_MATCH: {
    format: "SINGLE_FRIENDLY_MATCH",
    label: "Single Friendly",
    description: "One match — home vs away, date, neutral venue option; Club Friendlies category.",
    category: "friendly",
    implementationStatus: "complete",
    stages: [
      { key: "friendly", name: "Friendly", type: "friendly", sortOrder: 1, legs: 1 },
    ],
    progressionRules: [
      {
        id: "friendly-none",
        kind: "friendly_single",
        description: "No standings or bracket; result only.",
      },
    ],
  },

  JAGABAN_CUP_STANDARD: {
    format: "JAGABAN_CUP_STANDARD",
    label: "Jagaban Cup (Standard)",
    description:
      "2×4 groups, round-robin group stage, cross-group grand final & third-place playoff.",
    category: "showcase",
    implementationStatus: "complete",
    stages: buildJagabanCupStages({
      editionLabel: "Jagaban Cup",
      groupCount: 2,
      teamsPerGroup: 4,
      groupLabels: ["A", "B"],
    }),
    progressionRules: JAGABAN_PROGRESSION,
    defaultConfig: {
      jagaban: {
        editionLabel: "Jagaban Cup",
        groupCount: 2,
        teamsPerGroup: 4,
        groupLabels: ["A", "B"],
        cloneFromFormat: "JAGABAN_CUP_STANDARD",
      } satisfies JagabanCupConfig,
    },
  },

  COMBINATION_TOURNAMENT: {
    format: "COMBINATION_TOURNAMENT",
    label: "Combination Tournament",
    description:
      "Multi-stage pipeline (e.g. groups → league phase → knockout). Skeleton: configure stages manually.",
    category: "experimental",
    implementationStatus: "skeleton",
    stages: [
      { key: "stage_1", name: "Stage 1", type: "group", sortOrder: 1 },
      { key: "stage_2", name: "Stage 2", type: "league", sortOrder: 2 },
      { key: "stage_3", name: "Stage 3", type: "knockout", sortOrder: 3 },
    ],
    progressionRules: [
      {
        id: "combo-chain",
        kind: "multi_stage_chain",
        description: "Winners/advancers from each stage feed the next (manual seeding in v1).",
      },
    ],
    defaultConfig: { combination: { stageKeys: ["stage_1", "stage_2", "stage_3"] } },
  },

  CHALLENGE_LADDER: {
    format: "CHALLENGE_LADDER",
    label: "Challenge Ladder / Pyramid",
    description:
      "Ladder format: challengers play holders to move up rungs. Skeleton: document + placeholder stages.",
    category: "experimental",
    implementationStatus: "skeleton",
    stages: [{ key: "ladder", name: "Ladder", type: "ladder", sortOrder: 1 }],
    progressionRules: [
      {
        id: "ladder-challenge",
        kind: "ladder_challenge",
        description: "Winner takes the rung; loser drops or stays per pyramid rules.",
      },
    ],
    defaultConfig: { ladder: { maxRungs: 16 } },
  },
};

export function getCompetitionTemplate(format: CompetitionFormat): CompetitionTemplate {
  return COMPETITION_TEMPLATES[format];
}

export function listCompetitionTemplates(): CompetitionTemplate[] {
  return Object.values(COMPETITION_TEMPLATES);
}

export function cloneJagabanConfigForEdition(
  editionLabel: string,
  overrides?: Partial<JagabanCupConfig>
): JagabanCupConfig {
  const base = COMPETITION_TEMPLATES.JAGABAN_CUP_STANDARD.defaultConfig?.jagaban as JagabanCupConfig;
  return {
    ...base,
    editionLabel,
    cloneFromFormat: "JAGABAN_CUP_STANDARD",
    ...overrides,
  };
}
