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

  it("refuses Own Goal, which the first live run would have credited to a record", () => {
    /* There is a player record called `Own Goal`, and the dry run offered to give it a goal.
       Two words with letters in both, so every shape-based rule waves it through -- while
       `isPlaceholderName` had known about it all along. That is what asking the same question
       in two places costs. */
    expect(labelNamesAPerson("Own Goal")).toBe(false);
    expect(labelNamesAPerson("own goal")).toBe(false);
    expect(labelNamesAPerson("Goalkeeper")).toBe(false);
    expect(labelNamesAPerson("Opponent")).toBe(false);
    expect(labelNamesAPerson("Substitute")).toBe(false);
    expect(labelNamesAPerson("Trialist")).toBe(false);
  });

  it("refuses a team, which holds a player record on live and collects goals like one", () => {
    expect(labelNamesAPerson("FC Enegwea")).toBe(false);
    expect(labelNamesAPerson("Vido 99 FC")).toBe(false);
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

  it("links a player whose club has nothing to do with the goal, and says so", () => {
    /* This asserted the opposite until the live run: a club tie was required, and only one
       goal of 88 could be linked. `Farouk Salami` has six for FC BABINGTON, no squad row
       there and no linked events anywhere -- the only evidence he plays anywhere being the
       goals themselves.

       `Player.normalizedName` is unique, so the directory holds exactly one record per name
       and there is no second Farouk Salami to confuse him with. Requiring more than the name
       was stricter than the database being written to. The domain agrees: two players sharing
       a first or last name have never played in the same team in the same competition, and
       where names come close a third name distinguishes them. */
    const plan = planGoalLinks(
      [goal("e1", "Farouk Salami", "jp")],
      [player("p1", "Farouk Salami", ["ikorodu"], ["ikorodu"])]
    );
    expect(plan.links).toHaveLength(1);
    expect(plan.links[0]!.evidence).toBe("name-only");
  });

  it("refuses when two records hold that name", () => {
    /* `normalizedName` is nullable and Postgres lets nulls duplicate, so this is possible
       even though the directory is meant to hold one record per name. Nothing here can
       choose between them, and the domain says they should not both exist. */
    const plan = planGoalLinks(
      [goal("e1", "Alfred Isaac")],
      [player("p1", "Alfred Isaac", ["jp"]), player("p2", "ALFRED ISAAC", ["royal"])]
    );
    expect(plan.links).toHaveLength(0);
    expect(plan.unlinked[0]!.reason).toBe("several-of-that-name");
    expect(plan.unlinked[0]!.candidates).toHaveLength(2);
  });

  it("still links a goal that carries no team", () => {
    /* The team was the thing being checked against, and it no longer is. A label naming one
       directory player is that player, whatever the event does or does not record. */
    const plan = planGoalLinks(
      [goal("e1", "Farouk Salami", null)],
      [player("p1", "Farouk Salami", ["jp"])]
    );
    expect(plan.links).toHaveLength(1);
    expect(plan.links[0]!.evidence).toBe("name-only");
  });

  it("refuses every label that is not a name, without looking anybody up", () => {
    const plan = planGoalLinks(
      [goal("e1", "Unknown"), goal("e2", "No. 20"), goal("e3", "Player 1")],
      [player("p1", "Unknown", ["jp"])]
    );
    expect(plan.links).toHaveLength(0);
    expect(plan.unlinked.map((u) => u.reason)).toEqual([
      "placeholder",
      "placeholder",
      "placeholder",
    ]);
  });

  it("reports each refusal in its own words rather than as one kind", () => {
    /* The report files these under one heading otherwise, and telling a reader that
       `FC Enegwea` is "Unknown, Player, or a bare shirt number" is telling them something
       untrue about their data. A team holding a player record is a different problem from a
       goal nobody put a name to, and it is fixed differently. */
    const plan = planGoalLinks(
      [
        goal("e1", "Unknown"),
        goal("e2", "FC Enegwea"),
        goal("e3", "Jersey No. 35"),
        goal("e4", "Abdullah Shaubu (7) & Adebayo David (17)"),
      ],
      []
    );
    expect(plan.unlinked.map((u) => u.reason)).toEqual([
      "placeholder",
      "team",
      "carries-a-digit",
      "several-people",
    ]);
  });
});
