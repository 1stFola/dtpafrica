import "reflect-metadata";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import type { AdminAuthContext } from "../admin/auth/admin-auth.types";
import { REQUIRE_PERMISSIONS_KEY } from "../admin/decorators/require-permissions.decorator";
import { ThrottlerGuard } from "@nestjs/throttler";
import { AdminAuthGuard } from "../admin/guards/admin-auth.guard";
import { DEFAULT_ROLES, FAIRPLAY_PERMISSION_SLUGS } from "../admin/rbac/permissions.catalog";
import { assertCompetition, readerOf } from "./access";
import { FairPlayBootstrapGuard, FairPlayDeviceGuard } from "./device.guard";
import { FairPlayAdminController } from "./fairplay-admin.controller";
import { FairPlayDeviceController } from "./fairplay-device.controller";
import { loadFairPlayConfig } from "./fairplay.config";

/**
 * The authorization matrix, read from the code itself: which guard and which permissions
 * every FairPlay route carries, and how the competition scope treats each kind of account.
 * A route added without a permission, or a device route that an admin token could reach,
 * fails here.
 */

const ctx = (permissions: string[], competitionIds: string[] = [], userId = "u-1"): AdminAuthContext =>
  ({ method: "jwt", roleSlug: null, roleName: null, permissions, userId, email: "x@example.org", competitionIds });

function routes(controller: { prototype: object }) {
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== "constructor")
    .map((name) => {
      const handler = (controller.prototype as Record<string, unknown>)[name] as object;
      return { name, path: Reflect.getMetadata("path", handler), perms: Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler) as string[] | undefined,
        guards: (Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[] };
    })
    .filter((r) => r.path !== undefined);
}

const STAFF_READ = ["fairplay.session.manage", "fairplay.edge.admin", "fairplay.incident.operate", "fairplay.incident.review",
  "fairplay.evidence.view_original", "fairplay.evidence.export", "fairplay.report.view"];

const EXPECTED: Record<string, string[]> = {
  me: STAFF_READ,
  listDevices: ["fairplay.edge.admin", "fairplay.session.manage"],
  createDevice: ["fairplay.edge.admin"],
  retireDevice: ["fairplay.edge.admin"],
  rePairDevice: ["fairplay.edge.admin"],
  listSessions: STAFF_READ,
  createSession: ["fairplay.session.manage"],
  candidates: ["fairplay.session.manage"],
  getSession: STAFF_READ,
  setMembers: ["fairplay.session.manage"],
  setMyPin: STAFF_READ.filter((p) => p !== "fairplay.report.view"),
  report: STAFF_READ,
  syncState: STAFF_READ.filter((p) => p !== "fairplay.report.view"),
  readUrl: ["fairplay.incident.review", "fairplay.evidence.export", "fairplay.session.manage", "fairplay.report.view"],
  usage: ["fairplay.edge.admin", "fairplay.session.manage"],
  listRequests: ["fairplay.edge.admin"],
  createRequest: ["fairplay.edge.admin"],
  getRequest: ["fairplay.edge.admin"],
  heldForRequest: ["fairplay.edge.admin"],
  withdraw: ["fairplay.edge.admin"],
  closeRequest: ["fairplay.edge.admin"],
};

describe("FairPlay authorization matrix", () => {
  it("every admin route is admin-guarded and names exactly its permissions", () => {
    const classGuards = Reflect.getMetadata(GUARDS_METADATA, FairPlayAdminController) as unknown[];
    expect(classGuards).toContain(AdminAuthGuard);
    const found = Object.fromEntries(routes(FairPlayAdminController).map((r) => [r.name, [...(r.perms ?? [])].sort()]));
    expect(found).toEqual(Object.fromEntries(Object.entries(EXPECTED).map(([k, v]) => [k, [...v].sort()])));
  });

  it("every device route has a device guard and no admin guard; only register takes a bootstrap token, throttled", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, FairPlayDeviceController)).toBeUndefined();
    for (const r of routes(FairPlayDeviceController)) {
      expect(r.guards).not.toContain(AdminAuthGuard);
      expect(r.perms).toBeUndefined();
      // F7: register is reachable without a session, so it is throttled per address as a login is.
      expect([...r.guards].sort((a, b) => String(a).localeCompare(String(b))))
        .toEqual((r.name === "register" ? [FairPlayBootstrapGuard, ThrottlerGuard] : [FairPlayDeviceGuard]).sort((a, b) => String(a).localeCompare(String(b))));
    }
  });

  it("setting a PIN is throttled as a login is (F7)", () => {
    const pin = routes(FairPlayAdminController).find((r) => r.name === "setMyPin")!;
    expect(pin.guards).toContain(ThrottlerGuard);
  });

  it("an organiser must be scoped to competitions; staff with no scope see all", () => {
    expect(() => readerOf(ctx(["fairplay.report.view"]))).toThrow(/not limited to any competition/);
    expect(readerOf(ctx(["fairplay.report.view"], ["c-1"]))).toEqual({ kind: "organiser", competitions: ["c-1"] });
    expect(readerOf(ctx(["fairplay.incident.review"]))).toEqual({ kind: "staff", competitions: null });
    expect(() => readerOf(ctx(["scoreboard.read"]))).toThrow(/no FairPlay permission/);
  });

  it("another competition's session looks the same as one that does not exist", () => {
    const organiser = readerOf(ctx(["fairplay.report.view"], ["c-1"]));
    expect(() => assertCompetition(organiser, "c-2", "session", "s-9")).toThrow(/Unknown session s-9/);
    expect(() => assertCompetition(organiser, "c-1", "session", "s-9")).not.toThrow();
  });

  it("the organiser role holds report.view and nothing else of FairPlay or ScoreBoard", () => {
    const role = DEFAULT_ROLES.find((r) => r.slug === "fairplay_organiser_viewer")!;
    expect(role.permissionSlugs).toEqual(["admin.session.read", "fairplay.report.view"]);
    for (const slug of ["fairplay_operator", "fairplay_assessor", "fairplay_admin", "fairplay_organiser_viewer"]) {
      const perms = DEFAULT_ROLES.find((r) => r.slug === slug)!.permissionSlugs as string[];
      expect(perms.filter((p) => p.startsWith("scoreboard.") || p.startsWith("vision."))).toEqual([]);
    }
    expect(FAIRPLAY_PERMISSION_SLUGS).toHaveLength(7);
  });
});

describe("FairPlay stays apart from ScoreBoard writes and Vision storage", () => {
  const dir = __dirname;
  const sources = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"))
    .map((f) => ({ f, text: readFileSync(resolve(dir, f), "utf8") }));

  it("never writes a ScoreBoard row", () => {
    const writes = /\.(sbMatch|sbMatchEvent|sbMatchStatistics|sbCompetition|sbTeam)\.(create|update|upsert|delete)/;
    expect(sources.filter((s) => writes.test(s.text)).map((s) => s.f)).toEqual([]);
  });

  it("imports nothing from Vision but its refusal and JSON helpers", () => {
    const visionImports = sources.flatMap((s) => [...s.text.matchAll(/from "(\.\.\/)+vision\/([^"]+)"/g)].map((m) => m[2]));
    expect([...new Set(visionImports)].sort()).toEqual(["shared/json-safe", "shared/refusals"]);
  });

  it("never sets an ACL on an object", () => {
    const code = (text: string) => text.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    expect(sources.filter((s) => /\bACL\b|x-amz-acl|public-read/.test(code(s.text))).map((s) => s.f)).toEqual([]);
  });
});

describe("FairPlay configuration", () => {
  it("is off without a bucket, and refuses a half-configured or Vision bucket", () => {
    expect(loadFairPlayConfig({}).storage.backend).toBe("off");
    expect(() => loadFairPlayConfig({ FAIRPLAY_STORAGE_BACKEND: "r2" })).toThrow(/FAIRPLAY_R2_ENDPOINT is required/);
    expect(() => loadFairPlayConfig({ FAIRPLAY_STORAGE_BACKEND: "r2", FAIRPLAY_R2_ENDPOINT: "https://x", FAIRPLAY_R2_ACCESS_KEY_ID: "a",
      FAIRPLAY_R2_SECRET_ACCESS_KEY: "b", FAIRPLAY_R2_BUCKET: "dtp-vision-clips" })).toThrow(/looks like a Vision bucket/);
  });

  it("never issues a read URL longer than five minutes", () => {
    expect(loadFairPlayConfig({ FAIRPLAY_READ_URL_TTL_SECONDS: "3600" }).readUrlTtlSeconds).toBe(300);
  });
});
