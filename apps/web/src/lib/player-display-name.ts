/**
 * The name to show for a stored player label.
 *
 * A timeline event stores its player as `No. 11 EBULU EMMANUEL`: the recorder captures a
 * shirt number at pitchside and the API resolves it to a name, keeping the number so a
 * match report can be checked against the sheet. That is the right thing to store and the
 * wrong thing to display — the number is not part of anybody's name, and it certainly is
 * not part of the link to their profile.
 *
 * `EventTimeline` had this rule privately and every other surface rendered the label raw,
 * so the same person read as `EBULU EMMANUEL` on the public timeline and
 * `No. 11 EBULU EMMANUEL` in the match centre, on their own profile page and on the
 * academy dashboard. One copy, used everywhere, is what stops that drifting again.
 *
 * Deliberately **not** applied to the recorder console's own number picker. There the
 * number is what you are selecting by, so `No. 11 EBULU EMMANUEL` is the useful label and
 * the name alone would be a regression.
 */

/** `No. 11 `, `no 11 `, `#11 ` — the prefixes the API and the CSV importers write. */
const NUMBER_PREFIX = /^\s*(?:no\.?\s*|#\s*)\d{1,3}\s+/i;

/**
 * Strip the shirt-number prefix, leaving the name.
 *
 * A label that is *only* a number — `No. 11`, with nobody resolved behind it — is returned
 * unchanged rather than emptied. It says what was known, which is a number and not a
 * person, and callers decide whether to show or hide that; returning an empty string here
 * would silently drop the event's only description of who was involved.
 */
export function playerDisplayName(label: string | null | undefined): string | null {
  const value = label?.trim();
  if (!value) return null;
  const stripped = value.replace(NUMBER_PREFIX, "").trim();
  return stripped || value;
}

/** Whether a label carries a shirt-number prefix, for a caller that wants to show it apart. */
export function shirtNumberFromLabel(label: string | null | undefined): number | null {
  const match = label?.trim().match(/^(?:no\.?\s*|#\s*)(\d{1,3})\s+/i);
  return match ? Number(match[1]) : null;
}

/**
 * Whether a label names a person at all, and may therefore link to a profile.
 *
 * A timeline event's label is whatever the recorder wrote, and plenty of it is not a name.
 * On live, 88 goals carry a label with no player behind it: `Unknown` twenty-one times,
 * `Player` ten, and bare shirt numbers — `No. 20`, `No 36`, `No. 4` — about thirty more.
 *
 * `Unknown` was already safe by accident: the timeline only links a label of two or more
 * words. `No. 20` is two words by that rule, so it linked, to `/player/no-20` — a profile
 * page for a shirt number, invented from a label that names nobody. Anyone arriving there
 * sees a "Verifying" placeholder as though a real player were awaiting review.
 *
 * So the rule is asked of the label rather than of its shape: strip the shirt number, and
 * what remains must contain a letter and not be one of the words recorders use when they
 * did not catch who it was.
 */
const PLACEHOLDER_LABELS = new Set([
  "unknown",
  "unknown player",
  "player",
  "n/a",
  "na",
  "tbc",
  "tbd",
  "jersey",
]);

/**
 * A label that is only a shirt number.
 *
 * `NUMBER_PREFIX` cannot answer this: it requires whitespace after the digits, because it
 * exists to strip a number from in *front of a name*. `No. 20` has no name after it, so the
 * prefix never matches, the label keeps its letters — the `No` — and every letter-based
 * check waves it through. That is precisely how `/player/no-20` came to exist.
 */
const ONLY_A_NUMBER = /^\s*(?:no\.?\s*|#\s*)?\d{1,3}\s*$/i;

export function namesAPerson(label: string | null | undefined): boolean {
  const value = label?.trim();
  if (!value) return false;
  if (ONLY_A_NUMBER.test(value)) return false;

  const withoutNumber = value.replace(NUMBER_PREFIX, "").trim();
  /* `No. 20` and `20` leave nothing, or nothing with a letter in it. A shirt number is what
     was known, and what was known was not a name. */
  if (!/\p{L}/u.test(withoutNumber)) return false;

  const key = withoutNumber.toLowerCase().replace(/\s+/g, " ");
  if (PLACEHOLDER_LABELS.has(key)) return false;
  /* `Player 1`, `Player 2` — numbered placeholders from an import that had no names. */
  if (/^player\s*\d+$/.test(key)) return false;
  /* `Jersey No. 35` survives the prefix strip because the number is not at the front. */
  if (/^jersey\s*(?:no\.?)?\s*\d+$/.test(key)) return false;

  return true;
}
