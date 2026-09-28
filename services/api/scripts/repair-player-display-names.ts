/**
 * Tidy the display names that are spelled badly but belong to the right person.
 *
 *   pnpm --filter @dtp/api db:repair:player-display-names          # report only
 *   pnpm --filter @dtp/api db:repair:player-display-names --apply  # write
 *
 * On live: `NWOSU HENRY`, `YUSUF TAIWO AKANBI`, `JOEL EMMANUEL` and `OGUNDEJI ELIJAH`
 * shout, because the all-capitals record won its merge — `chooseMergeTarget` ranks a
 * real profile and a canonical slug above a tidier-looking name, deliberately, since
 * casing says nothing about which record people actually use. `Daniel  Matthew` has
 * two spaces. `Emmanuel Jac9b` has a 9 where the o belongs.
 *
 * None of this changes a single number. It is presentation, and the rules live in
 * `tidy-player-name.ts` with the reasoning for each.
 *
 * **Why this is not an UPDATE statement.** A player's name is denormalised into four
 * more places, and a name fixed in one of them is a name that disagrees with itself:
 *
 *   - `SbTeamSquad.displayName` — the squad list
 *   - `SbMatchSquadPlayer.playerName` — the lineup for one match
 *   - `SbMatchEvent.playerLabel`, `playerLabel2`, `assistLabel` — what was written on
 *     the sheet when the goal was recorded
 *
 * The event labels are matched case-insensitively against the *old* name and set to
 * the new one, which is the same thing `mergePlayerRecords` does when it claims a
 * folded record's labels. A label that reads something else entirely is left alone:
 * it is not this player's name and guessing otherwise would detach a goal.
 *
 * **The slug is never touched.** `/nwosu-henry` is already lowercase, so casing makes
 * no difference to it — and it is the URL anybody has ever shared. A correction that
 * moved slugs would break links to gain nothing.
 *
 * **What can go wrong, and is checked first.** `playerLookupKey` lowercases and
 * collapses whitespace, so tidying casing or spacing cannot move a player's dedupe
 * key. Correcting a misspelling *does* move it: `emmanuel jac9b` becomes
 * `emmanuel jacob`, and if another record already holds that key the write fails on
 * the unique index. Those are reported and skipped rather than met as a constraint
 * violation — the same failure that broke the admin's incremental seed once already.
 */
import { PrismaClient } from "@prisma/client";
import { playerLookupKey } from "@dtp/engines";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { isPlaceholderName } from "../src/players/placeholder-names";
import {
  hasDigit,
  tidyPlayerName,
  tokenCorrections,
} from "../src/players/tidy-player-name";

loadApiEnv();

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** How many to describe in full. The rest are counted, being the same kind of change. */
const SHOWN = 25;

type Candidate = {
  id: string;
  from: string;
  to: string;
  firstName: string;
  lastName: string;
  newFirstName: string;
  newLastName: string;
  keyMoves: boolean;
  newKey: string | null;
  blockedBy: { id: string; displayName: string } | null;
};

async function main() {
  console.log(
    `Player display names — ${APPLY ? "APPLYING" : "dry run, pass --apply to write"}\n`
  );

  const players = await prisma.player.findMany({
    select: {
      id: true,
      displayName: true,
      firstName: true,
      lastName: true,
      normalizedName: true,
      slug: true,
    },
  });

  const candidates: Candidate[] = [];
  for (const p of players) {
    const to = tidyPlayerName(p.displayName);
    if (to === p.displayName) continue;

    /* A tidy that produced a placeholder would be a rule gone wrong, not a fix.
       Cheap to check, and the alternative is discovering it on a leaderboard. */
    if (isPlaceholderName(to)) {
      console.log(`  SKIPPED ${p.displayName} -> ${to}: reads as a placeholder`);
      continue;
    }

    /* Carried into firstName and lastName so the record does not half-agree with
       itself. Casing and spacing always; a respelling only where the correction can
       be lined up token by token. */
    const perToken = tokenCorrections(p.displayName, to);
    const carry = (field: string) => {
      const tidied = tidyPlayerName(field);
      return perToken.get(tidied) ?? perToken.get(field) ?? tidied;
    };

    const newKey = playerLookupKey(to) || null;
    const keyMoves = newKey !== p.normalizedName;
    let blockedBy: Candidate["blockedBy"] = null;
    if (keyMoves && newKey) {
      const held = await prisma.player.findFirst({
        where: { normalizedName: newKey, id: { not: p.id } },
        select: { id: true, displayName: true },
      });
      if (held) blockedBy = held;
    }

    candidates.push({
      id: p.id,
      from: p.displayName,
      to,
      firstName: p.firstName,
      lastName: p.lastName,
      newFirstName: carry(p.firstName),
      newLastName: carry(p.lastName),
      keyMoves,
      newKey,
      blockedBy,
    });
  }

  const actionable = candidates.filter((c) => !c.blockedBy);
  const blocked = candidates.filter((c) => c.blockedBy);

  console.log(`  ${players.length} player records read`);
  console.log(`  ${actionable.length} name(s) to ${APPLY ? "tidy" : "be tidied"}`);
  console.log(`  ${blocked.length} blocked by another record holding the corrected key`);

  const withDigits = players.filter((p) => hasDigit(p.displayName));
  console.log(`  ${withDigits.length} name(s) containing a digit\n`);

  /* Computed before the early return below, not after it. The copies can be stale
     while every Player row is already tidy -- which is the commonest shape this run
     will take from now on -- and a return that fires on an empty first pass would
     skip the second entirely. The same mistake `repair-player-stats` had, found the
     same way: by running it twice and noticing the second run claimed nothing to do.
     */
  const stale = await countStaleCopies();
  const staleTotal =
    stale.tidyable.squad + stale.tidyable.lineup + stale.tidyable.primaryLabel + stale.tidyable.assistLabel;
  const differentTotal =
    stale.different.squad + stale.different.lineup + stale.different.primaryLabel + stale.different.assistLabel;

  if (!actionable.length && !blocked.length && !staleTotal) {
    console.log("Every display name is already tidy. Nothing to do.");
    if (withDigits.length) reportDigits(withDigits);
    return;
  }

  if (actionable.length) {
    console.log(`Names ${APPLY ? "tidied" : "to tidy"} (${actionable.length})`);
    console.log("-".repeat(72));
    /* Capped, and the copy counts are gathered only for the rows shown. Uncapped this
       printed four lines and ran five queries for each of 471 names, which is both
       unreadable and slow enough to discourage running the dry run at all. */
    for (const c of actionable.slice(0, SHOWN)) {
      console.log(`  ${c.from}`);
      console.log(`    -> ${c.to}`);
      if (c.newFirstName !== c.firstName || c.newLastName !== c.lastName) {
        console.log(
          `       also ${c.firstName}/${c.lastName} -> ${c.newFirstName}/${c.newLastName}`
        );
      }
      if (c.keyMoves) {
        console.log(`       dedupe key moves to "${c.newKey}" — nothing else holds it`);
      }
      /* Printed because it is the number that says how far this reaches, and a run
         that touched nothing but the Player row would be a run that half-worked. */
      const counts = await copies(c.id, c.from);
      console.log(
        `       copies: ${counts.squad} squad row(s), ${counts.matchSquad} lineup row(s), ` +
          `${counts.labels} event label(s)`
      );
    }
    if (actionable.length > SHOWN) {
      console.log(`  … and ${actionable.length - SHOWN} more, all the same kind of change`);
    }
  }

  if (blocked.length) {
    console.log(`\nBlocked (${blocked.length})`);
    console.log("-".repeat(72));
    console.log(
      "  Correcting the spelling would move the dedupe key onto one another record\n" +
        "  already holds, and the unique index would refuse the write. These are two\n" +
        "  records for one person: merge them first with db:merge:duplicate-players,\n" +
        "  then run this again.\n"
    );
    for (const c of blocked) {
      console.log(`  ${c.from} -> ${c.to}`);
      console.log(`    key "${c.newKey}" is held by ${c.blockedBy!.displayName}`);
    }
  }

  if (withDigits.length) reportDigits(withDigits);


  console.log(
    `\nCopies of a name that disagree with the player holding it (${staleTotal})`
  );
  console.log("-".repeat(72));
  console.log(
    "  A squad row, lineup row or event label whose spelling differs from its own\n" +
      "  player's, by casing or spacing alone. These are set to the player's name." + "\n"
  );
  console.log(
    `    ${stale.tidyable.squad} squad row(s), ${stale.tidyable.lineup} lineup row(s), ` +
      `${stale.tidyable.primaryLabel} scorer label(s), ${stale.tidyable.assistLabel} assist label(s)`
  );
  if (differentTotal) {
    console.log(
      `\n  ${differentTotal} more hold a genuinely different name and are left alone:` +
        ` ${stale.different.squad} squad, ${stale.different.lineup} lineup, ` +
        `${stale.different.primaryLabel} scorer, ${stale.different.assistLabel} assist.` +
        ` That is a spelling somebody chose or a row linked to the wrong person,` +
        ` and neither is presentation.`
    );
  }

  if (!APPLY) {
    console.log("\n" + "-".repeat(72));
    console.log("Nothing was written. Re-run with --apply.");
    return;
  }

  let written = 0;
  let squadRows = 0;
  let lineupRows = 0;
  let labels = 0;
  for (const c of actionable) {
    /* One transaction per player: the Player row and every copy of the name move
       together, or none of them do. A half-renamed player is worse than a shouting
       one, because the squad list and the profile would disagree and nothing would
       say which is right. */
    const result = await prisma.$transaction(async (tx) => {
      await tx.player.update({
        where: { id: c.id },
        data: {
          displayName: c.to,
          firstName: c.newFirstName,
          lastName: c.newLastName,
          ...(c.keyMoves ? { normalizedName: c.newKey } : {}),
        },
      });

      const squad = await tx.sbTeamSquad.updateMany({
        where: { playerId: c.id },
        data: { displayName: c.to },
      });
      const lineup = await tx.sbMatchSquadPlayer.updateMany({
        where: { playerId: c.id },
        data: { playerName: c.to },
      });

      /* Matched on the old spelling, case-insensitively, exactly as
         `mergePlayerRecords` claims a folded record's labels. A label reading anything
         else is somebody else's name and stays as it is. */
      const primary = await tx.sbMatchEvent.updateMany({
        where: { playerId: c.id, playerLabel: { equals: c.from, mode: "insensitive" } },
        data: { playerLabel: c.to },
      });
      const secondary = await tx.sbMatchEvent.updateMany({
        where: { playerLabel2: { equals: c.from, mode: "insensitive" } },
        data: { playerLabel2: c.to },
      });
      const assist = await tx.sbMatchEvent.updateMany({
        where: {
          assistPlayerId: c.id,
          assistLabel: { equals: c.from, mode: "insensitive" },
        },
        data: { assistLabel: c.to },
      });

      return {
        squad: squad.count,
        lineup: lineup.count,
        labels: primary.count + secondary.count + assist.count,
      };
    });

    written += 1;
    squadRows += result.squad;
    lineupRows += result.lineup;
    labels += result.labels;
    if (written <= SHOWN) console.log(`  ${c.from} -> ${c.to}`);
  }
  if (written > SHOWN) console.log(`  … and ${written - SHOWN} more`);

  console.log("\n" + "-".repeat(72));
  /* Second pass, after the renames, so it also catches the copies those just left
     behind as well as the ones that were already stale. */
  const realigned = await realignCopies();

  console.log(
    `Tidied ${written} name(s), and with them ${squadRows} squad row(s), ` +
      `${lineupRows} lineup row(s) and ${labels} event label(s).`
  );
  console.log(
    `Realigned ${realigned.squad} squad row(s), ${realigned.lineup} lineup row(s), ` +
      `${realigned.primaryLabel} scorer label(s) and ${realigned.assistLabel} assist label(s) ` +
      `that disagreed with their own player.`
  );
  if (blocked.length) {
    console.log(`  ${blocked.length} left alone, listed above.`);
  }

  /* The point of re-reading rather than trusting the writes: a name still shouting
     after a run means a rule that does not do what its tests say. */
  const after = await prisma.player.findMany({ select: { displayName: true } });
  const remaining = after.filter((p) => tidyPlayerName(p.displayName) !== p.displayName);
  console.log(`  names still untidy: ${remaining.length - blocked.length}`);

  /* And the copies, which is the check that caught this script reporting itself
     complete while 41 squad rows and 115 lineup rows were still shouting. */
  const leftover = await countStaleCopies();
  const leftoverTotal =
    leftover.tidyable.squad +
    leftover.tidyable.lineup +
    leftover.tidyable.primaryLabel +
    leftover.tidyable.assistLabel;
  console.log(`  copies still disagreeing by casing or spacing: ${leftoverTotal}`);

  if (remaining.length - blocked.length > 0 || leftoverTotal > 0) {
    console.log("  WARNING: expected zero. Re-run the dry run and look before doing more.");
    process.exitCode = 1;
  }
}

/**
 * The denormalised copies that disagree with the player they belong to.
 *
 * A second pass exists because the first one cannot reach these. It walks players
 * whose own `displayName` needs tidying, and a squad row reading `MUIZ LAWAL` beside
 * a player already reading `Muiz Lawal` is never visited — the player is fine, only
 * the copy is stale. On the local database that was 41 squad rows and 115 lineup
 * rows left shouting after a run that reported itself complete.
 *
 * Restricted to differences of **casing and whitespace only**. A copy holding a
 * genuinely different name is somebody's decision or somebody's mistake, and either
 * way it is not presentation: those are counted and reported, never overwritten.
 * `mergePlayerRecords` does overwrite them, which is right for a merge — the folded
 * record's name is gone — and wrong here.
 */
const SAME_BUT_FOR_CASE =
  `lower(regexp_replace(%s, '\\s+', ' ', 'g')) = lower(regexp_replace(p.display_name, '\\s+', ' ', 'g'))`;

type StaleCopies = { squad: number; lineup: number; primaryLabel: number; assistLabel: number };

async function countStaleCopies(): Promise<{ tidyable: StaleCopies; different: StaleCopies }> {
  const one = async (sql: string) => {
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(sql);
    return Number(rows[0]?.n ?? 0);
  };
  const pair = async (table: string, column: string, join: string) => {
    const qualified = `${table[0]}.${column}`;
    const base = `FROM ${table} ${table[0]} JOIN players p ON p.id = ${table[0]}.${join}`;
    const differs = `${qualified} <> p.display_name`;
    const same = SAME_BUT_FOR_CASE.replace("%s", qualified);
    return {
      tidyable: await one(`SELECT COUNT(*)::bigint AS n ${base} WHERE ${differs} AND ${same}`),
      different: await one(`SELECT COUNT(*)::bigint AS n ${base} WHERE ${differs} AND NOT ${same}`),
    };
  };

  const squad = await pair("sb_team_squad", "display_name", "player_id");
  const lineup = await pair("sb_match_squad_players", "player_name", "player_id");
  const primary = await pair("sb_match_events", "player_label", "player_id");
  const assist = await pair("sb_match_events", "assist_label", "assist_player_id");

  return {
    tidyable: {
      squad: squad.tidyable,
      lineup: lineup.tidyable,
      primaryLabel: primary.tidyable,
      assistLabel: assist.tidyable,
    },
    different: {
      squad: squad.different,
      lineup: lineup.different,
      primaryLabel: primary.different,
      assistLabel: assist.different,
    },
  };
}

/** Set each stale copy to its player's name. One statement per table, not per player. */
async function realignCopies(): Promise<StaleCopies> {
  const run = (table: string, column: string, join: string) =>
    prisma.$executeRawUnsafe(
      `UPDATE ${table} AS t SET ${column} = p.display_name` +
        ` FROM players p WHERE p.id = t.${join}` +
        ` AND t.${column} <> p.display_name` +
        ` AND ${SAME_BUT_FOR_CASE.replace("%s", `t.${column}`)}`
    );
  return {
    squad: await run("sb_team_squad", "display_name", "player_id"),
    lineup: await run("sb_match_squad_players", "player_name", "player_id"),
    primaryLabel: await run("sb_match_events", "player_label", "player_id"),
    assistLabel: await run("sb_match_events", "assist_label", "assist_player_id"),
  };
}

/** How many stored copies of this name exist besides the Player row itself. */
async function copies(playerId: string, name: string) {
  const [squad, matchSquad, primary, secondary, assist] = await Promise.all([
    prisma.sbTeamSquad.count({ where: { playerId } }),
    prisma.sbMatchSquadPlayer.count({ where: { playerId } }),
    prisma.sbMatchEvent.count({
      where: { playerId, playerLabel: { equals: name, mode: "insensitive" } },
    }),
    prisma.sbMatchEvent.count({
      where: { playerLabel2: { equals: name, mode: "insensitive" } },
    }),
    prisma.sbMatchEvent.count({
      where: { assistPlayerId: playerId, assistLabel: { equals: name, mode: "insensitive" } },
    }),
  ]);
  return { squad, matchSquad, labels: primary + secondary + assist };
}

function reportDigits(players: { displayName: string }[]) {
  console.log(`\nNames containing a digit (${players.length})`);
  console.log("-".repeat(72));
  console.log(
    "  A digit in a person's name is nearly always a typo, and no rule can guess the\n" +
      "  letter it replaced. Any of these not already corrected needs a line in\n" +
      "  REVIEWED_CORRECTIONS, added by somebody who can tell what the name should be.\n"
  );
  for (const p of players.slice(0, 25)) {
    const to = tidyPlayerName(p.displayName);
    console.log(
      `  ${p.displayName.padEnd(30)} ${to !== p.displayName ? `-> ${to}` : "no correction written yet"}`
    );
  }
  if (players.length > 25) console.log(`  … and ${players.length - 25} more`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
