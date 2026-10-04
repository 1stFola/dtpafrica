/**
 * The gates that need a database and a running API and nothing else, one after
 * another, and then a check that none of them left anything behind.
 *
 *   pnpm --filter @dtp/api vision:gates:db
 *
 * This is what CI runs (docs/vision/61). Until it did, no gate ran anywhere but
 * a developer's machine, and three of them had been failing on expectations
 * nobody had brought along.
 *
 * "Nothing else" is the selection rule: these gates neither read nor write the
 * object store from their own process, and start no worker. A gate that puts an
 * artifact in the bucket for the API to read needs a bucket both processes can
 * see, which CI does not have; those still run by hand before a release.
 * Every gate here makes what it needs, so the database can be empty: the
 * migrations and the RBAC seed are enough.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/** Script name, and what it proves, for the summary. */
export const DB_GATES: readonly { script: string; proves: string }[] = [
  { script: "vision-phase0-selfcheck.ts", proves: "rights policy, key layout, the job state machine" },
  { script: "vision-job-loop-check.ts", proves: "claim, heartbeat, complete and retry against Postgres" },
  { script: "vision-annotation-check.ts", proves: "tasks, claims, submissions, review" },
  { script: "vision-model-registry-check.ts", proves: "models, versions, provenance, dispatch" },
  { script: "vision-clock-check.ts", proves: "anchors, the match clock, who was on the pitch" },
  { script: "vision-identity-check.ts", proves: "sides, identity windows, a second person, the public view" },
  { script: "vision-identity-metrics-check.ts", proves: "identity scored against gold" },
  { script: "vision-event-check.ts", proves: "candidates, the review queue, promotion into a match" },
];

function main() {
  const tsx = createRequire(__filename).resolve("tsx/cli");
  const run = (script: string, args: string[] = [], capture = false) =>
    spawnSync(process.execPath, [tsx, resolve(__dirname, script), ...args], { stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit", encoding: "utf8" });

  const results: { script: string; ok: boolean }[] = [];
  for (const gate of DB_GATES) {
    console.log(`\n${"=".repeat(78)}\n${gate.script}: ${gate.proves}\n${"=".repeat(78)}`);
    const out = run(gate.script);
    results.push({ script: gate.script, ok: out.status === 0 });
  }

  /* A gate that passes and leaves rows behind has not passed. The purge's dry run lists
     everything a gate's names match; after a clean run it lists nothing. */
  console.log(`\n${"=".repeat(78)}\nWhat the gates left behind\n${"=".repeat(78)}`);
  const purge = run("purge-vision-gate-litter.ts", [], true);
  process.stdout.write(purge.stdout ?? "");
  const litter = purge.status !== 0 || /would delete|KEEPING/.test(purge.stdout ?? "");
  results.push({ script: "nothing left behind", ok: !litter });

  console.log(`\n${"=".repeat(78)}`);
  for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.script}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed${failed ? ` — ${failed} FAILED` : ""}`);
  process.exitCode = failed ? 1 : 0;
}

if (require.main === module) main();
