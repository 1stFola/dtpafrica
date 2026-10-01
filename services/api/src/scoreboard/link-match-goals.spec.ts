/**
 * Linking a published match's goals to the people their labels name.
 *
 * The gap this closes: a published event takes its player from the squad row the recorder
 * picked, and a row that is not itself linked to a player record leaves the goal with a name
 * and nobody behind it. On live that was 88 goals, seven of them `Farouk Salami`'s while his
 * profile showed none.
 */
import { describe, expect, it, vi } from "vitest";
import { linkMatchGoals } from "./link-match-goals";

type Event = { id: string; matchId: string; teamId: string | null; playerLabel: string | null };

function db(events: Event[], people: { id: string; displayName: string }[]) {
  const updates: { id: string; playerId: string }[] = [];
  return {
    updates,
    client: {
      sbMatchEvent: {
        findMany: vi.fn(async () => events),
        update: vi.fn(async (args: { where: { id: string }; data: { playerId: string } }) => {
          updates.push({ id: args.where.id, playerId: args.data.playerId });
          return {};
        }),
      },
      player: { findMany: vi.fn(async () => people) },
    },
  };
}

const goal = (id: string, label: string | null, teamId: string | null = "t1"): Event => ({
  id,
  matchId: "m1",
  teamId,
  playerLabel: label,
});

describe("linkMatchGoals", () => {
  it("links a goal whose label names one directory player", async () => {
    const { client, updates } = db(
      [goal("e1", "Farouk Salami")],
      [{ id: "p1", displayName: "Farouk Salami" }]
    );

    expect(await linkMatchGoals(client as never, "m1")).toBe(1);
    expect(updates).toEqual([{ id: "e1", playerId: "p1" }]);
  });

  it("matches through the shirt number the console writes in front of the name", async () => {
    /* `squadNumberLabel` writes `No. 11 Ebulu Emmanuel` when the row has a number, and the
       bare name when it does not. Both must resolve to the same boy. */
    const { client, updates } = db(
      [goal("e1", "No. 11 Ebulu Emmanuel")],
      [{ id: "p1", displayName: "Ebulu Emmanuel" }]
    );

    expect(await linkMatchGoals(client as never, "m1")).toBe(1);
    expect(updates[0]!.playerId).toBe("p1");
  });

  it("refuses a label that names nobody", async () => {
    /* The same gate the directory uses, so a publish can never create what
       `admitSquadName` exists to refuse. */
    const { client, updates } = db(
      [goal("e1", "Unknown"), goal("e2", "No. 20"), goal("e3", "Own Goal")],
      [{ id: "p1", displayName: "Unknown" }]
    );

    expect(await linkMatchGoals(client as never, "m1")).toBe(0);
    expect(updates).toEqual([]);
  });

  it("refuses when two records hold the name", async () => {
    const { client, updates } = db(
      [goal("e1", "Alfred Isaac")],
      [
        { id: "p1", displayName: "Alfred Isaac" },
        { id: "p2", displayName: "ALFRED ISAAC" },
      ]
    );

    expect(await linkMatchGoals(client as never, "m1")).toBe(0);
    expect(updates).toEqual([]);
  });

  it("writes nothing when the match has no unlinked goals", async () => {
    /* The ordinary case on every publish, and it must not read the directory to find that
       out — this runs on every approval. */
    const { client } = db([], [{ id: "p1", displayName: "Farouk Salami" }]);

    expect(await linkMatchGoals(client as never, "m1")).toBe(0);
    expect(client.player.findMany).not.toHaveBeenCalled();
  });

  it("asks only for the names these labels could be", async () => {
    /* Reading the whole directory on every approval would be a table scan per published
       sheet, and the directory holds nearly five thousand records. */
    const { client } = db(
      [goal("e1", "Farouk Salami"), goal("e2", "Unknown")],
      [{ id: "p1", displayName: "Farouk Salami" }]
    );

    await linkMatchGoals(client as never, "m1");
    const [args] = client.player.findMany.mock.calls[0] as unknown as [
      { where: { normalizedName: { in: string[] } } },
    ];
    expect(args.where.normalizedName.in).toContain("farouk salami");
    expect(args.where.normalizedName.in).toContain("unknown");
    expect(args.where.normalizedName.in).toHaveLength(2);
  });

  it("leaves a goal alone when nobody in the directory holds the name", async () => {
    const { client, updates } = db([goal("e1", "Somebody Absent")], []);
    expect(await linkMatchGoals(client as never, "m1")).toBe(0);
    expect(updates).toEqual([]);
  });
});
