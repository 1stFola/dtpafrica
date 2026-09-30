/**
 * Goals whose label names somebody the directory already holds.
 *
 * On live, 88 goals have a label and no player behind them, so they reach nobody's profile.
 * The breakdown decides what can be done about them:
 *
 *   - `Unknown` (21) and `Player` (10) — nobody wrote down who scored. Not recoverable.
 *   - bare shirt numbers, `No. 20`, `No 36` (~28) — a number is what was known, and a
 *     number is not a person. Not recoverable either, until somebody who was there says so.
 *   - **real names (~29)** — `Farouk Salami` alone has seven. These are players the
 *     directory already holds, whose goals were never linked.
 *
 * **Why they were not linked in the first place.** An event's label is resolved against the
 * squad of the team it belongs to. A boy who was never added to that team sheet -- the
 * commonest gap in this data -- resolves to nothing, and the goal stays a string.
 *
 * **A club tie was required at first, and the live data showed that to be wrong.** Of the 88,
 * only one goal could be linked: `Farouk Salami` has six goals for FC BABINGTON, no squad row
 * there, and no linked events anywhere -- because the only evidence he plays anywhere is the
 * goals being refused. The rule could not link precisely the players who needed it.
 *
 * **What settles it is the directory's own model.** `Player.normalizedName` is `@unique`, so
 * the directory holds exactly one `Farouk Salami` and can never hold a second. Requiring a
 * club tie was therefore stricter than the database being written to: it refused to attach a
 * goal to the only record that could ever hold it. `db:sync:squad-from-timeline` already
 * resolves labels the same way, by `findUnique({ normalizedName })` with no club check.
 *
 * **And the domain says the same.** From the people who run these competitions: two players
 * sharing a first or last name -- or one being the other reversed -- have never played in the
 * same team in the same competition. Where names come close, a third name distinguishes them.
 * That is the fact underneath the squad-scoped merges too, and it is written here because
 * nobody reading this code could know it otherwise.
 *
 * **One candidate only, still.** `normalizedName` is nullable, and Postgres lets nulls
 * duplicate freely, so two records can hold one name when neither has a key. That is the case
 * a machine must not decide, and it is refused.
 *
 * Whether the record is tied to the goal's club is still reported -- `squad`, `events` or
 * `name-only` -- because a reader should see which links rest on the identity model alone.
 */
import { playerLookupKey } from "@dtp/engines";

/** A goal with a label and no player. */
export type UnattributedGoal = {
  eventId: string;
  matchId: string;
  /** The team the goal was scored for. Null means there is nothing to match against. */
  teamId: string | null;
  label: string;
};

/** A directory player, with the teams tying them to a club. */
export type DirectoryPlayer = {
  id: string;
  displayName: string;
  /** Teams from squad rows. */
  teamIds: string[];
  /** Teams from their own events. */
  eventTeamIds: string[];
};

export type GoalLink = {
  goal: UnattributedGoal;
  player: DirectoryPlayer;
  /**
   * How this player relates to the team the goal was scored for.
   *
   * `name-only` is not a weaker link, it is a link resting on the directory being a
   * directory: one record per name, so the name IS the identity. It is reported apart so a
   * reader can see which links carry corroborating evidence and which do not.
   */
  evidence: "squad" | "events" | "name-only";
};

export type UnlinkedGoal = {
  goal: UnattributedGoal;
  /** Why it stays unlinked, in the words the report prints. */
  reason:
    | "not-a-name"
    | "nobody-by-that-name"
    | "several-of-that-name";
  /** Directory players holding the name, when that is the interesting part. */
  candidates: DirectoryPlayer[];
};

export type GoalLinkPlan = {
  links: GoalLink[];
  unlinked: UnlinkedGoal[];
};

/** `No. 20`, `#7`, `20` — a shirt number standing alone. */
const ONLY_A_NUMBER = /^\s*(?:no\.?\s*|#\s*)?\d{1,3}\s*$/i;
/** The words a recorder writes when nobody was caught. */
const PLACEHOLDERS = new Set(["unknown", "unknown player", "player", "n/a", "na", "tbc", "tbd"]);

/**
 * Whether this label is worth looking up.
 *
 * Deliberately the same judgement the web app makes before turning a label into a link
 * (`apps/web/src/lib/player-display-name.ts`). A label the site refuses to link is a label
 * this refuses to resolve, and the two agreeing is what stops a goal being attached to a
 * player the timeline will not show as a link anyway.
 */
export function labelNamesAPerson(label: string): boolean {
  const value = label.trim();
  if (!value) return false;
  if (ONLY_A_NUMBER.test(value)) return false;

  const withoutNumber = value.replace(/^\s*(?:no\.?\s*|#\s*)\d{1,3}\s+/i, "").trim();
  if (!/\p{L}/u.test(withoutNumber)) return false;

  const key = withoutNumber.toLowerCase().replace(/\s+/g, " ");
  if (PLACEHOLDERS.has(key)) return false;
  if (/^player\s*\d+$/.test(key)) return false;
  if (/^jersey\s*(?:no\.?)?\s*\d+$/.test(key)) return false;
  /* A label holding several people -- `Papi Emeka (10), Benjamin Aga (14)` -- is one goal
     credited to a list, and picking one of them would be inventing the answer. */
  if (/[,&/]| and /i.test(key)) return false;

  return true;
}

/** The name to look up: the label without its shirt number. */
export function nameFromLabel(label: string): string {
  return label.trim().replace(/^\s*(?:no\.?\s*|#\s*)\d{1,3}\s+/i, "").trim();
}

export function planGoalLinks(
  goals: UnattributedGoal[],
  players: DirectoryPlayer[]
): GoalLinkPlan {
  const byKey = new Map<string, DirectoryPlayer[]>();
  for (const player of players) {
    const key = playerLookupKey(player.displayName);
    if (!key) continue;
    const held = byKey.get(key);
    if (held) held.push(player);
    else byKey.set(key, [player]);
  }

  const links: GoalLink[] = [];
  const unlinked: UnlinkedGoal[] = [];
  const refuse = (goal: UnattributedGoal, reason: UnlinkedGoal["reason"], candidates: DirectoryPlayer[] = []) =>
    unlinked.push({ goal, reason, candidates });

  for (const goal of goals) {
    if (!labelNamesAPerson(goal.label)) {
      refuse(goal, "not-a-name");
      continue;
    }

    const key = playerLookupKey(nameFromLabel(goal.label));
    const holders = byKey.get(key) ?? [];
    if (!holders.length) {
      refuse(goal, "nobody-by-that-name");
      continue;
    }
    if (holders.length > 1) {
      /* Two records for one name, which `normalizedName` being nullable allows. Nothing here
         can choose between them and the domain says they should not both exist. */
      refuse(goal, "several-of-that-name", holders);
      continue;
    }

    const player = holders[0]!;
    const tiedBySquad = goal.teamId ? player.teamIds.includes(goal.teamId) : false;
    const tiedByEvents = goal.teamId ? player.eventTeamIds.includes(goal.teamId) : false;
    links.push({
      goal,
      player,
      evidence: tiedBySquad ? "squad" : tiedByEvents ? "events" : "name-only",
    });
  }

  return { links, unlinked };
}
