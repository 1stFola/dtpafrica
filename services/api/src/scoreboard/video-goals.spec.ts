import { describe, expect, it, vi } from "vitest";
import { videoGoals, withVideoGoals } from "./video-goals";

const match = { id: "m1", homeTeamId: "home", awayTeamId: "away" };

describe("goals added to a timeline from video", () => {
  it("are the rows marked as from video, counted for the side they are logged against", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { type: "goal", teamId: "home" },
      { type: "goal", teamId: "home" },
      { type: "goal_penalty", teamId: "away" },
      // Not a goal, and a team that is not playing: on the timeline, not on the scoreline.
      { type: "yellow_card", teamId: "home" },
      { type: "goal", teamId: "someone-else" },
      { type: "goal", teamId: null },
    ]);
    expect(await videoGoals({ sbMatchEvent: { findMany } }, match)).toEqual({ home: 2, away: 1, events: 6 });
    expect(findMany.mock.calls[0]![0].where).toEqual({ matchId: "m1", metadata: { path: ["source"], equals: "vision" } });
  });

  it("are none on a match Vision never added to, which is every match today", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const none = await videoGoals({ sbMatchEvent: { findMany } }, match);
    expect(none).toEqual({ home: 0, away: 0, events: 0 });
    expect(withVideoGoals({ home: 2, away: 1 }, none)).toEqual({ home: 2, away: 1 });
  });

  it("count on top of the sheet's score", () => {
    expect(withVideoGoals({ home: 2, away: 1 }, { home: 1, away: 0 })).toEqual({ home: 3, away: 1 });
    expect(withVideoGoals({ home: 0, away: 0 }, { home: 0, away: 2 })).toEqual({ home: 0, away: 2 });
  });
});
