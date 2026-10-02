import { describe, expect, it } from "vitest";
import { VISION_EVENT_TYPES } from "@dtp/vision-contracts";
import { isEventType, isPlay, matchRecorderEvent, scoreboardTypeOf, windowProblem, type RecorderEvent } from "./event-taxonomy";

describe("the taxonomy", () => {
  it("knows its fourteen types and nothing else", () => {
    expect(VISION_EVENT_TYPES).toHaveLength(14);
    expect(isEventType("shot")).toBe(true);
    expect(isEventType("goal_candidate")).toBe(true);
    expect(isEventType("goal")).toBe(false);
    expect(isEventType("")).toBe(false);
  });

  it("promotes only what the recorder has a row for", () => {
    expect(scoreboardTypeOf("goal_candidate")).toBe("goal");
    expect(scoreboardTypeOf("shot")).toBeNull();
    expect(scoreboardTypeOf("pass")).toBeNull();
  });

  it("calls a replay, an intro and halftime not play, and anything else play", () => {
    expect(isPlay("replay")).toBe(false);
    expect(isPlay("intro")).toBe(false);
    expect(isPlay("halftime")).toBe(false);
    expect(isPlay("wide")).toBe(true);
    expect(isPlay("unknown")).toBe(true);
    expect(isPlay(null)).toBe(true);
  });

  it("bounds a window by the footage", () => {
    expect(windowProblem(0, 0, 1000)).toBeNull();
    expect(windowProblem(10, 20, null)).toBeNull();
    expect(windowProblem(-1, 5, 1000)).toContain("before the footage");
    expect(windowProblem(20, 10, 1000)).toContain("ends before it starts");
    expect(windowProblem(10, 1001, 1000)).toContain("past the footage");
  });
});

describe("which recorder event a candidate is", () => {
  const goal = (over: Partial<RecorderEvent>): RecorderEvent => ({ id: "e", type: "goal", minute: 23, teamId: "home", playerId: null, ...over });

  it("matches the same type within a minute, nearest first", () => {
    const events = [goal({ id: "far", minute: 30 }), goal({ id: "near", minute: 24 }), goal({ id: "nearer", minute: 23 })];
    expect(matchRecorderEvent({ scoreboardType: "goal", minute: 23, sbTeamId: "home", actorPlayerId: null }, events)).toMatchObject({ kind: "matched", event: { id: "nearer" }, minutesApart: 0 });
    expect(matchRecorderEvent({ scoreboardType: "goal", minute: 25, sbTeamId: null, actorPlayerId: null }, events)).toMatchObject({ kind: "matched", event: { id: "near" }, minutesApart: 1 });
  });

  it("refuses to choose between two equally near", () => {
    const events = [goal({ id: "a", minute: 22 }), goal({ id: "b", minute: 24 })];
    expect(matchRecorderEvent({ scoreboardType: "goal", minute: 23, sbTeamId: "home", actorPlayerId: null }, events)).toMatchObject({ kind: "ambiguous", events: [{ id: "a" }, { id: "b" }] });
  });

  it("finds nothing beyond the tolerance, naming the nearest", () => {
    const events = [goal({ id: "far", minute: 30 })];
    expect(matchRecorderEvent({ scoreboardType: "goal", minute: 23, sbTeamId: "home", actorPlayerId: null }, events)).toEqual({ kind: "none", nearest: events[0] });
    // Two minutes is beyond the tolerance: a goal at 25' is not the candidate at 23'.
    const two = [goal({ id: "two", minute: 25 })];
    expect(matchRecorderEvent({ scoreboardType: "goal", minute: 23, sbTeamId: "home", actorPlayerId: null }, two)).toEqual({ kind: "none", nearest: two[0] });
    expect(matchRecorderEvent({ scoreboardType: "goal", minute: 23, sbTeamId: "home", actorPlayerId: null }, [])).toEqual({ kind: "none", nearest: null });
  });

  it("does not match across a type, a team or a player that both sides know", () => {
    const events = [goal({ id: "own", type: "own_goal" }), goal({ id: "away", teamId: "away", minute: 27 }), goal({ id: "someone", playerId: "p9" })];
    expect(matchRecorderEvent({ scoreboardType: "goal", minute: 23, sbTeamId: "home", actorPlayerId: "p7" }, events)).toMatchObject({ kind: "none", nearest: null });
    // A recorder event with no player, or a candidate with no team, is compatible.
    expect(matchRecorderEvent({ scoreboardType: "goal", minute: 23, sbTeamId: null, actorPlayerId: "p9" }, events)).toMatchObject({ kind: "matched", event: { id: "someone" } });
  });
});
