import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOW_DB_HOST, gateMatchNames, hostProblem, readEnvFile } from "./gate-harness";

const db = (url: string | undefined, allowed?: string) => hostProblem("database", url, allowed, ALLOW_DB_HOST);

describe("where a gate may run", () => {
  it("runs against a database on this machine, or a container beside it", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "host.docker.internal", "postgres", "LOCALHOST"]) {
      expect(db(`postgresql://dtp:dtp@${host}:5432/dtp_africa`), host).toBeNull();
    }
  });

  it("refuses a database anywhere else, and says how to mean it", () => {
    const problem = db("postgresql://u:p@dtp-live.abc123.eu-west-1.rds.amazonaws.com:5432/dtp");
    expect(problem).toContain("dtp-live.abc123.eu-west-1.rds.amazonaws.com");
    expect(problem).toContain(`${ALLOW_DB_HOST}=dtp-live.abc123.eu-west-1.rds.amazonaws.com`);
    // A name that only begins like a local one is not local.
    expect(db("postgresql://u:p@localhost.evil.example:5432/x")).not.toBeNull();
    expect(db("postgresql://u:p@10.0.0.12:5432/x")).not.toBeNull();
    expect(db("postgresql://u:p@postgres.internal:5432/x")).not.toBeNull();
  });

  it("never prints the credentials in the URL", () => {
    const problem = db("postgresql://admin:hunter2secret@db.example.com:5432/dtp")!;
    expect(problem).not.toContain("hunter2secret");
    expect(problem).not.toContain("admin");
  });

  it("is overridden only by naming the host", () => {
    const url = "postgresql://u:p@staging-db.example.com:5432/dtp";
    expect(db(url, "staging-db.example.com")).toBeNull();
    expect(db(url, " Staging-DB.example.com ")).toBeNull();
    // A habit of `=1` allows nothing, and neither does another host.
    for (const allowed of ["1", "true", "yes", "", "other-db.example.com", "example.com"]) expect(db(url, allowed), allowed).not.toBeNull();
  });

  it("refuses when there is no URL, or one it cannot read", () => {
    expect(db(undefined)).toContain("No database URL");
    expect(db("")).toContain("No database URL");
    expect(db("not a url")).toContain("cannot be read");
  });

  it("holds the API to the same rule", () => {
    expect(hostProblem("API", "http://localhost:3100/api/v1", undefined, "X")).toBeNull();
    expect(hostProblem("API", "https://staging.directtopro.africa/api/v1", undefined, "X")).toContain("staging.directtopro.africa");
    expect(hostProblem("API", "https://staging.directtopro.africa/api/v1", "staging.directtopro.africa", "X")).toBeNull();
  });
});

describe("reading an env file", () => {
  it("takes what the process does not have, and leaves what it does", () => {
    const env: Record<string, string | undefined> = { KEPT: "from the shell" };
    readEnvFile(['# a comment', 'DATABASE_URL="postgresql://u:p@localhost:5432/x"', "KEPT=from the file", "export PORT=3000", "  SPACED = y ", "#OFF=1", "junk line", "QUOTED='single'"].join("\n"), env);
    expect(env).toEqual({ KEPT: "from the shell", DATABASE_URL: "postgresql://u:p@localhost:5432/x", PORT: "3000", SPACED: "y", QUOTED: "single" });
  });
});

describe("what a gate's match is called", () => {
  it("ends in the run id, so the purge can find it", () => {
    expect(gateMatchNames.competitionSlug("0a1b2c3d")).toBe("gate-0a1b2c3d");
    expect(gateMatchNames.playerSlug("0a1b2c3d", "h", 12)).toBe("gate-0a1b2c3d-h12");
  });
});

describe("a gate that is interrupted", () => {
  const tsx = createRequire(__filename).resolve("tsx/cli");
  const run = (mode: string) => spawnSync(process.execPath, [tsx, resolve(__dirname, "gate-harness.interrupt-fixture.ts"), mode], { encoding: "utf8", timeout: 30_000 });

  it("runs its cleanup on the fixture as it stands, and stops there", () => {
    const out = run("ok");
    // The cleanup was registered before the fixture existed and still sees it.
    expect(out.stdout).toContain("cleaned:created-after-registering");
    expect(out.stdout).not.toContain("finished-normally");
    expect(out.stderr).toContain("cleaning up what this run created");
    // The shell's convention for "ended by Ctrl-C".
    expect(out.status).toBe(130);
  }, 40_000);

  it("says how to clear up by hand when its cleanup fails, and still stops", () => {
    const out = run("throws");
    expect(out.stderr).toContain("db:purge:gate-litter");
    expect(out.stdout).not.toContain("finished-normally");
    expect(out.status).toBe(130);
  }, 40_000);
});
