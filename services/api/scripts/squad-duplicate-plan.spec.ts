import { describe, expect, it } from "vitest";
import { planSquadDedupe, type SquadMember } from "./squad-duplicate-plan";
import { reorderKey } from "./duplicate-player-detection";

/** The same rule `db:report:duplicate-players` uses, so the two cannot disagree. */
const samePerson = (a: string, b: string) => reorderKey(a) === reorderKey(b);

let seq = 0;
function member(overrides: Partial<SquadMember> = {}): SquadMember {
  seq += 1;
  return {
    squadRowId: `row-${seq}`,
    teamId: "team-1",
    teamName: "FC NIEKETIEN",
    playerId: `player-${seq}`,
    displayName: "Abubakar Abdullah",
    events: 0,
    hasProfile: false,
    playerCreatedAt: new Date("2026-07-13T00:00:00.000Z"),
    ...overrides,
  };
}

describe("finding a squad that holds one person twice", () => {
  it("pairs a name with its reverse in the same squad", () => {
    const plans = planSquadDedupe(
      [
        member({ playerId: "a", displayName: "Abubakar Abdullah" }),
        member({ playerId: "b", displayName: "Abdullah Abubakar" }),
      ],
      samePerson
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]?.drop).toHaveLength(1);
  });

  it("leaves two genuinely different players alone", () => {
    const plans = planSquadDedupe(
      [
        member({ playerId: "a", displayName: "Emeka Okoli" }),
        member({ playerId: "b", displayName: "Chidi Okoli" }),
      ],
      samePerson
    );
    expect(plans).toEqual([]);
  });

  it("does not pair records across different squads", () => {
    /* Two teams can each have a player of the same name, and they are two people
       until something says otherwise. Only a shared squad is evidence. */
    const plans = planSquadDedupe(
      [
        member({ playerId: "a", teamId: "t1", displayName: "Clems Henry" }),
        member({ playerId: "b", teamId: "t2", displayName: "Henry Clems" }),
      ],
      samePerson
    );
    expect(plans).toEqual([]);
  });

  it("ignores one player listed twice in a squad", () => {
    // That is a different fault, and db:repair:squad-duplicates already fixes it.
    const plans = planSquadDedupe(
      [
        member({ playerId: "same", squadRowId: "r1" }),
        member({ playerId: "same", squadRowId: "r2" }),
      ],
      samePerson
    );
    expect(plans).toEqual([]);
  });

  it("handles a person held three times", () => {
    const plans = planSquadDedupe(
      [
        member({ playerId: "a", displayName: "Sabitu Shamsu Sunday" }),
        member({ playerId: "b", displayName: "Sunday Sabitu Shamsu" }),
        member({ playerId: "c", displayName: "Shamsu Sunday Sabitu" }),
      ],
      samePerson
    );
    expect(plans[0]?.drop).toHaveLength(2);
  });
});

describe("which record keeps the place", () => {
  it("keeps the one carrying more history", () => {
    const plans = planSquadDedupe(
      [
        member({ playerId: "quiet", displayName: "Otto Paul", events: 0 }),
        member({ playerId: "busy", displayName: "Paul Otto", events: 3 }),
      ],
      samePerson
    );
    expect(plans[0]?.keeper.playerId).toBe("busy");
    expect(plans[0]?.why).toContain("3 event(s)");
  });

  it("prefers a real profile when neither has history", () => {
    const plans = planSquadDedupe(
      [
        member({ playerId: "bare", displayName: "Lekan James" }),
        member({ playerId: "full", displayName: "James Lekan", hasProfile: true }),
      ],
      samePerson
    );
    expect(plans[0]?.keeper.playerId).toBe("full");
    expect(plans[0]?.why).toContain("profile");
  });

  it("falls back to the older record", () => {
    const plans = planSquadDedupe(
      [
        member({
          playerId: "new",
          displayName: "Samson Ogbu",
          playerCreatedAt: new Date("2026-07-24T00:00:00.000Z"),
        }),
        member({
          playerId: "old",
          displayName: "Ogbu Samson",
          playerCreatedAt: new Date("2026-07-13T00:00:00.000Z"),
        }),
      ],
      samePerson
    );
    expect(plans[0]?.keeper.playerId).toBe("old");
  });

  it("is deterministic when the records are indistinguishable", () => {
    /* Row order out of the database is not stable, and a tool that picks a
       different record each run is one nobody can check. */
    const two = [
      member({ playerId: "zzz", displayName: "Ade Bola" }),
      member({ playerId: "aaa", displayName: "Bola Ade" }),
    ];
    const first = planSquadDedupe(two, samePerson)[0]?.keeper.playerId;
    const second = planSquadDedupe([...two].reverse(), samePerson)[0]?.keeper.playerId;
    expect(first).toBe("aaa");
    expect(second).toBe("aaa");
  });

  it("never drops the record it keeps", () => {
    const plans = planSquadDedupe(
      [
        member({ playerId: "a", displayName: "Clems Henry", events: 5 }),
        member({ playerId: "b", displayName: "Henry Clems", events: 1 }),
      ],
      samePerson
    );
    const keeper = plans[0]!.keeper.playerId;
    expect(plans[0]!.drop.map((d) => d.playerId)).not.toContain(keeper);
  });
});
