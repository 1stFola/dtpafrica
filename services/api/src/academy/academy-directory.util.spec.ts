import { describe, it, expect } from "vitest";
import type { Academy } from "@prisma/client";
import { presentAcademyListing, presentClubCompetitions } from "./academy-directory.util";

const entry = (
  teamId: string,
  name: string,
  season: string,
  isPublished = true,
  id = `c-${teamId}`
) => ({ id: teamId, competition: { id, name, slug: id, season, isPublished } });

const row = (overrides: Partial<Academy> = {}): Academy => ({
  id: "a1",
  slug: "box-2-box-fc",
  name: "Box 2 Box FC",
  contactPerson: null,
  email: null,
  phone: null,
  city: "Lagos",
  country: "Nigeria",
  description: null,
  foundedYear: null,
  logoUrl: null,
  websiteUrl: null,
  loginUsername: null,
  passwordHash: null,
  subscriptionTier: null,
  maxPlayers: null,
  isPublished: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("presentClubCompetitions", () => {
  it("lists a club's competitions newest season first", () => {
    const listed = presentClubCompetitions([
      entry("t-a", "Scout To Pro International Tournament", "2025"),
      entry("t-b", "Coal City Scouting Tournament", "2026"),
    ]);
    expect(listed.map((c) => [c.competitionName, c.teamId])).toEqual([
      ["Coal City Scouting Tournament", "t-b"],
      ["Scout To Pro International Tournament", "t-a"],
    ]);
  });

  it("leaves out competitions that are not published", () => {
    const listed = presentClubCompetitions([
      entry("t-live", "Live Cup", "2026"),
      entry("t-draft", "Draft Cup", "2026", false),
    ]);
    expect(listed.map((c) => c.competitionName)).toEqual(["Live Cup"]);
  });

  it("orders numeric seasons numerically rather than as text", () => {
    const listed = presentClubCompetitions([
      entry("t9", "League", "2025/2026", true, "c-9"),
      entry("t10", "League", "2026/2027", true, "c-10"),
    ]);
    expect(listed[0].teamId).toBe("t10");
  });
});

describe("presentAcademyListing badges", () => {
  it("calls a club with a partner login a Partner Academy", () => {
    expect(presentAcademyListing(row({ loginUsername: "b2b" }), new Map()).badges[0]).toBe(
      "Partner Academy"
    );
  });

  // A profile created from ScoreBoard teams has no login and is not a partner.
  it("calls a club without a partner login just a Club", () => {
    expect(presentAcademyListing(row(), new Map()).badges[0]).toBe("Club");
  });

  it("carries the club's competitions", () => {
    const listing = presentAcademyListing(row(), new Map(), [entry("t1", "Coal City Scouting Tournament", "2026")]);
    expect(listing.competitions).toEqual([
      {
        competitionId: "c-t1",
        competitionName: "Coal City Scouting Tournament",
        competitionSlug: "c-t1",
        season: "2026",
        teamId: "t1",
      },
    ]);
  });
});
