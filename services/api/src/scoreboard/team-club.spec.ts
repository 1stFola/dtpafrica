import { describe, it, expect, vi } from "vitest";
import { ScoreboardService } from "./scoreboard.service";

/**
 * The public team page (GET /scoreboard/teams/:id) ties a competition entry
 * back to its club and the club's other competitions.
 */
function teamRow(academy: unknown) {
  return {
    id: "t-coal",
    name: "Box 2 Box FC",
    slug: "box-2-box-fc",
    shortName: null,
    logoUrl: null,
    city: "Lagos",
    groupKey: null,
    academyId: "a-b2b",
    competitionId: "c-coal",
    competition: { id: "c-coal", name: "Coal City Scouting Tournament", slug: "coal-city", season: "2026" },
    academy,
    squad: [],
    homeMatches: [],
    awayMatches: [],
  };
}

const club = (isPublished: boolean) => ({
  id: "a-b2b",
  slug: "box-2-box-fc",
  name: "Box 2 Box FC",
  logoUrl: null,
  isPublished,
  teams: [
    { id: "t-coal", competition: { id: "c-coal", name: "Coal City Scouting Tournament", slug: "coal-city", season: "2026" } },
    { id: "t-s2p", competition: { id: "c-s2p", name: "Scout To Pro International Tournament", slug: "s2p", season: "2025" } },
  ],
});

function service(row: unknown) {
  const prisma = { sbTeam: { findFirst: vi.fn(async () => row) } };
  return new ScoreboardService(prisma as never, null as never, null as never, null as never);
}

describe("teamById — club links", () => {
  it("names the club and lists its other competitions, not this one", async () => {
    const result: any = await service(teamRow(club(true))).teamById("t-coal");
    expect(result.club).toEqual({ id: "a-b2b", slug: "box-2-box-fc", name: "Box 2 Box FC", logoUrl: null });
    expect(result.clubCompetitions).toEqual([
      {
        teamId: "t-s2p",
        competitionId: "c-s2p",
        competitionName: "Scout To Pro International Tournament",
        competitionSlug: "s2p",
        season: "2025",
      },
    ]);
    // The raw relation, with its nested team rows, is not passed through.
    expect(result.academy).toBeUndefined();
  });

  it("does not surface an unpublished club profile", async () => {
    const result: any = await service(teamRow(club(false))).teamById("t-coal");
    expect(result.club).toBeNull();
    expect(result.clubCompetitions).toEqual([]);
  });

  it("works for a team not yet linked to any club", async () => {
    const result: any = await service(teamRow(null)).teamById("t-coal");
    expect(result.club).toBeNull();
    expect(result.clubCompetitions).toEqual([]);
    expect(result.name).toBe("Box 2 Box FC");
  });
});
