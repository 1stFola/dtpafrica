/**
 * Deciding which player lookup keys can be put right, and which cannot.
 *
 * `Player.normalizedName` is the column every duplicate check in this codebase
 * queries. It is supposed to hold `playerLookupKey(displayName)` — lowercased,
 * accents and punctuation stripped, whitespace collapsed. Some rows instead hold
 * the raw display name, capitals and all, and a couple hold null.
 *
 * That breaks two things at once, which is why the duplicates got as far as they
 * did:
 *
 *   - **The unique constraint stops applying.** `ADEBISI SEGUN` and `adebisi segun`
 *     are different strings, so Postgres allows both rows. A null escapes a unique
 *     index altogether, so those can duplicate without limit.
 *   - **Every dedupe lookup misses.** Each creation path asks for
 *     `normalizedName: playerLookupKey(name)`, which is lowercase, so it never
 *     matches the row stored in capitals — and creates another player.
 *
 * It even defeats the reversal-aware check in
 * `prisma/sync-scoreboard-timeline-player-profiles.ts`, which looks for
 * `Henry Clems` before creating `Clems Henry`: that check queries the same column.
 *
 * Separated from the repair script and tested, because the part that can go wrong
 * is not the rewriting — it is deciding which rewrite would land on a key another
 * row already owns.
 *
 * **What this does not do.** Two records for one person written in different word
 * orders — `Segun Adebisi` and `ADEBISI SEGUN` — have *different* canonical keys,
 * so both are repaired and both survive. Fixing the keys stops new duplicates being
 * created; it does not merge the ones already there. That is
 * `db:report:duplicate-players` and a decision.
 */
import { playerLookupKey } from "@dtp/engines";

export type KeyRow = {
  id: string;
  displayName: string;
  normalizedName: string | null;
};

export type KeyFix = { row: KeyRow; from: string | null; to: string };

export type KeyRepairPlan = {
  /** Rows whose key already matches their name. */
  correct: KeyRow[];
  /** Rows that can take their canonical key without colliding. */
  fixable: KeyFix[];
  /**
   * Canonical keys wanted by more than one row.
   *
   * Left alone: writing the same key to two rows would violate the unique index,
   * and choosing which row keeps it is a merge decision rather than a repair.
   */
  blocked: { key: string; rows: KeyRow[] }[];
  /** Names that normalise to nothing — punctuation, or empty. */
  unkeyable: KeyRow[];
};

export function planKeyRepair(rows: KeyRow[]): KeyRepairPlan {
  const plan: KeyRepairPlan = { correct: [], fixable: [], blocked: [], unkeyable: [] };

  const wantedBy = new Map<string, KeyRow[]>();
  for (const row of rows) {
    const key = playerLookupKey(row.displayName);
    if (!key) {
      plan.unkeyable.push(row);
      continue;
    }
    wantedBy.set(key, [...(wantedBy.get(key) ?? []), row]);
  }

  for (const [key, contenders] of wantedBy) {
    if (contenders.length > 1) {
      /* Two rows whose names normalise identically. One of them may already hold
         the key; it keeps it, and nothing is rewritten, because the question of
         which record is the real person is not one a key repair should answer. */
      plan.blocked.push({ key, rows: contenders });
      continue;
    }
    const row = contenders[0]!;
    if (row.normalizedName === key) plan.correct.push(row);
    else plan.fixable.push({ row, from: row.normalizedName, to: key });
  }

  return plan;
}

/**
 * The two passes a safe rewrite needs.
 *
 * A row's correct key can be sitting on *another* row that is itself about to move
 * — row A holds `b`, row B holds `a`, and both are wrong. Writing them one at a
 * time fails on the unique index for whichever goes first, and which one that is
 * depends on iteration order, so it would fail unpredictably.
 *
 * Parking every row on a value nothing else can hold, and only then writing the
 * real keys, removes the ordering question entirely. The id is already unique, so
 * it makes a safe parking value.
 */
export function parkingKey(id: string): string {
  /* Punctuation, not a control character. A NUL byte is the obvious way to
     guarantee nothing real collides, and Postgres rejects it outright in a text
     column -- `invalid byte sequence for encoding "UTF8": 0x00`, which this hit
     on the first real run. A colon is enough: `playerLookupKey` strips every
     character that is not a letter, a number or a space, so it can never
     produce one. */
  return `:pending:${id}`;
}
