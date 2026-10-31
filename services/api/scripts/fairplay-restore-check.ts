/**
 * Phase 6.2: do the cloud's FairPlay tables come back from a backup, whole and still protected?
 *
 *   FAIRPLAY_CHECK_DATABASE_URL=postgresql://â€¦/fp62_scratch pnpm --filter @dtp/api fairplay:restorecheck
 *
 * Point it at a throwaway database that `fairplay:cloudcheck` has already filled. It dumps that
 * database the way infra/backup/dtp-backup.py does (`pg_dump --format=custom` inside the Postgres
 * container), restores the dump into a new database beside it in one transaction, and compares
 * every fairplay_ table row by row. It then checks the audit chain still verifies and that the
 * restored database still refuses to change an audit row or delete a withdrawal.
 *
 * It drops the database it restored into and touches nothing else. It refuses any database whose
 * name does not say it is throwaway. The live database has `dtp-backup verify` (support playbook).
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const url = process.env.FAIRPLAY_CHECK_DATABASE_URL ?? "";
const container = process.env.FAIRPLAY_CHECK_PG_CONTAINER ?? "dtp-postgres";
const parsed = url ? new URL(url) : null;
const source = parsed?.pathname.slice(1) ?? "";
if (!/(scratch|test|ci)/i.test(source)) {
  console.error("Refused: FAIRPLAY_CHECK_DATABASE_URL must name a throwaway database (scratch, test or ci).");
  process.exit(2);
}
const pgUser = decodeURIComponent(parsed!.username);
const copy = `${source}_restored`;
const copyUrl = Object.assign(new URL(url), { pathname: `/${copy}` }).toString();

let failed = 0, passed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  ${JSON.stringify(detail)}` : ""}`);
}
function docker(args: string[], input?: Buffer) {
  const r = spawnSync("docker", ["exec", "-i", container, ...args], { input, maxBuffer: 1 << 30 });
  return { ok: r.status === 0, out: r.stdout, err: r.stderr?.toString() ?? "" };
}
function sql(database: string, text: string) {
  return docker(["psql", "-U", pgUser, "-d", database, "-v", "ON_ERROR_STOP=1", "-Atc", text]);
}

async function tables(db: PrismaClient) {
  const rows = await db.$queryRaw<{ name: string }[]>`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'fairplay\_%' ORDER BY 1`;
  return rows.map((r) => r.name);
}
/** Every row of a table, in one order, reduced to a count and a hash. */
async function fingerprint(db: PrismaClient, table: string) {
  const rows = await db.$queryRawUnsafe<{ row: string }[]>(`SELECT t::text AS row FROM "${table}" t ORDER BY 1`);
  return { rows: rows.length, sha256: createHash("sha256").update(rows.map((r) => r.row).join("\n")).digest("hex") };
}
async function refused(db: PrismaClient, statement: string) {
  try {
    await db.$executeRawUnsafe(statement);
    return false;
  } catch {
    return true;
  }
}

async function main() {
  const dump = docker(["pg_dump", "-U", pgUser, "-d", source, "--format=custom"]);
  check("the database dumps as the nightly backup dumps it", dump.ok && dump.out.length > 0, dump.err);
  const toc = docker(["pg_restore", "--list"], dump.out);
  check("the dump's table of contents reads", toc.ok, toc.err);

  sql("postgres", `DROP DATABASE IF EXISTS "${copy}"`);
  sql("postgres", `CREATE DATABASE "${copy}"`);
  const restored = docker(["pg_restore", "-U", pgUser, "-d", copy, "--single-transaction", "--no-owner"], dump.out);
  check("it restores into a new database in one transaction", restored.ok, restored.err);

  const a = new PrismaClient({ datasources: { db: { url } } });
  const b = new PrismaClient({ datasources: { db: { url: copyUrl } } });
  try {
    const names = await tables(a);
    check("every fairplay_ table is there", names.length >= 13 && JSON.stringify(names) === JSON.stringify(await tables(b)), names);
    let total = 0;
    for (const name of names) {
      const [was, now] = [await fingerprint(a, name), await fingerprint(b, name)];
      total += was.rows;
      check(`${name}: ${was.rows} rows, identical`, was.rows === now.rows && was.sha256 === now.sha256, { was, now });
    }
    check("and there was something to compare", total > 0, total);
    for (const name of ["fairplay_withdrawals", "fairplay_audit_logs", "fairplay_edge_audit_entries", "fairplay_evidence"]) {
      check(`${name} is not empty, so the comparison means something`, (await fingerprint(b, name)).rows > 0);
    }

    // The rows are back. Are the rules that protect them?
    const triggers = await b.$queryRaw<{ name: string }[]>`SELECT tgname AS name FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text LIKE 'fairplay%' ORDER BY 1`;
    check("the triggers protecting the audit rows and withdrawals are back", triggers.length === 6, triggers);
    check("the restored database refuses to change an audit row", await refused(b, `UPDATE "fairplay_audit_logs" SET "action" = 'x'`));
    check("or to delete one", await refused(b, `DELETE FROM "fairplay_audit_logs"`));
    check("or to delete an Edge's audit entry", await refused(b, `DELETE FROM "fairplay_edge_audit_entries"`));
    check("or to delete a withdrawal", await refused(b, `DELETE FROM "fairplay_withdrawals"`));
    check("or to truncate them", await refused(b, `TRUNCATE "fairplay_withdrawals"`));
    const dangling = await b.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM "fairplay_withdrawals" w LEFT JOIN "fairplay_evidence" e ON e.id = w."evidence_id" WHERE e.id IS NULL`;
    check("every withdrawal still points at its evidence", Number(dangling[0].n) === 0, Number(dangling[0].n));
    const migrations = async (db: PrismaClient) => (await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`)[0].n;
    check("the restored database is at the same migration", (await migrations(a)) === (await migrations(b)));
  } finally {
    await a.$disconnect();
    await b.$disconnect();
    sql("postgres", `DROP DATABASE IF EXISTS "${copy}"`);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
