import { describe, expect, it } from "vitest";
import { validateEventGoldLabels } from "./event-gold";
const window = { startMs: 1000, endMs: 5000 };
const event = { id: "e", type: "shot", startMs: 1200, endMs: 1600, actorMatchSquadPlayerId: null };
describe("event gold labels", () => {
  it("requires explicit empty arrays and explicit unknown actors", () => {
    expect(validateEventGoldLabels({ events: [], nonPlayWindows: [] }, window)).toEqual({ labels: { events: [], nonPlayWindows: [] }, problems: [] });
    expect(validateEventGoldLabels({}, window).labels).toBeNull();
    expect(validateEventGoldLabels({ events: [{ ...event, actorMatchSquadPlayerId: undefined }], nonPlayWindows: [] }, window).labels).toBeNull();
  });
  it("accepts instant events, a window-ending boundary and unknown actors", () => {
    for (const endMs of [1200, 5000]) expect(validateEventGoldLabels({ events: [{ ...event, endMs }], nonPlayWindows: [] }, window).problems).toEqual([]);
  });
  it("rejects duplicate IDs, unsupported types, fractional and out-of-window times", () => {
    for (const change of [{ type: "made_up" }, { startMs: 999 }, { startMs: 5000, endMs: 5000 }, { startMs: 1001.1 }, { endMs: 1100 }, { endMs: Infinity }]) {
      expect(validateEventGoldLabels({ events: [{ ...event, ...change }], nonPlayWindows: [] }, window).labels).toBeNull();
    }
    expect(validateEventGoldLabels({ events: [event, event], nonPlayWindows: [] }, window).labels).toBeNull();
  });
  it("rejects live events crossing non-play footage and overlapping non-play windows", () => {
    const range = { startMs: 1500, endMs: 2000, kind: "replay" };
    expect(validateEventGoldLabels({ events: [event], nonPlayWindows: [range] }, window).labels).toBeNull();
    expect(validateEventGoldLabels({ events: [], nonPlayWindows: [range, { ...range, startMs: 1900 }] }, window).labels).toBeNull();
    expect(validateEventGoldLabels({ events: [], nonPlayWindows: [{ ...range, startMs: 2000 }] }, window).labels).toBeNull();
    expect(validateEventGoldLabels({ events: [{ ...event, startMs: 2000, endMs: 2100 }], nonPlayWindows: [range] }, window).problems).toEqual([]);
  });
  it("bounds work before inspecting payloads", () => {
    expect(validateEventGoldLabels({ events: Array(201).fill(event), nonPlayWindows: [] }, window).problems[0]).toContain("at most 200");
  });
});
