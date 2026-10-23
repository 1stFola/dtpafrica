import { describe, it, expect, vi, beforeEach } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { AdminScoreboardService } from "./admin-scoreboard.service";

const TEAM_ID = "team-1";
const COMP_ID = "comp-1";

type Squad = { id: string; teamId: string; playerId: string | null; displayName: string; position: string | null; shirtNumber: number | null };

/**
 * In-memory stand-in for the tables importSquadCsv touches. Squad writes go
 * through a transaction handle, so a test can assert that a rejected file
 * wrote nothing at all.
 */
function setup(options: { existingSquad?: Squad[]; knownPlayers?: Array<{ id: string; normalizedName: string }>; otherTeamSquad?: Squad[] } = {}) {
  const squad: Squad[] = [...(options.existingSquad ?? [])];
  const writes = { created: 0, updated: 0 };
  let seq = 0;

  const tx = {
    sbTeamSquad: {
      findFirst: vi.fn(async ({ where }: any) =>
        squad.find(
          (row) =>
            row.teamId === where.teamId &&
            (where.playerId
              ? row.playerId === where.playerId
              : row.displayName.toLowerCase() === where.displayName.equals.toLowerCase())
        ) ?? null
      ),
      update: vi.fn(async ({ where, data }: any) => {
        writes.updated++;
        const row = squad.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
      create: vi.fn(async ({ data }: any) => {
        writes.created++;
        const row = { id: `squad-${++seq}`, ...data };
        squad.push(row);
        return row;
      }),
    },
  };

  const prisma = {
    sbTeam: {
      findUnique: vi.fn(async () => ({ id: TEAM_ID, competitionId: COMP_ID, competition: { id: COMP_ID } })),
    },
    player: {
      findMany: vi.fn(async ({ where }: any) =>
        (options.knownPlayers ?? []).filter((p) => where.normalizedName.in.includes(p.normalizedName))
      ),
    },
    sbTeamSquad: {
      // Conflict lookup: squad rows for these players in *other* teams.
      findMany: vi.fn(async ({ where }: any) =>
        (options.otherTeamSquad ?? [])
          .filter((row) => where.playerId.in.includes(row.playerId))
          .map((row) => ({ ...row, team: { name: "Rival FC" } }))
      ),
    },
    $transaction: vi.fn(async (fn: any) => fn(tx)),
  };

  // Deterministic ids: a known player keeps its id, anyone else gets a new one.
  const playerDirectory = {
    resolveOrCreatePlayer: vi.fn(async (displayName: string) => {
      const known = (options.knownPlayers ?? []).find(
        (p) => p.normalizedName === displayName.toLowerCase()
      );
      return { id: known?.id ?? `new-${displayName.toLowerCase().replace(/\s+/g, "-")}`, displayName };
    }),
    publishRegisteredPlayers: vi.fn(async (ids: string[]) => ids.length),
  };

  const service = new AdminScoreboardService(
    prisma as never,
    null as never,
    null as never,
    playerDirectory as never,
    null as never,
    null as never
  );
  return { service, squad, writes, prisma, playerDirectory };
}

describe("importSquadCsv", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("imports the downloadable template as-is", async () => {
    const csv = "shirtNumber,displayName,position\n1,Goalkeeper Name,GK\n9,Striker Name,ST\n";
    const result = await ctx.service.importSquadCsv(TEAM_ID, csv);
    expect(result).toMatchObject({ imported: 2, created: 2, updated: 0, warnings: [] });
    expect(ctx.squad.map((r) => [r.shirtNumber, r.displayName, r.position])).toEqual([
      [1, "Goalkeeper Name", "GK"],
      [9, "Striker Name", "ST"],
    ]);
  });

  // Regression: Excel's "CSV UTF-8" prefixes a byte-order mark that glued
  // itself to the first header, so the shirt-number column silently vanished.
  it("reads a file saved by Excel with a byte-order mark", async () => {
    const csv = "\uFEFFshirtNumber,displayName,position\n7,Idris Okekunle,RW\n";
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    await ctx.service.importSquadCsv(TEAM_ID, csv);
    expect(ctx.squad[0]).toMatchObject({ shirtNumber: 7, displayName: "Idris Okekunle" });
  });

  it("accepts the jerseyNumber / fullName headers used by roster exports", async () => {
    const csv = "jerseyNumber,fullName,position\n17,Damilola Oderinde,ST\n";
    await ctx.service.importSquadCsv(TEAM_ID, csv);
    expect(ctx.squad[0]).toMatchObject({ shirtNumber: 17, displayName: "Damilola Oderinde" });
  });

  // Regression: rows were written one by one and the loop threw mid-way, so a
  // failure part way down the file left the earlier rows committed.
  it("writes nothing when any row is invalid", async () => {
    const csv = "shirtNumber,displayName\n1,Keeper One\n2,Defender Two\nten,Bad Number\n";
    await expect(ctx.service.importSquadCsv(TEAM_ID, csv)).rejects.toThrow(/row 4: shirt number "ten"/);
    expect(ctx.writes).toEqual({ created: 0, updated: 0 });
    expect(ctx.playerDirectory.resolveOrCreatePlayer).not.toHaveBeenCalled();
  });

  it("rejects a player already registered to another team, naming the row", async () => {
    ctx = setup({
      knownPlayers: [{ id: "p-victor", normalizedName: "victor johnson" }],
      otherTeamSquad: [
        { id: "s-x", teamId: "team-2", playerId: "p-victor", displayName: "Victor Johnson", position: null, shirtNumber: 4 },
      ],
    });
    const csv = "shirtNumber,displayName\n1,Someone Else\n4,Victor Johnson\n";
    await expect(ctx.service.importSquadCsv(TEAM_ID, csv)).rejects.toThrow(
      /row 3: Victor Johnson is already registered for Rival FC/
    );
    expect(ctx.writes).toEqual({ created: 0, updated: 0 });
    /* Rejected: the players it resolved stay hidden drafts, not public players on no squad. */
    expect(ctx.playerDirectory.publishRegisteredPlayers).not.toHaveBeenCalled();
  });

  it("publishes the squad's players inside the transaction that writes the rows", async () => {
    /* The UFC 2026 squads were imported as drafts and every profile opened as
       "Profile verification in progress". */
    const csv = "shirtNumber,displayName\n1,Amaka Obi\n2,Ngozi Eze\n";
    await ctx.service.importSquadCsv(TEAM_ID, csv);
    expect(ctx.playerDirectory.publishRegisteredPlayers).toHaveBeenCalledWith(
      ["new-amaka-obi", "new-ngozi-eze"],
      expect.objectContaining({ sbTeamSquad: expect.anything() })
    );
  });

  it("rejects a player listed twice in the same file", async () => {
    const csv = "displayName\nAmaka Obi\nNgozi Eze\namaka  obi\n";
    await expect(ctx.service.importSquadCsv(TEAM_ID, csv)).rejects.toThrow(/row 4: .* already listed on row 2/);
    expect(ctx.writes.created).toBe(0);
  });

  it("warns about a repeated shirt number but still imports", async () => {
    const csv = "shirtNumber,displayName\n30,Jerry Elochukwu Othniel\n30,Sabiu Abdullahi\n";
    const result = await ctx.service.importSquadCsv(TEAM_ID, csv);
    expect(result.imported).toBe(2);
    expect(result.warnings).toEqual(["shirt #30 is used on rows 2 and 3"]);
  });

  it("keeps recorded values when a cell is left blank", async () => {
    ctx = setup({
      existingSquad: [
        { id: "s-1", teamId: TEAM_ID, playerId: "new-tunde-bello", displayName: "Tunde Bello", position: "ST", shirtNumber: 9 },
      ],
    });
    const result = await ctx.service.importSquadCsv(TEAM_ID, "shirtNumber,displayName,position\n,Tunde Bello,\n");
    expect(result).toMatchObject({ created: 0, updated: 1 });
    expect(ctx.squad[0]).toMatchObject({ shirtNumber: 9, position: "ST" });
  });

  it("explains a missing name column", async () => {
    await expect(ctx.service.importSquadCsv(TEAM_ID, "shirtNumber,position\n1,GK\n")).rejects.toThrow(
      BadRequestException
    );
    await expect(ctx.service.importSquadCsv(TEAM_ID, "shirtNumber,position\n1,GK\n")).rejects.toThrow(
      /missing a player name column/
    );
  });
});
