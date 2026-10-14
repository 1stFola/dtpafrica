import { describe, expect, it } from "vitest";
import { readCompetitionDescription, writeCompetitionDescription } from "./competition-featured";

describe("competition description and the featured token", () => {
  it("reads the token as a flag and hides it from the text", () => {
    expect(readCompetitionDescription("[featured]")).toEqual({ text: "", featured: true });
    expect(readCompetitionDescription("A cup in Lagos. [featured]")).toEqual({
      text: "A cup in Lagos.",
      featured: true,
    });
    expect(readCompetitionDescription(null)).toEqual({ text: "", featured: false });
  });

  it("keeps the flag through an edit of the text, and drops it only when asked", () => {
    const stored = writeCompetitionDescription("New words", true);
    expect(stored).toBe("New words [featured]");
    expect(readCompetitionDescription(stored)).toEqual({ text: "New words", featured: true });
    expect(writeCompetitionDescription("New words", false)).toBe("New words");
    expect(writeCompetitionDescription("", false)).toBeNull();
    expect(writeCompetitionDescription("", true)).toBe("[featured]");
  });

  it("does not let a token typed into the text stack up", () => {
    expect(writeCompetitionDescription("Words [featured]", true)).toBe("Words [featured]");
    expect(writeCompetitionDescription("Words [FEATURED]", false)).toBe("Words");
  });
});
