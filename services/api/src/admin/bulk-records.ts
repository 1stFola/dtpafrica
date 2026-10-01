/**
 * Running one records action over many rows.
 *
 * The Master records page can now select rows and act on all of them, which raises a question
 * the single-row endpoints never had to answer: what happens when one of them refuses.
 *
 * Several of them do refuse, on purpose. A competition with teams, fixtures, highlights or
 * player stats behind it cannot be deleted; a team tied to matches cannot; a live match cannot.
 * Those rules are the reason the page is safe, so a bulk action **calls the same single-row
 * method** rather than reaching for `deleteMany` — a bulk path with its own query would be a
 * second set of rules, and the laxer of the two would win by being the one with a button.
 *
 * So a bulk action partially succeeds, and says so. `{ requested, done, failures }` is the
 * whole answer: how many rows were asked for, how many went through, and for each one that did
 * not, which row and why. A bare count would leave an admin to work out which five of their
 * forty are still there.
 *
 * **Sequential, not `Promise.all`.** Each of these does several queries and some recompute
 * standings, so two hundred at once would take the connection pool down with them. In order,
 * too, so the failure list reads down the table the admin was looking at.
 */
import { BadRequestException } from "@nestjs/common";

/**
 * The most rows one call may carry.
 *
 * Not a safety rail -- the guards are the safety -- but a bound on how long one request can
 * run, since each id is its own round of queries.
 */
export const BULK_LIMIT = 200;

export type BulkFailure = { id: string; reason: string };

export type BulkResult = {
  /** Ids asked for, after duplicates were dropped. */
  requested: number;
  done: number;
  failures: BulkFailure[];
};

/**
 * Read a list of ids off a request body.
 *
 * Duplicates are dropped rather than refused: a double-click on a checkbox should not make a
 * bulk delete fail, and acting on the same row twice would report the second as a failure
 * ("not found") for no reason anybody could act on.
 */
export function readBulkIds(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${field} must be an array of ids`);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") throw new BadRequestException(`${field} must hold only ids`);
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (!ids.length) throw new BadRequestException(`${field} is empty`);
  if (ids.length > BULK_LIMIT) {
    throw new BadRequestException(
      `${field} holds ${ids.length} ids; ${BULK_LIMIT} is the most one request may carry`
    );
  }
  return ids;
}

/** What to tell an admin about a row that refused. */
export function reasonFor(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Unknown error";
}

/**
 * Apply `act` to each id, collecting the ones that refuse.
 *
 * A thrown error stops that row and nothing else. The alternative -- abandoning the rest on the
 * first refusal -- would make a bulk delete of forty rows depend on the order of the first one
 * that happens to still have a fixture attached.
 */
export async function runBulk(
  ids: readonly string[],
  act: (id: string) => Promise<unknown>
): Promise<BulkResult> {
  const failures: BulkFailure[] = [];
  let done = 0;
  for (const id of ids) {
    try {
      await act(id);
      done += 1;
    } catch (error) {
      failures.push({ id, reason: reasonFor(error) });
    }
  }
  return { requested: ids.length, done, failures };
}
