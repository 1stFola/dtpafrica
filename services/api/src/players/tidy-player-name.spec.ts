import { playerLookupKey } from "@dtp/engines";
import { describe, expect, it } from "vitest";
import { isPlaceholderName } from "./placeholder-names";
import {
  REVIEWED_CORRECTIONS,
  hasDigit,
  tidyPlayerName,
  looksLikeATeam,
  restoreClubMarkers,
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

describe("records that are not a person, taken from the live directory", () => {
  /* Every string here is one the live dry run printed. The first version of this
     module title-cased `VIDO 99 FC` into `Vido 99 Fc` -- a rule written for
     `NWOSU HENRY` damaging a name it had no business touching. Guessed examples
     would not have caught that; the report did. */

  it("does not lowercase FC into a word", () => {
    expect(tidyPlayerName("VIDO 99 FC")).toBe("VIDO 99 FC");
    expect(tidyPlayerName("VIDO 99 FC")).not.toBe("Vido 99 Fc");
  });

  it("recognises a club marker wherever it sits", () => {
    expect(looksLikeATeam("VIDO 99 FC")).toBe(true);
    expect(looksLikeATeam("FC Ogunlade")).toBe(true);
    expect(looksLikeATeam("WIKKI TOURISTS AFC")).toBe(true);
    expect(looksLikeATeam("Nwosu Henry")).toBe(false);
  });

  it("leaves a shouting team name alone rather than prettifying it", () => {
    /* No digit to catch it, so the club marker is what does. A team in the player
       directory is a record to look at, not to tidy. */
    expect(tidyPlayerName("WIKKI TOURISTS FC")).toBe("WIKKI TOURISTS FC");
  });

  it("leaves a jersey number alone", () => {
    for (const name of ["Jersey No. 35", "Jersey No. 6", "Ayila No.7", "FC Ogunlade No. 15"]) {
      expect(tidyPlayerName(name)).toBe(name);
    }
  });

  it("leaves a name carrying a shirt number in brackets alone", () => {
    expect(tidyPlayerName("Ademola James (19)")).toBe("Ademola James (19)");
  });

  it("leaves a field holding several people alone", () => {
    /* One live record's entire name. Five players in one field is a data-entry
       fault, and re-casing it would make it look deliberate. */
    const many = "Papi Emeka (10), Benjamin Aga (14), Paul Otto (13)";
    expect(tidyPlayerName(many)).toBe(many);
    expect(tidyPlayerName("Abdullah Shaubu (7) & Adebayo David (17)")).toBe(
      "Abdullah Shaubu (7) & Adebayo David (17)"
    );
  });

  it("still applies a reviewed correction to a name with a digit in it", () => {
    /* Otherwise the digit rule would block the one typo we actually know how to fix. */
    expect(tidyPlayerName("Emmanuel Jac9b")).toBe("Emmanuel Jacob");
  });

  it("still collapses whitespace in a name it declines to re-case", () => {
    // Safe whatever the record turns out to be, and it costs nothing to leave tidy.
    expect(tidyPlayerName("Jersey  No. 35")).toBe("Jersey No. 35");
  });
});

describe("repairing a club marker an earlier run lowercased", () => {
  /* This is damage in the live directory, not a hypothetical. An earlier version of
     this module title-cased `VIDO 99 FC` into `Vido 99 Fc` and that ran on live
     before the guard existed. Neither rule finds it again -- the digit rule skips it,
     the casing rule ignores a name with lowercase in it -- so it needed its own
     repair or it would simply have stayed. */

  it("puts the marker back into capitals", () => {
    expect(restoreClubMarkers("Vido 99 Fc")).toBe("Vido 99 FC");
    expect(restoreClubMarkers("Wikki Tourists Afc")).toBe("Wikki Tourists AFC");
    expect(restoreClubMarkers("Remo Stars Sc")).toBe("Remo Stars SC");
  });

  it("repairs the live record through tidyPlayerName", () => {
    expect(tidyPlayerName("Vido 99 Fc")).toBe("Vido 99 FC");
  });

  it("repairs a mangled team name that has no digit to catch it", () => {
    /* The ones I cannot see in the live report: an all-capitals team name without a
       digit was tidied into `... Fc` and sits among the 543 renames indistinguishable
       from a person. This is what finds them. */
    expect(tidyPlayerName("Wikki Tourists Fc")).toBe("Wikki Tourists FC");
  });

  it("does not pretend to restore the original capitals", () => {
    /* Nothing recorded that it used to be `VIDO 99 FC`, and the denormalised copies
       were realigned to the mangled spelling in the same run, so there is nowhere to
       read it from. The marker is the part that was wrong and the part that is fixed. */
    expect(tidyPlayerName("Vido 99 Fc")).not.toBe("VIDO 99 FC");
  });

  it("leaves an untouched team name exactly as it is", () => {
    expect(tidyPlayerName("VIDO 99 FC")).toBe("VIDO 99 FC");
    expect(tidyPlayerName("WIKKI TOURISTS FC")).toBe("WIKKI TOURISTS FC");
  });

  it("leaves a person's name alone, having no marker in it", () => {
    for (const name of ["Nwosu Henry", "Emmanuel Jacob", "Al-Hassan Isaiku"]) {
      expect(restoreClubMarkers(name)).toBe(name);
    }
  });

  it("is idempotent, so a second run finds nothing", () => {
    const once = tidyPlayerName("Vido 99 Fc");
    expect(tidyPlayerName(once)).toBe(once);
  });
});

describe("a shirt number in front of a player record's name", () => {
  /* These are Player records in the live directory, not event labels. A path that only
     refused a bare number let `No. 8 OLAIYA FARUK` become a person, and the number
     followed him into `/player/no-8-olaiya-faruk`. Every name here is from the
     DYNAMIC FC v HIGHKLASS SA fixture. */

  it("takes the number off and tidies what is left", () => {
    expect(tidyPlayerName("No. 11 EBULU EMMANUEL")).toBe("Ebulu Emmanuel");
    expect(tidyPlayerName("No. 8 OLAIYA FARUK")).toBe("Olaiya Faruk");
    expect(tidyPlayerName("No. 1 ASUQUO GIDEON")).toBe("Asuquo Gideon");
    expect(tidyPlayerName("No. 16 NNANA SAMSON")).toBe("Nnana Samson");
  });

  it("handles the other spellings and leaves good casing alone", () => {
    expect(tidyPlayerName("#10 Wasiu Yayah")).toBe("Wasiu Yayah");
    expect(tidyPlayerName("no 7 Ogundeji Elijah")).toBe("Ogundeji Elijah");
  });

  it("still leaves the shapes the digit rule exists for", () => {
    /* The number is only stripped when it *leads*. These begin with a word, carry the
       number at the end, or have no name behind it at all. */
    for (const name of ["Jersey No. 35", "FC Ogunlade No. 15", "Ayila No.7", "No. 12", "Team360 FC"]) {
      expect(tidyPlayerName(name)).toBe(name);
    }
  });

  it("does not strip from a name that merely starts with No", () => {
    expect(tidyPlayerName("Noah Idris")).toBe("Noah Idris");
  });

  it("leaves a club alone even behind a number", () => {
    /* `No. 15 FC OGUNLADE` would strip to a team name, and a team is still not a
       person -- the club check must run on what is left, not on the original. */
    expect(tidyPlayerName("No. 15 FC OGUNLADE")).toBe("FC OGUNLADE");
  });

  it("moves the dedupe key, which is why the caller must check for a clash", () => {
    /* `no. 11 ebulu emmanuel` becomes `ebulu emmanuel`, and if a real record already
       holds that key these are two records for one person. */
    expect(playerLookupKey(tidyPlayerName("No. 11 EBULU EMMANUEL"))).toBe("ebulu emmanuel");
    expect(playerLookupKey(tidyPlayerName("No. 11 EBULU EMMANUEL"))).not.toBe(
      playerLookupKey("No. 11 EBULU EMMANUEL")
    );
  });
});
