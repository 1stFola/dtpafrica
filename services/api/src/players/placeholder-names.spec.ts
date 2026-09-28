import { describe, expect, it } from "vitest";
import { isPlaceholderName } from "./placeholder-names";

/**
 * Which names are not people.
 *
 * Both directions matter and for different reasons. Letting a placeholder through
 * puts a phantom in the scoring charts — `Player` is currently second in the Ex
 * Internationals Cup. Catching a real name refuses a real player, which is worse,
 * so the negative cases are the ones to be careful about.
 */

describe("names that stand in for a person", () => {
  it("catches the words people write when they do not know", () => {
    for (const n of [
      "Unknown",
      "unknown",
      "UNKNOWN PLAYER",
      "Player",
      "Goalkeeper",
      "Keeper",
      "GK",
      "Own Goal",
      "Opponent",
      "Substitute",
      "Trialist",
      "N/A",
      "TBC",
    ]) {
      expect(isPlaceholderName(n), n).toBe(true);
    }
  });

  it("catches a shirt number however it is written", () => {
    for (const n of ["No. 9", "No.9", "no 9", "NO. 11", "#7", "7", "23"]) {
      expect(isPlaceholderName(n), n).toBe(true);
    }
  });

  it("catches a numbered stand-in", () => {
    expect(isPlaceholderName("Player 3")).toBe(true);
    expect(isPlaceholderName("GK 1")).toBe(true);
  });

  it("treats an empty or punctuation-only name as one", () => {
    expect(isPlaceholderName("")).toBe(true);
    expect(isPlaceholderName("   ")).toBe(true);
    expect(isPlaceholderName("...")).toBe(true);
    expect(isPlaceholderName(null)).toBe(true);
    expect(isPlaceholderName(undefined)).toBe(true);
  });
});

describe("names that are people", () => {
  it("lets real names through", () => {
    /* The costly mistake. Refusing one of these turns a player into a placeholder,
       which is worse than the problem being solved. */
    for (const n of [
      "Wasiu Yayah",
      "Onyedigbo Daniel",
      "Ijeh Solomon",
      "Esther Oyenezide",
      "Chibueze Moemeke",
      "Uma Bartholomew",
      "Nwabueze Onyebuchi",
      "Toyosi Sanni A.",
      "Collins. Kadiri",
      "Olasunkanmi A. Dayo",
    ]) {
      expect(isPlaceholderName(n), n).toBe(false);
    }
  });

  it("does not refuse a name that merely contains a placeholder word", () => {
    // `Player` alone is a stand-in; `Player Okonkwo` is somebody's name.
    expect(isPlaceholderName("Player Okonkwo")).toBe(false);
    expect(isPlaceholderName("Goodluck Unknownson")).toBe(false);
    expect(isPlaceholderName("Nnamdi Keeper")).toBe(false);
  });

  it("does not refuse a name that ends in a number", () => {
    // A squad list can legitimately disambiguate two people this way.
    expect(isPlaceholderName("Ade Bola 2")).toBe(false);
  });

  it("does not refuse a single-word real name", () => {
    /* Plenty of the live data is one word — `Solomon`, `Jackson`. Ambiguous, but a
       person, and the duplicate report is where that gets sorted out. */
    expect(isPlaceholderName("Solomon")).toBe(false);
    expect(isPlaceholderName("Nonso")).toBe(false);
  });
});
