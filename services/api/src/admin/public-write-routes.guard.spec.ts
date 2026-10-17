/**
 * The write routes that used to be open to anyone.
 *
 * `POST/PUT/DELETE /benchmarks`, `POST /players`, `POST /sip/players/:id/match-metrics` and
 * `POST /sip/players/:id/recalculate` had no guard at all, and there is no global one, so any
 * visitor could rewrite the calibration benchmarks or create players. They now sit behind the
 * same `AdminAuthGuard` + `PermissionsGuard` pair as the admin controllers.
 *
 * This stands a real Nest app up and sends real requests, with the real guards. Only the auth
 * service behind the guard and the domain services are stubs: what is under test is whether a
 * request without credentials reaches the handler.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import { AdminAuthService } from "./auth/admin-auth.service";
import type { AdminAuthContext } from "./auth/admin-auth.types";
import { AdminAuthGuard } from "./guards/admin-auth.guard";
import { PermissionsGuard } from "./guards/permissions.guard";
import { BenchmarksController } from "../benchmarks/benchmarks.controller";
import { BenchmarksService } from "../benchmarks/benchmarks.service";
import { PlayersController } from "../players/players.controller";
import { PlayersService } from "../players/players.service";
import { MetricsController } from "../metrics/metrics.controller";
import { MetricsService } from "../metrics/metrics.service";
import { SipController } from "../sip/sip.controller";
import { SipRecalculationService } from "../sip/sip-recalculation.service";

const API_KEY = "test-admin-key-for-write-routes";

const jwtSession = (permissions: string[]): AdminAuthContext => ({
  method: "jwt",
  roleSlug: "custom",
  roleName: "Custom",
  permissions,
});

// Tokens stand for accounts: the stub turns each into the permissions that account holds.
const sessions: Record<string, AdminAuthContext> = {
  "token-reader": jwtSession(["players.read"]),
  "token-writer": jwtSession(["players.write"]),
  "token-calibrator": jwtSession(["players.calibrate"]),
};

const adminAuth = {
  apiKeyContext: (): AdminAuthContext => ({
    method: "api_key",
    roleSlug: "super_admin",
    roleName: "Super Admin",
    permissions: [],
  }),
  sessionFromToken: async (token: string) => {
    const session = sessions[token];
    if (!session) throw new UnauthorizedException();
    return session;
  },
};

const benchmarks = {
  list: vi.fn(async () => []),
  create: vi.fn(async () => ({ id: "b1" })),
  update: vi.fn(async () => ({ id: "b1" })),
  remove: vi.fn(async () => ({ ok: true })),
};
const players = {
  list: vi.fn(async () => []),
  create: vi.fn(async () => ({ id: "p1" })),
  getById: vi.fn(async () => ({ id: "p1" })),
};
const metrics = { ingest: vi.fn(async () => ({ ok: true })) };
const sip = { recalculatePlayer: vi.fn(async () => ({ ok: true })) };

let app: INestApplication;
let base: string;
let savedKey: string | undefined;

beforeAll(async () => {
  savedKey = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = API_KEY;

  const moduleRef = await Test.createTestingModule({
    controllers: [BenchmarksController, PlayersController, MetricsController, SipController],
    providers: [
      { provide: AdminAuthService, useValue: adminAuth },
      AdminAuthGuard,
      PermissionsGuard,
      { provide: BenchmarksService, useValue: benchmarks },
      { provide: PlayersService, useValue: players },
      { provide: MetricsService, useValue: metrics },
      { provide: SipRecalculationService, useValue: sip },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0);
  const address = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app?.close();
  if (savedKey === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = savedKey;
});

const send = (method: string, path: string, headers: Record<string, string> = {}) =>
  fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(method === "GET" ? {} : { body: JSON.stringify({ name: "x" }) }),
  });

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Each route, the permission it needs, and the stub that would run if the request got in. */
const WRITE_ROUTES: Array<{
  method: string;
  path: string;
  needs: keyof typeof sessions;
  handler: ReturnType<typeof vi.fn>;
}> = [
  { method: "POST", path: "/benchmarks", needs: "token-calibrator", handler: benchmarks.create },
  { method: "PUT", path: "/benchmarks/b1", needs: "token-calibrator", handler: benchmarks.update },
  { method: "DELETE", path: "/benchmarks/b1", needs: "token-calibrator", handler: benchmarks.remove },
  { method: "POST", path: "/players", needs: "token-writer", handler: players.create },
  { method: "POST", path: "/sip/players/p1/match-metrics", needs: "token-writer", handler: metrics.ingest },
  { method: "POST", path: "/sip/players/p1/recalculate", needs: "token-calibrator", handler: sip.recalculatePlayer },
];

describe.each(WRITE_ROUTES)("$method $path", ({ method, path, needs, handler }) => {
  it("refuses an anonymous request before the handler runs", async () => {
    handler.mockClear();
    const res = await send(method, path);
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a wrong API key", async () => {
    handler.mockClear();
    const res = await send(method, path, { "x-admin-api-key": "not-the-key" });
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a signed-in admin without the permission", async () => {
    handler.mockClear();
    const res = await send(method, path, bearer("token-reader"));
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("lets through an admin holding the permission", async () => {
    handler.mockClear();
    const res = await send(method, path, bearer(needs));
    expect(res.status).toBeLessThan(300);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("lets through the operator API key", async () => {
    handler.mockClear();
    const res = await send(method, path, { "x-admin-api-key": API_KEY });
    expect(res.status).toBeLessThan(300);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("the reads stay public", () => {
  it.each(["/benchmarks", "/players", "/players/p1"])("GET %s needs no credentials", async (path) => {
    const res = await send("GET", path);
    expect(res.status).toBe(200);
  });
});
