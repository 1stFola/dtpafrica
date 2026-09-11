import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { syncTeamsToClubs } from "./club-sync";
import { academyFieldsForTeamSync } from "./academy-team-sync.util";

type Team = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  city: string | null;
  academyId: string | null;
  createdAt: Date;
  competition: { country: string | null; createdAt: Date };
};
type Academy = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  city?: string | null;
  country?: string | null;
  isPublished: boolean;
  loginUsername: string | null;
  createdAt: Date;
};

const day = (n: number) => new Date(2026, 0, n);

/** A team entry in a competition that started on day `competitionDay`. */
function team(id: string, name: string, competitionDay: number, extra: Partial<Team> = {}): Team {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    logoUrl: null,
    city: null,
    academyId: null,
    createdAt: day(competitionDay),
    competition: { country: "Nigeria", createdAt: day(competitionDay) },
    ...extra,
  };
}

function academy(id: string, name: string, extra: Partial<Academy> = {}): Academy {
  return {
    id,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    name,
    logoUrl: null,
    isPublished: true,
    loginUsername: null,
    createdAt: day(1),
    ...extra,
  };
}

/** In-memory SbTeam + Academy tables with the unique slug constraint. */
function db(teams: Team[], academies: Academy[] = []) {
  let seq = 0;
  const prisma = {
    sbTeam: {
      findMany: async () => teams.map((t) => ({ ...t })),
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const t of teams) {
          if (!where.id.in.includes(t.id)) continue;
          if (where.academyId === null && t.academyId !== null) continue;
          Object.assign(t, data);
          count++;
        }
        return { count };
      },
    },
    academy: {
      findMany: async () => academies.map((a) => ({ ...a })),
      create: async ({ data }: any) => {
        if (academies.some((a) => a.slug === data.slug)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
          });
        }
        const row: Academy = {
          id: `club-${++seq}`,
          loginUsername: null,
          createdAt: new Date(),
          ...data,
        };
        academies.push(row);
        return { ...row };
      },
      update: async ({ where, data }: any) => {
        const row = academies.find((a) => a.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
  };
  return { prisma: prisma as never, teams, academies };
}

const clubOf = (d: ReturnType<typeof db>, teamId: string) =>
  d.teams.find((t) => t.id === teamId)!.academyId;

describe("syncTeamsToClubs", () => {
  // The reported problem: one club, one SbTeam per competition, no link.
  it("gathers one club's entries across competitions under a single new profile", async () => {
    const d = db([
      team("t-s2p", "BOX 2 BOX FC", 1),
      team("t-coal", "Box 2 Box FC", 5, {
        logoUrl: "https://cdn.example/b2b.png",
        city: "Lagos",
      }),
    ]);

    const result = await syncTeamsToClubs(d.prisma);

    expect(result).toMatchObject({ teamsLinked: 2, clubsCreated: 1, clubsMatched: 0 });
    expect(d.academies).toHaveLength(1);
    const [club] = d.academies;
    expect(clubOf(d, "t-s2p")).toBe(club.id);
    expect(clubOf(d, "t-coal")).toBe(club.id);
    // Built from the most recent entry, and published straight away.
    expect(club).toMatchObject({
      name: "Box 2 Box FC",
      slug: "box-2-box-fc",
      logoUrl: "https://cdn.example/b2b.png",
      city: "Lagos",
      isPublished: true,
    });
  });

  it("links to an existing profile with the same club identity", async () => {
    const d = db([team("t1", "IKORODU CITY", 2)], [academy("a-ikd", "Ikorodu City FC")]);
    const result = await syncTeamsToClubs(d.prisma);
    expect(result).toMatchObject({ clubsCreated: 0, clubsMatched: 1, teamsLinked: 1 });
    expect(clubOf(d, "t1")).toBe("a-ikd");
  });

  it("honours the ex-intl- slug convention the academy sync already used", async () => {
    const d = db(
      [team("t1", "Legends XI", 2, { slug: "legends-xi" })],
      [academy("a-ex", "Some Other Display Name", { slug: "ex-intl-legends-xi" })]
    );
    await syncTeamsToClubs(d.prisma);
    expect(clubOf(d, "t1")).toBe("a-ex");
  });

  it("lets a manual link decide where the rest of the club goes", async () => {
    const d = db(
      [
        team("t-old", "Klassisch FA", 1, { academyId: "a-manual" }),
        team("t-new", "KLASSISCH FA", 4),
      ],
      [academy("a-manual", "Klassisch Football Academy"), academy("a-other", "Klassisch FA")]
    );
    await syncTeamsToClubs(d.prisma);
    expect(clubOf(d, "t-new")).toBe("a-manual");
  });

  it("never re-points a team that is already linked", async () => {
    const d = db([team("t1", "Vido 99 FC", 1, { academyId: "a-set" })], [academy("a-vido", "Vido 99 FC")]);
    const result = await syncTeamsToClubs(d.prisma);
    expect(result.teamsLinked).toBe(0);
    expect(clubOf(d, "t1")).toBe("a-set");
  });

  it("reports and leaves alone a club already split across two profiles", async () => {
    const d = db([
      team("t1", "DRV FC", 1, { academyId: "a-1" }),
      team("t2", "DRV FC", 2, { academyId: "a-2" }),
      team("t3", "DRV FC", 3),
    ]);
    const result = await syncTeamsToClubs(d.prisma);
    expect(result.ambiguous).toEqual(["DRV FC"]);
    expect(clubOf(d, "t3")).toBeNull();
  });

  it("is idempotent", async () => {
    const d = db([team("t1", "042 FC", 1), team("t2", "042 FC", 2)]);
    await syncTeamsToClubs(d.prisma);
    const second = await syncTeamsToClubs(d.prisma);
    expect(second).toMatchObject({ teamsLinked: 0, clubsCreated: 0, clubsMatched: 0 });
    expect(d.academies).toHaveLength(1);
  });

  it("fills a missing crest on an existing profile but never replaces one", async () => {
    const d = db(
      [
        team("t1", "Athletic SC", 1, { logoUrl: "https://cdn.example/new.png" }),
        team("t2", "Goal Getters FA", 1, { logoUrl: "https://cdn.example/team.png" }),
      ],
      [
        academy("a-bare", "Athletic SC"),
        academy("a-crest", "Goal Getters FA", { logoUrl: "https://cdn.example/official.png" }),
      ]
    );
    await syncTeamsToClubs(d.prisma);
    expect(d.academies.find((a) => a.id === "a-bare")!.logoUrl).toBe("https://cdn.example/new.png");
    expect(d.academies.find((a) => a.id === "a-crest")!.logoUrl).toBe("https://cdn.example/official.png");
  });

  // Deliberately conservative: a wrong merge would publish one club's history
  // under another's name.
  it("keeps differently suffixed clubs apart unless aliased", async () => {
    const d = db([team("t-fa", "LAGOS STARS FA", 1), team("t-fc", "Lagos Stars FC", 2)]);
    await syncTeamsToClubs(d.prisma);
    expect(d.academies).toHaveLength(2);
    expect(clubOf(d, "t-fa")).not.toBe(clubOf(d, "t-fc"));
  });

  it("merges the aliased pairs into one club each", async () => {
    const d = db([
      team("t-ikd-s2p", "IKORODU CITY FA", 1),
      team("t-ikd-coal", "Ikorodu City FC", 5),
      team("t-ath-s2p", "ATHLETIC FC", 1),
      team("t-ath-coal", "Athletic SC", 5),
    ]);
    await syncTeamsToClubs(d.prisma);
    expect(d.academies.map((a) => a.name).sort()).toEqual(["Athletic SC", "Ikorodu City FC"]);
    expect(clubOf(d, "t-ikd-s2p")).toBe(clubOf(d, "t-ikd-coal"));
    expect(clubOf(d, "t-ath-s2p")).toBe(clubOf(d, "t-ath-coal"));
  });

  it("only touches the clubs of the given teams when scoped", async () => {
    const d = db([team("t-in", "Gloriousday FA", 1), team("t-out", "Coal City United", 1)]);
    const result = await syncTeamsToClubs(d.prisma, { teamIds: ["t-in"] });
    expect(result.teamsLinked).toBe(1);
    expect(clubOf(d, "t-out")).toBeNull();
  });

  it("picks a free slug when the natural one belongs to an unrelated profile", async () => {
    // Same slug, different identity: "Stars" vs a club genuinely named "Stars FC".
    const d = db([team("t1", "Stars", 1, { slug: "stars-team" })], [academy("a-x", "Unrelated", { slug: "stars" })]);
    await syncTeamsToClubs(d.prisma);
    const created = d.academies.find((a) => a.id !== "a-x")!;
    expect(created.slug).toBe("stars-2");
    expect(clubOf(d, "t1")).toBe(created.id);
  });
});

describe("academyFieldsForTeamSync", () => {
  // Regression: saving a club profile with no crest wrote logoUrl: null onto
  // every one of its teams, wiping their logos in every competition.
  it("does not blank a team's crest or city when the profile has none", () => {
    expect(academyFieldsForTeamSync({ name: "Coal City United", logoUrl: null, city: "" })).toEqual({
      name: "Coal City United",
    });
  });

  it("pushes a crest and city when the profile has them", () => {
    expect(
      academyFieldsForTeamSync({ name: "Coal City United", logoUrl: "https://x/l.png", city: "Enugu" })
    ).toEqual({ name: "Coal City United", logoUrl: "https://x/l.png", city: "Enugu" });
  });
});
