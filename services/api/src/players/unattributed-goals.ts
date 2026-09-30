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
 * **The evidence rule is the one that worked for numbered duplicates.** A name match alone
 * is not enough: names repeat, and attaching a goal to the wrong `Musa Abdul` is worse than
 * leaving it unattached, because a wrong goal on a profile is invisible while a missing one
 * is merely absent. So the named player must also have played for the team the goal belongs
 * to -- by a squad row, or by their own events.
 *
 * **One candidate only.** Two directory players sharing a name and both tied to that team is
 * exactly the case a machine must not decide.
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
  /** Which evidence tied the player to the goal's team. */
  evidence: "squad" | "events";
};

export type UnlinkedGoal = {
  goal: UnattributedGoal;
  /** Why it stays unlinked, in the words the report prints. */
  reason:
    | "not-a-name"
    | "no-team-on-the-event"
    | "nobody-by-that-name"
    | "several-of-that-name"
    | "not-tied-to-that-team";
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
    if (!goal.teamId) {
      /* Without a team there is nothing to check a name against, and a name on its own is
         how a goal ends up on the wrong profile. */
      refuse(goal, "no-team-on-the-event");
      continue;
    }

    const key = playerLookupKey(nameFromLabel(goal.label));
    const holders = byKey.get(key) ?? [];
    if (!holders.length) {
      refuse(goal, "nobody-by-that-name");
      continue;
    }

    const tied = holders.filter(
      (p) => p.teamIds.includes(goal.teamId!) || p.eventTeamIds.includes(goal.teamId!)
    );
    if (!tied.length) {
      refuse(goal, "not-tied-to-that-team", holders);
      continue;
    }
    if (tied.length > 1) {
      refuse(goal, "several-of-that-name", tied);
      continue;
    }

    const player = tied[0]!;
    links.push({
      goal,
      player,
      evidence: player.teamIds.includes(goal.teamId) ? "squad" : "events",
    });
  }

  return { links, unlinked };
}
