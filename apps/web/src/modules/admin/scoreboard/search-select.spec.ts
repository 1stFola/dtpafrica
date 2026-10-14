import { describe, expect, it } from "vitest";
import { filterSearchOptions } from "./search-select";

const options = [
  { id: "1", label: "Adebayo Samuel", detail: "Box 2 Box FC (Coal City Scouting Tournament)" },
  { id: "2", label: "Samuel Adebayo Junior", detail: "Ablaze FC (United Football Championship League)" },
  { id: "3", label: "SAMUEL ADEBAYO", detail: "Master player profile" },
  { id: "4", label: "Chukwuemeka Obi", detail: "Box 2 Box FC (Coal City Scouting Tournament)" },
  { id: "5", label: "Ọlá Adébáyọ̀", detail: "Jumez International FC" },
];

describe("filterSearchOptions", () => {
  it("matches every typed word in any order, ignoring case", () => {
    expect(filterSearchOptions(options, "samuel adebayo").map((o) => o.id)).toEqual(["3", "2", "1"]);
  });

  it("puts an exact name first, then names that start with the query", () => {
    expect(filterSearchOptions(options, "Samuel Adebayo")[0].id).toBe("3");
    expect(filterSearchOptions(options, "samuel ad").map((o) => o.id)).toEqual(["2", "3", "1"]);
  });

  it("searches the club and competition as well as the name", () => {
    expect(filterSearchOptions(options, "obi box").map((o) => o.id)).toEqual(["4"]);
    expect(filterSearchOptions(options, "coal city").map((o) => o.id)).toEqual(["1", "4"]);
  });

  it("ignores accents, punctuation and spacing", () => {
    expect(filterSearchOptions(options, "ola adebayo").map((o) => o.id)).toEqual(["5"]);
    expect(filterSearchOptions(options, "box2box").map((o) => o.id)).toEqual(["1", "4"]);
    expect(filterSearchOptions(options, "box-2-box").map((o) => o.id)).toEqual(["1", "4"]);
  });

  it("returns the first options unchanged for an empty query, up to the limit", () => {
    expect(filterSearchOptions(options, "  ", 2).map((o) => o.id)).toEqual(["1", "2"]);
    expect(filterSearchOptions(options, "zzz")).toEqual([]);
  });
});
