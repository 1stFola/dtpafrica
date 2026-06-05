export type GroupStandingRow = {
  teamId: string;
  teamName: string;
  shortName: string | null;
  groupKey: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: Array<"W" | "D" | "L">;
  rank: number;
};

type FinishedMatch = {
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  kickoffAt?: Date | null;
};

type TeamInfo = {
  id: string;
  name: string;
  shortName: string | null;
  groupKey: string | null;
};

function resultChar(homeScore: number, awayScore: number, isHome: boolean): "W" | "D" | "L" {
  if (homeScore === awayScore) return "D";
  const homeWins = homeScore > awayScore;
  if (isHome) return homeWins ? "W" : "L";
  return homeWins ? "L" : "W";
}

export function computeGroupStandings(
  teams: TeamInfo[],
  finishedMatches: FinishedMatch[]
): GroupStandingRow[] {
  const byGroup = new Map<string, Map<string, GroupStandingRow>>();

  for (const t of teams) {
    const gk = t.groupKey ?? "default";
    if (!byGroup.has(gk)) byGroup.set(gk, new Map());
    byGroup.get(gk)!.set(t.id, {
      teamId: t.id,
      teamName: t.name,
      shortName: t.shortName,
      groupKey: gk,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
      form: [],
      rank: 0,
    });
  }

  const sortedMatches = [...finishedMatches].sort((a, b) => {
    const ta = a.kickoffAt?.getTime() ?? 0;
    const tb = b.kickoffAt?.getTime() ?? 0;
    return ta - tb;
  });

  for (const m of sortedMatches) {
    for (const [gk, table] of byGroup) {
      const home = table.get(m.homeTeamId);
      const away = table.get(m.awayTeamId);
      if (!home || !away) continue;

      home.played += 1;
      away.played += 1;
      home.goalsFor += m.homeScore;
      home.goalsAgainst += m.awayScore;
      away.goalsFor += m.awayScore;
      away.goalsAgainst += m.homeScore;

      const homeResult = resultChar(m.homeScore, m.awayScore, true);
      const awayResult = resultChar(m.homeScore, m.awayScore, false);
      home.form.push(homeResult);
      away.form.push(awayResult);
      if (home.form.length > 5) home.form.shift();
      if (away.form.length > 5) away.form.shift();

      if (m.homeScore > m.awayScore) {
        home.won += 1;
        home.points += 3;
        away.lost += 1;
      } else if (m.homeScore < m.awayScore) {
        away.won += 1;
        away.points += 3;
        home.lost += 1;
      } else {
        home.drawn += 1;
        away.drawn += 1;
        home.points += 1;
        away.points += 1;
      }
    }
  }

  const rows: GroupStandingRow[] = [];
  for (const table of byGroup.values()) {
    const sorted = [...table.values()]
      .map((r) => ({
        ...r,
        goalDifference: r.goalsFor - r.goalsAgainst,
      }))
      .sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goalDifference !== a.goalDifference) {
          return b.goalDifference - a.goalDifference;
        }
        return b.goalsFor - a.goalsFor;
      });
    sorted.forEach((r, i) => rows.push({ ...r, rank: i + 1 }));
  }

  return rows.sort((a, b) =>
    a.groupKey.localeCompare(b.groupKey) || a.rank - b.rank
  );
}
