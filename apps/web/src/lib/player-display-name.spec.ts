import { describe, expect, it } from "vitest";
import { playerDisplayName, shirtNumberFromLabel } from "./player-display-name";

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
