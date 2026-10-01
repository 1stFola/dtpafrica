/**
 * No game reads as live until its recorder presses Kick off.
 *
 * What these guard against is a real complaint from the people running the competitions:
 * approving a fixture for the public feed made it show as LIVE straight away, hours before
 * kickoff, with a 0-0 nobody was playing for. Approving says a game MAY be shown; the
 * recorder's Kick off says when it is.
 */
import { describe, expect, it } from "vitest";
import type { ClockState } from "../admin/admin-match-stats.service";
import { hasKickedOff, publicLiveState, type PublicLiveInput } from "./public-live-state";

const KICKOFF_AT = Date.parse("2026-09-30T15:00:00.000Z");
const clock = (over: Partial<ClockState> = {}): ClockState => ({
  halfLength: 45,
  half: 1,
  phase: "pre_kickoff",
  addedFirst: null,
  addedSecond: null,
  firstHalfStartedAt: null,
  secondHalfStartedAt: null,
  ...over,
});

/** An approved fixture with a recorder's sheet on it — the ordinary case. */
const state = (over: Partial<PublicLiveInput> = {}) =>
  publicLiveState({
    liveEnabled: true,
    sheetStatus: "live",
    matchStatus: "scheduled",
    clock: clock(),
    minute: null,
    now: KICKOFF_AT,
    ...over,
  });

describe("hasKickedOff", () => {
  it("is the console's own `started` test", () => {
    expect(hasKickedOff(null)).toBe(false);
    expect(hasKickedOff(undefined)).toBe(false);
    expect(hasKickedOff(clock({ phase: "pre_kickoff" }))).toBe(false);
    expect(hasKickedOff(clock({ phase: "running" }))).toBe(true);
  });

  it("counts every phase after the whistle, a finished match included", () => {
    for (const phase of [
      "running",
      "awaiting_added",
      "added_running",
      "awaiting_second_half",
      "awaiting_full_time",
      "penalty_shootout",
      "finished",
    ] as ClockState["phase"][]) {
      expect(hasKickedOff(clock({ phase }))).toBe(true);
    }
  });
});

describe("publicLiveState before kickoff", () => {
  it("says nothing about an approved fixture whose recorder has not started", () => {
    expect(state()).toBeNull();
  });

  it("says nothing when the sheet has no clock at all", () => {
    /* A sheet gets its clock when Kick off is pressed, so no clock is no kickoff. */
    expect(state({ clock: null })).toBeNull();
  });

  it("still says nothing when the sheet already holds events", () => {
    /* The regression this module was written for. The old rule waived the kickoff test as
       soon as one event existed -- `events.length === 0 && pre_kickoff` -- so a recorder
       filing anything before the whistle published a live game. Events are no longer part
       of the question, which is why this function is not given any. */
    expect(state({ clock: clock({ phase: "pre_kickoff" }) })).toBeNull();
  });
});

describe("publicLiveState after kickoff", () => {
  it("counts the minute from the first-half anchor", () => {
    const result = state({
      clock: clock({
        phase: "running",
        firstHalfStartedAt: new Date(KICKOFF_AT - 7 * 60_000).toISOString(),
      }),
    });
    expect(result).toEqual({ status: "live", minute: 8 });
  });

  it("counts the second half on from the end of the first", () => {
    const result = state({
      clock: clock({
        phase: "running",
        half: 2,
        halfLength: 40,
        firstHalfStartedAt: new Date(KICKOFF_AT - 60 * 60_000).toISOString(),
        secondHalfStartedAt: new Date(KICKOFF_AT - 3 * 60_000).toISOString(),
      }),
    });
    expect(result).toEqual({ status: "live", minute: 44 });
  });

  it("is live on the row's minute when the phase says running and no anchor was stamped", () => {
    expect(state({ clock: clock({ phase: "running" }), minute: 12 })).toEqual({
      status: "live",
      minute: 12,
    });
  });

  it("is halftime between the halves", () => {
    expect(state({ clock: clock({ phase: "awaiting_second_half" }), minute: 45 })).toEqual({
      status: "halftime",
      minute: 45,
    });
  });

  it("is finished at full time, and when the recorder has submitted", () => {
    expect(state({ clock: clock({ phase: "finished" }), minute: 90 })).toEqual({
      status: "finished",
      minute: 90,
    });
    expect(
      state({ sheetStatus: "submitted", clock: clock({ phase: "running" }), minute: 90 })
    ).toEqual({ status: "finished", minute: 90 });
  });
});

describe("publicLiveState and the admin's switch", () => {
  it("says nothing about a game taken off the feed, however far into it the recorder is", () => {
    /* The switch is the feed controller: the recorder goes on capturing, and the public is
       told nothing. */
    expect(
      state({
        liveEnabled: false,
        clock: clock({
          phase: "running",
          firstHalfStartedAt: new Date(KICKOFF_AT - 20 * 60_000).toISOString(),
        }),
      })
    ).toBeNull();
  });

  it("says nothing about a match with no sheet, leaving the row to speak", () => {
    /* No sheet means no clock, so this is the same answer as "has not kicked off" -- and an
       admin who marks a match live by hand is not contradicted. */
    expect(state({ matchStatus: "live", clock: null })).toBeNull();
  });

  it("says nothing once the sheet is approved or the match is finished", () => {
    const running = clock({
      phase: "running",
      firstHalfStartedAt: new Date(KICKOFF_AT - 20 * 60_000).toISOString(),
    });
    expect(state({ sheetStatus: "approved", clock: running })).toBeNull();
    expect(state({ matchStatus: "finished", clock: running })).toBeNull();
  });
});
