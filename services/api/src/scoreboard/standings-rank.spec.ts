import { describe, expect, it } from "vitest";
import { computeStandings } from "./standings";

/**
 * Position on a flat league table.
 *
 * The grouped table assigned a rank and the flat one never did, so every
 * ungrouped competition came back with no position and the page printed a dash
 * in the POS column for every side. It went unnoticed because the rows were
 * already in the right order — only the number was missing.
 */
const teams = [
  { id: "a", name: "Alpha", shortName: null },
  { id: "b", name: "Bravo", shortName: null },
  { id: "c", name: "Charlie", shortName: null },
];

describe("computeStandings rank", () => {
  it("numbers every row from one, in table order", () => {
    const rows = computeStandings(teams, [
      { homeTeamId: "a", awayTeamId: "b", homeScore: 3, awayScore: 0 },
      { homeTeamId: "b", awayTeamId: "c", homeScore: 1, awayScore: 0 },
    ]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(rows[0].teamId).toBe("a");
  });

  it("leaves no row without a position", () => {
    // The symptom was a null rank, not a wrong one.
    const rows = computeStandings(teams, []);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => typeof r.rank === "number" && r.rank > 0)).toBe(true);
  });

  it("ranks by the order the table is sorted in, not by insertion", () => {
    // Charlie is entered last and should finish first.
    const rows = computeStandings(teams, [
      { homeTeamId: "c", awayTeamId: "a", homeScore: 5, awayScore: 0 },
      { homeTeamId: "c", awayTeamId: "b", homeScore: 5, awayScore: 0 },
    ]);
    expect(rows[0].teamId).toBe("c");
    expect(rows[0].rank).toBe(1);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("gives tied sides consecutive positions rather than repeating one", () => {
    /* Two sides level on every tiebreak still occupy two places. The grouped
       table numbers them consecutively and this matches it, so the two tables
       never disagree about what POS means. */
    const rows = computeStandings(teams, [
      { homeTeamId: "a", awayTeamId: "b", homeScore: 0, awayScore: 0 },
    ]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});
