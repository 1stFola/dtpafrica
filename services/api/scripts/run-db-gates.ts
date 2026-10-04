/**
 * The gates, one after another, and then a check that none of them left
 * anything behind.
 *
 *   pnpm --filter @dtp/api vision:gates:db   # the eight that need a database and an API
 *   pnpm --filter @dtp/api vision:gates:ci   # those, and the thirteen that need an object store
 *
 * CI runs the second (docs/vision/61, 65). Until it ran any, no gate ran
 * anywhere but a developer's machine, and three had been failing on
 * expectations nobody had brought along.
 *
 * Two lists, by what a gate needs beside the database and the API:
 *
 *   - `DB_GATES` need nothing else. Storage may be in memory.
 *   - `STORE_GATES` put an object in the store for the API to read, or read one
 *     the API wrote, so both processes must see one store: the R2 backend
 *     pointed at something that speaks S3. In CI that is a mock on localhost.
 *     Seven of them also run the worker's Python (`VISION_WORKER_PYTHON`).
 *
 * Every gate makes what it needs, its match included, so the database can be
 * empty: the migrations and the RBAC seed are enough. The one gate in neither
 * list is `vision:e2echeck`, which runs the worker's container: it needs the
 * image built first, so CI runs it in a step of its own (docs/vision/66).
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

export type Gate = { script: string; proves: string };

export const DB_GATES: readonly Gate[] = [
  { script: "vision-phase0-selfcheck.ts", proves: "rights policy, key layout, the job state machine" },
  { script: "vision-job-loop-check.ts", proves: "claim, heartbeat, complete and retry against Postgres" },
  { script: "vision-annotation-check.ts", proves: "tasks, claims, submissions, review" },
  { script: "vision-model-registry-check.ts", proves: "models, versions, provenance, dispatch" },
  { script: "vision-clock-check.ts", proves: "anchors, the match clock, who was on the pitch" },
  { script: "vision-identity-check.ts", proves: "sides, identity windows, a second person, the public view" },
  { script: "vision-identity-metrics-check.ts", proves: "identity scored against gold" },
  { script: "vision-event-check.ts", proves: "candidates, the review queue, promotion into a match" },
];

export const STORE_GATES: readonly Gate[] = [
  { script: "vision-r2-check.ts", proves: "the object store itself: write-once masters, presigned reads" },
  { script: "vision-upload-resume-check.ts", proves: "a resumable upload, interrupted and completed" },
  { script: "vision-catalog-check.ts", proves: "sources, rights evidence, grants, a partner's upload link" },
  { script: "vision-dataset-check.ts", proves: "membership, splits, leakage, freezing, export" },
  { script: "vision-boxes-check.ts", proves: "box labels validated, stored and exported" },
  { script: "vision-benchmark-check.ts", proves: "a detector scored against gold" },
  { script: "vision-promotion-check.ts", proves: "the promotion gate, two people, rollback" },
  { script: "vision-track-check.ts", proves: "tracking, its artifact, positions and the footage list" },
  { script: "vision-track-metrics-check.ts", proves: "tracking scored against gold" },
  { script: "vision-team-check.ts", proves: "kit sides from frames" },
  { script: "vision-calibration-check.ts", proves: "segments and calibration" },
  { script: "vision-cuts-check.ts", proves: "camera cuts proposed from scene changes" },
  { script: "vision-game-state-check.ts", proves: "every track placed in metres, by chunk" },
];

/** Why the store gates cannot run as things are, or null. */
export function storeProblem(env: Record<string, string | undefined>): string | null {
  const backend = env.VISION_STORAGE_BACKEND?.trim();
  if (backend !== "r2") {
    return `The store gates need one object store that this process and the API both see, and VISION_STORAGE_BACKEND is ${backend ? `"${backend}"` : "unset"}. In-memory storage is per process. Point the R2 backend at an S3-compatible store (VISION_R2_ENDPOINT) and start the API with the same settings.`;
  }
  return null;
}

function main() {
  const withStore = process.argv.includes("--store");
  if (withStore) {
    const problem = storeProblem(process.env);
    if (problem) {
      console.error(problem);
      process.exitCode = 2;
      return;
    }
  }
  const gates = withStore ? [...DB_GATES, ...STORE_GATES] : DB_GATES;
  const tsx = createRequire(__filename).resolve("tsx/cli");
  const run = (script: string, args: string[] = [], capture = false) =>
    spawnSync(process.execPath, [tsx, resolve(__dirname, script), ...args], { stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit", encoding: "utf8" });

  const results: { script: string; ok: boolean }[] = [];
  for (const gate of gates) {
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
