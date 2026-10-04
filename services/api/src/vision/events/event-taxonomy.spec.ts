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
    expect(isPlay("live_play")).toBe(true);
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
  const goal = (over: Partial<RecorderEvent>): RecorderEvent => ({ id: "e", type: "goal", half: 1, minute: 23, addedMinute: null, teamId: "home", playerId: null, ...over });
  const cand = (over: Partial<Parameters<typeof matchRecorderEvent>[0]> = {}) => ({ scoreboardType: "goal", half: 1 as 1 | 2, minute: 23, addedMinute: null, sbTeamId: "home" as string | null, actorPlayerId: null as string | null, ...over });

  it("matches the same type within a minute, nearest first", () => {
    const events = [goal({ id: "far", minute: 30 }), goal({ id: "near", minute: 24 }), goal({ id: "nearer", minute: 23 })];
    expect(matchRecorderEvent(cand(), events)).toMatchObject({ kind: "matched", event: { id: "nearer" }, minutesApart: 0, sameMinute: true });
    expect(matchRecorderEvent(cand({ minute: 25, sbTeamId: null }), events)).toMatchObject({ kind: "matched", event: { id: "near" }, minutesApart: 1, sameMinute: false });
  });

  it("refuses to choose between two equally near", () => {
    const events = [goal({ id: "a", minute: 22 }), goal({ id: "b", minute: 24 })];
    expect(matchRecorderEvent(cand(), events)).toMatchObject({ kind: "ambiguous", events: [{ id: "a" }, { id: "b" }] });
  });

  it("finds nothing beyond the tolerance, naming the nearest", () => {
    const events = [goal({ id: "far", minute: 30 })];
    expect(matchRecorderEvent(cand(), events)).toEqual({ kind: "none", nearest: events[0] });
    // Two minutes is beyond the tolerance: a goal at 25' is not the candidate at 23'.
    const two = [goal({ id: "two", minute: 25 })];
    expect(matchRecorderEvent(cand(), two)).toEqual({ kind: "none", nearest: two[0] });
    expect(matchRecorderEvent(cand(), [])).toEqual({ kind: "none", nearest: null });
  });

  it("does not match across a type, a team or a player that both sides know", () => {
    const events = [goal({ id: "own", type: "own_goal" }), goal({ id: "away", teamId: "away", minute: 27 }), goal({ id: "someone", playerId: "p9" })];
    expect(matchRecorderEvent(cand({ actorPlayerId: "p7" }), events)).toMatchObject({ kind: "none", nearest: null });
    // A recorder event with no player, or a candidate with no team, is compatible.
    expect(matchRecorderEvent(cand({ sbTeamId: null, actorPlayerId: "p9" }), events)).toMatchObject({ kind: "matched", event: { id: "someone" } });
  });

  it("counts added time on: 45+2 is the recorder's 45+2, and one from 45+1", () => {
    const events = [goal({ id: "stoppage", minute: 45, addedMinute: 2 })];
    expect(matchRecorderEvent(cand({ minute: 45, addedMinute: 2 }), events)).toMatchObject({ kind: "matched", event: { id: "stoppage" }, minutesApart: 0, sameMinute: true });
    expect(matchRecorderEvent(cand({ minute: 45, addedMinute: 1 }), events)).toMatchObject({ kind: "matched", minutesApart: 1, sameMinute: false });
    // The capped minute alone is two away: 45' is not 45+2'.
    expect(matchRecorderEvent(cand({ minute: 45, addedMinute: null }), events)).toMatchObject({ kind: "none", nearest: { id: "stoppage" } });
  });

  it("never matches across the halves, however near the numbers", () => {
    // First-half stoppage at 45+2 and a second-half goal in the 47th minute are the same number and different goals.
    const second = [goal({ id: "second-half", half: 2, minute: 47 })];
    expect(matchRecorderEvent(cand({ half: 1, minute: 45, addedMinute: 2 }), second)).toEqual({ kind: "none", nearest: second[0] });
    const stoppage = [goal({ id: "stoppage", half: 1, minute: 45, addedMinute: 2 })];
    expect(matchRecorderEvent(cand({ half: 2, minute: 47 }), stoppage)).toEqual({ kind: "none", nearest: stoppage[0] });
    // And 45' at the end of the first half is not 46' at the start of the second.
    expect(matchRecorderEvent(cand({ half: 2, minute: 46 }), [goal({ id: "on-the-whistle", half: 1, minute: 45 })])).toMatchObject({ kind: "none" });
  });

  it("says the minutes are the same only when the minute and the added minute both are", () => {
    // A row entered by hand as 46' in the first half sits where 45+1 does, and is not the same minute.
    const byHand = [goal({ id: "by-hand", half: 1, minute: 46, addedMinute: null })];
    expect(matchRecorderEvent(cand({ minute: 45, addedMinute: 1 }), byHand)).toMatchObject({ kind: "matched", minutesApart: 0, sameMinute: false });
  });
});

describe("the second beside the recorder's minute", () => {
  it("is Vision's when the minutes agree and the recorder gave none, and nothing otherwise", async () => {
    const { secondToWrite } = await import("./event-taxonomy");
    expect(secondToWrite(20, true, null)).toBe(20);
    expect(secondToWrite(0, true, null)).toBe(0);
    expect(secondToWrite(20, false, null)).toBeNull();
    expect(secondToWrite(20, true, 40)).toBeNull();
    expect(secondToWrite(20, true, 0)).toBeNull();
  });
});
