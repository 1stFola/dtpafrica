import { describe, expect, it } from "vitest";
import {
  HIDDEN_COMPETITION_STATUSES,
  PUBLIC_COMPETITION_STATUSES,
  readCompetitionStatus,
  type SbCompetitionStatus,
} from "./admin-scoreboard.service";

/**
 * What a competition's status means, and what the public site does with it.
 *
 * The setting used to decide nothing: the ScoreBoard filtered on `isPublished` alone, so
 * marking a competition Archived changed a badge in the admin and left it on the site.
 */

describe("reading a stored status", () => {
  it("keeps the four current words", () => {
    for (const status of ["scheduled", "ongoing", "draft", "archived"] as const) {
      expect(readCompetitionStatus(status)).toBe(status);
    }
  });

  it("translates the words the column used to hold", () => {
    /* Rows written by an older build, and CSVs exported before the change, still say
       these. `db:repair:competition-status` rewrites them; until it runs, and for any
       import that carries them afterwards, they read correctly. */
    expect(readCompetitionStatus("upcoming")).toBe("scheduled");
    expect(readCompetitionStatus("active")).toBe("ongoing");
  });

  it("ignores casing and surrounding space, as an import would produce", () => {
    /* A CSV cell arrives title-cased and padded. It does not arrive as `ON GOING`: the
       normaliser turns an inner space into an underscore, so a two-word spelling is not
       supported and inventing one here would have tested nothing real. */
    expect(readCompetitionStatus("  Upcoming ")).toBe("scheduled");
    expect(readCompetitionStatus(" Ongoing")).toBe("ongoing");
    expect(readCompetitionStatus("Archived")).toBe("archived");
    expect(readCompetitionStatus("ACTIVE")).toBe("ongoing");
  });

  it("falls back to scheduled for anything unrecognised", () => {
    /* Never to archived or draft: a value nobody recognises must not take a competition
       off the public site as a side effect of being unreadable. */
    for (const value of ["", "   ", "nonsense", null, undefined]) {
      expect(readCompetitionStatus(value)).toBe("scheduled");
    }
  });
});

describe("which statuses the ScoreBoard shows", () => {
  it("shows scheduled and ongoing", () => {
    expect([...PUBLIC_COMPETITION_STATUSES].sort()).toEqual(["ongoing", "scheduled"]);
  });

  it("hides archived and draft", () => {
    expect([...HIDDEN_COMPETITION_STATUSES].sort()).toEqual(["archived", "draft"]);
  });

  it("accounts for every status, so none is accidentally neither", () => {
    /* A status that is in neither list would be hidden by the public filter's `notIn`
       while looking public in the admin — the same silent disagreement this change
       exists to remove. */
    const all: SbCompetitionStatus[] = ["scheduled", "ongoing", "draft", "archived"];
    const covered = new Set<string>([
      ...PUBLIC_COMPETITION_STATUSES,
      ...HIDDEN_COMPETITION_STATUSES,
    ]);
    for (const status of all) expect(covered.has(status)).toBe(true);
    expect(covered.size).toBe(all.length);
  });

  it("keeps the two lists disjoint", () => {
    for (const status of PUBLIC_COMPETITION_STATUSES) {
      expect(HIDDEN_COMPETITION_STATUSES).not.toContain(status);
    }
  });
});
