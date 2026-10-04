import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DB_GATES } from "./run-db-gates";

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
/** They link their footage to a match that exists and write nothing to it. They need the bucket too, so CI does not run them. */
const READS_A_MATCH = new Set(["vision-calibration-check.ts", "vision-cuts-check.ts", "vision-game-state-check.ts", "vision-team-check.ts", "vision-track-check.ts", "vision-worker-e2e-check.ts"]);

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
      // Looking a real match up is allowed only for the gates listed, which only link to it.
      if (/sbMatch\.find(First|Many)\(/.test(text)) expect(READS_A_MATCH.has(gate), `${gate} looks up a match somebody recorded`).toBe(true);
    }
  });
});

describe("the gates CI runs", () => {
  it("exist, and make everything they need", () => {
    for (const gate of DB_GATES) {
      expect(existsSync(join(dir, gate.script)), gate.script).toBe(true);
      const text = source(gate.script);
      // An empty database has no match to find and no bucket two processes can share.
      expect(/sbMatch\.find(First|Many)\(/.test(text), `${gate.script} needs a match that already exists`).toBe(false);
      expect(text.includes("spawnSync") || text.includes("execFile"), `${gate.script} starts another program`).toBe(false);
    }
  });

  it("have a script in package.json each, so a person can run one alone", () => {
    const scripts = Object.values(JSON.parse(readFileSync(join(dir, "..", "package.json"), "utf8")).scripts as Record<string, string>);
    for (const gate of DB_GATES) expect(scripts.some((s) => s.endsWith(`scripts/${gate.script}`)), gate.script).toBe(true);
  });
});
