/**
 * Whether an event label may become a squad row and a player record.
 *
 * This is the gate in front of a write that creates people. A recorder types a scorer's
 * name on the timeline; if nobody in the squad answers to it, that name is now allowed
 * to become an `SbTeamSquad` row and a `Player`. Everything downstream treats a Player
 * as a person: it collects goals, appears in a squad, and climbs a scoring chart.
 *
 * **Every rejection here comes from a string found in the live directory**, not from
 * imagination. The directory already contains records auto-created from labels by paths
 * that had no such gate:
 *
 *   - `Unknown`, `Player`, `Player 1` — a scorer nobody caught the name of. `Player`
 *     sat second in the Ex Internationals Cup with five goals.
 *   - `Jersey No. 35`, `Ayila No.7`, `No. 9` — a shirt number where a name belongs.
 *   - `VIDO 99 FC`, `Team360 FC`, `FC Ogunlade No. 15` — a club, not a person.
 *   - `Ademola James (19)` — a real name carrying a shirt number.
 *   - `Papi Emeka (10), Benjamin Aga (14), Paul Otto (13), Nwafor Daberechi (16),
 *     Martin Ogbu (11)` — one field holding five people, and
 *     `Abdullah Shaubu (7) & Adebayo David (17)` holding two.
 *
 * Each of those would have become a person under a gate that only checked for
 * emptiness. Guessing wrong in the permissive direction is not a small error: the
 * record is public, it accrues goals, and somebody has to find and merge it later.
 * Refusing a real name costs a line in a report that a human reads.
 *
 * A digit is therefore refused outright rather than parsed. `Ademola James (19)` is a
 * real person and this still declines it, because the same rule has to handle
 * `Jersey No. 35` and a rule that tries to tell them apart is a rule that will
 * eventually get one wrong. The label is reported instead, and a person decides.
 */
import { normalizePlayerName } from "@dtp/engines";
import { isPlaceholderName } from "./placeholder-names";
import { hasDigit, looksLikeATeam } from "./tidy-player-name";

export type SquadNameRejection =
  | "placeholder"
  | "team"
  | "carries-a-digit"
  | "several-people"
  | "initials-only"
  | "no-letters";

export type SquadNameVerdict =
  | { ok: true; name: string }
  | { ok: false; reason: SquadNameRejection; name: string };

/**
 * Separators that mean the field holds more than one person.
 *
 * A comma, an ampersand or a slash between two names is a recorder filling one box with
 * a list. Splitting it and creating each would be a guess about where one name ends —
 * `Abdullah Shaubu (7) & Adebayo David (17)` is clear, a stray comma in a single name is
 * not — so the whole label is refused and reported.
 *
 * **The semicolon was missing and the live data had one.** This list was written from the
 * separators that happened to be in the labels I looked at, which is a bad way to write a
 * list of separators: `Labi Akinola; Adesanya David` at FC OMORUYI passed the gate and was
 * queued to become one player record holding two people -- both of whom the directory
 * already had, so it would have split their goals a third way.
 *
 * So the rule is now the general one rather than the observed one: a character that cannot
 * occur inside a Nigerian name but is used to join a list. A semicolon, a plus and a pipe
 * all qualify and none of them can be part of anybody's name.
 */
const SEVERAL_PEOPLE = /[,&/;+|]| and /i;

/**
 * A name whose first or last part is a bare initial.
 *
 * The live timeline has nineteen of these queued to become people -- `I. Attah`, `A. Great`,
 * `S. David`, `O. Bethel` -- and a record made from one cannot be told apart from the next
 * `A. Great` at the same club. It then collects goals under an identity nobody can confirm,
 * which is the exact failure the rest of this gate exists to prevent; a bare shirt number is
 * refused for the same reason.
 *
 * **First or last part, not any part.** The platform identifies people by those two: the
 * lookup key, the reversal matching, and the Name QA grouping all read the first word and
 * the last. A middle initial -- `Chidi O Nwosu` -- leaves both of those known and is a whole
 * name, so it is accepted.
 *
 * `Lekan. James` is accepted too: a trailing dot on a full given name is a typo, not an
 * initial, and the test for it is the length of the word rather than the presence of a dot.
 */
function isInitialsOnly(name: string): boolean {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  const bareInitial = (part: string) => /^\p{L}\.?$/u.test(part);
  /* First and last, which for a one-word label are the same word -- so a lone `A` is
     refused by the same rule, without a second one that could disagree with it. */
  return bareInitial(parts[0]!) || bareInitial(parts.at(-1)!);
}

/** `No. 7 Ogundeji Elijah` carries the number the recorder typed; the name is the rest. */
export function stripNumberPrefix(label: string): string {
  return label.replace(/^\s*(?:no\.?\s*|#\s*)\d{1,3}\s+/i, "");
}

export function admitSquadName(label: string | null | undefined): SquadNameVerdict {
  const name = normalizePlayerName(stripNumberPrefix(label ?? ""));

  /* Order matters only for which reason gets reported, and the reason is what a human
     acts on -- so the most specific check goes first. `Jersey No. 35` is a placeholder
     and also carries a digit; calling it a placeholder is the more useful answer. */
  if (isPlaceholderName(name)) return { ok: false, reason: "placeholder", name };
  if (!/[\p{L}]/u.test(name)) return { ok: false, reason: "no-letters", name };
  if (looksLikeATeam(name)) return { ok: false, reason: "team", name };
  if (SEVERAL_PEOPLE.test(name)) return { ok: false, reason: "several-people", name };
  if (hasDigit(name)) return { ok: false, reason: "carries-a-digit", name };
  /* After the digit check, so `A. Great (7)` reports the number rather than the initial --
     the number is the part a recorder can fix at the console. */
  if (isInitialsOnly(name)) return { ok: false, reason: "initials-only", name };

  return { ok: true, name };
}
