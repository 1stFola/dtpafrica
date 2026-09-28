/**
 * Put the people the timeline named into the squads they played for.
 *
 *   pnpm --filter @dtp/api db:sync:squad-from-timeline          # report only
 *   pnpm --filter @dtp/api db:sync:squad-from-timeline --apply  # write
 *
 * The publish path now does this as a sheet is approved. This is the backlog: every
 * match already recorded, whose scorers were never added to a squad.
 *
 * `db:sync:event-player-links` has been reporting these for a while — *"No matching
 * player: the squad has no row for this name"* — and calling it somebody's data-entry
 * job. An unlinked label costs a goal that reaches no profile and no scoring chart while
 * the fixture page looks perfectly fine, which is why nothing surfaced it on its own.
 *
 * **Read the dry run before applying.** This creates player records, and a player record
 * is a person everywhere in the product: it collects goals and climbs a scoring chart.
 * The live directory already holds `Jersey No. 35`, `Player 1`, `VIDO 99 FC` and one
 * record whose name is five people, each created by a path with no gate. `admitSquadName`
 * is that gate now, and the dry run is where you check what it admits against real
 * labels rather than against the examples its tests were written with.
 *
 * Rows are created with **no shirt number**. Inventing one would resolve future events to
 * the wrong person; staff assign it, and `db:sync:timeline-squad-numbers` then resolves
 * that fixture's remaining `No. 7` labels to the row.
 */
import { PrismaClient } from "@prisma/client";
import { playerLookupKey } from "@dtp/engines";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { resolveUniquePlayerSlug, slugifyPlayerName } from "../src/players/player-slug";
import {
  addSquadMembersFromTimeline,
  type SquadAddition,
  type SquadRejectionRow,
} from "../src/scoreboard/squad-from-timeline";

loadApiEnv();

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const SHOWN = 30;

/**
 * The directory's create path, without the Nest service.
 *
 * `PlayerDirectoryService.resolveOrCreatePlayer` is a Nest injectable and a script has no
 * container, so the same steps are done here against the same tables: look the name up by
 * dedupe key first, and only create when nothing holds it. The created shell is `draft`
 * and not public, exactly as the service makes it, so a name harvested from a label never
 * appears in the public directory until somebody approves it.
 */
async function resolvePlayer(displayName: string) {
  const key = playerLookupKey(displayName);
  if (!key) throw new Error(`"${displayName}" normalises to nothing`);

  const existing = await prisma.player.findUnique({ where: { normalizedName: key } });
  if (existing) return existing;

  const parts = displayName.trim().split(/\s+/);
  const firstName = parts[0]!;
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : parts[0]!;
  const slug = await resolveUniquePlayerSlug(prisma, displayName);
  void slugifyPlayerName;

  return prisma.player.create({
    data: {
      firstName,
      lastName,
      displayName,
      normalizedName: key,
      slug,
      positionPrimary: "MF",
      registrationStatus: "draft",
      isPublic: false,
    },
  });
}

function groupByTeam<T extends { teamId: string }>(rows: T[], names: Map<string, string>) {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const team = names.get(row.teamId) ?? row.teamId;
    const list = out.get(team) ?? [];
    list.push(row);
    out.set(team, list);
  }
  return new Map([...out].sort((a, b) => a[0].localeCompare(b[0])));
}

async function main() {
  console.log(
    `Squad rows from timeline labels — ${APPLY ? "APPLYING" : "dry run, pass --apply to write"}\n`
  );

  const events = await prisma.sbMatchEvent.findMany({
    select: { teamId: true, playerLabel: true, playerLabel2: true, assistLabel: true },
  });
  console.log(`  ${events.length} event(s) read`);

  const result = await addSquadMembersFromTimeline(
    {
      db: prisma as never,
      resolvePlayer,
    },
    events,
    { dryRun: !APPLY }
  );

  const teamNames = new Map(
    (
      await prisma.sbTeam.findMany({
        where: {
          id: {
            in: [...new Set([...result.added, ...result.rejected].map((r) => r.teamId))],
          },
        },
        select: { id: true, name: true },
      })
    ).map((t) => [t.id, t.name])
  );

  const created = result.added.filter((a) => a.player === "new");
  const linked = result.added.filter((a) => a.player === "existing");

  console.log(`  ${result.alreadyInSquad} name(s) already in their squad`);
  console.log(`  ${linked.length} squad row(s) ${APPLY ? "added" : "to add"} for a player who already exists`);
  console.log(
    `  ${created.length} squad row(s) ${APPLY ? "added" : "to add"} with a new player record`
  );
  console.log(`  ${result.rejected.length} label(s) refused\n`);

  if (linked.length) {
    console.log(`Existing players joining a squad (${linked.length})`);
    console.log("-".repeat(72));
    console.log(
      "  Already in the directory, just not in this team's squad. The safe half of this\n" +
        "  run: no new record is created.\n"
    );
    report(linked, teamNames);
  }

  if (created.length) {
    console.log(`\nNew player records (${created.length}) — read this list`);
    console.log("-".repeat(72));
    console.log(
      "  Nobody in the directory answers to these names, so each becomes a new player.\n" +
        "  A record here is a person everywhere in the product. Anything in this list that\n" +
        "  is not a footballer's name should be fixed at the event label first, because\n" +
        "  once created it collects goals and somebody has to find and merge it.\n"
    );
    report(created, teamNames);
  }

  if (result.rejected.length) {
    const byReason = new Map<string, SquadRejectionRow[]>();
    for (const row of result.rejected) {
      const list = byReason.get(row.reason) ?? [];
      list.push(row);
      byReason.set(row.reason, list);
    }
    console.log(`\nLabels refused (${result.rejected.length})`);
    console.log("-".repeat(72));
    console.log(
      "  Each of these would have become a person under a gate that only checked for\n" +
        "  emptiness, which is how the directory acquired the ones it already has.\n"
    );
    for (const [reason, rows] of [...byReason].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${reason} (${rows.length})`);
      for (const row of rows.slice(0, 8)) {
        console.log(`      ${row.name.slice(0, 52)}`);
      }
      if (rows.length > 8) console.log(`      … and ${rows.length - 8} more`);
    }
  }

  if (!APPLY) {
    console.log("\n" + "-".repeat(72));
    console.log(
      "Nothing was written. Re-run with --apply.\n" +
        "Every row is created without a shirt number, for staff to assign. Running\n" +
        "db:sync:timeline-squad-numbers afterwards resolves the No. 7 labels to them."
    );
    return;
  }

  console.log("\n" + "-".repeat(72));
  console.log(
    `Added ${result.added.length} squad row(s): ${created.length} with a new player record, ` +
      `${linked.length} linked to one that already existed.`
  );

  /* Re-read rather than trust the writes, and the honest check is the second run: a name
     added now must not be offered again. */
  const again = await addSquadMembersFromTimeline(
    { db: prisma as never, resolvePlayer },
    events,
    { dryRun: true }
  );
  console.log(`  names still missing from their squad: ${again.added.length}`);
  if (again.added.length) {
    console.log("  WARNING: expected zero. Re-run the dry run and look before doing more.");
    process.exitCode = 1;
  }
}

function report(rows: SquadAddition[], teamNames: Map<string, string>) {
  for (const [team, list] of groupByTeam(rows, teamNames)) {
    console.log(`  ${team}  (${list.length})`);
    for (const row of list.slice(0, SHOWN)) {
      const via = row.label === row.name ? "" : `   (from "${row.label.slice(0, 30)}")`;
      console.log(`      ${row.name.padEnd(28)}${via}`);
    }
    if (list.length > SHOWN) console.log(`      … and ${list.length - SHOWN} more`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
