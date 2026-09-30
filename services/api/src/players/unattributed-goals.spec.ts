/**
 * Which unattributed goals may be linked, and which must stay as they are.
 *
 * Every label here is one the live database holds, from the breakdown of the 88 goals whose
 * label resolved to no player: `Unknown` twenty-one times, `Player` ten, bare shirt numbers
 * about thirty, and `Farouk Salami` with seven goals reaching nobody.
 */
import { describe, expect, it } from "vitest";
import {
  labelNamesAPerson,
  nameFromLabel,
  planGoalLinks,
  type DirectoryPlayer,
  type UnattributedGoal,
} from "./unattributed-goals";

const goal = (
  eventId: string,
  label: string,
  teamId: string | null = "jp"
): UnattributedGoal => ({ eventId, matchId: "m1", teamId, label });

const player = (
  id: string,
  displayName: string,
  teamIds: string[] = [],
  eventTeamIds: string[] = []
): DirectoryPlayer => ({ id, displayName, teamIds, eventTeamIds });

describe("labelNamesAPerson", () => {
  it("accepts a name, with or without its shirt number", () => {
    expect(labelNamesAPerson("Farouk Salami")).toBe(true);
    expect(labelNamesAPerson("No. 11 EBULU EMMANUEL")).toBe(true);
    expect(labelNamesAPerson("Idowu Babatunde Morakinyo")).toBe(true);
  });

  it("refuses what the live data holds instead of names", () => {
    expect(labelNamesAPerson("Unknown")).toBe(false);
    expect(labelNamesAPerson("Player")).toBe(false);
    expect(labelNamesAPerson("Player 1")).toBe(false);
    expect(labelNamesAPerson("No. 20")).toBe(false);
    expect(labelNamesAPerson("No 36")).toBe(false);
    expect(labelNamesAPerson("Jersey No. 35")).toBe(false);
  });

  it("refuses a label holding several people", () => {
    /* One goal credited to a list. Picking one of them would be inventing the answer. */
    expect(labelNamesAPerson("Papi Emeka (10), Benjamin Aga (14)")).toBe(false);
    expect(labelNamesAPerson("Abdullah Shaubu (7) & Adebayo David (17)")).toBe(false);
  });

  it("agrees with the rule the site uses before linking a label", () => {
    /* The two must not diverge: a label the timeline refuses to link is one this refuses to
       resolve, or a goal gets attached to a player the site will not show as a link. */
    for (const label of ["Unknown", "Player", "No. 20", "Jersey No. 6", "#7"]) {
      expect(labelNamesAPerson(label)).toBe(false);
    }
  });
});

describe("nameFromLabel", () => {
  it("drops the shirt number so the lookup is on the name", () => {
    expect(nameFromLabel("No. 11 EBULU EMMANUEL")).toBe("EBULU EMMANUEL");
    expect(nameFromLabel("Farouk Salami")).toBe("Farouk Salami");
  });
});

describe("planGoalLinks", () => {
  it("links a goal to the player who plays for the team it was scored for", () => {
    const plan = planGoalLinks(
      [goal("e1", "Farouk Salami")],
      [player("p1", "Farouk Salami", ["jp"])]
    );

    expect(plan.links).toHaveLength(1);
    expect(plan.links[0]!.player.id).toBe("p1");
    expect(plan.links[0]!.evidence).toBe("squad");
    expect(plan.unlinked).toHaveLength(0);
  });

  it("accepts the player's own events as the tie, like the numbered-duplicate merge", () => {
    const plan = planGoalLinks(
      [goal("e1", "Muiz Lawal")],
      [player("p1", "Muiz Lawal", [], ["jp"])]
    );
    expect(plan.links).toHaveLength(1);
    expect(plan.links[0]!.evidence).toBe("events");
  });

  it("matches through casing and a shirt number on the label", () => {
    const plan = planGoalLinks(
      [goal("e1", "No. 12 ISMAILA PHILIP")],
      [player("p1", "Ismaila philip", ["jp"])]
    );
    expect(plan.links).toHaveLength(1);
  });

  it("refuses a name nobody in the directory holds", () => {
    const plan = planGoalLinks([goal("e1", "Somebody Absent")], [player("p1", "Farouk Salami", ["jp"])]);
    expect(plan.links).toHaveLength(0);
    expect(plan.unlinked[0]!.reason).toBe("nobody-by-that-name");
  });

  it("refuses when the named player has nothing to do with that team", () => {
    /* The whole safety argument: a wrong goal on a profile is invisible, while a missing one
       is merely absent. Names repeat, so a name match alone is not evidence. */
    const plan = planGoalLinks(
      [goal("e1", "Musa Abdul", "jp")],
      [player("p1", "Musa Abdul", ["super"], ["super"])]
    );
    expect(plan.links).toHaveLength(0);
    expect(plan.unlinked[0]!.reason).toBe("not-tied-to-that-team");
    expect(plan.unlinked[0]!.candidates).toHaveLength(1);
  });

  it("refuses when two players of that name are both tied to the team", () => {
    const plan = planGoalLinks(
      [goal("e1", "Alfred Isaac")],
      [player("p1", "Alfred Isaac", ["jp"]), player("p2", "ALFRED ISAAC", ["jp"])]
    );
    expect(plan.links).toHaveLength(0);
    expect(plan.unlinked[0]!.reason).toBe("several-of-that-name");
    expect(plan.unlinked[0]!.candidates).toHaveLength(2);
  });

  it("picks the tied player when a namesake elsewhere is not tied", () => {
    /* Two boys called Alfred Isaac at different clubs is the ordinary case, and the goal
       belongs to the one who plays where it was scored. */
    const plan = planGoalLinks(
      [goal("e1", "Alfred Isaac", "jp")],
      [player("p1", "Alfred Isaac", ["jp"]), player("p2", "Alfred Isaac", ["royal"])]
    );
    expect(plan.links).toHaveLength(1);
    expect(plan.links[0]!.player.id).toBe("p1");
  });

  it("refuses a goal with no team, whatever the label says", () => {
    const plan = planGoalLinks(
      [goal("e1", "Farouk Salami", null)],
      [player("p1", "Farouk Salami", ["jp"])]
    );
    expect(plan.links).toHaveLength(0);
    expect(plan.unlinked[0]!.reason).toBe("no-team-on-the-event");
  });

  it("refuses every label that is not a name, without looking anybody up", () => {
    const plan = planGoalLinks(
      [goal("e1", "Unknown"), goal("e2", "No. 20"), goal("e3", "Player 1")],
      [player("p1", "Unknown", ["jp"])]
    );
    expect(plan.links).toHaveLength(0);
    expect(plan.unlinked.map((u) => u.reason)).toEqual(["not-a-name", "not-a-name", "not-a-name"]);
  });
});
