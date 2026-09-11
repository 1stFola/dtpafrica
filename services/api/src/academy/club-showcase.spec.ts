import { describe, it, expect, vi } from "vitest";
import { buildClubShowcase, EMPTY_CLUB_SHOWCASE } from "./club-showcase";

const CLUB = ["t-coal", "t-s2p"];
const team = (name: string) => ({ name, shortName: null, logoUrl: null });

let n = 0;
function match(opts: {
  home: string;
  away: string;
  score: [number, number];
  status?: string;
  day?: number;
}) {
  n++;
  return {
    id: `m${n}`,
    slug: `m${n}`,
    status: opts.status ?? "finished",
    kickoffAt: new Date(2026, 0, opts.day ?? n),
    homeTeamId: opts.home,
    awayTeamId: opts.away,
    homeScore: opts.score[0],
    awayScore: opts.score[1],
    homeTeam: team(opts.home === "t-coal" || opts.home === "t-s2p" ? "Box 2 Box FC" : "Rival FC"),
    awayTeam: team(opts.away === "t-coal" || opts.away === "t-s2p" ? "Box 2 Box FC" : "Rival FC"),
    competition: { name: "Coal City Scouting Tournament", season: "2026" },
  };
}

function prisma(data: { finished?: any[]; upcoming?: any[]; events?: any[]; squad?: any[] }) {
  return {
    sbMatch: {
      findMany: vi.fn(async ({ where }: any) =>
        where.status === "finished" ? data.finished ?? [] : data.upcoming ?? []
      ),
    },
    sbMatchEvent: { findMany: vi.fn(async () => data.events ?? []) },
    sbTeamSquad: { findMany: vi.fn(async () => data.squad ?? []) },
  } as never;
}

describe("buildClubShowcase", () => {
  it("returns an empty showcase for a club with no competition entries", async () => {
    expect(await buildClubShowcase(prisma({}), [])).toEqual(EMPTY_CLUB_SHOWCASE);
  });

  it("tallies the record from the club's side, home or away, across seasons", async () => {
    const finished = [
      match({ home: "t-coal", away: "x", score: [2, 0] }), // home win, clean sheet
      match({ home: "x", away: "t-s2p", score: [1, 3] }), // away win
      match({ home: "x", away: "t-coal", score: [1, 1] }), // draw
      match({ home: "t-s2p", away: "x", score: [0, 2] }), // home loss
    ];
    const { record } = await buildClubShowcase(prisma({ finished }), CLUB);
    expect(record).toEqual({
      played: 4,
      won: 2,
      drawn: 1,
      lost: 1,
      goalsFor: 6,
      goalsAgainst: 4,
      cleanSheets: 1,
    });
  });

  it("marks each recent result W/D/L from the club's point of view", async () => {
    const finished = [
      match({ home: "x", away: "t-coal", score: [0, 1] }),
      match({ home: "t-coal", away: "x", score: [0, 1] }),
    ];
    const { recentResults } = await buildClubShowcase(prisma({ finished }), CLUB);
    expect(recentResults.map((r) => [r.clubSide, r.outcome])).toEqual([
      ["away", "W"],
      ["home", "L"],
    ]);
  });

  it("puts a match in progress ahead of scheduled fixtures", async () => {
    const upcoming = [
      match({ home: "t-coal", away: "x", score: [0, 0], status: "scheduled", day: 1 }),
      match({ home: "x", away: "t-coal", score: [1, 0], status: "live", day: 9 }),
    ];
    const result = await buildClubShowcase(prisma({ upcoming }), CLUB);
    expect(result.upcoming.map((m) => m.status)).toEqual(["live", "scheduled"]);
    expect(result.upcoming[0].outcome).toBeNull();
  });

  it("ranks scorers, counting unlinked goals by name and never linking a private profile", async () => {
    const events = [
      { playerId: "p1", playerLabel: null, player: { displayName: "Chidi Nwosu", slug: "chidi", playerPhotoUrl: "c.png", isPublic: true } },
      { playerId: "p1", playerLabel: null, player: { displayName: "Chidi Nwosu", slug: "chidi", playerPhotoUrl: "c.png", isPublic: true } },
      { playerId: "p2", playerLabel: null, player: { displayName: "Hidden Player", slug: "hidden", playerPhotoUrl: "h.png", isPublic: false } },
      { playerId: null, playerLabel: "tunde  bello", player: null },
    ];
    const { topScorers } = await buildClubShowcase(prisma({ events }), CLUB);
    expect(topScorers[0]).toEqual({ name: "Chidi Nwosu", goals: 2, slug: "chidi", photoUrl: "c.png" });
    const hidden = topScorers.find((s) => s.name === "Hidden Player")!;
    expect(hidden).toMatchObject({ slug: null, photoUrl: null });
    expect(topScorers.map((s) => s.name)).toContain("tunde bello");
  });

  it("lists each player once across seasons, public profiles first", async () => {
    const squad = [
      { playerId: "p1", displayName: "Private Keeper", position: "GK", shirtNumber: 1, player: { displayName: "Private Keeper", slug: "pk", positionPrimary: "GK", playerPhotoUrl: null, overallRating: 90, isPublic: false } },
      { playerId: "p2", displayName: "Star Striker", position: "ST", shirtNumber: 9, player: { displayName: "Star Striker", slug: "star", positionPrimary: "ST", playerPhotoUrl: "s.png", overallRating: 81, isPublic: true } },
      { playerId: "p2", displayName: "Star Striker", position: "ST", shirtNumber: 10, player: { displayName: "Star Striker", slug: "star", positionPrimary: "ST", playerPhotoUrl: "s.png", overallRating: 81, isPublic: true } },
    ];
    const { players, squadSize } = await buildClubShowcase(prisma({ squad }), CLUB);
    expect(squadSize).toBe(2);
    expect(players.map((p) => p.name)).toEqual(["Star Striker", "Private Keeper"]);
    // A private profile's rating and link are withheld.
    expect(players[1]).toMatchObject({ slug: null, photoUrl: null, overallRating: null });
  });
});
