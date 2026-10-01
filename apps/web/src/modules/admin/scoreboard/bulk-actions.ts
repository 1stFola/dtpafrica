/**
 * Asking about, and reporting on, a bulk records action.
 *
 * A bulk action partially succeeds. The server runs each row through the same guard the
 * single-row delete uses — a competition with fixtures behind it refuses, a team tied to
 * matches refuses, a live fixture refuses — so "deleted 37 of 40" is the ordinary outcome and
 * the three that stayed are the part worth reading.
 *
 * Both the question and the answer are plain functions so they can be read and tested without a
 * DOM, which is how the web tests work here.
 */
import type { AdminSbBulkResult } from "../../../api/admin-scoreboard";

/** Singular and plural, because "1 competitions" in a confirmation dialog reads as a bug. */
export type Noun = { one: string; many: string };

export function countOf(noun: Noun, n: number): string {
  return `${n} ${n === 1 ? noun.one : noun.many}`;
}

/** How many names a confirmation lists before it starts counting instead. */
const NAMED_IN_CONFIRM = 5;

/**
 * The text of the confirmation for a bulk action.
 *
 * It names rows rather than only counting them. "Delete 40 teams?" tells an admin nothing about
 * whether the selection is the one they meant; four names and "and 36 more" tells them whether
 * they are looking at the right club.
 */
export function confirmBulk(args: {
  verb: string;
  noun: Noun;
  names: readonly string[];
  /** Added on its own line, for anything the admin should know before pressing it. */
  caveat?: string;
}): string {
  const head = `${args.verb} ${countOf(args.noun, args.names.length)}?`;
  const listed = args.names.slice(0, NAMED_IN_CONFIRM);
  const rest = args.names.length - listed.length;
  const body = listed.map((name) => `  • ${name}`).join("\n");
  const more = rest > 0 ? `\n  … and ${rest} more` : "";
  return [head, "", body + more, ...(args.caveat ? ["", args.caveat] : [])].join("\n");
}

export type BulkReport = {
  /** What went through, or null when nothing did. */
  ok: string | null;
  /** What refused and why, or null when nothing refused. */
  problem: string | null;
};

/**
 * What to tell the admin afterwards.
 *
 * The reasons are grouped rather than listed per row: forty rows refusing for one reason is one
 * sentence, and it is the sentence that says what to do next. The count comes with it, because
 * "Cannot delete a competition with teams" reads very differently for one row than for forty.
 */
export function reportBulk(
  result: AdminSbBulkResult,
  noun: Noun,
  pastTense: string
): BulkReport {
  const ok = result.done > 0 ? `${countOf(noun, result.done)} ${pastTense}` : null;
  if (!result.failures.length) return { ok, problem: null };

  const byReason = new Map<string, number>();
  for (const failure of result.failures) {
    byReason.set(failure.reason, (byReason.get(failure.reason) ?? 0) + 1);
  }
  const grouped = [...byReason.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => (count === 1 ? reason : `${reason} (${count})`))
    .join(" ");

  /* The whole clause agrees, not just the verb: "1 team was left as they are" reads as a bug in
     the sentence rather than a fact about the data. */
  const stayed =
    result.failures.length === 1
      ? `${countOf(noun, 1)} was left as it is.`
      : `${countOf(noun, result.failures.length)} were left as they are.`;
  return { ok, problem: `${stayed} ${grouped}` };
}

/**
 * The most ids one request carries, matching `BULK_LIMIT` on the server.
 *
 * The server refuses a longer list rather than truncating it, so this is not a formality: the
 * directory tab shows every squad row there is -- three thousand of them on the live data --
 * and "Select all shown" followed by Delete would be one request the server rejects outright.
 */
export const BULK_REQUEST_LIMIT = 200;

/** Split ids into requests the server will accept. */
export function chunkIds(ids: readonly string[], size = BULK_REQUEST_LIMIT): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * Run an action over any number of ids, a requestful at a time, as one result.
 *
 * Sequential, like the server-side loop and for the same reason: each row is several queries
 * and some recompute standings. A batch that fails outright -- a network drop, a server error --
 * is not allowed to hide the batches that worked, so it is rethrown only when nothing has been
 * done yet; after that the ids it covered are reported as failures and the rest carry on.
 */
export async function runInBatches(
  ids: readonly string[],
  act: (batch: string[]) => Promise<AdminSbBulkResult>
): Promise<AdminSbBulkResult> {
  const merged: AdminSbBulkResult = { requested: ids.length, done: 0, failures: [] };
  for (const batch of chunkIds(ids)) {
    try {
      const result = await act(batch);
      merged.done += result.done;
      merged.failures.push(...result.failures);
    } catch (error) {
      if (merged.done === 0 && merged.failures.length === 0) throw error;
      const reason = error instanceof Error ? error.message : "Request failed";
      for (const id of batch) merged.failures.push({ id, reason });
    }
  }
  return merged;
}