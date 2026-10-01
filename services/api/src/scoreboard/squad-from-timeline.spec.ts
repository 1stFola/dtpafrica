import { describe, expect, it, vi } from "vitest";
import { PlaceholderPlayerNameError } from "../players/placeholder-names";
import {
  addSquadMembersFromTimeline,
  withoutTeamNames,
  missingFromSquad,
  squadCandidatesFrom,
  type SquadFromTimelineDeps,
  type TimelineEventLabels,
} from "./squad-from-timeline";

const HOME = "team-home";
const AWAY = "team-away";

function event(over: Partial<TimelineEventLabels> = {}): TimelineEventLabels {
  return { teamId: HOME, playerLabel: null, playerLabel2: null, assistLabel: null, ...over };
}

describe("finding the people a timeline names", () => {
  it("takes a scorer from the label", () => {
    const { candidates } = squadCandidatesFrom([event({ playerLabel: "Ogundeji Elijah" })]);
    expect(candidates).toMatchObject([{ teamId: HOME, name: "Ogundeji Elijah" }]);
  });

  it("takes the assister and the second player too", () => {
    /* A substitution names the incoming player in `playerLabel2`, and a goal names the
       assister. Both are people who played and neither was being harvested. */
    const { candidates } = squadCandidatesFrom([
      event({ playerLabel: "Scorer One", playerLabel2: "Sub In", assistLabel: "Assister Two" }),
    ]);
    expect(candidates.map((c) => c.name).sort()).toEqual(["Assister Two", "Scorer One", "Sub In"]);
  });

  it("names one person once, however many events they appear in", () => {
    const { candidates } = squadCandidatesFrom([
      event({ playerLabel: "Wasiu Yayah" }),
      event({ playerLabel: "Wasiu Yayah" }),
      event({ playerLabel: "WASIU YAYAH" }),
    ]);
    expect(candidates).toHaveLength(1);
  });

  it("keeps the same name on two teams apart", () => {
    // Two clubs can each have a Daniel, and they are not the same squad row.
    const { candidates } = squadCandidatesFrom([
      event({ teamId: HOME, playerLabel: "Daniel" }),
      event({ teamId: AWAY, playerLabel: "Daniel" }),
    ]);
    expect(candidates).toHaveLength(2);
  });

  it("takes the name from behind a shirt number", () => {
    const { candidates } = squadCandidatesFrom([event({ playerLabel: "No. 7 Ogundeji Elijah" })]);
    expect(candidates[0]?.name).toBe("Ogundeji Elijah");
  });

  it("ignores an event with no team, having nowhere to put the person", () => {
    const { candidates } = squadCandidatesFrom([event({ teamId: null, playerLabel: "Nobody" })]);
    expect(candidates).toEqual([]);
  });

  it("refuses everything the gate refuses, and says why once per name", () => {
    const { candidates, rejected } = squadCandidatesFrom([
      event({ playerLabel: "No. 7" }),
      event({ playerLabel: "Unknown" }),
      event({ playerLabel: "VIDO 99 FC" }),
      event({ playerLabel: "Jersey No. 35" }),
      event({ playerLabel: "Jersey No. 35" }),
      event({ playerLabel: "Abdullah Shaubu (7) & Adebayo David (17)" }),
    ]);
    expect(candidates).toEqual([]);
    expect(rejected).toHaveLength(5);
    expect(rejected.map((r) => r.reason)).toContain("team");
    expect(rejected.map((r) => r.reason)).toContain("several-people");
  });
});

describe("skipping the people already in the squad", () => {
  it("leaves a name the squad already holds", () => {
    const candidates = squadCandidatesFrom([event({ playerLabel: "Nwosu Henry" })]).candidates;
    const missing = missingFromSquad(candidates, [
      { teamId: HOME, displayName: "Nwosu Henry", playerId: "p1" },
    ]);
    expect(missing.missing).toEqual([]);
  });

  it("matches across spellings, so no second row is created", () => {
    /* The squad says `NWOSU HENRY` and the timeline says `Nwosu Henry`. Comparing the
       stored text would create a duplicate for a person already there. */
    const candidates = squadCandidatesFrom([event({ playerLabel: "Nwosu Henry" })]).candidates;
    const missing = missingFromSquad(candidates, [
      { teamId: HOME, displayName: "NWOSU HENRY", playerId: "p1" },
    ]);
    expect(missing.missing).toEqual([]);
  });

  it("does not treat the other team's squad as this team's", () => {
    const candidates = squadCandidatesFrom([event({ teamId: HOME, playerLabel: "Daniel" })]).candidates;
    const missing = missingFromSquad(candidates, [
      { teamId: AWAY, displayName: "Daniel", playerId: "p2" },
    ]);
    expect(missing.missing).toHaveLength(1);
  });

  it("returns the ones genuinely missing", () => {
    const candidates = squadCandidatesFrom([
      event({ playerLabel: "In Squad" }),
      event({ playerLabel: "Not In Squad" }),
    ]).candidates;
    const missing = missingFromSquad(candidates, [
      { teamId: HOME, displayName: "In Squad", playerId: "p1" },
    ]);
    expect(missing.missing.map((m) => m.name)).toEqual(["Not In Squad"]);
  });

  it("treats a reversed spelling as already in the squad", () => {
    /* The live shape. `db:merge:squad-duplicates` folded `Onyebuchi Nwabueze` into
       `Nwabueze Onyebuchi` and deleted it, but a merge leaves an already-linked event's
       label as the recorder wrote it -- so the timeline still says the old spelling. On a
       key-only match this run proposed 69 new records, ~35 of them reversals of records
       deleted hours earlier: it would have undone that merge in one pass. */
    const candidates = squadCandidatesFrom([
      event({ playerLabel: "Onyebuchi Nwabueze" }),
    ]).candidates;
    const result = missingFromSquad(candidates, [
      { teamId: HOME, displayName: "Nwabueze Onyebuchi", playerId: "p1" },
    ]);

    expect(result.missing).toHaveLength(0);
    expect(result.sameWordsDifferentOrder).toHaveLength(1);
    expect(result.sameWordsDifferentOrder[0]!.squadSpelling).toBe("Nwabueze Onyebuchi");
  });

  it("matches a reversal through casing and punctuation", () => {
    const candidates = squadCandidatesFrom([event({ playerLabel: "HENRY NWOSU" })]).candidates;
    const result = missingFromSquad(candidates, [
      { teamId: HOME, displayName: "Nwosu. Henry", playerId: "p1" },
    ]);
    expect(result.missing).toHaveLength(0);
    expect(result.sameWordsDifferentOrder).toHaveLength(1);
  });

  it("does not treat a different name as a reversal", () => {
    /* Two words in common is not the test — the words must be the same words. */
    const candidates = squadCandidatesFrom([event({ playerLabel: "Henry Adeyemi" })]).candidates;
    const result = missingFromSquad(candidates, [
      { teamId: HOME, displayName: "Nwosu Henry", playerId: "p1" },
    ]);
    expect(result.missing).toHaveLength(1);
    expect(result.sameWordsDifferentOrder).toHaveLength(0);
  });

  it("keeps the rule inside one squad", () => {
    /* A reversal at another club is not evidence of anything: the domain rule is about two
       players in the same team, and across clubs names repeat freely. */
    const candidates = squadCandidatesFrom([
      event({ playerLabel: "Onyebuchi Nwabueze" }),
    ]).candidates;
    const result = missingFromSquad(candidates, [
      { teamId: AWAY, displayName: "Nwabueze Onyebuchi", playerId: "p1" },
    ]);
    expect(result.missing).toHaveLength(1);
    expect(result.sameWordsDifferentOrder).toHaveLength(0);
  });
});

function fakeDeps(over: {
  squad?: { teamId: string; displayName: string; playerId: string | null }[];
  existingByKey?: Record<string, string>;
  /** The display name that directory record holds, when it differs from its key. */
  existingNames?: Record<string, string>;
  resolve?: (name: string) => Promise<{ id: string; displayName: string }>;
  teamNames?: string[];
} = {}) {
  const created: { teamId: string; displayName: string; shirtNumber: number | null }[] = [];
  const deps: SquadFromTimelineDeps = {
    db: {
      sbTeamSquad: {
        findMany: async () => over.squad ?? [],
        create: async (args: unknown) => {
          const data = (args as { data: { teamId: string; displayName: string; shirtNumber: number | null } }).data;
          created.push(data);
          return { id: `squad-${created.length}` };
        },
      },
      sbTeam: {
        findMany: async () => (over.teamNames ?? []).map((name) => ({ name })),
      },
      player: {
        findUnique: async (args: unknown) => {
          const key = (args as { where: { normalizedName: string } }).where.normalizedName;
          const id = over.existingByKey?.[key];
          /* The real directory returns the tidied name, and the squad row is written with
             it rather than with the label. */
          return id ? { id, displayName: over.existingNames?.[key] ?? key } : null;
        },
      },
    },
    resolvePlayer:
      over.resolve ?? (async (name) => ({ id: `new-${name}`, displayName: name })),
  };
  return { deps, created };
}

describe("adding the rows", () => {
  it("creates a squad row with no shirt number", async () => {
    /* The number is the one thing a label cannot supply, and inventing one would resolve
       future events to the wrong person. Staff assign it later. */
    const { deps, created } = fakeDeps();
    const result = await addSquadMembersFromTimeline(deps, [
      event({ playerLabel: "Adekunle Jamiu" }),
    ]);
    expect(created).toEqual([
      { teamId: HOME, playerId: "new-Adekunle Jamiu", displayName: "Adekunle Jamiu", shirtNumber: null },
    ]);
    expect(result.added).toMatchObject([{ name: "Adekunle Jamiu", player: "new" }]);
  });

  it("links an existing player instead of creating a second one", async () => {
    const { deps, created } = fakeDeps({ existingByKey: { "ismaila philip": "already" } });
    const result = await addSquadMembersFromTimeline(deps, [
      event({ playerLabel: "Ismaila Philip" }),
    ]);
    expect(result.added).toMatchObject([{ player: "existing", playerId: "already" }]);
    expect(created[0]).toMatchObject({ playerId: "already" });
  });

  it("writes nothing on a dry run but still reports what it would do", async () => {
    const { deps, created } = fakeDeps();
    const result = await addSquadMembersFromTimeline(
      deps,
      [event({ playerLabel: "Onyedigbo Daniel" })],
      { dryRun: true }
    );
    expect(created).toEqual([]);
    expect(result.added).toMatchObject([{ name: "Onyedigbo Daniel", player: "new" }]);
  });

  it("counts the ones the squad already has", async () => {
    const { deps } = fakeDeps({
      squad: [{ teamId: HOME, displayName: "Already There", playerId: "p" }],
    });
    const result = await addSquadMembersFromTimeline(deps, [
      event({ playerLabel: "Already There" }),
    ]);
    expect(result.alreadyInSquad).toBe(1);
    expect(result.added).toEqual([]);
  });

  it("keeps going when the directory refuses one name, and never throws", async () => {
    /* This runs on the tail of a recorder publishing a sheet. A bad label must not be
       able to fail that publish -- the recorder would not know why, and ninety minutes
       of captured events are worth more than a squad row. */
    const { deps, created } = fakeDeps({
      resolve: async (name) => {
        if (name === "Bad One") throw new PlaceholderPlayerNameError(name);
        return { id: `new-${name}`, displayName: name };
      },
    });
    const result = await addSquadMembersFromTimeline(deps, [
      event({ playerLabel: "Bad One" }),
      event({ playerLabel: "Good One" }),
    ]);
    expect(result.added).toMatchObject([{ name: "Good One" }]);
    expect(result.rejected).toMatchObject([{ name: "Bad One", reason: "directory-refused" }]);
    expect(created).toHaveLength(1);
  });

  it("tells a directory refusal apart from a failed write", async () => {
    const { deps } = fakeDeps({
      resolve: async () => {
        throw new Error("connection lost");
      },
    });
    const result = await addSquadMembersFromTimeline(deps, [event({ playerLabel: "Someone" })]);
    expect(result.rejected).toMatchObject([{ reason: "write-failed" }]);
  });

  it("does nothing at all when the timeline names nobody admissible", async () => {
    const { deps, created } = fakeDeps();
    const findMany = vi.fn();
    deps.db.sbTeamSquad.findMany = findMany;
    const result = await addSquadMembersFromTimeline(deps, [event({ playerLabel: "No. 9" })]);
    expect(created).toEqual([]);
    /* Not even a read: a publish whose labels are all numbers should cost nothing. */
    expect(findMany).not.toHaveBeenCalled();
    expect(result.rejected).toHaveLength(1);
  });
});

describe("labels that are the club itself", () => {
  /* All three were queued to join a squad as a player by the live dry run. The token
     rules caught neither `Franceex United`, which has no abbreviation at all, nor
     `Star To Be FA` before `FA` was added to them. Asking the database what its teams
     are called is the rule that does not depend on guessing a suffix. */

  it("refuses `Franceex United` by its UNITED token", () => {
    /* The live case. It has no FC, FA or SC, which is why `UNITED` had to join the
       markers -- read off the team list rather than guessed at. */
    const { candidates, rejected } = squadCandidatesFrom([
      event({ playerLabel: "Franceex United" }),
    ]);
    expect(candidates).toEqual([]);
    expect(rejected).toMatchObject([{ reason: "team" }]);
  });

  it("refuses a team whose name carries no marker at all", () => {
    /* What the token rules can never do. A club can be named anything, so the only
       rule that does not depend on guessing a suffix is asking the database what its
       teams are called. */
    const candidates = squadCandidatesFrom([event({ playerLabel: "Rikay" })]).candidates;
    expect(candidates).toHaveLength(1);
    const split = withoutTeamNames(candidates, ["RIKAY", "Some Other FC"]);
    expect(split.kept).toEqual([]);
    expect(split.teams).toHaveLength(1);
  });

  it("matches a team name across casing and punctuation", () => {
    const candidates = squadCandidatesFrom([event({ playerLabel: "wasola ven fc" })]).candidates;
    /* The label went through the token rules first, so an `FC` name never reaches here
       -- this asserts the key matching itself on a name that does. */
    const split = withoutTeamNames(
      [{ teamId: HOME, label: "Star To Be", name: "Star To Be", key: "star to be" }],
      ["STAR TO BE!"]
    );
    expect(split.teams).toHaveLength(1);
    void candidates;
  });

  it("keeps a player whose name merely resembles a team", () => {
    const split = withoutTeamNames(
      [{ teamId: HOME, label: "Henry Nwosu", name: "Henry Nwosu", key: "henry nwosu" }],
      ["FRANCEEX UNITED"]
    );
    expect(split.kept).toHaveLength(1);
    expect(split.teams).toEqual([]);
  });

  it("reports a marker-free team rather than adding it, through the whole path", async () => {
    const { deps, created } = fakeDeps({ teamNames: ["Rikay"] });
    const result = await addSquadMembersFromTimeline(deps, [
      event({ playerLabel: "Rikay" }),
      event({ playerLabel: "Real Person" }),
    ]);
    expect(created).toHaveLength(1);
    expect(result.added).toMatchObject([{ name: "Real Person" }]);
    expect(result.rejected).toMatchObject([{ name: "Rikay", reason: "is-a-team" }]);
  });

  it("refuses the FA academies the live list is full of", () => {
    /* `FA` was left out of the markers on the reasoning that it was as likely somebody's
       initials. Half these clubs are named Football Academy. */
    for (const label of ["Star To Be FA", "ADHOC FA", "GALAXY SPORT FA"]) {
      expect(squadCandidatesFrom([event({ playerLabel: label })]).candidates).toEqual([]);
    }
  });
});
