/**
 * Put the people the timeline named into the squad they played for.
 *
 * A recorder writes a scorer's name on the timeline. If nobody in that team's squad
 * answers to it, the goal reaches no profile and the name reaches no squad — it stays a
 * label on one event and nothing else. `db:sync:event-player-links` has been reporting
 * these for a while as *"the squad has no row for this name"*, described there as
 * somebody's data-entry job. This does that job.
 *
 * The row is created **without a shirt number**, deliberately. The number is the one
 * thing a label often cannot supply, and inventing one would be worse than leaving it
 * blank: a wrong number resolves future events to the wrong person. Staff assign it
 * later, and `db:sync:timeline-squad-numbers` then resolves the fixture's remaining
 * `No. 7` labels to this row.
 *
 * **Everything hangs on `admitSquadName`.** This creates player records, and a player
 * record is treated as a person everywhere: it collects goals and climbs a scoring
 * chart. The live directory already holds `Jersey No. 35`, `Player 1`, `VIDO 99 FC` and
 * one record whose name is five people, every one of them created by a path with no gate
 * beyond a check for emptiness. A refused label costs a line in a report; an admitted
 * bad one costs a public record somebody has to find and merge.
 *
 * The player itself goes through `PlayerDirectoryService.resolveOrCreatePlayer`, which
 * already looks the name up by dedupe key, display name and slug before creating
 * anything, and creates a **draft, non-public** shell when it must. Reused rather than
 * reimplemented: a second path that created players slightly differently is how the
 * directory ended up with 165 names held by more than one record.
 */
import { playerLookupKey } from "@dtp/engines";
import { reorderKey } from "../players/squad-duplicates";
import { PlaceholderPlayerNameError } from "../players/placeholder-names";
import {
  admitSquadName,
  type SquadNameRejection,
} from "../players/admissible-squad-name";

/** The three label columns an event can name somebody in. */
const LABEL_FIELDS = ["playerLabel", "playerLabel2", "assistLabel"] as const;

export type TimelineEventLabels = {
  teamId: string | null;
  playerLabel: string | null;
  playerLabel2: string | null;
  assistLabel: string | null;
};

export type SquadCandidate = { teamId: string; label: string; name: string; key: string };

export type SquadAddition = SquadCandidate & {
  /** Whether the player already existed or had to be created. */
  player: "existing" | "new";
  playerId: string | null;
};

export type SquadRejectionRow = {
  teamId: string;
  label: string;
  name: string;
  reason: SquadNameRejection | "is-a-team" | "directory-refused" | "write-failed";
};

/**
 * The distinct (team, name) pairs a timeline names, minus anything inadmissible.
 *
 * Pure, so the whole gate is testable without a database. One label naming the same
 * person in ten events yields one candidate.
 */
export function squadCandidatesFrom(events: TimelineEventLabels[]) {
  const candidates = new Map<string, SquadCandidate>();
  const rejected: SquadRejectionRow[] = [];
  const seenRejects = new Set<string>();

  for (const event of events) {
    if (!event.teamId) continue;
    for (const field of LABEL_FIELDS) {
      const label = event[field];
      if (!label?.trim()) continue;
      const verdict = admitSquadName(label);
      if (!verdict.ok) {
        const k = `${event.teamId}|${verdict.name}|${verdict.reason}`;
        if (!seenRejects.has(k)) {
          seenRejects.add(k);
          rejected.push({
            teamId: event.teamId,
            label,
            name: verdict.name,
            reason: verdict.reason,
          });
        }
        continue;
      }
      const key = playerLookupKey(verdict.name);
      if (!key) continue;
      const k = `${event.teamId}|${key}`;
      if (!candidates.has(k)) {
        candidates.set(k, { teamId: event.teamId, label, name: verdict.name, key });
      }
    }
  }

  return { candidates: [...candidates.values()], rejected };
}

/**
 * Which candidates the squad does not already hold.
 *
 * Matched on the dedupe key rather than the stored spelling, so `NWOSU HENRY` in the
 * squad and `Nwosu Henry` on the timeline are one person and no second row is created.
 *
 * Matching by key alone has one gap worth naming: a squad row whose display name was
 * edited to something the timeline never used — a nickname, or a correction — will not
 * match, and a second row gets created for the same person. `db:dedupe:squad-members`
 * is what folds those together, and a duplicate squad row is recoverable in a way an
 * invented shirt number is not.
 *
 * **Reversed spellings are matched too, and that is not a nicety.** A merge repoints an
 * already-linked event but leaves its label as the recorder wrote it, so the timeline keeps
 * saying `Onyebuchi Nwabueze` after that record was folded into `Nwabueze Onyebuchi`. On a
 * key-only match this run proposed 69 new records, and roughly 35 of them were reversals of
 * records `db:merge:squad-duplicates` had deleted hours earlier — it would have undone that
 * merge in one pass, quietly, and the report would have read like ordinary new players.
 *
 * The rule is the one that merge already rests on: within a single squad, no two players
 * share a first or last name even swapped, so the same words in any order are one person.
 * They are returned separately rather than silently dropped, because a reader should see
 * how many rows were not created and why.
 */
export function missingFromSquad(
  candidates: SquadCandidate[],
  squad: { teamId: string; displayName: string; playerId: string | null }[]
) {
  const held = new Set<string>();
  const heldByWords = new Map<string, string>();
  for (const row of squad) {
    const key = playerLookupKey(row.displayName);
    if (!key) continue;
    held.add(`${row.teamId}|${key}`);
    /* Same words, any order. `db:merge:squad-duplicates` folds these together within one
       squad on the rule that no two players in a team share a first or last name, even
       swapped -- so a squad already holding `Nwabueze Onyebuchi` holds the boy the label
       `Onyebuchi Nwabueze` names. */
    const words = reorderKey(row.displayName);
    if (words && !heldByWords.has(`${row.teamId}|${words}`)) {
      heldByWords.set(`${row.teamId}|${words}`, row.displayName);
    }
  }

  const missing: SquadCandidate[] = [];
  const sameWordsDifferentOrder: { candidate: SquadCandidate; squadSpelling: string }[] = [];
  for (const candidate of candidates) {
    if (held.has(`${candidate.teamId}|${candidate.key}`)) continue;
    const spelling = heldByWords.get(`${candidate.teamId}|${reorderKey(candidate.name)}`);
    if (spelling) {
      sameWordsDifferentOrder.push({ candidate, squadSpelling: spelling });
      continue;
    }
    missing.push(candidate);
  }
  return { missing, sameWordsDifferentOrder };
}

/**
 * Drop any candidate whose name is one of the competition's own team names.
 *
 * The token rules in `admitSquadName` catch `VIDO 99 FC` and `Star To Be FA`, but they
 * cannot catch `Franceex United` -- which is a team in this database and was queued to
 * join its own squad as a player. No list of suffixes was ever going to be enough,
 * because a club can be named anything.
 *
 * The database already knows every team's name, so this asks it rather than guessing.
 * Matched on the dedupe key, so casing and punctuation cannot slip a name past.
 */
export function withoutTeamNames(
  candidates: SquadCandidate[],
  teamNames: string[]
) {
  const keys = new Set(
    teamNames.map((name) => playerLookupKey(name)).filter((key): key is string => Boolean(key))
  );
  const kept: SquadCandidate[] = [];
  const teams: SquadCandidate[] = [];
  for (const candidate of candidates) {
    if (keys.has(candidate.key)) teams.push(candidate);
    else kept.push(candidate);
  }
  return { kept, teams };
}
export type SquadFromTimelineDeps = {
  /** Only the calls this needs, so a test can supply a fake without a schema. */
  db: {
    sbTeamSquad: {
      findMany: (args: unknown) => Promise<
        { teamId: string; displayName: string; playerId: string | null }[]
      >;
      create: (args: unknown) => Promise<{ id: string }>;
    };
    player: {
      findUnique: (args: unknown) => Promise<{ id: string; displayName: string } | null>;
    };
    sbTeam: {
      findMany: (args: unknown) => Promise<{ name: string }[]>;
    };
  };
  /** `PlayerDirectoryService.resolveOrCreatePlayer`, passed in rather than imported. */
  /**
   * The directory's create-or-find, which also tidies the name it stores.
   *
   * Its `displayName` comes back because the row is written with it rather than with the
   * raw label: the directory turns `NWOSU HENRY` into `Nwosu Henry`, and a squad row still
   * holding the shouted spelling is the "copies that disagree with the player holding them"
   * category `db:repair:player-display-names` has to realign -- 445 of them on the last run.
   */
  resolvePlayer: (displayName: string) => Promise<{ id: string; displayName: string }>;
};

/**
 * Add a squad row for every person the timeline named who is not in the squad.
 *
 * Fails safe, one candidate at a time. A label that cannot become a player — the
 * directory's own placeholder guard refusing it, or any other error on that one row —
 * is recorded and skipped, never thrown. This runs on the tail of a recorder publishing
 * a sheet, and a bad label must not be able to fail that publish: the recorder would
 * have no idea why, and the events they just spent ninety minutes capturing are worth
 * more than the squad row.
 */
export async function addSquadMembersFromTimeline(
  deps: SquadFromTimelineDeps,
  events: TimelineEventLabels[],
  options: {
    dryRun?: boolean;
    /**
     * Add a squad row only where the directory already holds the person.
     *
     * The two halves of this run carry very different risk. A row for somebody already in
     * the directory is a join, reversible by deleting the row. A row that creates a player
     * is a person everywhere in the product, and on the live data most of those are not
     * names anybody wants -- nineteen initials, one semicolon-joined pair. Being able to
     * take the safe half and leave the rest is what stops the whole run waiting on them.
     *
     * Held candidates are returned in `heldForNewRecord`, never dropped quietly.
     */
    existingPlayersOnly?: boolean;
  } = {}
) {
  const { candidates, rejected } = squadCandidatesFrom(events);
  if (!candidates.length)
    return {
      added: [],
      rejected,
      alreadyInSquad: 0,
      sameWordsDifferentOrder: [],
      heldForNewRecord: [],
    };

  const teamIds = [...new Set(candidates.map((c) => c.teamId))];

  /* Before anything else: a label that is one of this competition's team names is not
     a person, whatever it looks like. `Franceex United` was queued to join its own
     squad and no suffix rule would have stopped it. */
  const allTeams = await deps.db.sbTeam.findMany({ select: { name: true } });
  const split = withoutTeamNames(candidates, allTeams.map((t) => t.name));
  for (const team of split.teams) {
    rejected.push({
      teamId: team.teamId,
      label: team.label,
      name: team.name,
      reason: "is-a-team",
    });
  }

  const squad = await deps.db.sbTeamSquad.findMany({
    where: { teamId: { in: teamIds } },
    select: { teamId: true, displayName: true, playerId: true },
  });
  const { missing, sameWordsDifferentOrder } = missingFromSquad(split.kept, squad);

  const added: SquadAddition[] = [];
  const heldForNewRecord: typeof missing = [];
  for (const candidate of missing) {
    try {
      const existing = await deps.db.player.findUnique({
        where: { normalizedName: candidate.key },
        select: { id: true, displayName: true },
      });

      /* Before the dry-run branch, so a dry run and an apply with the same flags report
         the same split. */
      if (!existing && options.existingPlayersOnly) {
        heldForNewRecord.push(candidate);
        continue;
      }

      if (options.dryRun) {
        added.push({
          ...candidate,
          player: existing ? "existing" : "new",
          playerId: existing?.id ?? null,
        });
        continue;
      }

      const player = existing ?? (await deps.resolvePlayer(candidate.name));
      await deps.db.sbTeamSquad.create({
        data: {
          teamId: candidate.teamId,
          playerId: player.id,
          /* The player's name, not the label. They differ whenever the directory tidied it,
             and a row holding the other spelling is a copy that disagrees with its own
             player from the moment it is written. */
          displayName: player.displayName,
          /* Left blank on purpose. A number invented here would resolve future events
             to the wrong person, which is worse than a row waiting for one. */
          shirtNumber: null,
        },
      });
      added.push({
        ...candidate,
        player: existing ? "existing" : "new",
        playerId: player.id,
      });
    } catch (error) {
      /* The directory's own guard refused it, or this single row failed. Either way the
         run continues: see the note above on not failing a recorder's publish. */
      rejected.push({
        teamId: candidate.teamId,
        label: candidate.label,
        name: candidate.name,
        /* Told apart because they need different actions. The directory refusing a name
           is the guard working and wants no follow-up; anything else is a fault worth
           looking at. */
        reason: error instanceof PlaceholderPlayerNameError ? "directory-refused" : "write-failed",
      });
    }
  }

  return {
    added,
    rejected,
    heldForNewRecord,
    /* Names already present count the reversed spellings too: a row was not created
       because the boy is there under the other order, which is a kind of "already in the
       squad" and not a kind of refusal. */
    alreadyInSquad: split.kept.length - missing.length,
    sameWordsDifferentOrder,
  };
}
