import type { CompetitionFormat, FixtureTeamInput, GeneratedFixture } from "./competition-types";
import { getCompetitionTemplate } from "./competition-templates";

/** Round-robin pairings (circle method) for n teams; returns [homeIdx, awayIdx] per round. */
function roundRobinPairings(teamIds: string[]): Array<Array<[string, string]>> {
  const ids = [...teamIds];
  if (ids.length % 2 === 1) ids.push("__bye__");
  const n = ids.length;
  const rounds: Array<Array<[string, string]>> = [];
  const fixed = ids[0];
  let rotating = ids.slice(1);

  for (let r = 0; r < n - 1; r++) {
    const round: Array<[string, string]> = [];
    const order = [fixed, ...rotating];
    for (let i = 0; i < n / 2; i++) {
      const home = order[i];
      const away = order[n - 1 - i];
      if (home !== "__bye__" && away !== "__bye__") {
        round.push(r % 2 === 0 ? [home, away] : [away, home]);
      }
    }
    rounds.push(round);
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }
  return rounds;
}

function groupTeamsByKey(teams: FixtureTeamInput[]): Map<string, FixtureTeamInput[]> {
  const map = new Map<string, FixtureTeamInput[]>();
  for (const t of teams) {
    const key = t.groupKey ?? "default";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(t);
  }
  return map;
}

function generateGroupFixtures(
  stageKey: string,
  groupLabel: string,
  teams: FixtureTeamInput[],
  matchdayOffset: number
): GeneratedFixture[] {
  const rounds = roundRobinPairings(teams.map((t) => t.id));
  const fixtures: GeneratedFixture[] = [];
  let sortOrder = 0;
  rounds.forEach((round, mdIndex) => {
    for (const [homeId, awayId] of round) {
      fixtures.push({
        stageKey,
        roundLabel: `Group ${groupLabel} · MD${mdIndex + 1}`,
        matchday: matchdayOffset + mdIndex + 1,
        homeTeamId: homeId,
        awayTeamId: awayId,
        sortOrder: sortOrder++,
      });
    }
  });
  return fixtures;
}

function generateLeagueFixtures(
  teams: FixtureTeamInput[],
  homeAndAway: boolean
): GeneratedFixture[] {
  const firstLeg = generateGroupFixtures("league", "All", teams, 0);
  if (!homeAndAway) return firstLeg;
  const secondLeg = firstLeg.map((f, i) => ({
    ...f,
    stageKey: "league",
    roundLabel: `League · MD${f.matchday + (teams.length - 1)} (Away leg)`,
    matchday: f.matchday + (teams.length - 1),
    homeTeamId: f.awayTeamId,
    awayTeamId: f.homeTeamId,
    sortOrder: firstLeg.length + i,
  }));
  return [...firstLeg, ...secondLeg];
}

function generateKnockoutBracket(
  teamIds: string[],
  stagePrefix: string
): GeneratedFixture[] {
  const rounds: Array<{ key: string; label: string; count: number }> = [];
  const n = teamIds.length;
  if (n >= 32) rounds.push({ key: "r32", label: "Round of 32", count: 16 });
  if (n >= 16) rounds.push({ key: "r16", label: "Round of 16", count: 8 });
  if (n >= 8) rounds.push({ key: "qf", label: "Quarter-Finals", count: 4 });
  if (n >= 4) rounds.push({ key: "sf", label: "Semi-Finals", count: 2 });
  rounds.push({ key: "final", label: "Final", count: 1 });

  const fixtures: GeneratedFixture[] = [];
  let sortOrder = 0;
  let slot = [...teamIds];
  for (const round of rounds) {
    const pairs = Math.min(round.count, Math.floor(slot.length / 2));
    for (let i = 0; i < pairs; i++) {
      const home = slot[i * 2];
      const away = slot[i * 2 + 1];
      if (!home || !away) break;
      fixtures.push({
        stageKey: `${stagePrefix}_${round.key}`,
        roundLabel: round.label,
        matchday: 1,
        homeTeamId: home,
        awayTeamId: away,
        sortOrder: sortOrder++,
      });
    }
    slot = slot.slice(pairs * 2);
  }
  return fixtures;
}

/**
 * Generate scheduled fixtures for a competition from its format and enrolled teams.
 * Knockout placeholders after group stages use TBD team ids when progression not yet resolved.
 */
export function generateFixtures(
  _competitionId: string,
  formatType: CompetitionFormat,
  teamsArray: FixtureTeamInput[],
  options?: { homeAndAway?: boolean; knockoutTeamCount?: number }
): GeneratedFixture[] {
  const template = getCompetitionTemplate(formatType);

  switch (formatType) {
    case "STANDARD_LEAGUE": {
      const homeAndAway = options?.homeAndAway ?? true;
      return generateLeagueFixtures(teamsArray, homeAndAway);
    }

    case "KNOCKOUT_CUP": {
      const count = options?.knockoutTeamCount ?? teamsArray.length;
      const ids = teamsArray.slice(0, count).map((t) => t.id);
      return generateKnockoutBracket(ids, "knockout");
    }

    case "HYBRID_CHAMPIONS_LEAGUE": {
      const byGroup = groupTeamsByKey(teamsArray);
      let fixtures: GeneratedFixture[] = [];
      let mdOffset = 0;
      for (const [groupKey, groupTeams] of byGroup) {
        const stageKey = `group_${groupKey.toLowerCase()}`;
        const groupFixtures = generateGroupFixtures(
          stageKey,
          groupKey,
          groupTeams,
          mdOffset
        );
        fixtures = fixtures.concat(groupFixtures);
        mdOffset += groupTeams.length - 1;
      }
      return fixtures;
    }

    case "SINGLE_FRIENDLY_MATCH": {
      if (teamsArray.length < 2) return [];
      const [home, away] = teamsArray;
      return [
        {
          stageKey: "friendly",
          roundLabel: "Club Friendly",
          matchday: 1,
          homeTeamId: home.id,
          awayTeamId: away.id,
          sortOrder: 0,
        },
      ];
    }

    case "JAGABAN_CUP_STANDARD": {
      const byGroup = groupTeamsByKey(teamsArray);
      const labels = template.defaultConfig?.jagaban as { groupLabels?: string[] };
      const groupKeys = labels?.groupLabels ?? ["A", "B"];
      let fixtures: GeneratedFixture[] = [];
      for (const gk of groupKeys) {
        const groupTeams = byGroup.get(gk) ?? [];
        if (groupTeams.length < 2) continue;
        fixtures = fixtures.concat(
          generateGroupFixtures(`group_${gk.toLowerCase()}`, gk, groupTeams, 0)
        );
      }
      return fixtures;
    }

    case "COMBINATION_TOURNAMENT":
    case "CHALLENGE_LADDER":
      return [];

    default:
      return [];
  }
}

/** Progression preview nodes for admin UI (not fixtures). */
export function buildProgressionPreview(formatType: CompetitionFormat): string[] {
  const t = getCompetitionTemplate(formatType);
  return t.progressionRules.map((r) => r.description);
}
