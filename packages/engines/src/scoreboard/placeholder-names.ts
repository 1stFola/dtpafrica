/**
 * Names that are not people.
 *
 * Match data is full of them. A scorer nobody caught the name of gets written down
 * as `Unknown`, a shirt number as `No. 9`, and whoever filled the sheet in a hurry
 * wrote `Player` or `Goalkeeper`. They are perfectly good *labels* — they say what
 * was known at the time — and they must never become player records.
 *
 * When one does, it behaves like a person: it collects goals, it appears in a
 * squad, and it climbs the scoring charts. On live, `Player` sits second in the Ex
 * Internationals Cup with five goals and `Unknown` fourth with four. Second place
 * in that competition is nobody.
 *
 * The rule already existed, privately, inside
 * `prisma/sync-scoreboard-timeline-player-profiles.ts`, which is why that path has
 * never created one. `resolveOrCreatePlayer` had no such guard, so a squad CSV or a
 * matchday roster with `Player` in it made one. This is that rule, in one place,
 * for both.
 */

/** Words that stand in for a person nobody named. */
const PLACEHOLDER_WORDS = new Set([
  "player",
  "players",
  "goalkeeper",
  "keeper",
  "gk",
  "unknown",
  "unknown player",
  "unnamed",
  "n/a",
  "na",
  "nil",
  "none",
  "own goal",
  "owngoal",
  "opponent",
  "substitute",
  "sub",
  "trialist",
  "tbc",
  "tba",
]);

/** A bare shirt number: `No. 9`, `no9`, `#7`, `7`. */
const SHIRT_NUMBER = /^(?:no\.?\s*|#\s*)?\d{1,3}$/i;

/**
 * Whether this name is a stand-in rather than a person.
 *
 * Normalisation is done here rather than expected of callers, so a name cannot
 * slip past on punctuation or casing alone: `NO. 9`, `no.9` and `#9` are all the
 * same non-person.
 */
export function isPlaceholderName(name: string | null | undefined): boolean {
  const cleaned = (name ?? "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s/#.]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!cleaned) return true;
  /* Nothing but punctuation. The dot and hash survive the clean above so that
     `No. 9` and `#7` still read as shirt numbers, which leaves `...` looking like
     a name until it is checked for having any letter or digit in it at all. */
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return true;
  if (PLACEHOLDER_WORDS.has(cleaned)) return true;
  if (SHIRT_NUMBER.test(cleaned)) return true;
  /* `no 9` once the dot has been stripped, and `player 3`-style numbering. */
  if (/^(no|player|gk|keeper|sub)\s*\d{1,3}$/.test(cleaned)) return true;
  return false;
}

/** Thrown rather than silently creating a player for a name that is not one. */
export class PlaceholderPlayerNameError extends Error {
  constructor(readonly attemptedName: string) {
    super(
      `"${attemptedName}" is a placeholder, not a player. Names like Unknown, ` +
        `Player, Goalkeeper or a bare shirt number describe what was known at the ` +
        `time and must not become player records — they collect goals and appear ` +
        `in the scoring charts as if they were somebody.`
    );
    this.name = "PlaceholderPlayerNameError";
  }
}
