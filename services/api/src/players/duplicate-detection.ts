/**
 * Deciding when two player records are probably one person.
 *
 * Separated from the report and tested, because this rule decides what gets put
 * in front of somebody as a suspected duplicate. It is read-only either way, so a
 * false positive costs attention rather than data — but attention is what makes
 * the report worth running, and a rule that cries wolf stops being read.
 *
 * **The rule is deliberately narrow: same words, any order.** That is not a guess
 * about what duplicates look like in general; it is what the data showed. Every
 * one of the twenty-two ambiguous names `db:sync:event-player-links` reported
 * turned out to be a name and its reverse on the same team — `Clems Henry` and
 * `Henry Clems`, `Adebayo Taylor` and `Taylor Adebayo`. Nigerian names are often
 * written surname-first or given-name-first depending on who is filling the form,
 * and both spellings ended up as separate Player rows.
 *
 * Deliberately **not** included: fuzzy spelling distance. It would catch
 * `Micheal`/`Michael`, and it would also catch two brothers, two cousins and two
 * unrelated players who share a common surname and a one-letter difference. The
 * cost of a wrong merge is a goal credited to the wrong child, which is worse than
 * a duplicate nobody noticed.
 */
import { playerLookupKey } from "@dtp/engines";

/**
 * A name reduced to its words, sorted.
 *
 * `playerLookupKey` already lowercases, strips punctuation and accents, and
 * collapses whitespace — so `Collins. Kadiri` and `Collins Kadiri` arrive here
 * identical. Sorting the words on top of that is what makes the order irrelevant.
 */
export function reorderKey(name: string): string {
  return playerLookupKey(name).split(" ").filter(Boolean).sort().join(" ");
}

export type Candidate = {
  id: string;
  displayName: string;
};

export type DuplicateGroup<T extends Candidate> = {
  key: string;
  members: T[];
  /** True when the members are spelled differently, not merely duplicated names. */
  differentSpellings: boolean;
};

/**
 * Group records that are probably the same person.
 *
 * Only groups of two or more distinct ids are returned: a person who appears once
 * is not a duplicate, however their name is written.
 */
export function groupProbableDuplicates<T extends Candidate>(
  players: T[]
): DuplicateGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const player of players) {
    const key = reorderKey(player.displayName);
    /* A name that normalises to nothing — punctuation only, or empty — groups
       every such row together and says nothing about any of them. */
    if (!key) continue;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(player);
    else byKey.set(key, [player]);
  }

  const groups: DuplicateGroup<T>[] = [];
  for (const [key, members] of byKey) {
    const distinct = [...new Map(members.map((m) => [m.id, m])).values()];
    if (distinct.length < 2) continue;
    groups.push({
      key,
      members: distinct,
      differentSpellings: new Set(distinct.map((m) => m.displayName)).size > 1,
    });
  }
  return groups;
}
