import { describe, it, expect, vi, beforeEach } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { AdminScoreboardController } from "./admin-scoreboard.controller";
import { AdminScoreboardService } from "./admin-scoreboard.service";

// ── Mock PrismaService ────────────────────────────────────────────────────────
const mockPrisma = {
  sbTeamSquad: {
    findMany: vi.fn(),
  },
};

/** Builds the service with only the dependency `listSquads` actually touches. */
function makeService(): AdminScoreboardService {
  return new AdminScoreboardService(
    mockPrisma as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never
  );
}

/** The `where` object the service handed to Prisma on the last call. */
function lastWhere(): Record<string, unknown> {
  return mockPrisma.sbTeamSquad.findMany.mock.calls.at(-1)![0].where;
}

describe("AdminScoreboardService.listSquads — filter mapping", () => {
  let service: AdminScoreboardService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.sbTeamSquad.findMany.mockResolvedValue([]);
    service = makeService();
  });

  it("omits shirtNumber entirely when no filter is given", async () => {
    await service.listSquads({});
    expect(lastWhere()).not.toHaveProperty("shirtNumber");
  });

  // Regression: NestJS's ValidationPipe coerces an absent `?: number` query
  // param with `+undefined`, producing NaN. The old `!== undefined` guard let
  // that through and Prisma rejected NaN on an Int column, so *every* unfiltered
  // list call failed — not just shirt-number-filtered ones.
  it("does not forward NaN to Prisma", async () => {
    await service.listSquads({ shirtNumber: Number.NaN });
    expect(lastWhere()).not.toHaveProperty("shirtNumber");
  });

  it("forwards a real shirt number", async () => {
    await service.listSquads({ shirtNumber: 10 });
    expect(lastWhere().shirtNumber).toBe(10);
  });

  it("maps teamId and competitionId onto the query", async () => {
    await service.listSquads({ teamId: "team-1", competitionId: "comp-1" });
    const where = lastWhere();
    expect(where.teamId).toBe("team-1");
    expect(where.team).toEqual({ competitionId: "comp-1" });
  });

  it("searches display name and slug for a text query", async () => {
    await service.listSquads({ q: "  obi  " });
    expect(lastWhere().OR).toEqual([
      { displayName: { contains: "obi", mode: "insensitive" } },
      { player: { displayName: { contains: "obi", mode: "insensitive" } } },
      { player: { slug: { contains: "obi", mode: "insensitive" } } },
    ]);
  });
});

describe("AdminScoreboardController.listSquads — shirtNumber query parsing", () => {
  let controller: AdminScoreboardController;
  const sb = { listSquads: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AdminScoreboardController(sb as never);
  });

  const forwarded = () => sb.listSquads.mock.calls.at(-1)![0].shirtNumber;

  it("treats an absent param as no filter", () => {
    controller.listSquads(undefined, undefined, undefined, undefined, undefined);
    expect(forwarded()).toBeUndefined();
  });

  it("treats a blank param as no filter", () => {
    controller.listSquads(undefined, undefined, undefined, undefined, "  ");
    expect(forwarded()).toBeUndefined();
  });

  it("parses a numeric string", () => {
    controller.listSquads(undefined, undefined, undefined, undefined, "10");
    expect(forwarded()).toBe(10);
  });

  it("rejects a non-integer param", () => {
    expect(() =>
      controller.listSquads(undefined, undefined, undefined, undefined, "abc")
    ).toThrow(BadRequestException);
  });
});
