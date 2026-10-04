import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DB_GATES, STORE_GATES, storeProblem } from "./run-db-gates";

/**
 * Rules every gate keeps, checked by reading the gates. A gate is a script
 * somebody writes late in a phase; these are the things that were left out of
 * one or another of them (docs/vision/50, appendix E), so a new gate that leaves
 * them out fails here and not on somebody's database.
 */
const dir = __dirname;
const gates = readdirSync(dir).filter((f) => /^vision-.*check\.ts$/.test(f)).sort();
const source = (file: string) => readFileSync(join(dir, file), "utf8");

/** No database: it talks to the bucket alone. */
const NO_DATABASE = new Set(["vision-r2-check.ts"]);
/** Their work is one transaction that is rolled back, so an interrupt leaves nothing. */
const ROLLED_BACK = new Set(["vision-job-loop-check.ts", "vision-phase0-selfcheck.ts"]);
describe("every gate", () => {
  it("is one of the scripts this test knows how to read", () => {
    expect(gates.length).toBeGreaterThanOrEqual(22);
  });

  it("checks where it is about to write before it does anything", () => {
    for (const gate of gates.filter((g) => !NO_DATABASE.has(g))) {
      const text = source(gate);
      const main = text.slice(text.indexOf("async function main() {"));
      // The first statement of main, before any query.
      expect(main.slice(0, 120), gate).toMatch(/^async function main\(\) \{\n {2}assertDevDatabase\(/);
      // A gate that calls the API names it, so the API is held to the same rule.
      if (text.includes("const API = ")) expect(main.slice(0, 120), gate).toContain("assertDevDatabase({ api: API })");
    }
  });

  it("cleans up when it is interrupted, unless its work is a transaction that rolls back", () => {
    for (const gate of gates.filter((g) => !NO_DATABASE.has(g) && !ROLLED_BACK.has(g))) expect(source(gate), gate).toMatch(/\bonInterrupt\(async \(\) => \{/);
    for (const gate of ROLLED_BACK) expect(source(gate), gate).toContain("throw new Rollback()");
  });

  it("writes into no match but its own", () => {
    for (const gate of gates) {
      const text = source(gate);
      const touchesAMatch = /sbMatchEvent\.(create|createMany|createManyAndReturn|update|delete)|sbMatch\.update|sbMatchSquadPlayer\.(create|update)|player\.update/.test(text);
      if (touchesAMatch) expect(text, `${gate} writes to a match, so the match must be the gate's`).toContain("createGateMatch(");
      // No gate depends on a match somebody recorded: a gate that needs one makes it.
      expect(/sbMatch\.find(First|Many)\(/.test(text), `${gate} looks up a match somebody recorded`).toBe(false);
    }
  });
});

describe("the gates CI runs", () => {
  /** Not in either list: it needs the worker's image, so the workflow builds that and runs it in a step of its own. */
  const OWN_STEP = ["vision-worker-e2e-check.ts"];
  const listed = [...DB_GATES, ...STORE_GATES];
  const workflow = readFileSync(join(dir, "../../../.github/workflows/ci.yml"), "utf8");
  const scriptsByName = JSON.parse(readFileSync(join(dir, "..", "package.json"), "utf8")).scripts as Record<string, string>;

  it("are every gate there is: each in a list, or run by the workflow in a step of its own", () => {
    // A new gate is in one list or the other, or it is named here and the workflow runs it.
    const names = listed.map((g) => g.script);
    expect(new Set(names).size).toBe(names.length);
    expect([...names, ...OWN_STEP].sort()).toEqual(gates);
    for (const script of OWN_STEP) {
      const command = Object.keys(scriptsByName).find((name) => scriptsByName[name]!.endsWith(`scripts/${script}`));
      expect(command, script).toBeDefined();
      // Named as the exception is not enough: it was, for a while, the gate nothing ran.
      expect(workflow, `${script} is run by no step in ci.yml`).toMatch(new RegExp(`run: pnpm --filter @dtp/api ${command}\\b`));
    }
    expect(workflow).toContain("run: pnpm --filter @dtp/api vision:gates:ci");
  });

  it("gives the worker's container and the host one name for the store", () => {
    // A presigned URL is made out here and used in there. `localhost` in there is the container.
    const endpoint = /VISION_R2_ENDPOINT: (\S+)/.exec(workflow)?.[1];
    expect(endpoint).toBe("http://host.docker.internal:9090");
    expect(workflow).toContain('echo "127.0.0.1 host.docker.internal" | sudo tee -a /etc/hosts');
    expect(readFileSync(join(dir, "vision-worker-e2e-check.ts"), "utf8")).toContain('"--add-host", "host.docker.internal:host-gateway"');
  });

  it("exist, and have a script in package.json each, so a person can run one alone", () => {
    const scripts = Object.values(JSON.parse(readFileSync(join(dir, "..", "package.json"), "utf8")).scripts as Record<string, string>);
    for (const gate of listed) {
      expect(existsSync(join(dir, gate.script)), gate.script).toBe(true);
      expect(scripts.some((s) => s.endsWith(`scripts/${gate.script}`)), gate.script).toBe(true);
      expect(gate.proves.length, gate.script).toBeGreaterThan(10);
    }
  });

  it("need nothing but a database and an API, when they are in the first list", () => {
    for (const gate of DB_GATES) {
      const text = source(gate.script);
      // In-memory storage is per process, and CI's first list may be run without the worker installed.
      expect(text.includes("spawnSync") || text.includes("execFile"), `${gate.script} starts another program`).toBe(false);
      expect(/R2ObjectStore|store\.(putSmallObject|presign)/.test(text) && gate.script !== "vision-job-loop-check.ts" && gate.script !== "vision-phase0-selfcheck.ts", `${gate.script} uses the object store`).toBe(false);
    }
  });

  it("start no container and no program but the worker's Python, in the second", () => {
    for (const gate of STORE_GATES) {
      const text = source(gate.script);
      expect(/\bdocker\b/.test(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), `${gate.script} runs docker`).toBe(false);
      // The interpreter comes from the environment: CI has no `.venv` in the worker's folder.
      if (text.includes("spawnSync")) expect(text, gate.script).toContain("process.env.VISION_WORKER_PYTHON ??");
    }
  });

  it("refuse to run the second list on in-memory storage, and say why", () => {
    expect(storeProblem({ VISION_STORAGE_BACKEND: "r2" })).toBeNull();
    expect(storeProblem({ VISION_STORAGE_BACKEND: " r2 " })).toBeNull();
    for (const backend of ["memory", "", undefined]) {
      const problem = storeProblem({ VISION_STORAGE_BACKEND: backend });
      expect(problem, String(backend)).toContain("per process");
      expect(problem, String(backend)).toContain("VISION_R2_ENDPOINT");
    }
  });
});
