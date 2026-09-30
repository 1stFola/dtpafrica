import { describe, expect, it } from "vitest";
import { namesAPerson, playerDisplayName, shirtNumberFromLabel } from "./player-display-name";

/**
 * Every label here is one the API actually stores, taken from the live timeline sync
 * rather than invented.
 */
describe("the name to show for a stored label", () => {
  it("drops the shirt number the API stores in front of the name", () => {
    expect(playerDisplayName("No. 11 EBULU EMMANUEL")).toBe("EBULU EMMANUEL");
    expect(playerDisplayName("No. 8 OLAIYA FARUK")).toBe("OLAIYA FARUK");
    expect(playerDisplayName("No. 13 Olatunde Qudus")).toBe("Olatunde Qudus");
  });

  it("handles the other spellings the importers write", () => {
    expect(playerDisplayName("no 7 Ogundeji Elijah")).toBe("Ogundeji Elijah");
    expect(playerDisplayName("#10 Wasiu Yayah")).toBe("Wasiu Yayah");
    expect(playerDisplayName("NO.9 Biola Olajide")).toBe("Biola Olajide");
  });

  it("leaves a name that never had a number", () => {
    expect(playerDisplayName("Nwosu Henry")).toBe("Nwosu Henry");
  });

  it("keeps a bare number rather than emptying the label", () => {
    /* `No. 12` means the number resolved to nobody. It says what was known, and
       returning an empty string would drop the event's only description of who was
       involved. The caller decides whether to show it. */
    expect(playerDisplayName("No. 12")).toBe("No. 12");
    expect(playerDisplayName("#7")).toBe("#7");
  });

  it("returns null for nothing", () => {
    expect(playerDisplayName(null)).toBeNull();
    expect(playerDisplayName(undefined)).toBeNull();
    expect(playerDisplayName("   ")).toBeNull();
  });

  it("does not eat a number that belongs to the name", () => {
    /* `Ayila No.7` has the number at the end, and `Team360 FC` has one inside a word.
       Neither is a prefix and neither should be touched. */
    expect(playerDisplayName("Ayila No.7")).toBe("Ayila No.7");
    expect(playerDisplayName("Team360 FC")).toBe("Team360 FC");
  });

  it("does not mistake a name beginning with No for a number", () => {
    expect(playerDisplayName("Noah Idris")).toBe("Noah Idris");
    expect(playerDisplayName("Nonso")).toBe("Nonso");
  });

  it("trims", () => {
    expect(playerDisplayName("  No. 11  EBULU EMMANUEL ")).toBe("EBULU EMMANUEL");
  });
});

describe("reading the shirt number back out", () => {
  it("returns the number when the label carries one", () => {
    expect(shirtNumberFromLabel("No. 11 EBULU EMMANUEL")).toBe(11);
    expect(shirtNumberFromLabel("#7 Ogundeji Elijah")).toBe(7);
  });

  it("returns null when there is none to read", () => {
    expect(shirtNumberFromLabel("Nwosu Henry")).toBeNull();
    expect(shirtNumberFromLabel("No. 12")).toBeNull();
    expect(shirtNumberFromLabel(null)).toBeNull();
  });
});

/**
 * Which labels may become a link. Every string here is one the live database holds, from
 * the breakdown of the 88 goals whose label resolved to no player.
 */
describe("whether a label names a person", () => {
  it("accepts the names of people", () => {
    expect(namesAPerson("Farouk Salami")).toBe(true);
    expect(namesAPerson("No. 11 EBULU EMMANUEL")).toBe(true);
    expect(namesAPerson("Idowu Babatunde Morakinyo")).toBe(true);
    /* One word, and a real person — this rule says it is a name. Whether a single name is
       linked is the timeline's own two-word rule, which is a different question. */
    expect(namesAPerson("Christopher")).toBe(true);
  });

  it("refuses a bare shirt number, which used to link to /player/no-20", () => {
    expect(namesAPerson("No. 20")).toBe(false);
    expect(namesAPerson("No. 4")).toBe(false);
    expect(namesAPerson("No 36")).toBe(false);
    expect(namesAPerson("#7")).toBe(false);
    expect(namesAPerson("20")).toBe(false);
  });

  it("refuses the words a recorder writes when nobody was caught", () => {
    expect(namesAPerson("Unknown")).toBe(false);
    expect(namesAPerson("unknown")).toBe(false);
    expect(namesAPerson("Player")).toBe(false);
    expect(namesAPerson("Player 1")).toBe(false);
    expect(namesAPerson("Player 2")).toBe(false);
  });

  it("refuses a jersey placeholder, whose number is not at the front", () => {
    expect(namesAPerson("Jersey No. 35")).toBe(false);
    expect(namesAPerson("Jersey No. 6")).toBe(false);
  });

  it("refuses nothing at all", () => {
    expect(namesAPerson(null)).toBe(false);
    expect(namesAPerson(undefined)).toBe(false);
    expect(namesAPerson("   ")).toBe(false);
  });
});
