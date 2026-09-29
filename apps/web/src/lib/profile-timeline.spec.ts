import { describe, expect, it } from "vitest";
import { showsOnProfileTimeline } from "./profile-timeline";

/** Types are the ones the recorder console actually files; see EVENT_LABELS. */
describe("what a player's own timeline lists", () => {
  it("hides the three a showcase should not lead with", () => {
    for (const type of ["offside", "yellow_card", "red_card"]) {
      expect(showsOnProfileTimeline({ type })).toBe(false);
    }
  });

  it("shows everything else the recorder files", () => {
    /* Taken from the DYNAMIC FC v HIGHKLASS SA timeline, which is the fixture that
       prompted this and carries an unusually wide spread of types. */
    for (const type of [
      "goal",
      "goal_penalty",
      "substitution",
      "shot",
      "shot_off_target",
      "missed_chance",
      "clearance",
      "goal_line_clearance",
      "goalkeeper_intervention",
      "goalkeeper_command",
      "interception",
      "midfield_battle",
      "long_throw",
      "dribble",
      "woodwork",
      "save",
      "penalty_saved",
    ]) {
      expect(showsOnProfileTimeline({ type })).toBe(true);
    }
  });

  it("shows an unknown type rather than hiding it", () => {
    /* A new event type should appear on profiles the day it is added. Defaulting to
       hidden would make each one an invisible omission nobody thinks to look for. */
    expect(showsOnProfileTimeline({ type: "something_new" })).toBe(true);
  });
});
