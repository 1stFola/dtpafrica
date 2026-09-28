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
