/**
 * The player record whose name absorbed a shirt number, and the record it duplicates.
 *
 * `No. 16 Musa Abdul` and `Musa Abdul` are the same boy. The first was created from a
 * timeline label written `No. 16 Musa Abdul` before anyone linked it, and the number came
 * along for the ride into `displayName`.
 *
 * **No existing tool folds these, which is why this exists.** The evidence:
 *
 *   - `db:repair:player-display-names` computes the tidy name, finds the corrected key is
 *     already held, and blocks — correctly, because the unique index would refuse it. On
 *     live that is 47 records, and its advice to run `db:merge:duplicate-players` first
 *     does not work, for the reason below.
 *   - `db:merge:duplicate-players` groups on `playerLookupKey`, and these do not collide:
 *     `playerLookupKey("No. 16 Musa Abdul")` is `"no 16 musa abdul"`, not `"musa abdul"`.
 *     That difference is exactly why both records are allowed to exist today.
 *   - `db:merge:squad-duplicates` is scoped to one squad and keyed the same way.
 *
 * **A shared team is the evidence, and it is required.** `No. 4 Alfred Isaac` at one club
 * and `Alfred Isaac` at another are not obviously one person: names repeat, and Nigerian
 * grassroots squads are full of boys who share one. Within a single squad a shirt number
 * in front of a name is bookkeeping, not identity — the same reasoning that lets
 * `db:merge:squad-duplicates` act where the directory-wide tool refuses.
 *
 * **Squad membership is not the only evidence, and on live it was the weaker half.** Of the
 * nine pairs the first version refused, seven had the numbered record carrying *more*
 * events than the record being kept -- the signature of a record created from a timeline
 * label that nobody ever put on a team sheet. So a shared team is taken from squad rows or
 * from the `teamId` on the events themselves, and the report says which it found.
 *
 * Pairs with neither are reported as `needs-a-human` rather than merged. That list is short
 * and somebody who knows the competitions can settle it.
 */
import { playerLookupKey } from "@dtp/engines";
import { stripNumberPrefix } from "./admissible-squad-name";

/** A player record as this planner needs to see it. */
export type NumberedCandidate = {
  id: string;
  displayName: string;
  /** Team ids this record appears in, from `SbTeamSquad`. */
  teamIds: string[];
  /**
   * Team ids this record has played for, from the `teamId` on its own events.
   *
   * A record created from a timeline label often has no squad row at all -- somebody filed
   * a goal for `No. 4 ALFRED ISAAC` and nobody ever added him to a team sheet. Squad
   * membership alone therefore cannot tell "plays for another club" from "was never
   * written on a team sheet", and those are opposite readings: the first is evidence of a
   * different person, the second is no evidence at all.
   *
   * What the events say is stronger anyway. A squad row is somebody typing a name into a
   * list; an event is a goal scored for that team in a match that happened.
   */
  eventTeamIds: string[];
};

export type NumberedPair = {
  /** The record whose name carries the shirt number. */
  numbered: NumberedCandidate;
  /** The record holding the same name without it. */
  plain: NumberedCandidate;
  /** The name they agree on once the number is off the front. */
  name: string;
  /** Team ids both records appear in, from squad rows. */
  sharedTeamIds: string[];
  /** Team ids both records have played for, from their events. */
  sharedEventTeamIds: string[];
  /** Which evidence put this pair together. `none` means it is for a human. */
  evidence: "squad" | "events" | "none";
};

export type NumberedPlan = {
  /** Pairs sharing at least one team: a shirt number in front of a squad-mate's name. */
  mergeable: NumberedPair[];
  /** Pairs with no team in common. Reported, never merged. */
  needsAHuman: NumberedPair[];
};

/** Whether this display name begins with a shirt number that is not part of it. */
export function carriesNumberPrefix(displayName: string): boolean {
  const stripped = stripNumberPrefix(displayName);
  return stripped !== displayName && stripped.trim().length > 0;
}

/**
 * Pair every numbered record with the unnumbered record holding its name.
 *
 * Deliberately not transitive. `No. 9 Ade Bello` and `No. 16 Ade Bello` both point at
 * `Ade Bello`, and each is folded into it in its own pair rather than into each other —
 * one of them is somebody who changed shirt, and the plain record is the one with a URL
 * anybody has shared.
 */
export function planNumberedDuplicates(candidates: NumberedCandidate[]): NumberedPlan {
  const byKey = new Map<string, NumberedCandidate[]>();
  for (const candidate of candidates) {
    if (carriesNumberPrefix(candidate.displayName)) continue;
    const key = playerLookupKey(candidate.displayName);
    if (!key) continue;
    const held = byKey.get(key);
    if (held) held.push(candidate);
    else byKey.set(key, [candidate]);
  }

  const mergeable: NumberedPair[] = [];
  const needsAHuman: NumberedPair[] = [];

  for (const numbered of candidates) {
    if (!carriesNumberPrefix(numbered.displayName)) continue;
    const name = stripNumberPrefix(numbered.displayName).trim();
    const key = playerLookupKey(name);
    if (!key) continue;

    const holders = byKey.get(key) ?? [];
    /* More than one unnumbered record with this name is a duplicate pair of its own, and
       `db:merge:duplicate-players` is the tool for it. Choosing between them here would be
       guessing which of two equal claims the number belongs to. */
    if (holders.length !== 1) continue;
    const plain = holders[0]!;
    if (plain.id === numbered.id) continue;

    const shared = numbered.teamIds.filter((id) => plain.teamIds.includes(id));
    /* Either side of the comparison may be the one with no squad row, so a numbered
       record's events are checked against the plain record's squad and events alike. */
    const plainTeams = new Set([...plain.teamIds, ...plain.eventTeamIds]);
    const sharedEvents = [...new Set(numbered.eventTeamIds)].filter((id) =>
      plainTeams.has(id)
    );

    const evidence: NumberedPair["evidence"] = shared.length
      ? "squad"
      : sharedEvents.length
        ? "events"
        : "none";
    const pair: NumberedPair = {
      numbered,
      plain,
      name,
      sharedTeamIds: shared,
      sharedEventTeamIds: sharedEvents,
      evidence,
    };
    if (evidence === "none") needsAHuman.push(pair);
    else mergeable.push(pair);
  }

  return { mergeable, needsAHuman };
}
