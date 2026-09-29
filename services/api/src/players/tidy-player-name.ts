/**
 * Tidying a display name that is spelled badly but belongs to the right person.
 *
 * Separate from `placeholder-names.ts`, which decides whether a name is a person at
 * all. Everything here is about presentation: `NWOSU HENRY` is the correct person
 * under a name that shouts, `Daniel  Matthew` has two spaces where one belongs.
 * Nobody's identity is in question and no record is going anywhere.
 *
 * Two of the three rules are mechanical and one cannot be:
 *
 *   - **Whitespace** is `normalizePlayerName`, reused rather than restated. It
 *     already trims, collapses runs of spaces and strips zero-width characters.
 *   - **Shouting** is title case, and only for a name with *no* lowercase letter
 *     anywhere. That restraint is the whole safety of it: `McDonald`, `O'Brien` and
 *     `de Souza` all contain lowercase, so they are never touched. A rule that
 *     re-cased every name would flatten exactly the names whose casing is
 *     deliberate.
 *   - **A misspelling** cannot be derived from anything. `Emmanuel Jac9b` is
 *     `Jacob` with a 9 where the o belongs, and no rule can know that. Those live
 *     in `REVIEWED_CORRECTIONS` below, one line each, and a human put them there.
 *
 * What this deliberately does not do is reorder names. `NWOSU HENRY` becomes
 * `Nwosu Henry` and not `Henry Nwosu`: which part is the surname is a fact about the
 * person, Nigerian records commonly put it first, and guessing would produce
 * confident nonsense at scale. Casing is safe to infer. Order is not.
 *
 * Note that tidying casing or whitespace does **not** move a player's dedupe key:
 * `playerLookupKey` lowercases and collapses whitespace before comparing, so
 * `Daniel  Matthew` and `Daniel Matthew` already share one. Correcting a misspelling
 * *does* move it, and can therefore collide with a record that already holds the
 * corrected key — which the caller has to check for rather than discover from a
 * constraint violation.
 */
import { normalizePlayerName } from "@dtp/engines";
import { stripNumberPrefix } from "./admissible-squad-name";

/**
 * Suffixes that are not words and must not be title-cased into one.
 *
 * `JOHN III` reads `John Iii` under a naive rule. Restricted to an explicit set, and
 * only in final position, so a name token that merely looks Roman is safe: `V` and
 * `X` are left out because a lone letter there is far more likely an initial than a
 * fifth of his name.
 */
const NUMERIC_SUFFIXES = new Set(["II", "III", "IV", "VI", "VII", "VIII", "IX"]);

/** Capitalise each run of letters, leaving the separators between them alone. */
function titleCaseToken(token: string): string {
  /* Letter *runs*, so the separators do the work for free: an apostrophe, hyphen or
     period ends a run, which is why `O'BRIEN` becomes `O'Brien`, `ADE-BOLA` becomes
     `Ade-Bola` and `J.J.` survives as `J.J.` rather than `J.j.`. */
  return token.replace(/\p{L}+/gu, (run) => run[0]!.toUpperCase() + run.slice(1).toLowerCase());
}

/**
 * Title-case a name that is written entirely in capitals. Anything else is returned
 * untouched, including a name with no letters in it at all.
 */
export function titleCaseShoutedName(name: string): string {
  if (/\p{Ll}/u.test(name)) return name;
  if (!/\p{Lu}/u.test(name)) return name;

  const tokens = name.split(" ");
  return tokens
    .map((token, i) =>
      i === tokens.length - 1 && NUMERIC_SUFFIXES.has(token) ? token : titleCaseToken(token)
    )
    .join(" ");
}

/**
 * Misspellings that cannot be derived, keyed by the exact stored name.
 *
 * Deliberately exact rather than normalised: a correction is a statement about one
 * record somebody looked at, and matching loosely would let it reach a name nobody
 * reviewed. Add a line here only after seeing the name in a report.
 */
export const REVIEWED_CORRECTIONS: Readonly<Record<string, string>> = {
  /* A 9 where the o belongs. Found in the drift report's most-affected list. */
  "Emmanuel Jac9b": "Emmanuel Jacob",
};

/** Whether a name carries a digit. */
export function hasDigit(name: string): boolean {
  return /\p{N}/u.test(name);
}

/**
 * Club markers, which mean the record is a team rather than a person.
 *
 * `VIDO 99 FC` is in the live player directory, and title-casing it produced
 * `Vido 99 Fc` — a rule meant for `NWOSU HENRY` quietly damaging a name it had no
 * business touching. `FC` is not a word and must not be lowercased into one.
 *
 * Kept to the tokens that are unambiguously club suffixes. `AC` and `FA` are left out
 * because they are as likely to be somebody's initials, and the cost of a false
 * positive here is only that a shouting name stays shouting and gets reported, which
 * is the failure worth having.
 */
const CLUB_MARKERS = new Set(["FC", "AFC", "SC", "CF"]);

/**
 * Everything that marks a name as a club rather than a person.
 *
 * Wider than `CLUB_MARKERS`, and separate from it on purpose: these decide whether a
 * name *is* a team, while `CLUB_MARKERS` decides which tokens must be written in
 * capitals. `UNITED` belongs here and not there -- `Leads UNITED FC` would be a new
 * mistake in place of the old one.
 *
 * **Read off the live team list, not guessed.** An earlier version of this left `FA`
 * out on the reasoning that it was as likely somebody's initials. The directory is
 * full of `ADHOC FA`, `AJUWA FA`, `BILDA FA`, `IGHALO FA`, `PANTHERS FA`,
 * `GALAXY SPORT FA` -- Football Academy is how half these clubs are named -- and the
 * consequence was `Star To Be FA` queued to join two squads as a player. The list was
 * available to check and was not checked.
 *
 * `AC` is still out: no live team uses it, and it is a plausible pair of initials.
 */
const TEAM_MARKERS = new Set([
  ...CLUB_MARKERS,
  "FA",
  "SA",
  "LFC",
  "UNITED",
  "ACADEMY",
  "ACADEMICAL",
  "LADIES",
  "QUEENS",
  "SPORTS",
  "ATHLETIC",
  "ATHLETICS",
]);

export function looksLikeATeam(name: string): boolean {
  return name.split(/\s+/).some((token) => TEAM_MARKERS.has(token.toUpperCase()));
}

/**
 * Put a club marker back into capitals after something lowercased it.
 *
 * This repairs damage already in the directory. An earlier version of this module
 * title-cased `VIDO 99 FC` into `Vido 99 Fc`, and that ran on live before the guard
 * above existed. Neither rule here would find it again — the digit rule skips it, and
 * the casing rule ignores a name that already has lowercase in it — so without this
 * the mangled spelling would simply stay.
 *
 * It repairs the marker and **not** the original form. `Vido 99 Fc` becomes
 * `Vido 99 FC`, not `VIDO 99 FC`: nothing recorded that the name used to be in
 * capitals, and the denormalised copies were realigned to the mangled spelling in the
 * same run, so there is nowhere left to read it from. `FC` in capitals is the part
 * that was actually wrong, and it is the part that can be put right.
 */
export function restoreClubMarkers(name: string): string {
  return name
    .split(" ")
    .map((token) => (CLUB_MARKERS.has(token.toUpperCase()) ? token.toUpperCase() : token))
    .join(" ");
}

/**
 * The per-token difference between a name and its corrected form.
 *
 * `firstName` and `lastName` hold the same words as `displayName` split in two, and a
 * correction written for the whole name has to reach them or the record is left
 * half-fixed: `displayName` reading `Emmanuel Jacob` while `lastName` still reads
 * `Jac9b`. Nothing renders those two fields today, which is exactly why an
 * inconsistency there would go unnoticed until something did.
 *
 * Returns nothing when the token counts differ. A correction that adds or removes a
 * word cannot be matched up token by token, and guessing which word became which is
 * the kind of inference this module exists to avoid — the caller re-cases those
 * fields and leaves their spelling alone.
 */
export function tokenCorrections(from: string, to: string): Map<string, string> {
  const before = from.split(" ");
  const after = to.split(" ");
  const map = new Map<string, string>();
  if (before.length !== after.length) return map;
  for (const [i, token] of before.entries()) {
    const replacement = after[i]!;
    if (token !== replacement) map.set(token, replacement);
  }
  return map;
}

/**
 * The tidied form of a stored name, or the same string when there is nothing to do.
 *
 * Order matters: whitespace first so a reviewed correction is matched against a name
 * with single spaces, then the correction, then casing. A correction is written the
 * way it should read, so it is not re-cased afterwards.
 */
export function tidyPlayerName(name: string): string {
  const spaced = normalizePlayerName(name);
  const corrected = REVIEWED_CORRECTIONS[spaced];
  if (corrected) return corrected;

  /* Two kinds of name this declines to re-case, both learned from the live directory
     rather than imagined. Whitespace is still collapsed — that is safe whatever the
     record turns out to be — but the casing is left exactly as found.

     A **digit** means the record is not understood. Live holds `Jersey No. 35`,
     `Ademola James (19)`, `Ayila No.7`, `Team360 FC`, and one whose whole name is
     `Papi Emeka (10), Benjamin Aga (14), Paul Otto (13), …` — five people in one
     field. None of those is a person whose name wants tidying, and prettifying them
     would make a broken record look deliberate. A reviewed correction above still
     applies, which is how `Emmanuel Jac9b` is fixed despite its 9.

     A **club marker** means it is a team. `VIDO 99 FC` is in the directory, and
     title-casing gave `Vido 99 Fc`. */
  /* Before either check, because a marker already lowercased by an earlier run is
     damage to repair, and both checks below would otherwise walk straight past it. */
  const marked = restoreClubMarkers(spaced);

  /* A shirt number in front of a name is the one digit that *is* understood, and it
     has to come off before the rule below sees one and gives up. `No. 8 OLAIYA FARUK`
     is a player record in the live directory -- created from a timeline label by a
     path that only refused a bare number -- and the number followed him into
     `/player/no-8-olaiya-faruk`. The digit rule was skipping exactly the records that
     needed fixing.

     Only a *leading* prefix, so the shapes the digit rule is there for are untouched:
     `Jersey No. 35` and `FC Ogunlade No. 15` begin with a word, `Ayila No.7` carries
     its number at the end, and a bare `No. 12` has no name behind it to keep. */
  const unnumbered = stripNumberPrefix(marked).trim();
  if (unnumbered && unnumbered !== marked) return tidyPlayerName(unnumbered);

  if (hasDigit(marked)) return marked;
  if (looksLikeATeam(marked)) return marked;

  return titleCaseShoutedName(marked);
}
