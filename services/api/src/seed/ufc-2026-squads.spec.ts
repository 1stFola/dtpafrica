import { describe, it, expect } from "vitest";
import {
  ROSTERS,
  rosterProblems,
  seedUnitedFootballChampionshipLeague2026Squads,
  type RosterSeed,
} from "../../prisma/seed-united-football-championship-league-2026-squads";
import { TEAMS } from "../../prisma/seed-united-football-championship-league-2026";

type Player = {
  id: string;
  displayName: string;
  normalizedName: string | null;
  slug: string;
  playerPhotoUrl: string | null;
};
type Squad = {
  id: string;
  teamId: string;
  playerId: string | null;
  displayName: string;
  position: string | null;
  shirtNumber: number | null;
};

const COMP_ID = "ufc";

/**
 * In-memory stand-in for the tables the squad seed touches: enough of the Prisma
 * surface for the seed and for the player directory it delegates to.
 */
function makePrisma(options: { players?: Player[]; squad?: Squad[] } = {}) {
  const players: Player[] = [...(options.players ?? [])];
  const squad: Squad[] = [...(options.squad ?? [])];
  const teams = TEAMS.map((t) => ({ id: `team-${t.slug}`, slug: t.slug, name: t.name }));
  let seq = 0;
  const teamOf = (id: string) => teams.find((t) => t.id === id);

  const prisma = {
    players,
    squad,
    sbCompetition: {
      findUnique: async ({ where }: any) =>
        where.slug === "united-football-championship-league-2026" ? { id: COMP_ID } : null,
    },
    sbTeam: {
      findMany: async () => teams,
    },
    player: {
      findUnique: async ({ where }: any) =>
        players.find((p) =>
          where.normalizedName ? p.normalizedName === where.normalizedName : p.slug === where.slug
        ) ?? null,
      findFirst: async ({ where }: any) =>
        players.find(
          (p) =>
            (where.displayName &&
              p.displayName.toLowerCase() === where.displayName.equals.toLowerCase()) ||
            (where.slug && p.slug === where.slug)
        ) ?? null,
      findUniqueOrThrow: async ({ where }: any) => players.find((p) => p.id === where.id)!,
      update: async ({ where, data }: any) => {
        const row = players.find((p) => p.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      create: async ({ data }: any) => {
        const row = { id: `player-${++seq}`, playerPhotoUrl: null, ...data };
        players.push(row);
        return row;
      },
    },
    sbTeamSquad: {
      findFirst: async ({ where }: any) => {
        if (where.teamId?.not) {
          return (
            squad
              .filter(
                (s) =>
                  s.playerId === where.playerId &&
                  s.teamId !== where.teamId.not &&
                  teamOf(s.teamId) !== undefined
              )
              .map((s) => ({ team: { name: teamOf(s.teamId)!.name } }))[0] ?? null
          );
        }
        return (
          squad.find(
            (s) =>
              s.teamId === where.teamId &&
              where.OR.some(
                (clause: any) =>
                  (clause.playerId && s.playerId === clause.playerId) ||
                  (clause.displayName &&
                    s.displayName.toLowerCase() === clause.displayName.equals.toLowerCase())
              )
          ) ?? null
        );
      },
      create: async ({ data }: any) => {
        const row = { id: `squad-${++seq}`, ...data };
        squad.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = squad.find((s) => s.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      count: async ({ where }: any) => squad.filter((s) => s.teamId === where.teamId).length,
    },
  };
  return prisma;
}

const run = (prisma: ReturnType<typeof makePrisma>) =>
  seedUnitedFootballChampionshipLeague2026Squads(prisma as any);

const listed = ROSTERS.reduce((n, r) => n + r.players.length, 0);

describe("UFC 2026 registered squads", () => {
  it("lists the eleven clubs that registered, each a UFC team, nobody twice in a club", () => {
    expect(rosterProblems()).toEqual([]);
    expect(ROSTERS).toHaveLength(11);
    expect(TEAMS.filter((t) => !ROSTERS.some((r) => r.teamSlug === t.slug)).map((t) => t.slug)).toEqual([
      "box2box-fc",
    ]);
  });

  it("rosterProblems catches a club listing one player twice or a slug that is not a UFC club", () => {
    const bad: RosterSeed[] = [
      {
        teamSlug: "ablaze-fc",
        players: [
          { shirt: 1, name: "Yusuf Murtala", position: "AM", photo: null },
          { shirt: 2, name: "YUSUF  MURTALA", position: "ST", photo: "http://plain.example/a.jpg" },
        ],
      },
      { teamSlug: "not-a-club", players: [] },
    ];
    const problems = rosterProblems(bad);
    expect(problems).toContain("ablaze-fc: YUSUF  MURTALA is listed twice (also as Yusuf Murtala)");
    expect(problems).toContain("ablaze-fc: YUSUF  MURTALA has a photo link that is not https");
    expect(problems).toContain("not-a-club is not a UFC club");
  });

  it("carries a registration photo for everyone except the one player who sent none", () => {
    const without = ROSTERS.flatMap((r) => r.players.filter((p) => !p.photo).map((p) => p.name));
    expect(without).toEqual(["Teslim Umar"]);
  });

  it("never stores a name that shouts: every roster name has a lowercase letter", () => {
    for (const roster of ROSTERS) {
      for (const row of roster.players) expect(row.name).toMatch(/\p{Ll}/u);
    }
  });

  it("creates every row on an empty league and holds back only the namesake", async () => {
    const prisma = makePrisma();
    const result = await run(prisma);

    expect(result.created).toBe(listed - 1);
    expect(result.heldBack).toEqual([
      "Usman Mohammed (The Charlesann FC #6): already registered for G12 Football Club in this league",
    ]);
    expect(prisma.squad).toHaveLength(listed - 1);
    expect(result.squadSizes["box2box-fc"]).toBe(0);
    expect(result.squadSizes["jumez-international-fc"]).toBe(24);

    const row = prisma.squad.find((s) => s.displayName === "Eguakun Lucky")!;
    expect(row).toMatchObject({ teamId: "team-jumez-international-fc", shirtNumber: 8, position: "AM" });
    expect(prisma.players.find((p) => p.id === row.playerId)).toMatchObject({
      displayName: "Eguakun Lucky",
      normalizedName: "eguakun lucky",
      playerPhotoUrl: expect.stringMatching(/^https:\/\/storage\.tally\.so\//),
    });
    expect(result.photosAdded).toBe(listed - 2);
    expect(prisma.players.filter((p) => !p.playerPhotoUrl).map((p) => p.displayName)).toEqual([
      "Teslim Umar",
    ]);
  });

  it("is additive: a second run writes nothing, and admin edits to a row survive", async () => {
    const prisma = makePrisma();
    await run(prisma);
    const row = prisma.squad.find((s) => s.displayName === "Eguakun Lucky")!;
    row.shirtNumber = 99;
    row.position = "GK";
    const playersBefore = prisma.players.length;

    const again = await run(prisma);

    expect(again.created).toBe(0);
    expect(again.linked).toBe(0);
    expect(again.photosAdded).toBe(0);
    expect(again.unchanged).toBe(listed - 1);
    expect(prisma.players).toHaveLength(playersBefore);
    expect(row).toMatchObject({ shirtNumber: 99, position: "GK" });
  });

  it("links an existing unlinked row to its player instead of adding a second row", async () => {
    const prisma = makePrisma({
      squad: [
        {
          id: "legacy",
          teamId: "team-ablaze-fc",
          playerId: null,
          displayName: "yusuf murtala",
          position: null,
          shirtNumber: null,
        },
      ],
    });
    const result = await run(prisma);

    expect(result.linked).toBe(1);
    const rows = prisma.squad.filter((s) => s.displayName.toLowerCase() === "yusuf murtala");
    expect(rows).toHaveLength(1);
    expect(rows[0].playerId).toBeTruthy();
  });

  it("reuses a player already in the directory rather than minting a duplicate, and keeps their photo", async () => {
    const prisma = makePrisma({
      players: [
        {
          id: "known",
          displayName: "AMINU IBRAHIM",
          normalizedName: "aminu ibrahim",
          slug: "aminu-ibrahim",
          playerPhotoUrl: "https://lh3.googleusercontent.com/chosen-in-admin",
        },
      ],
    });
    await run(prisma);

    const row = prisma.squad.find((s) => s.displayName === "Aminu ibrahim")!;
    expect(row.playerId).toBe("known");
    expect(prisma.players.filter((p) => p.normalizedName === "aminu ibrahim")).toHaveLength(1);
    expect(prisma.players.find((p) => p.id === "known")!.playerPhotoUrl).toBe(
      "https://lh3.googleusercontent.com/chosen-in-admin"
    );
  });
});
