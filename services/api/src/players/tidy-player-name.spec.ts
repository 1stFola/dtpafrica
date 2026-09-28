import { playerLookupKey } from "@dtp/engines";
import { describe, expect, it } from "vitest";
import { isPlaceholderName } from "./placeholder-names";
import {
  REVIEWED_CORRECTIONS,
  hasDigit,
  tidyPlayerName,
  titleCaseShoutedName,
  tokenCorrections,
} from "./tidy-player-name";

/**
 * Tidying a name without changing whose it is.
 *
 * The risk in this file is not that a shouted name stays shouted — someone would
 * notice. It is that a rule meant for `NWOSU HENRY` reaches `McDonald` and quietly
 * rewrites a name whose casing was deliberate. Most of these tests are about names
 * the rule must refuse to touch.
 */

describe("names written entirely in capitals", () => {
  it("title-cases the four found on live", () => {
    expect(titleCaseShoutedName("NWOSU HENRY")).toBe("Nwosu Henry");
    expect(titleCaseShoutedName("YUSUF TAIWO AKANBI")).toBe("Yusuf Taiwo Akanbi");
    expect(titleCaseShoutedName("JOEL EMMANUEL")).toBe("Joel Emmanuel");
    expect(titleCaseShoutedName("OGUNDEJI ELIJAH")).toBe("Ogundeji Elijah");
  });

  it("keeps the capital after an apostrophe", () => {
    // `O'brien` would be a new spelling mistake in place of the old one.
    expect(titleCaseShoutedName("O'BRIEN MICHAEL")).toBe("O'Brien Michael");
    expect(titleCaseShoutedName("D'ANGELO")).toBe("D'Angelo");
  });

  it("keeps the capital after a hyphen", () => {
    expect(titleCaseShoutedName("ADE-BOLA SEGUN")).toBe("Ade-Bola Segun");
  });

  it("leaves initials as initials", () => {
    /* `J.j. Okocha` is the naive result and is obviously wrong. Letter runs are what
       makes this work: the period ends the run. */
    expect(titleCaseShoutedName("J.J. OKOCHA")).toBe("J.J. Okocha");
    expect(titleCaseShoutedName("A B ADEYEMI")).toBe("A B Adeyemi");
  });

  it("does not turn a numeric suffix into a word", () => {
    expect(titleCaseShoutedName("JOHN OKAFOR III")).toBe("John Okafor III");
    expect(titleCaseShoutedName("SAMUEL ADE II")).toBe("Samuel Ade II");
  });

  it("title-cases a lone V or X, which is an initial far more often than a fifth", () => {
    expect(titleCaseShoutedName("MUSA X")).toBe("Musa X");
    expect(titleCaseShoutedName("MUSA V")).toBe("Musa V");
  });

  it("only treats a numeric suffix as one in final position", () => {
    // `IV` opening a name is not a suffix, whatever else it is.
    expect(titleCaseShoutedName("IV SOMETHING")).toBe("Iv Something");
  });
});

describe("names it must refuse to touch", () => {
  it("leaves a name that already has lowercase in it", () => {
    /* The whole safety of the rule. One lowercase letter anywhere means somebody
       chose the casing, and this has no business overruling them. */
    for (const name of ["McDonald Peter", "O'Brien Michael", "de Souza Carlos", "van Dijk"]) {
      expect(titleCaseShoutedName(name)).toBe(name);
    }
  });

  it("leaves an ordinary name alone", () => {
    expect(titleCaseShoutedName("Nwosu Henry")).toBe("Nwosu Henry");
  });

  it("leaves a name with no letters at all", () => {
    expect(titleCaseShoutedName("123")).toBe("123");
    expect(titleCaseShoutedName("")).toBe("");
  });

  it("does not reorder a name", () => {
    /* Which part is the surname is a fact about the person, not something to infer.
       Nigerian records commonly put it first, and a tool that swapped them would be
       wrong at scale and hard to undo. */
    expect(tidyPlayerName("NWOSU HENRY")).toBe("Nwosu Henry");
    expect(tidyPlayerName("NWOSU HENRY")).not.toBe("Henry Nwosu");
  });
});

describe("whitespace", () => {
  it("collapses the double space found on live", () => {
    expect(tidyPlayerName("Daniel  Matthew")).toBe("Daniel Matthew");
  });

  it("trims", () => {
    expect(tidyPlayerName("  Biola Olajide ")).toBe("Biola Olajide");
  });

  it("collapses whitespace and casing in the same pass", () => {
    expect(tidyPlayerName("WASIU   YAYAH")).toBe("Wasiu Yayah");
  });
});

describe("misspellings nobody can derive", () => {
  it("applies the reviewed correction", () => {
    expect(tidyPlayerName("Emmanuel Jac9b")).toBe("Emmanuel Jacob");
  });

  it("matches a correction after whitespace has been tidied, not before", () => {
    /* Otherwise a stored name with a stray double space would slip past the entry
       written for it. */
    expect(tidyPlayerName("Emmanuel  Jac9b")).toBe("Emmanuel Jacob");
  });

  it("does not re-case a correction, which is written as it should read", () => {
    // A correction that came out title-cased would undo any deliberate casing in it.
    expect(tidyPlayerName("Emmanuel Jac9b")).not.toBe("Emmanuel Jacob".toUpperCase());
  });

  it("spots a digit in a name, which is how the next one gets found", () => {
    expect(hasDigit("Emmanuel Jac9b")).toBe(true);
    expect(hasDigit("Nwosu Henry")).toBe(false);
  });
});

describe("the reviewed corrections themselves", () => {
  it("every entry actually changes the name", () => {
    // An entry that maps a name to itself is a leftover, and hides that it did nothing.
    for (const [from, to] of Object.entries(REVIEWED_CORRECTIONS)) {
      expect(to).not.toBe(from);
    }
  });

  it("no entry produces a name the platform would reject as a placeholder", () => {
    for (const to of Object.values(REVIEWED_CORRECTIONS)) {
      expect(isPlaceholderName(to)).toBe(false);
    }
  });

  it("every key is already whitespace-tidy, so it can be matched", () => {
    /* `tidyPlayerName` looks the key up *after* collapsing whitespace. A key with a
       double space in it could therefore never match anything. */
    for (const from of Object.keys(REVIEWED_CORRECTIONS)) {
      expect(from).toBe(from.trim().replace(/\s+/g, " "));
    }
  });

  it("no entry is a change of casing only, which the casing rule should own", () => {
    for (const [from, to] of Object.entries(REVIEWED_CORRECTIONS)) {
      expect(to.toLowerCase()).not.toBe(from.toLowerCase());
    }
  });
});

describe("what tidying does to the dedupe key", () => {
  it("leaves the key untouched for casing and whitespace", () => {
    /* Why these are the safe fixes: the key already ignores both, so no record can
       collide with another because of one, and nothing has to be checked first. */
    for (const name of ["NWOSU HENRY", "Daniel  Matthew", "  Biola Olajide "]) {
      expect(playerLookupKey(tidyPlayerName(name))).toBe(playerLookupKey(name));
    }
  });

  it("moves the key for a misspelling, which is why the caller must check first", () => {
    /* `emmanuel jac9b` becomes `emmanuel jacob`, and if another record already holds
       that key the write fails on the unique index. The script reports the clash
       rather than meeting it as a constraint violation. */
    expect(playerLookupKey(tidyPlayerName("Emmanuel Jac9b"))).not.toBe(
      playerLookupKey("Emmanuel Jac9b")
    );
    expect(playerLookupKey(tidyPlayerName("Emmanuel Jac9b"))).toBe("emmanuel jacob");
  });
});

describe("carrying a correction into firstName and lastName", () => {
  it("names the token that changed", () => {
    const map = tokenCorrections("Emmanuel Jac9b", "Emmanuel Jacob");
    expect([...map]).toEqual([["Jac9b", "Jacob"]]);
  });

  it("says nothing about tokens that did not change", () => {
    // Otherwise every unchanged word would be rewritten to itself for no reason.
    expect(tokenCorrections("Emmanuel Jac9b", "Emmanuel Jacob").has("Emmanuel")).toBe(false);
  });

  it("declines when the word count changes", () => {
    /* A correction that adds or drops a word cannot be lined up token by token, and
       guessing which became which is the inference this module exists to avoid. */
    expect(tokenCorrections("Emmanuel Jac9b", "Emmanuel Jacob Okoro").size).toBe(0);
    expect(tokenCorrections("Emmanuel Jac9b Extra", "Emmanuel Jacob").size).toBe(0);
  });

  it("returns an empty map for an unchanged name", () => {
    expect(tokenCorrections("Nwosu Henry", "Nwosu Henry").size).toBe(0);
  });

  it("handles several changed tokens at once", () => {
    const map = tokenCorrections("Ab1 Cd2", "Abi Cdo");
    expect([...map]).toEqual([
      ["Ab1", "Abi"],
      ["Cd2", "Cdo"],
    ]);
  });

  it("covers every reviewed correction, so none is left half-applied", () => {
    /* If a correction ever changes the word count, this is where it shows up, and the
       script falls back to re-casing those two fields without respelling them. */
    for (const [from, to] of Object.entries(REVIEWED_CORRECTIONS)) {
      expect(tokenCorrections(from, to).size).toBeGreaterThan(0);
    }
  });
});
