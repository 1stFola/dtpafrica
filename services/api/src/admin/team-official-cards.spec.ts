import { describe, expect, it } from "vitest";
import { readEvents } from "./admin-match-stats.service";
import { generateEventComment } from "./match-event-comments";
import { danglingNumbers } from "./sheet-auto-approve";

const base = { id: "e1", minute: 30, addedMinute: null, side: "home", half: 1 };
const ctx = { teamName: "France", opponentName: "Spain" };

describe("cards shown to team officials", () => {
  it("keeps the official on a card and drops any shirt number sent with it", () => {
    const [event] = readEvents([
      {
        ...base,
        type: "yellow_card",
        playerNumber: 9,
        secondaryPlayerNumber: 4,
        official: { role: "head_coach", name: "  Didier   Deschamps " },
      },
    ]);
    expect(event).toMatchObject({
      playerNumber: null,
      secondaryPlayerNumber: null,
      official: { role: "head_coach", name: "Didier Deschamps" },
    });
  });

  it("ignores an official on anything but a card", () => {
    const [event] = readEvents([
      { ...base, type: "goal", playerNumber: 9, official: { role: "head_coach", name: "X" } },
    ]);
    expect(event.playerNumber).toBe(9);
    expect(event).not.toHaveProperty("official");
  });

  it("refuses an unknown role, and reads a blank name as no name", () => {
    const [bad, blank] = readEvents([
      { ...base, type: "red_card", playerNumber: 5, official: { role: "chairman" } },
      { ...base, id: "e2", type: "red_card", official: { role: "medic", name: "   " } },
    ]);
    expect(bad.playerNumber).toBe(5);
    expect(bad).not.toHaveProperty("official");
    expect(blank.official).toEqual({ role: "medic", name: null });
  });

  it("leaves a player event exactly as it was", () => {
    const [event] = readEvents([{ ...base, type: "yellow_card", playerNumber: 7 }]);
    expect(event).toEqual({ ...base, type: "yellow_card", playerNumber: 7, secondaryPlayerNumber: null });
  });

  it("words the card for the bench, with or without a name", () => {
    const named = { ...base, side: "home" as const, type: "yellow_card", official: { role: "head_coach" as const, name: "Didier Deschamps" } };
    expect(generateEventComment(named, ctx)).toBe(
      "30' - Yellow Card! The referee cautions the France head coach Didier Deschamps on the touchline."
    );
    const red = { ...named, type: "red_card", official: { role: "medic" as const, name: null } };
    expect(generateEventComment(red, ctx)).toBe(
      "30' - Red Card! The France physio is sent to the stands by the referee."
    );
  });

  it("never holds auto-approval for an official, who has no number to resolve", () => {
    const events = readEvents([
      { ...base, type: "yellow_card", official: { role: "assistant_coach", name: null } },
    ]);
    expect(danglingNumbers(events, () => ({ kind: "unknown" }))).toEqual([]);
  });
});
