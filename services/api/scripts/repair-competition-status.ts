/**
 * Move the competition status column onto the words the product uses.
 *
 *   pnpm --filter @dtp/api db:repair:competition-status          # report only
 *   pnpm --filter @dtp/api db:repair:competition-status --apply  # write
 *
 * `upcoming` becomes `scheduled` and `active` becomes `ongoing`. The vocabulary was
 * already half-changed before this: the API accepted `ongoing` on the way in and stored
 * `active`, and the admin badge *labelled* `active` as "Ongoing" — so the word on the
 * screen and the word in the column had quietly diverged.
 *
 * **Nothing depends on this having run.** The public filter hides `archived` and `draft`
 * by name, so a row still saying `upcoming` keeps showing exactly as it should, and the
 * admin maps legacy words on read. This is tidying, not a repair the product is waiting
 * on — which is why it is a separate command rather than something bolted to a deploy.
 */
import { PrismaClient } from "@prisma/client";
import { loadApiEnv } from "../src/shared/load-dotenv";

loadApiEnv();

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** Old word to new. Anything not listed is already current, or is not a status we set. */
const RENAMES: Record<string, string> = {
  upcoming: "scheduled",
  active: "ongoing",
};

async function main() {
  console.log(
    `Competition status vocabulary — ${APPLY ? "APPLYING" : "dry run, pass --apply to write"}\n`
  );

  const rows = await prisma.sbCompetition.findMany({
    select: { id: true, name: true, status: true, isPublished: true },
    orderBy: { name: "asc" },
  });

  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);

  console.log(`  ${rows.length} competition(s)`);
  for (const [status, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    const rename = RENAMES[status];
    console.log(`    ${status.padEnd(12)} ${String(count).padStart(4)}${rename ? `  -> ${rename}` : ""}`);
  }

  const toRename = rows.filter((row) => RENAMES[row.status]);
  console.log(`\n  ${toRename.length} row(s) to rename\n`);

  if (!toRename.length) {
    console.log("Every competition already uses the current words. Nothing to do.");
    return;
  }

  /* Named rather than counted, because a status decides whether a competition appears on
     the public site and somebody should recognise the list before it moves. */
  console.log("Competitions to rename");
  console.log("-".repeat(64));
  for (const row of toRename.slice(0, 40)) {
    console.log(`  ${row.name.slice(0, 40).padEnd(42)} ${row.status} -> ${RENAMES[row.status]}`);
  }
  if (toRename.length > 40) console.log(`  … and ${toRename.length - 40} more`);

  if (!APPLY) {
    console.log("\n" + "-".repeat(64));
    console.log(
      "Nothing was written. Re-run with --apply.\n" +
        "Neither the public site nor the admin is waiting on this: the filter hides\n" +
        "archived and draft by name, and legacy words are mapped on read."
    );
    return;
  }

  let written = 0;
  for (const [from, to] of Object.entries(RENAMES)) {
    const result = await prisma.sbCompetition.updateMany({
      where: { status: from },
      data: { status: to },
    });
    written += result.count;
  }

  console.log("\n" + "-".repeat(64));
  console.log(`Renamed ${written} competition(s).`);

  const after = await prisma.sbCompetition.findMany({ select: { status: true } });
  const stale = after.filter((row) => RENAMES[row.status]).length;
  console.log(`  rows still on a legacy word: ${stale}`);
  if (stale) {
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
