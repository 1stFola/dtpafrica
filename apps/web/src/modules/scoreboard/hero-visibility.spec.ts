import { describe, expect, it } from "vitest";
import { heroShownFor } from "./hero-visibility";

describe("heroShownFor", () => {
  it("shows the hero on the Overview and Competitions tab roots", () => {
    expect(heroShownFor("/scoreboard")).toBe(true);
    expect(heroShownFor("/scoreboard/")).toBe(true);
    expect(heroShownFor("/scoreboard/browse")).toBe(true);
    expect(heroShownFor("/scoreboard/browse/")).toBe(true);
  });

  it("folds it on a fixture opened from Overview and a competition opened from Competitions", () => {
    expect(heroShownFor("/scoreboard/match/broad-city-fc-vs-klassisc-fc-2")).toBe(false);
    expect(heroShownFor("/scoreboard/competition/jagaban-cup-2026")).toBe(false);
    expect(heroShownFor("/scoreboard/team/0b1f")).toBe(false);
  });

  it("folds it on the Highlights and Live Games tabs", () => {
    expect(heroShownFor("/scoreboard/highlights")).toBe(false);
    expect(heroShownFor("/scoreboard/live")).toBe(false);
  });
});
