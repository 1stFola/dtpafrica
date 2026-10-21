import { describe, expect, it } from "vitest";
import { mergeSameNameLeaders, statLeaderName } from "./stat-leader-names";

describe("the name a stat leader goes by", () => {
  it("drops the shirt number a match sheet writes in front of an unlinked squad name", () => {
    expect(statLeaderName(null, "No. 8 tajudeen fawaz")).toBe("tajudeen fawaz");
    expect(statLeaderName(null, "no 8 Tajudeen Fawaz")).toBe("Tajudeen Fawaz");
    expect(statLeaderName(null, "#8 Tajudeen Fawaz")).toBe("Tajudeen Fawaz");
  });

  it("drops it from a player record that was created with the number in its name", () => {
    expect(statLeaderName({ displayName: "No. 11 EBULU EMMANUEL" }, "No. 11 EBULU EMMANUEL")).toBe(
      "EBULU EMMANUEL"
    );
  });

  it("prefers the record's name to the label", () => {
    expect(statLeaderName({ displayName: "Tajudeen Fawaz" }, "No. 8 tajudeen fawaz")).toBe("Tajudeen Fawaz");
  });

  it("keeps a plain name as written", () => {
    expect(statLeaderName(null, "  Farouk Salami ")).toBe("Farouk Salami");
  });

  it("names nobody for a bare number or a placeholder", () => {
    for (const label of ["No. 8", "#7", "8", "Unknown", "Player", "No. 9 Unknown", "", null, undefined]) {
      expect(statLeaderName(null, label), String(label)).toBeNull();
    }
  });
});

describe("one stat leader row per name per team", () => {
  const team = { id: "evolution" };

  it("adds an unlinked name's goals to the record of the same name on the same team", () => {
    const rows = mergeSameNameLeaders([
      { playerId: null, playerName: "tajudeen fawaz", playerSlug: "tajudeen-fawaz", team, count: 1 },
      { playerId: "p1", playerName: "Tajudeen Fawaz", playerSlug: "tajudeen-fawaz-2", team, count: 2 },
    ]);
    expect(rows).toEqual([
      { playerId: "p1", playerName: "Tajudeen Fawaz", playerSlug: "tajudeen-fawaz-2", team, count: 3 },
    ]);
  });

  it("keeps the clean record over a numbered duplicate of it", () => {
    const rows = mergeSameNameLeaders([
      { playerId: "numbered", playerName: "Musa Abdul", playerSlug: "no-16-musa-abdul", team, count: 3 },
      { playerId: "clean", playerName: "Musa Abdul", playerSlug: "musa-abdul", team, count: 1 },
    ]);
    expect(rows).toEqual([{ playerId: "clean", playerName: "Musa Abdul", playerSlug: "musa-abdul", team, count: 4 }]);
  });

  it("leaves the same name on another team alone", () => {
    const rows = mergeSameNameLeaders([
      { playerId: "p1", playerName: "Tajudeen Fawaz", playerSlug: "tajudeen-fawaz", team, count: 2 },
      { playerId: null, playerName: "Tajudeen Fawaz", playerSlug: "tajudeen-fawaz", team: { id: "patnik" }, count: 1 },
    ]);
    expect(rows.map((r) => r.count)).toEqual([2, 1]);
  });

  it("keeps an unlinked name that has no record", () => {
    const row = { playerId: null, playerName: "Farouk Salami", playerSlug: "farouk-salami", team, count: 7 };
    expect(mergeSameNameLeaders([row])).toEqual([row]);
  });
});
