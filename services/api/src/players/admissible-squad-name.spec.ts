import { describe, expect, it } from "vitest";
import { admitSquadName, stripNumberPrefix } from "./admissible-squad-name";

/**
 * The gate in front of a write that creates people.
 *
 * Almost every test here is a refusal, and every refused string is one that is in the
 * live directory *because* an earlier path had no gate. Letting one through creates a
 * public record that collects goals and that somebody has to find and merge later;
 * refusing a real name costs a line in a report. The asymmetry is the whole design.
 */

describe("names that may become a squad row", () => {
  it("admits an ordinary name", () => {
    expect(admitSquadName("Ogundeji Elijah")).toEqual({ ok: true, name: "Ogundeji Elijah" });
  });

  it("admits a single name, which is often all a recorder writes", () => {
    /* `Daniel` is a real person recorded briefly. It is ambiguous, but ambiguity is
       settled by the squad lookup later, not by refusing to record the person. */
    expect(admitSquadName("Daniel")).toMatchObject({ ok: true, name: "Daniel" });
  });

  it("takes the name out from behind the shirt number", () => {
    // `No. 7 Ogundeji Elijah` is what the timeline stores once a number resolved.
    expect(admitSquadName("No. 7 Ogundeji Elijah")).toEqual({ ok: true, name: "Ogundeji Elijah" });
    expect(admitSquadName("#10 Wasiu Yayah")).toEqual({ ok: true, name: "Wasiu Yayah" });
  });

  it("tidies whitespace on the way through", () => {
    expect(admitSquadName("  Biola   Olajide ")).toEqual({ ok: true, name: "Biola Olajide" });
  });

  it("admits a hyphenated or apostrophised name", () => {
    expect(admitSquadName("Al-Hassan Isaiku")).toMatchObject({ ok: true });
    expect(admitSquadName("O'Brien Michael")).toMatchObject({ ok: true });
  });
});

describe("names that must never become a person", () => {
  it("refuses the placeholders that are already in the directory", () => {
    /* `Player` sat second in the Ex Internationals Cup with five goals. Second place in
       that competition was nobody. */
    for (const label of ["Unknown", "Player", "Player 1", "Goalkeeper", "N/A", "TBC"]) {
      expect(admitSquadName(label)).toMatchObject({ ok: false, reason: "placeholder" });
    }
  });

  it("refuses a bare shirt number, however it is written", () => {
    for (const label of ["No. 9", "no9", "#7", "7"]) {
      expect(admitSquadName(label).ok).toBe(false);
    }
  });

  it("refuses the jersey labels found on live", () => {
    // 15 of these are in the player directory today, created by a path with no gate.
    for (const label of ["Jersey No. 35", "Jersey No. 6", "Ayila No.7"]) {
      expect(admitSquadName(label).ok).toBe(false);
    }
  });

  it("refuses a club", () => {
    for (const label of ["VIDO 99 FC", "Team360 FC", "FC Babington", "Diadem Stallion SC"]) {
      expect(admitSquadName(label).ok).toBe(false);
    }
    expect(admitSquadName("FC Babington")).toMatchObject({ reason: "team" });
  });

  it("refuses a field holding several people", () => {
    /* Two live records between them hold seven players. Splitting one and creating each
       would be a guess about where a name ends. */
    expect(admitSquadName("Abdullah Shaubu (7) & Adebayo David (17)")).toMatchObject({
      ok: false,
      reason: "several-people",
    });
    expect(
      admitSquadName("Papi Emeka (10), Benjamin Aga (14), Paul Otto (13)")
    ).toMatchObject({ ok: false, reason: "several-people" });
    expect(admitSquadName("Ade Bola / Segun Okoye")).toMatchObject({ reason: "several-people" });
    expect(admitSquadName("Ade Bola and Segun Okoye")).toMatchObject({ reason: "several-people" });
  });

  it("refuses a real name that carries a digit, and says why", () => {
    /* `Ademola James (19)` is a person, and this still declines. The same rule has to
       handle `Jersey No. 35`, and a rule that tries to tell those apart is one that will
       eventually get one of them wrong. Reported for a human instead. */
    expect(admitSquadName("Ademola James (19)")).toMatchObject({
      ok: false,
      reason: "carries-a-digit",
    });
  });

  it("refuses empty, blank and punctuation-only labels", () => {
    for (const label of ["", "   ", "...", "-", null, undefined]) {
      expect(admitSquadName(label).ok).toBe(false);
    }
  });

  it("refuses a label that is only a number prefix with nothing behind it", () => {
    // Stripping the prefix must not turn `No. 7` into an empty admissible name.
    expect(admitSquadName("No. 7").ok).toBe(false);
  });

  it("reports the cleaned name alongside the refusal, so a report can show it", () => {
    const verdict = admitSquadName("  Jersey  No. 35 ");
    expect(verdict.ok).toBe(false);
    expect(verdict.name).toBe("Jersey No. 35");
  });
});

describe("stripping the number prefix", () => {
  it("removes the forms the timeline writes", () => {
    expect(stripNumberPrefix("No. 7 Ogundeji Elijah")).toBe("Ogundeji Elijah");
    expect(stripNumberPrefix("no 7 Ogundeji Elijah")).toBe("Ogundeji Elijah");
    expect(stripNumberPrefix("#7 Ogundeji Elijah")).toBe("Ogundeji Elijah");
  });

  it("leaves a name that merely starts with a word alone", () => {
    expect(stripNumberPrefix("Nosa Emmanuel")).toBe("Nosa Emmanuel");
  });

  it("does not strip a number that is part of the name", () => {
    /* `Ayila No.7` has no space after the number, so there is no name behind it to
       take. Leaving it whole is what gets it refused rather than silently emptied. */
    expect(stripNumberPrefix("Ayila No.7")).toBe("Ayila No.7");
  });

  it("leaves a bare number alone, so it stays refusable", () => {
    expect(stripNumberPrefix("No. 7")).toBe("No. 7");
  });
});

describe("a label holding several people, by any separator", () => {
  /* The separator list was written from the ones I had seen, which is how a semicolon got
     through. Every string here is a list of people in one box. */
  it("refuses the separators the live labels use", () => {
    for (const label of [
      "Sodiq Adebowale, Sangotoki Enoch",
      "Abdullah Shaubu (7) & Adebayo David (17)",
      "Clement Ogwu / Inya Kelechi",
      "Albert Felix and Abdul Nasir",
    ]) {
      expect(admitSquadName(label).ok).toBe(false);
    }
  });

  it("refuses a semicolon, which the live timeline actually holds", () => {
    /* `Labi Akinola; Adesanya David` at FC OMORUYI was queued to become one player record
       holding two people — both of whom the directory already had, so it would have split
       their goals a third way. */
    const verdict = admitSquadName("Labi Akinola; Adesanya David");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toBe("several-people");
  });

  it("refuses a plus and a pipe, which cannot be inside anybody's name", () => {
    expect(admitSquadName("Labi Akinola + Adesanya David").ok).toBe(false);
    expect(admitSquadName("Labi Akinola | Adesanya David").ok).toBe(false);
  });

  it("does not read a hyphenated or apostrophed name as a list", () => {
    /* `Alli-Balogun Abdullateef` and `Taiwo Oshunubi-Taofeek` are single people, and both
       are in the live data. */
    expect(admitSquadName("Alli-Balogun Abdullateef").ok).toBe(true);
    expect(admitSquadName("Nnamdi O'Brien").ok).toBe(true);
  });
});

describe("a name reduced to initials", () => {
  it("refuses a first name that is only an initial", () => {
    /* Nineteen of these are queued on live: `I. Attah`, `A. Great`, `S. David`. A record
       made from one cannot be told apart from the next `A. Great` at the same club, and it
       collects goals under an identity nobody can confirm. */
    for (const label of ["I. Attah", "A. Great", "S. David", "O. Bethel", "C. Udoye"]) {
      const verdict = admitSquadName(label);
      expect(verdict.ok).toBe(false);
      expect(verdict.ok === false && verdict.reason).toBe("initials-only");
    }
  });

  it("refuses an initial with no dot after it", () => {
    expect(admitSquadName("I Attah").ok).toBe(false);
  });

  it("refuses a surname reduced to an initial", () => {
    /* The mirror image, and the same loss: the platform matches people on the first word
       and the last. */
    expect(admitSquadName("Samuel A.").ok).toBe(false);
  });

  it("accepts a middle initial, which leaves both ends known", () => {
    /* `Chidi O Nwosu` is a whole name. Refusing every name with an initial anywhere in it
       would turn a naming convention into a rejection. */
    expect(admitSquadName("Chidi O Nwosu").ok).toBe(true);
    expect(admitSquadName("Idowu Babatunde Morakinyo").ok).toBe(true);
  });

  it("accepts a full given name that happens to carry a dot", () => {
    /* `Lekan. James` is in the live directory. A trailing dot is a typo, not an initial,
       which is why the test is the length of the word rather than the dot. */
    expect(admitSquadName("Lekan. James").ok).toBe(true);
  });

  it("refuses a label that is one letter and nothing else", () => {
    /* `A` was accepted before this rule existed. One word or two, a bare initial names
       nobody -- and the same test answers both, so there is no second rule to disagree
       with the first. */
    expect(admitSquadName("A").ok).toBe(false);
    expect(admitSquadName("A.").ok).toBe(false);
  });

  it("leaves a single-word name to the rest of the gate", () => {
    /* `Feranmi` is a one-word label, which Name QA flags for completion. It is not this
       rule's business, and reading it as an initial would refuse half the timeline. */
    expect(admitSquadName("Feranmi").ok).toBe(true);
  });

  it("reports the digit first when a label has both problems", () => {
    /* `A. Great (7)` — the number is the part a recorder can fix at the console, so that is
       the reason worth printing. */
    const verdict = admitSquadName("A. Great (7)");
    expect(verdict.ok === false && verdict.reason).toBe("carries-a-digit");
  });
});
