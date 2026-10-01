/**
 * That the bulk records routes are reachable, and are not the single-row routes.
 *
 * `DELETE /competitions` and `DELETE /competitions/:competitionId` are one path apart. Express
 * matches in registration order and a param matches any single segment, so a bulk route one
 * segment deeper — `competitions/bulk` — would also match the id route, and which handler ran
 * would depend on which decorator came first in the file. Nothing in a unit test would notice:
 * the service method would be called with the id `"bulk"` and the row would simply not be found.
 *
 * So this stands a real Nest app up on a port and sends real requests. The guards are replaced
 * with ones that let everything through, because what is being tested is the router, and the
 * service is a stub, because what is being tested is which method the router reaches.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { AddressInfo } from "node:net";
import { AdminScoreboardController } from "./admin-scoreboard.controller";
import { AdminScoreboardService } from "./admin-scoreboard.service";
import { AdminAuthGuard } from "./guards/admin-auth.guard";
import { PermissionsGuard } from "./guards/permissions.guard";

const stub = {
  deleteCompetition: vi.fn(async () => ({ ok: true })),
  bulkDeleteCompetitions: vi.fn(async () => ({ requested: 2, done: 2, failures: [] })),
  bulkSetCompetitionsPublished: vi.fn(async () => ({ requested: 2, done: 2, failures: [] })),
  updateCompetition: vi.fn(async () => ({ id: "c1" })),
  deleteTeam: vi.fn(async () => ({ ok: true })),
  bulkDeleteTeams: vi.fn(async () => ({ requested: 1, done: 1, failures: [] })),
  deleteMatch: vi.fn(async () => ({ ok: true })),
  bulkDeleteMatches: vi.fn(async () => ({ requested: 1, done: 1, failures: [] })),
};

let app: INestApplication;
let base: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminScoreboardController],
    providers: [{ provide: AdminScoreboardService, useValue: stub }],
  })
    .overrideGuard(AdminAuthGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(PermissionsGuard)
    .useValue({ canActivate: () => true })
    .compile();

  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0);
  const address = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}/admin/scoreboard`;
});

afterAll(async () => {
  await app?.close();
});

const send = (path: string, method: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });


describe("DELETE competitions", () => {
  it("reaches the bulk handler, not the one that takes an id", async () => {
    stub.bulkDeleteCompetitions.mockClear();
    stub.deleteCompetition.mockClear();

    const res = await send("/competitions", "DELETE", { competitionIds: ["a", "b"] });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requested: 2, done: 2, failures: [] });
    expect(stub.bulkDeleteCompetitions).toHaveBeenCalledWith(["a", "b"]);
    expect(stub.deleteCompetition).not.toHaveBeenCalled();
  });

  it("leaves the single-row route alone", async () => {
    stub.bulkDeleteCompetitions.mockClear();
    stub.deleteCompetition.mockClear();

    await send("/competitions/c1", "DELETE");

    expect(stub.deleteCompetition).toHaveBeenCalledWith("c1");
    expect(stub.bulkDeleteCompetitions).not.toHaveBeenCalled();
  });

  it("refuses an empty or missing list rather than treating it as nothing to do", async () => {
    expect((await send("/competitions", "DELETE", { competitionIds: [] })).status).toBe(400);
    expect((await send("/competitions", "DELETE", {})).status).toBe(400);
  });
});

describe("PATCH competitions", () => {
  it("reaches the bulk publish handler", async () => {
    stub.bulkSetCompetitionsPublished.mockClear();
    stub.updateCompetition.mockClear();

    const res = await send("/competitions", "PATCH", {
      competitionIds: ["a", "b"],
      isPublished: false,
    });

    expect(res.status).toBe(200);
    expect(stub.bulkSetCompetitionsPublished).toHaveBeenCalledWith(["a", "b"], false);
    expect(stub.updateCompetition).not.toHaveBeenCalled();
  });

  it("insists on a boolean, so a missing flag cannot read as unpublish", async () => {
    /* `isPublished: undefined` would publish or unpublish forty competitions on a guess. */
    expect((await send("/competitions", "PATCH", { competitionIds: ["a"] })).status).toBe(400);
    expect(
      (await send("/competitions", "PATCH", { competitionIds: ["a"], isPublished: "yes" })).status
    ).toBe(400);
  });

  it("leaves the single-row patch alone", async () => {
    stub.bulkSetCompetitionsPublished.mockClear();
    stub.updateCompetition.mockClear();

    await send("/competitions/c1", "PATCH", { name: "Renamed" });

    expect(stub.updateCompetition).toHaveBeenCalled();
    expect(stub.bulkSetCompetitionsPublished).not.toHaveBeenCalled();
  });
});

describe("DELETE teams and matches", () => {
  it("reaches the bulk team handler", async () => {
    stub.bulkDeleteTeams.mockClear();
    stub.deleteTeam.mockClear();

    await send("/teams", "DELETE", { teamIds: ["t1"] });

    expect(stub.bulkDeleteTeams).toHaveBeenCalledWith(["t1"]);
    expect(stub.deleteTeam).not.toHaveBeenCalled();
  });

  it("reaches the bulk fixture handler", async () => {
    stub.bulkDeleteMatches.mockClear();
    stub.deleteMatch.mockClear();

    await send("/matches", "DELETE", { matchIds: ["m1"] });

    expect(stub.bulkDeleteMatches).toHaveBeenCalledWith(["m1"]);
    expect(stub.deleteMatch).not.toHaveBeenCalled();
  });

  it("leaves both single-row routes alone", async () => {
    stub.deleteTeam.mockClear();
    stub.deleteMatch.mockClear();

    await send("/teams/t1", "DELETE");
    await send("/matches/m1", "DELETE");

    expect(stub.deleteTeam).toHaveBeenCalledWith("t1");
    expect(stub.deleteMatch).toHaveBeenCalledWith("m1");
  });

  it("names the field in the refusal, so the message says which list was wrong", async () => {
    const res = await send("/teams", "DELETE", { squadIds: ["t1"] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("teamIds");
  });
});
