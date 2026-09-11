import { describe, it, expect, vi } from "vitest";
import { ScoreboardService } from "./scoreboard.service";

/**
 * The Browse page cards show each competition's team and goal counts, from
 * GET /scoreboard/competitions and the polled GET /scoreboard/competitions/tallies.
 */
function service() {
  const groupBy = vi.fn(async () => [
    { competitionId: "c-coal", _sum: { homeScore: 5, awayScore: 3 } },
    // Postgres returns null sums when every row is null; treat that as none.
    { competitionId: "c-dsl", _sum: { homeScore: null, awayScore: 2 } },
  ]);
  const prisma = {
    sbCompetition: {
      findMany: vi.fn(async (args: { select?: unknown }) =>
        args.select
          ? [
              { id: "c-coal", _count: { teams: 12 } },
              { id: "c-dsl", _count: { teams: 8 } },
              { id: "c-new", _count: { teams: 4 } },
            ]
          : [
              { id: "c-coal", name: "Coal City Scouting Tournament", _count: { teams: 12, matches: 20 } },
              { id: "c-new", name: "New Cup", _count: { teams: 4, matches: 0 } },
            ]
      ),
    },
    sbMatch: { groupBy },
  };
  const sb = new ScoreboardService(prisma as never, null as never, null as never, null as never);
  return { sb, groupBy };
}

describe("competition tallies", () => {
  it("sums both sides' scores per competition and counts its teams", async () => {
    const { sb } = service();
    expect(await sb.competitionTallies()).toEqual([
      { competitionId: "c-coal", teams: 12, goals: 8 },
      { competitionId: "c-dsl", teams: 8, goals: 2 },
      { competitionId: "c-new", teams: 4, goals: 0 },
    ]);
  });

  it("only counts published matches that have kicked off", async () => {
    const { sb, groupBy } = service();
    await sb.competitionTallies();
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["competitionId"],
        where: {
          isPublished: true,
          status: { in: ["live", "halftime", "finished"] },
          competition: { isPublished: true },
        },
      })
    );
  });

  it("adds the goal total to the competitions list", async () => {
    const { sb } = service();
    const rows: any[] = await sb.competitions();
    expect(rows.map((row) => [row.id, row.goals, row._count.teams])).toEqual([
      ["c-coal", 8, 12],
      ["c-new", 0, 4],
    ]);
  });
});
