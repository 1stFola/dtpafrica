/**
 * The numbers in a competition's Tournament Totals (and its History tab's Edition Stats).
 *
 * The average used to divide every goal by every fixture on the calendar, so a cup with
 * ten of forty games played read about a quarter of its real rate, and it fell further each
 * time a fixture was added. The goals and the average now come from finished matches only,
 * so Goals divided by Matches Played is the Goals / Match shown beside them. A game in
 * progress joins both once its final whistle goes. A shootout is not in the goals: the
 * match score is the score at the end of play, the shootout lives in `meta`.
 */
export type TournamentTotals = {
  /** Every fixture in the competition, played or not. */
  matches: number;
  matchesPlayed: number;
  goals: number;
  /** One decimal place; "0.0" until a match is finished. */
  goalsPerMatch: string;
};

type TotalsMatch = { status: string; homeScore: number; awayScore: number };

export function deriveTournamentTotals(matches: TotalsMatch[]): TournamentTotals {
  const played = matches.filter((m) => m.status === "finished");
  const goals = played.reduce((sum, m) => sum + m.homeScore + m.awayScore, 0);
  return {
    matches: matches.length,
    matchesPlayed: played.length,
    goals,
    goalsPerMatch: played.length ? (goals / played.length).toFixed(1) : "0.0",
  };
}
