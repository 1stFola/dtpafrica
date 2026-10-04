import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { ALLOW_DB_HOST, AUDIT_TARGET_MODELS, auditPurgeProblem, gateMatchNames, hostProblem, orphanedAuditRows, readEnvFile, removeGateAuditTrail } from "./gate-harness";

const db = (url: string | undefined, allowed?: string) => hostProblem("database", url, allowed, ALLOW_DB_HOST);

describe("where a gate may run", () => {
  it("runs against a database on this machine", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "host.docker.internal", "LOCALHOST"]) {
      expect(db(`postgresql://dtp:dtp@${host}:5432/dtp_africa`), host).toBeNull();
    }
  });

  it("does not take a compose service name for this machine: that is how the live API reaches the live database", () => {
    const compose = readFileSync(resolve(__dirname, "../../../infra/docker-compose.staging.yml"), "utf8");
    const liveHost = /DATABASE_URL: postgresql:\/\/[^@]+@([a-z0-9_-]+):/.exec(compose)?.[1];
    expect(liveHost).toBe("postgres");
    for (const host of [liveHost!, "db", "database"]) {
      expect(db(`postgresql://dtp:dtp@${host}:5432/dtp_africa`), host).toContain("not this machine");
      // Somebody who means it says so.
      expect(db(`postgresql://dtp:dtp@${host}:5432/dtp_africa`, host), host).toBeNull();
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

describe("the audit trail a gate leaves", () => {
  /** A database of ids: which rows each table holds, and the audit rows. */
  const fake = (tables: Record<string, string[]>, audit: { id: string; action?: string; targetKind: string; targetId: string | null; actorId?: string | null; createdAt?: Date }[]) => {
    const rows = audit.map((a) => ({ action: "x", actorId: null, createdAt: new Date("2026-10-04T12:00:00Z"), ...a }));
    const asked: Record<string, number> = {};
    const table = (name: string) => ({
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        asked[name] = (asked[name] ?? 0) + 1;
        return (tables[name] ?? []).filter((id) => where.id.in.includes(id)).map((id) => ({ id }));
      },
    });
    const prisma = new Proxy(
      {
        visionAuditLog: {
          findMany: async ({ where }: { where: { createdAt: { gte: Date } } }) => rows.filter((r) => r.createdAt >= where.createdAt.gte),
          deleteMany: async ({ where }: { where: { id: { in: string[] } } }) => {
            const before = rows.length;
            for (const id of where.id.in) {
              const at = rows.findIndex((r) => r.id === id);
              if (at !== -1) rows.splice(at, 1);
            }
            return { count: before - rows.length };
          },
        },
      } as Record<string, unknown>,
      { get: (target, name: string) => target[name] ?? table(name) }
    ) as unknown as PrismaClient;
    return { prisma, rows, asked };
  };

  it("knows the table behind every kind of target the Vision module writes", () => {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const kinds = new Set<string>();
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = resolve(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith(".ts") && !name.endsWith(".spec.ts")) for (const m of readFileSync(path, "utf8").matchAll(/targetKind: "(vision_[a-z_]+)"/g)) kinds.add(m[1]);
      }
    };
    walk(resolve(__dirname, "../src/vision"));
    expect(kinds.size).toBeGreaterThan(15);
    // A kind with no table here is a kind whose rows every gate would leave behind again.
    expect([...kinds].filter((k) => !AUDIT_TARGET_MODELS[k])).toEqual([]);
    // And each table is one the database has.
    const schema = readFileSync(resolve(__dirname, "../prisma/schema.prisma"), "utf8");
    for (const [kind, model] of Object.entries(AUDIT_TARGET_MODELS)) {
      expect(schema, kind).toMatch(new RegExp(`^model ${model[0].toUpperCase()}${model.slice(1)} \\{`, "m"));
    }
  });

  it("finds the rows whose target is gone, and leaves the ones whose target is there", async () => {
    const { prisma, rows } = fake({ visionJob: ["job-kept"], visionModelVersion: [] }, [
      { id: "a", targetKind: "vision_job", targetId: "job-kept" },
      { id: "b", targetKind: "vision_job", targetId: "job-gone" },
      { id: "c", targetKind: "vision_model_version", targetId: "mv-gone" },
    ]);
    expect((await orphanedAuditRows(prisma, rows)).map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("leaves a row a person who still exists stands behind: they removed something, and the trail says so", async () => {
    const { prisma, rows } = fake({ adminUser: ["ada"] }, [
      { id: "theirs", targetKind: "vision_camera_segment", targetId: "seg-gone", actorId: "ada" },
      // A gate's scratch sign-in, removed with the gate: nobody stands behind it.
      { id: "gate", targetKind: "vision_camera_segment", targetId: "seg-gone", actorId: "gate-user-gone" },
      // The operator key and a worker have no actor id at all.
      { id: "key", targetKind: "vision_camera_segment", targetId: "seg-gone", actorId: null },
    ]);
    expect((await orphanedAuditRows(prisma, rows)).map((r) => r.id)).toEqual(["gate", "key"]);
  });

  it("leaves a row with no target, and a row of a kind it has no table for", async () => {
    const { prisma, rows } = fake({}, [
      { id: "no-target", targetKind: "vision_job", targetId: null },
      { id: "unknown-kind", targetKind: "something_new", targetId: "x-1" },
    ]);
    // Not knowing where a target lives is no reason to say it is gone.
    expect(await orphanedAuditRows(prisma, rows)).toEqual([]);
  });

  it("asks each table once however many rows point into it, and a long list in pieces", async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({ id: `r-${i}`, targetKind: "vision_job", targetId: `job-${i % 2200}` }));
    const { prisma, rows, asked } = fake({ visionJob: ["job-7"] }, many);
    const gone = await orphanedAuditRows(prisma, rows);
    // 2,200 distinct ids: three questions of at most a thousand.
    expect(asked.visionJob).toBe(3);
    expect(gone).toHaveLength(2500 - 2);
  });

  it("clears only this run: rows since the gate started, whose target the gate removed", async () => {
    const since = new Date("2026-10-04T12:00:00Z");
    const { prisma, rows } = fake({ visionJob: ["job-live"] }, [
      { id: "old-orphan", targetKind: "vision_job", targetId: "job-gone", createdAt: new Date("2026-10-04T11:59:59Z") },
      { id: "mine", targetKind: "vision_job", targetId: "job-gone", createdAt: new Date("2026-10-04T12:00:01Z") },
      { id: "live", targetKind: "vision_job", targetId: "job-live", createdAt: new Date("2026-10-04T12:00:02Z") },
    ]);
    expect(await removeGateAuditTrail(prisma, since)).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(["old-orphan", "live"]);
    // Nothing left to clear: nothing is deleted, and it says so.
    expect(await removeGateAuditTrail(prisma, since)).toBe(0);
  });

  it("is purged from a database on this machine and from no other, with no override", () => {
    expect(auditPurgeProblem("postgresql://dtp:dtp@localhost:5432/dtp_africa")).toBeNull();
    expect(auditPurgeProblem("postgresql://dtp:dtp@[::1]:5432/dtp_africa")).toBeNull();
    // The live database, as the live API container reaches it.
    expect(auditPurgeProblem("postgresql://dtp:secret@postgres:5432/dtp_africa")).toContain("on postgres");
    expect(auditPurgeProblem("postgresql://u:hunter2secret@db.example.com:5432/dtp")).not.toContain("hunter2secret");
    expect(auditPurgeProblem(undefined)).toContain("not named");
    expect(auditPurgeProblem("not a url")).toContain("not named");
    // The gates' override names a host a gate may write to. It does not make history litter.
    const before = process.env[ALLOW_DB_HOST];
    process.env[ALLOW_DB_HOST] = "postgres";
    try {
      expect(auditPurgeProblem("postgresql://dtp:secret@postgres:5432/dtp_africa")).not.toBeNull();
    } finally {
      if (before === undefined) delete process.env[ALLOW_DB_HOST];
      else process.env[ALLOW_DB_HOST] = before;
    }
  });

  it("is cleared by every gate as it ends: none lets go of the database by hand", () => {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const gates = readdirSync(__dirname).filter((n) => /^vision-.*-check\.ts$/.test(n));
    expect(gates.length).toBeGreaterThan(15);
    const byHand = gates.filter((n) => {
      const text = readFileSync(resolve(__dirname, n), "utf8");
      return text.includes("new PrismaClient") && (text.includes("prisma.$disconnect()") || !text.includes("closeGate(prisma)"));
    });
    expect(byHand).toEqual([]);
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
