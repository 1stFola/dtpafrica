import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompetitionEngineService } from "./competition-engine.service";

/**
 * The group-phase table cut.
 *
 * 1XCup's group-stage teams reached it by winning zonal knockout qualifiers, so
 * every one of them already has finished matches that are nothing to do with the
 * group table. Two things therefore have to hold, and neither is obvious enough to
 * leave to inspection:
 *
 *   1. Only `group_*` matches may feed the table, or a side's qualifying wins would
 *      be counted twice over in its group.
 *   2. Only teams that actually have a group fixture may appear, or the seventy-six
 *      eliminated clubs render five all-zero zone tables beside the six real ones.
 */

const COMP = "comp-1";

function makePrisma(over: Record<string, unknown> = {}) {
  return {
    sbCompetition: {
      findFirst: vi.fn().mockResolvedValue({
        id: COMP,
        name: "1XCup 2026",
        season: "2026",
        formatType: "1XCUP_MULTI_STAGE",
        isPublished: true,
        teams: [
          { id: "t1", name: "Group Team One", shortName: null, groupKey: "Group A", logoUrl: null },
          { id: "t2", name: "Group Team Two", shortName: null, groupKey: "Group A", logoUrl: null },
          { id: "z9", name: "Eliminated Club", shortName: null, groupKey: "ikeja_zone", logoUrl: null },
        ],
      }),
    },
    sbMatch: { findMany: vi.fn() },
    ...over,
  };
}

describe("1XCup group-phase standings", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: CompetitionEngineService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new CompetitionEngineService(prisma as never);
  });

  it("counts only group matches, never the qualifying rounds", async () => {
    prisma.sbMatch.findMany.mockImplementation(({ where, select }: never) => {
      // The membership lookup asks for team ids; the results lookup asks for scores.
      if ((select as Record<string, unknown>).homeScore === undefined) {
        return Promise.resolve([{ homeTeamId: "t1", awayTeamId: "t2" }]);
      }
      expect((where as Record<string, unknown>).stageKey).toEqual({ startsWith: "group_" });
      return Promise.resolve([
        { homeTeamId: "t1", awayTeamId: "t2", homeScore: 2, awayScore: 0, kickoffAt: new Date(), stageKey: "group_a" },
      ]);
    });

    const result = await service.standings(COMP, { publicOnly: true });
    const t1 = result.rows.find((r) => r.teamId === "t1");
    expect(t1?.played).toBe(1);
    expect(t1?.points).toBe(3);
  });

  it("leaves out teams with no group fixture, so eliminated clubs form no table", async () => {
    prisma.sbMatch.findMany.mockImplementation(({ select }: never) => {
      if ((select as Record<string, unknown>).homeScore === undefined) {
        return Promise.resolve([{ homeTeamId: "t1", awayTeamId: "t2" }]);
      }
      return Promise.resolve([]);
    });

    const result = await service.standings(COMP, { publicOnly: true });
    expect(result.rows.map((r) => r.teamId).sort()).toEqual(["t1", "t2"]);
    // Cast, because `StandingRow` does not declare `groupKey` even though
    // computeGroupStandings puts it on every grouped row and the HTTP response
    // carries it. Narrowed here rather than widening the engine's types from a test.
    const groupsSeen = [
      ...new Set(result.rows.map((r) => (r as { groupKey?: string }).groupKey)),
    ];
    expect(groupsSeen).toEqual(["Group A"]);
  });

  it("does not narrow the table before any group fixture exists", async () => {
    // Until the draw is seeded every team must still appear, or the qualifying
    // phase would show an empty table instead of its zones.
    prisma.sbMatch.findMany.mockResolvedValue([]);
    const result = await service.standings(COMP, { publicOnly: true });
    expect(result.rows).toHaveLength(3);
  });

  it("does not apply the cut to a format that has no earlier phase", async () => {
    prisma = makePrisma();
    prisma.sbCompetition.findFirst.mockResolvedValue({
      id: COMP, name: "A League", season: "2026", formatType: "STANDARD_LEAGUE",
      isPublished: true,
      teams: [{ id: "l1", name: "One", shortName: null, groupKey: null, logoUrl: null },
              { id: "l2", name: "Two", shortName: null, groupKey: null, logoUrl: null }],
    });
    prisma.sbMatch.findMany.mockResolvedValue([
      { homeTeamId: "l1", awayTeamId: "l2", homeScore: 1, awayScore: 1, kickoffAt: new Date(), stageKey: null },
    ]);
    service = new CompetitionEngineService(prisma as never);

    const result = await service.standings(COMP, { publicOnly: true });
    // A single league table: no grouping, and the un-prefixed match still counts.
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.played === 1)).toBe(true);
  });
});
