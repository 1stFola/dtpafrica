/**
 * Put `Player.normalizedName` back to what every dedupe check expects.
 *
 *   pnpm --filter @dtp/api db:repair:player-lookup-keys          # report only
 *   pnpm --filter @dtp/api db:repair:player-lookup-keys --apply  # write
 *
 * That column is the directory's dedupe key, and it is supposed to hold
 * `playerLookupKey(displayName)`. Some rows hold the raw display name instead —
 * capitals and all — and a couple hold null. See `player-key-repair.ts` for why
 * that breaks both the unique constraint and every lookup that depends on it, and
 * how it let `db:report:duplicate-players` find 165 names held twice.
 *
 * **This does not merge anybody.** Two records for one person written in different
 * word orders have different canonical keys, so both are repaired and both survive.
 * What it stops is the *next* import creating a third. Merging the existing ones is
 * a separate decision, and the report is its worklist.
 *
 * Nothing here touches a name a person sees. `displayName`, `firstName`,
 * `lastName` and `slug` are left exactly as they are; only the derived key is
 * rewritten, to the value the code already assumes it holds.
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";
import { parkingKey, planKeyRepair, type KeyRow } from "./player-key-repair";

loadApiEnv();

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

const show = (value: string | null) => (value === null ? "null" : `"${value}"`);

async function main() {
  console.log(
    `Player lookup keys — ${APPLY ? "APPLYING" : "dry run, pass --apply to write"}\n`
  );

  const rows = (await prisma.player.findMany({
    select: { id: true, displayName: true, normalizedName: true },
  })) as KeyRow[];

  const plan = planKeyRepair(rows);

  console.log(`  ${rows.length} player records`);
  console.log(`  ${plan.correct.length} already keyed correctly`);
  console.log(`  ${plan.fixable.length} ${APPLY ? "repaired" : "repairable now"}`);
  console.log(`  ${plan.blocked.length} name(s) blocked by a collision`);
  if (plan.unkeyable.length) {
    console.log(`  ${plan.unkeyable.length} name(s) that normalise to nothing`);
  }

  if (plan.fixable.length) {
    console.log(`\n${APPLY ? "Repaired" : "Repairable"} (${plan.fixable.length})`);
    console.log("-".repeat(64));
    for (const fix of plan.fixable.slice(0, 40)) {
      console.log(
        `  ${fix.row.displayName.padEnd(28)} ${show(fix.from).padEnd(30)} → "${fix.to}"`
      );
    }
    if (plan.fixable.length > 40) {
      console.log(`  … and ${plan.fixable.length - 40} more`);
    }
  }

  if (plan.blocked.length) {
    console.log(`\nBlocked by a collision (${plan.blocked.length})`);
    console.log("-".repeat(64));
    console.log(
      "  More than one record normalises to the same name, so the key cannot be\n" +
        "  written to both. These need merging, not repairing — see\n" +
        "  db:report:duplicate-players.\n"
    );
    for (const { key, rows: contenders } of plan.blocked.slice(0, 40)) {
      console.log(`  "${key}"  — ${contenders.length} records`);
      for (const c of contenders) {
        console.log(`      ${c.displayName.padEnd(28)} key ${show(c.normalizedName)}`);
      }
    }
    if (plan.blocked.length > 40) {
      console.log(`  … and ${plan.blocked.length - 40} more`);
    }
  }

  if (plan.unkeyable.length) {
    console.log(`\nNo usable name (${plan.unkeyable.length})`);
    console.log("-".repeat(64));
    console.log("  Left alone: there is nothing to key these on.\n");
    for (const r of plan.unkeyable.slice(0, 10)) {
      console.log(`      ${JSON.stringify(r.displayName)}  /${r.id.slice(0, 8)}`);
    }
  }

  if (!APPLY) {
    console.log("\n" + "-".repeat(64));
    console.log("Nothing was written. Re-run with --apply.");
    return;
  }

  if (!plan.fixable.length) {
    console.log("\nNothing to repair.");
    return;
  }

  /* Two passes inside one transaction. A row's correct key can be sitting on
     another row that is itself about to move, so writing them one at a time fails
     on the unique index for whichever goes first. Parking them all first removes
     the ordering question; see `parkingKey`. */
  await prisma.$transaction([
    ...plan.fixable.map((fix) =>
      prisma.player.update({
        where: { id: fix.row.id },
        data: { normalizedName: parkingKey(fix.row.id) },
      })
    ),
    ...plan.fixable.map((fix) =>
      prisma.player.update({
        where: { id: fix.row.id },
        data: { normalizedName: fix.to },
      })
    ),
  ]);

  const after = (await prisma.player.findMany({
    select: { id: true, displayName: true, normalizedName: true },
  })) as KeyRow[];
  const recheck = planKeyRepair(after);
  console.log("\n" + "-".repeat(64));
  console.log(
    `Repaired ${plan.fixable.length} key(s).\n` +
      `  now keyed correctly : ${recheck.correct.length} (was ${plan.correct.length})\n` +
      `  still repairable    : ${recheck.fixable.length}\n` +
      `  still blocked       : ${recheck.blocked.length}`
  );
  /* Left parked would be worse than left wrong: a key nothing can ever match. */
  const parked = after.filter((r) => r.normalizedName?.startsWith(":pending:"));
  if (parked.length) {
    console.log(`\n  WARNING: ${parked.length} row(s) left parked. Re-run with --apply.`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
