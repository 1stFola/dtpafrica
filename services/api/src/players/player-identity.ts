/**
 * The two fields that have to travel together when a player is created.
 *
 * `normalizedName` is the directory's dedupe key: it is what the unique index
 * enforces and what every "does this player already exist?" lookup queries. It is
 * derived from `displayName` and is never entered by hand.
 *
 * It was optional in the schema and therefore easy to leave out, and four creation
 * paths did — public registration, the players API, the admin calibration import
 * and the seed row. Every player those made carried a **null** key, which is worse
 * than a wrong one:
 *
 *   - Postgres permits any number of nulls in a unique index, so those rows can
 *     duplicate without limit.
 *   - Every lookup asks for a specific key, so a null row is never found, and the
 *     next import creates another copy of the same person.
 *
 * That is how the live directory reached 165 names held by more than one record.
 * Setting the key here, next to the name it is derived from, is what stops a fifth
 * path repeating it — and `player-identity.spec.ts` fails the build if one tries.
 */
import { playerLookupKey } from "@dtp/engines";

export type PlayerIdentityFields = {
  displayName: string;
  normalizedName: string | null;
};

/**
 * Build a player's name and dedupe key from one display name.
 *
 * Returns `null` for the key when the name normalises to nothing — punctuation, or
 * empty. A null is the honest answer there: there is no key to store, and storing
 * an empty string would let exactly one such row exist and collide every other.
 */
export function playerIdentityFields(displayName: string): PlayerIdentityFields {
  const trimmed = displayName.trim();
  return { displayName: trimmed, normalizedName: playerLookupKey(trimmed) || null };
}
