/**
 * Fold the players a squad lists twice into one.
 *
 *   pnpm --filter @dtp/api db:merge:squad-duplicates          # report only
 *   pnpm --filter @dtp/api db:merge:squad-duplicates --apply  # merge and delete
 *
 * `Abubakar Abdullah` and `Abdullah Abubakar` on one team sheet are the same boy. Nigerian
 * records are written surname-first or given-name-first depending on who fills the form,
 * so both spellings become separate squad rows and often separate `Player` records —
 * splitting his goals across two profiles, neither of which is right.
 *
 * `db:merge:duplicate-players` deliberately refuses a reversed pair, and says why:
 *
 * > *"those have different canonical keys, both are valid, and deciding they are one
 * > person is a judgement this should not make on its own."*
 *
 * **Within one squad, it is.** That scoping is the entire basis for this tool, and the
 * reason it can act where the directory-wide one cannot: across competitions
 * `Clems Henry` and `Henry Clems` could be two people, while on one team sheet they are
 * one player written down twice. See `squad-duplicates.ts`.
 *
 * **This is the irreversible one.** It deletes player records. Two things follow from
 * that. The dry run lists every group with every spelling, because that list is where a
 * human catches the case nothing here can detect — two genuinely different people in one
 * squad whose names are each other's reverse, brothers most plausibly. And the merge
 * itself is `mergePlayerRecords`, the same function behind the admin's Merge Players
 * button, so there is no second implementation to drift.
 *
 * Career totals: `mergePlayerRecords` raises the survivor's to its own competition rows
 * and never copies the folded record's, for the reasons in that file. Run
 * `db:repair:player-stats` afterwards.
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { mergePlayerRecords } from "../src/players/merge-player-records";
import {
  planSquadDuplicates,
  type SquadMemberRow,
} from "../src/players/squad-duplicates";
import { chooseMergeTarget, type MergeCandidate } from "./merge-target";

loadApiEnv();

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
/** Print the redundant-row list in full as well. The fold list is always complete. */
const ALL = process.argv.includes("--all");
/**
 * How many of the safe, reversible groups to print before summarising.
 *
 * The irreversible list is **never** truncated, whatever this says. On live the dry run
 * found 48 groups to fold and printed 40, so eight merges that delete player records were
 * about to be approved by somebody who had not been shown them — while this file's own
 * docstring promised that "the dry run lists every group with every spelling, because that
 * list is where a human catches the case nothing here can detect".
 *
 * A cap is still right for the redundant rows: 180 of them, none of which destroys a
 * record, and a wall of them is what stops the dangerous list being read at all. `--all`
 * prints them.
 */
const SHOWN = 40;

async function main() {
  console.log(
    `Players a squad lists twice — ${APPLY ? "APPLYING" : "dry run, pass --apply to merge"}\n`
  );

  const squadRows = await prisma.sbTeamSquad.findMany({
    select: {
      id: true,
      teamId: true,
      playerId: true,
      displayName: true,
      team: { select: { name: true } },
      player: {
        select: {
          id: true,
          displayName: true,
          slug: true,
          createdAt: true,
          playerPhotoUrl: true,
          academyId: true,
        },
      },
      _count: { select: { matchSquadPlayers: true } },
    },
  });

  const rows: SquadMemberRow[] = squadRows.map((row) => ({
    rowId: row.id,
    teamId: row.teamId,
    playerId: row.playerId,
    /* The player's own name when linked, because that is the one the display-name tools
       keep tidy; the row's own spelling otherwise. */
    name: row.player?.displayName ?? row.displayName,
    matchSquadCount: row._count.matchSquadPlayers,
    hasProfile: Boolean(row.player?.playerPhotoUrl || row.player?.academyId),
    slug: row.player?.slug ?? null,
    /* `SbTeamSquad` carries no timestamp of its own, so the player's stands in. Two
       unlinked rows therefore tie here and fall through to the row id, which is what
       keeps the choice stable across runs. */
    createdAt: row.player?.createdAt ?? new Date(0),
  }));

  const teamNames = new Map(squadRows.map((row) => [row.teamId, row.team.name]));
  const duplicates = planSquadDuplicates(rows);
  const toMerge = duplicates.filter((d) => d.playerIds.length > 1);
  const rowsOnly = duplicates.filter((d) => d.playerIds.length <= 1);

  console.log(`  ${squadRows.length} squad row(s) across ${teamNames.size} team(s)`);
  console.log(`  ${duplicates.length} squad(s) listing somebody twice`);
  console.log(`  ${toMerge.length} of those hold two or more player records to fold`);
  console.log(
    `  ${rowsOnly.length} are one record listed twice — a redundant row, nothing to merge\n`
  );

  if (!duplicates.length) {
    console.log("No squad lists anybody twice. Nothing to do.");
    return;
  }

  /* Event counts decide which record survives, so they are fetched only for the players
     actually in a group rather than for the whole directory. */
  const playerIds = [...new Set(toMerge.flatMap((d) => d.playerIds))];
  const eventCounts = new Map<string, number>();
  for (const id of playerIds) {
    eventCounts.set(
      id,
      await prisma.sbMatchEvent.count({
        where: { OR: [{ playerId: id }, { assistPlayerId: id }] },
      })
    );
  }
  const players = new Map(
    (
      await prisma.player.findMany({
        where: { id: { in: playerIds } },
        select: {
          id: true,
          displayName: true,
          slug: true,
          createdAt: true,
          playerPhotoUrl: true,
          academyId: true,
        },
      })
    ).map((p) => [p.id, p])
  );

  const candidateFor = (id: string): MergeCandidate => {
    const p = players.get(id)!;
    return {
      id: p.id,
      displayName: p.displayName,
      slug: p.slug,
      hasProfile: Boolean(p.playerPhotoUrl || p.academyId),
      events: eventCounts.get(id) ?? 0,
      createdAt: p.createdAt,
    };
  };

  if (toMerge.length) {
    console.log(`Records to fold (${toMerge.length})`);
    console.log("-".repeat(76));
    console.log(
      "  Read this list. Two people in one squad whose names are each other's reverse\n" +
        "  would look exactly like one person written twice, and nothing here can tell them\n" +
        "  apart. Brothers are the plausible case. A merge cannot be undone by re-running.\n"
    );
    /* Every one of them, never a slice: this is the list the paragraph above tells a human
       to read, and the records it describes cannot be brought back. */
    for (const group of toMerge) {
      const choice = chooseMergeTarget(group.playerIds.map(candidateFor));
      console.log(`  ${(teamNames.get(group.teamId) ?? group.teamId).slice(0, 34).padEnd(36)}`);
      console.log(`      keep   ${choice.target.displayName}  (${choice.why})`);
      for (const source of choice.sources) {
        console.log(
          `      fold   ${source.displayName}  — ${source.events} event(s) move across`
        );
      }
    }
  }

  if (rowsOnly.length) {
    console.log(`\nRedundant rows only (${rowsOnly.length})`);
    console.log("-".repeat(76));
    console.log(
      "  One player record listed twice in the squad, or two rows neither of which is\n" +
        "  linked. Nothing to merge; the extra row is deleted so the name resolves to one\n" +
        "  player again and goals stop reaching nobody.\n"
    );
    for (const group of ALL ? rowsOnly : rowsOnly.slice(0, SHOWN)) {
      console.log(
        `  ${(teamNames.get(group.teamId) ?? group.teamId).slice(0, 34).padEnd(36)} ${group.names.join(" / ")}`
      );
    }
    if (!ALL && rowsOnly.length > SHOWN) {
      console.log(`  … and ${rowsOnly.length - SHOWN} more — pass --all to list them`);
    }
  }

  if (!APPLY) {
    console.log("\n" + "-".repeat(76));
    console.log(
      "Nothing was written. Re-run with --apply.\n" +
        "Run db:repair:player-stats afterwards: a merge raises the survivor's career total\n" +
        "to its own competition rows and never copies the folded record's."
    );
    return;
  }

  let merged = 0;
  let rowsDeleted = 0;
  for (const group of duplicates) {
    /* One transaction per squad: the records fold and the extra rows go together, or
       neither happens. A half-done group leaves a squad listing a player whose record
       has already been deleted. */
    await prisma.$transaction(
      async (tx) => {
        if (group.playerIds.length > 1) {
          const choice = chooseMergeTarget(group.playerIds.map(candidateFor));
          for (const source of choice.sources) {
            await mergePlayerRecords(tx, {
              sourcePlayerId: source.id,
              targetPlayerId: choice.target.id,
              removeSource: true,
            });
            merged += 1;
          }
        }
        /* After the fold every row in the group points at the survivor, so the extras are
           duplicates of one another and the ranked-first row is the one to keep. */
        const removed = await tx.sbTeamSquad.deleteMany({
          where: { id: { in: group.redundantRowIds } },
        });
        rowsDeleted += removed.count;
      },
      { timeout: 30_000 }
    );
  }

  console.log("\n" + "-".repeat(76));
  console.log(`Folded ${merged} player record(s) and deleted ${rowsDeleted} squad row(s).`);

  /* Re-read rather than trust the writes: a squad still listing somebody twice after this
     ran means the plan and the writes disagree. */
  const after = await prisma.sbTeamSquad.findMany({
    select: {
      id: true,
      teamId: true,
      playerId: true,
      displayName: true,
      player: { select: { displayName: true, createdAt: true, slug: true } },
      _count: { select: { matchSquadPlayers: true } },
    },
  });
  const leftover = planSquadDuplicates(
    after.map((row) => ({
      rowId: row.id,
      teamId: row.teamId,
      playerId: row.playerId,
      name: row.player?.displayName ?? row.displayName,
      matchSquadCount: row._count.matchSquadPlayers,
      hasProfile: false,
      slug: row.player?.slug ?? null,
      createdAt: row.player?.createdAt ?? new Date(0),
    }))
  );
  console.log(`  squads still listing somebody twice: ${leftover.length}`);
  if (leftover.length) {
    console.log("  WARNING: expected zero. Re-run the dry run and look before doing more.");
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
