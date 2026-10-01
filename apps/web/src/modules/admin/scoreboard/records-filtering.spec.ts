/**
 * Filtering the Master records tabs.
 *
 * Two things are being pinned here: that moving these filters off the server kept their
 * answers, and that Name QA still flags what it flagged when it was doing it quadratically.
 */
import { describe, expect, it } from "vitest";
import type {
  AdminSbCompetition,
  AdminSbPlayerDirectoryRow,
  AdminSbTeam,
} from "./types";
import type { SbMatchListItem } from "../../../api/scoreboard";
import {
  NAME_QA_FLAGS,
  competitionSearchText,
  filterIndexed,
  fixtureSearchText,
  indexForSearch,
  keepCompetition,
  keepFixture,
  keepNameQaRow,
  keepPlayer,
  keepTeam,
  nameQaFlagOptionsFor,
  nameQaRowsFor,
  normalizeNameKey,
  playerSearchText,
  searchNeedle,
  squadIdOf,
  teamGroupOptionsFor,
  teamSearchText,
} from "./records-filtering";

const competition = (over: Partial<AdminSbCompetition> = {}): AdminSbCompetition => ({
  id: "c1",
  slug: "jagaban-cup",
  name: "Jagaban Cup",
  type: "tournament",
  formatType: "GROUP_KNOCKOUT",
  region: "Lagos",
  season: "2026",
  teamsCount: 8,
  matchesCount: 12,
  status: "ongoing" as AdminSbCompetition["status"],
  isPublished: true,
  isFeatured: false,
  logoUrl: null,
  ...over,
});

const team = (over: Partial<AdminSbTeam> = {}): AdminSbTeam => ({
  id: "t1",
  slug: "fc-babington",
  name: "FC Babington",
  shortName: "BAB",
  region: "Ikorodu",
  logoUrl: null,
  groupKey: "A",
  competition: { id: "c1", name: "Jagaban Cup", slug: "jagaban-cup" },
  squadCount: 18,
  ...over,
});

const fixture = (over: Partial<SbMatchListItem> = {}): SbMatchListItem =>
  ({
    id: "m1",
    slug: "babington-vs-enegwea",
    status: "scheduled",
    minute: null,
    homeScore: 0,
    awayScore: 0,
    sipMatchId: null,
    sipIngestStatus: "none",
    sipIngestedAt: null,
    sipIngestSummary: null,
    kickoffAt: null,
    venue: "Agege Stadium",
    roundLabel: "Quarter-final",
    stageKey: "quarter_final",
    stats: null,
    homeTeam: { id: "t1", name: "FC Babington", slug: "fc-babington" },
    awayTeam: { id: "t2", name: "FC Enegwea", slug: "fc-enegwea" },
    competition: { id: "c1", name: "Jagaban Cup", slug: "jagaban-cup" },
    ...over,
  }) as SbMatchListItem;

const player = (
  displayName: string,
  over: Partial<AdminSbPlayerDirectoryRow> = {}
): AdminSbPlayerDirectoryRow => ({
  playerId: `p-${displayName}`,
  slug: null,
  displayName,
  positionPrimary: "MF",
  teams: [
    {
      squadId: `s-${displayName}`,
      teamId: "t1",
      teamName: "FC Babington",
      competitionSlug: "jagaban-cup",
      competitionName: "Jagaban Cup",
      position: "MF",
      shirtNumber: 8,
    },
  ],
  ...over,
});

const noFilters = { status: "", type: "", published: "", featured: "" };

describe("searchNeedle", () => {
  it("is empty for whitespace, so a stray space does not hide every row", () => {
    expect(searchNeedle("   ")).toBe("");
    expect(searchNeedle("  Babington ")).toBe("babington");
  });
});

describe("filterIndexed", () => {
  const rows = [competition({ id: "a", name: "Jagaban Cup" }), competition({ id: "b", name: "Royal League", slug: "royal-league" })];
  const indexed = indexForSearch(rows, competitionSearchText);

  it("returns everything when nothing is asked", () => {
    expect(filterIndexed(indexed, "", () => true)).toHaveLength(2);
  });

  it("matches the search against every indexed field, not just the name", () => {
    expect(filterIndexed(indexed, "royal-league", () => true).map((c) => c.id)).toEqual(["b"]);
    expect(filterIndexed(indexed, "lagos", () => true)).toHaveLength(2);
  });

  it("is case-insensitive", () => {
    expect(filterIndexed(indexed, searchNeedle("JAGABAN"), () => true).map((c) => c.id)).toEqual([
      "a",
    ]);
  });

  it("applies the search and the filters together", () => {
    const keep = keepCompetition({ ...noFilters, published: "unpublished" });
    expect(filterIndexed(indexed, "cup", keep)).toEqual([]);
  });

  it("keeps the order it was given", () => {
    expect(filterIndexed(indexed, "", () => true).map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("keepCompetition", () => {
  it("filters on status and type the way the server did, ignoring case", () => {
    /* These two used to be a server round trip, where the comparison was
       `mode: "insensitive"`. Moving them into the browser must not start rejecting an
       `Ongoing` row because the dropdown says `ongoing`. */
    const rows = [
      competition({ id: "a", status: "ongoing" as AdminSbCompetition["status"], type: "League" }),
      competition({ id: "b", status: "completed" as AdminSbCompetition["status"], type: "tournament" }),
    ];
    const pick = (f: Partial<typeof noFilters>) => rows.filter(keepCompetition({ ...noFilters, ...f })).map((c) => c.id);

    expect(pick({ status: "ongoing" })).toEqual(["a"]);
    expect(pick({ type: "league" })).toEqual(["a"]);
    expect(pick({ type: "tournament" })).toEqual(["b"]);
  });

  it("filters on publish and featured state", () => {
    const rows = [
      competition({ id: "a", isPublished: true, isFeatured: true }),
      competition({ id: "b", isPublished: false, isFeatured: false }),
    ];
    const pick = (f: Partial<typeof noFilters>) => rows.filter(keepCompetition({ ...noFilters, ...f })).map((c) => c.id);

    expect(pick({ published: "published" })).toEqual(["a"]);
    expect(pick({ published: "unpublished" })).toEqual(["b"]);
    expect(pick({ featured: "featured" })).toEqual(["a"]);
    expect(pick({ featured: "notFeatured" })).toEqual(["b"]);
  });

  it("combines filters rather than taking the last one", () => {
    const rows = [
      competition({ id: "a", isPublished: true, status: "ongoing" as AdminSbCompetition["status"] }),
      competition({ id: "b", isPublished: false, status: "ongoing" as AdminSbCompetition["status"] }),
    ];
    expect(
      rows.filter(keepCompetition({ ...noFilters, status: "ongoing", published: "unpublished" })).map((c) => c.id)
    ).toEqual(["b"]);
  });
});

describe("keepTeam", () => {
  const rows = [
    team({ id: "a", groupKey: "A" }),
    team({ id: "b", groupKey: "B" }),
    team({ id: "c", groupKey: null, competition: { id: "c2", name: "Royal League", slug: "royal" } }),
  ];

  it("filters by competition, which used to be a refetch", () => {
    expect(rows.filter(keepTeam({ competitionId: "c1", groupKey: "" })).map((t) => t.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("filters by group", () => {
    expect(rows.filter(keepTeam({ competitionId: "", groupKey: "B" })).map((t) => t.id)).toEqual(["b"]);
  });

  it("offers each group once, sorted, and never a blank one", () => {
    expect(teamGroupOptionsFor(rows)).toEqual(["A", "B"]);
  });

  it("searches the club, its slug, its short name and its competition", () => {
    const indexed = indexForSearch(rows, teamSearchText);
    expect(filterIndexed(indexed, "bab", () => true)).toHaveLength(3);
    expect(filterIndexed(indexed, "royal", () => true).map((t) => t.id)).toEqual(["c"]);
    expect(filterIndexed(indexed, "ikorodu", () => true)).toHaveLength(3);
  });
});

describe("keepFixture", () => {
  const rows = [
    fixture({ id: "a", status: "scheduled" }),
    fixture({ id: "b", status: "finished" }),
    fixture({ id: "c", status: "live", competition: { id: "c2", name: "Royal League", slug: "royal" } }),
  ];

  it("filters by competition and status", () => {
    expect(rows.filter(keepFixture({ competitionId: "c1", status: "" })).map((m) => m.id)).toEqual([
      "a",
      "b",
    ]);
    expect(rows.filter(keepFixture({ competitionId: "", status: "live" })).map((m) => m.id)).toEqual([
      "c",
    ]);
  });

  it("searches both clubs, the venue, the round and the stage key", () => {
    const indexed = indexForSearch(rows, fixtureSearchText);
    expect(filterIndexed(indexed, "enegwea", () => true)).toHaveLength(3);
    expect(filterIndexed(indexed, "agege", () => true)).toHaveLength(3);
    expect(filterIndexed(indexed, "quarter_final", () => true)).toHaveLength(3);
  });

  it("does not trip over a fixture with no venue or round", () => {
    const indexed = indexForSearch([fixture({ venue: null, roundLabel: null, stageKey: null })], fixtureSearchText);
    expect(indexed[0]!.haystack).not.toContain("null");
    expect(filterIndexed(indexed, "babington", () => true)).toHaveLength(1);
  });
});

describe("keepPlayer", () => {
  const rows = [
    player("Farouk Salami"),
    player("Ebulu Emmanuel", {
      teams: [
        {
          squadId: "s2",
          teamId: "t2",
          teamName: "FC Enegwea",
          competitionSlug: "royal",
          competitionName: "Royal League",
          position: "GK",
          shirtNumber: 1,
        },
      ],
    }),
    player("Unlinked Row", { playerId: null }),
  ];

  it("filters by team, position group and whether a profile is linked", () => {
    const pick = (f: Partial<{ teamId: string; position: string; link: string }>) =>
      rows.filter(keepPlayer({ teamId: "", position: "", link: "", ...f })).map((p) => p.displayName);

    expect(pick({ teamId: "t2" })).toEqual(["Ebulu Emmanuel"]);
    expect(pick({ position: "GK" })).toEqual(["Ebulu Emmanuel"]);
    expect(pick({ link: "unlinked" })).toEqual(["Unlinked Row"]);
    expect(pick({ link: "linked" })).toEqual(["Farouk Salami", "Ebulu Emmanuel"]);
  });

  it("reads the position from the squad row first and the profile second", () => {
    const row = player("No Squad Position", {
      positionPrimary: "GK",
      teams: [
        {
          squadId: "s3",
          teamId: "t1",
          teamName: "FC Babington",
          competitionSlug: "jagaban-cup",
          competitionName: "Jagaban Cup",
          position: null,
          shirtNumber: null,
        },
      ],
    });
    expect(keepPlayer({ teamId: "", position: "GK", link: "" })(row)).toBe(true);
  });

  it("searches the clubs a player appears for, not only their name", () => {
    /* The directory search was a server round trip capped at 500 rows, and it looked at names
       alone -- so a club name typed into it returned nothing. */
    const indexed = indexForSearch(rows, playerSearchText);
    expect(filterIndexed(indexed, "enegwea", () => true).map((p) => p.displayName)).toEqual([
      "Ebulu Emmanuel",
    ]);
  });
});

describe("squadIdOf", () => {
  it("is the squad row, which is the record this page deletes", () => {
    expect(squadIdOf(player("Farouk Salami"))).toBe("s-Farouk Salami");
  });

  it("is null for a directory row with no squad row behind it", () => {
    expect(squadIdOf(player("Orphan", { teams: [] }))).toBeNull();
  });
});

describe("normalizeNameKey", () => {
  it("compares names through case, punctuation and spacing", () => {
    expect(normalizeNameKey("  O'Brien   ADE-moye ")).toBe("o brien ade moye");
    expect(normalizeNameKey("No. 11")).toBe("no");
  });
});

describe("nameQaRowsFor", () => {
  const flagsFor = (rows: ReturnType<typeof nameQaRowsFor>, name: string) =>
    rows.find((row) => row.player.displayName === name)?.flags ?? [];

  it("flags a one-word name as needing completion", () => {
    const rows = nameQaRowsFor([player("Farouk")]);
    expect(flagsFor(rows, "Farouk")).toContain(NAME_QA_FLAGS.incomplete);
  });

  it("flags two records holding the same name", () => {
    const rows = nameQaRowsFor([player("Alfred Isaac"), player("ALFRED ISAAC")]);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.flags).toContain(NAME_QA_FLAGS.duplicate);
  });

  it("flags a shared surname and a shared first-and-last pair apart", () => {
    const rows = nameQaRowsFor([
      player("Musa Salami"),
      player("Farouk Salami"),
      player("Musa Danladi Salami"),
    ]);
    expect(flagsFor(rows, "Farouk Salami")).toContain(NAME_QA_FLAGS.sameSurname);
    expect(flagsFor(rows, "Farouk Salami")).not.toContain(NAME_QA_FLAGS.sameFirstLast);
    /* `Musa Salami` and `Musa Danladi Salami` share first and last, which is the pair the
       domain says never happens in one squad -- the third name is the distinguisher. */
    expect(flagsFor(rows, "Musa Salami")).toContain(NAME_QA_FLAGS.sameFirstLast);
  });

  it("flags a reversed two-part name", () => {
    const rows = nameQaRowsFor([player("Salami Farouk"), player("Farouk Salami")]);
    expect(flagsFor(rows, "Salami Farouk")).toContain(NAME_QA_FLAGS.swapped);
    expect(flagsFor(rows, "Farouk Salami")).toContain(NAME_QA_FLAGS.swapped);
  });

  it("does not call a symmetrical name its own reversal", () => {
    /* `Musa Musa` reversed is `Musa Musa`, which would flag a single record as a swap of
       itself. The grouping skips a pair whose halves are equal. */
    const rows = nameQaRowsFor([player("Musa Musa")]);
    expect(flagsFor(rows, "Musa Musa")).not.toContain(NAME_QA_FLAGS.swapped);
  });

  it("flags unusual characters and very short names", () => {
    expect(flagsFor(nameQaRowsFor([player("Jersey No. 35")]), "Jersey No. 35")).toContain(
      NAME_QA_FLAGS.unusual
    );
    expect(flagsFor(nameQaRowsFor([player("A B")]), "A B")).toContain(NAME_QA_FLAGS.tooShort);
  });

  it("leaves a clean name out altogether", () => {
    expect(nameQaRowsFor([player("Farouk Salami"), player("Ebulu Emmanuel")])).toEqual([]);
  });

  it("keeps the directory's order", () => {
    const rows = nameQaRowsFor([player("Zeta"), player("Alpha")]);
    expect(rows.map((row) => row.player.displayName)).toEqual(["Zeta", "Alpha"]);
  });

  it("handles a directory of thousands without quadratic work", () => {
    /* The grouping used to copy each bucket on every insert. Two thousand players sharing one
       surname is four million copies -- it finished, slowly, on every render that touched the
       list. This asserts the answer; the time it takes is the point of the change. */
    const many = Array.from({ length: 2000 }, (_, i) => player(`Player${i} Salami`));
    const started = Date.now();
    const rows = nameQaRowsFor(many);
    expect(rows).toHaveLength(2000);
    expect(rows[0]!.flags).toContain(NAME_QA_FLAGS.sameSurname);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("keepNameQaRow", () => {
  const rows = nameQaRowsFor([
    player("Farouk"),
    player("A B"),
    player("Ebulu", {
      teams: [
        {
          squadId: "s2",
          teamId: "t2",
          teamName: "FC Enegwea",
          competitionSlug: "royal",
          competitionName: "Royal League",
          position: "GK",
          shirtNumber: 1,
        },
      ],
    }),
  ]);

  it("filters by issue type and by team", () => {
    /* `A B` is two words, so it is short but not incomplete. */
    expect(
      rows.filter(keepNameQaRow({ flag: NAME_QA_FLAGS.incomplete, teamId: "" }))
    ).toHaveLength(2);
    expect(
      rows.filter(keepNameQaRow({ flag: "", teamId: "t2" })).map((row) => row.player.displayName)
    ).toEqual(["Ebulu"]);
    expect(rows.filter(keepNameQaRow({ flag: NAME_QA_FLAGS.swapped, teamId: "" }))).toEqual([]);
  });

  it("offers each flag that is actually present, once and sorted", () => {
    expect(nameQaFlagOptionsFor(rows)).toEqual([
      NAME_QA_FLAGS.incomplete,
      NAME_QA_FLAGS.tooShort,
    ]);
  });
});
