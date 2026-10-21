import { describe, expect, it } from "vitest";
import { deriveTournamentTotals } from "./tournament-totals";

const match = (status: string, homeScore = 0, awayScore = 0) => ({ status, homeScore, awayScore });

describe("tournament totals", () => {
  it("averages goals over the matches played, not over every fixture", () => {
    const totals = deriveTournamentTotals([
      match("finished", 3, 1),
      match("finished", 2, 2),
      match("scheduled"),
      match("scheduled"),
    ]);
    expect(totals).toEqual({ matches: 4, matchesPlayed: 2, goals: 8, goalsPerMatch: "4.0" });
  });

  it("leaves a game in progress out until it is finished", () => {
    const totals = deriveTournamentTotals([
      match("finished", 1, 0),
      match("live", 2, 1),
      match("halftime", 1, 1),
    ]);
    expect(totals).toEqual({ matches: 3, matchesPlayed: 1, goals: 1, goalsPerMatch: "1.0" });
  });

  it("ignores a score left on a fixture that was never played", () => {
    const totals = deriveTournamentTotals([match("finished", 2, 0), match("postponed", 1, 1)]);
    expect(totals.goals).toBe(2);
    expect(totals.goalsPerMatch).toBe("2.0");
  });

  it("reads 0.0 before a ball is kicked", () => {
    expect(deriveTournamentTotals([match("scheduled"), match("scheduled")])).toEqual({
      matches: 2,
      matchesPlayed: 0,
      goals: 0,
      goalsPerMatch: "0.0",
    });
  });

  it("rounds the average to one place", () => {
    const totals = deriveTournamentTotals([
      match("finished", 1, 0),
      match("finished", 1, 1),
      match("finished", 3, 1),
    ]);
    expect(totals.goalsPerMatch).toBe("2.3");
  });
});
