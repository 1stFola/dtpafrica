import { describe, it, expect, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import {
  matchSquadCsvRows,
  parseMatchSquadCsv,
  type TeamSquadCandidate,
} from "./match-squad-csv";
import { AdminScoreboardService } from "./admin-scoreboard.service";

const HEADER = "jersey_number,player_name,position,is_starter";

function member(
  id: string,
  displayName: string,
  shirtNumber: number | null,
  extra: Partial<TeamSquadCandidate> = {}
): TeamSquadCandidate {
  return {
    id,
    displayName,
    shirtNumber,
    position: "MF",
    playerId: `player-${id}`,
    player: { displayName },
    ...extra,
  };
}

function rowsOf(...lines: string[]) {
  return parseMatchSquadCsv([HEADER, ...lines].join("\n"));
}

describe("matchSquadCsvRows", () => {
  it("maps a row to the squad player whatever the casing and punctuation", () => {
    const squad = [member("a", "Nwosu Henry", 9)];
    const { matched, errors } = matchSquadCsvRows(rowsOf("9,NWOSU  henry.,ST,TRUE"), squad);
    expect(errors).toEqual([]);
    expect(matched.map((m) => m.squad.id)).toEqual(["a"]);
  });

  it("maps a name written the other way round", () => {
    const squad = [member("a", "Henry Nwosu", 9)];
    const { matched, errors } = matchSquadCsvRows(rowsOf("9,Nwosu Henry,ST,TRUE"), squad);
    expect(errors).toEqual([]);
    expect(matched[0].squad.id).toBe("a");
  });

  it("matches on the linked player's name when the squad row is spelled differently", () => {
    const squad = [member("a", "Nwosu H.", 9, { player: { displayName: "Nwosu Henry" } })];
    const { matched } = matchSquadCsvRows(rowsOf("9,Nwosu Henry,ST,TRUE"), squad);
    expect(matched[0].squad.id).toBe("a");
  });

  it("refuses a name nobody in the squad answers to", () => {
    const squad = [member("a", "Nwosu Henry", 9)];
    const { matched, errors } = matchSquadCsvRows(rowsOf("9,Someone Else,ST,TRUE"), squad);
    expect(matched).toEqual([]);
    expect(errors).toEqual(["row 2: Someone Else is not in this team's squad"]);
  });

  it("never matches on the jersey number", () => {
    const squad = [member("a", "Nwosu Henry", 9)];
    const { errors } = matchSquadCsvRows(rowsOf("9,Nwosu Harry,ST,TRUE"), squad);
    expect(errors).toHaveLength(1);
  });

  it("refuses a name two squad rows answer to", () => {
    const squad = [member("a", "Nwosu Henry", 9), member("b", "NWOSU HENRY", 10)];
    const { errors } = matchSquadCsvRows(rowsOf("9,Nwosu Henry,ST,TRUE"), squad);
    expect(errors[0]).toMatch(/matches more than one squad player/);
  });

  it("prefers the exact spelling over the reversed one", () => {
    const squad = [member("a", "Nwosu Henry", 9), member("b", "Henry Nwosu", 10)];
    const { matched, errors } = matchSquadCsvRows(rowsOf("9,Henry Nwosu,ST,TRUE"), squad);
    expect(errors).toEqual([]);
    expect(matched[0].squad.id).toBe("b");
  });

  it("refuses the same player listed twice", () => {
    const squad = [member("a", "Nwosu Henry", 9)];
    const { errors } = matchSquadCsvRows(
      rowsOf("9,Nwosu Henry,ST,TRUE", "9,Henry Nwosu,ST,FALSE"),
      squad
    );
    expect(errors).toEqual(["row 3: Henry Nwosu is the same player as row 2"]);
  });

  it("keeps the squad's jersey number over the sheet's", () => {
    const squad = [member("a", "Nwosu Henry", 9)];
    const { matched } = matchSquadCsvRows(rowsOf("14,Nwosu Henry,ST,TRUE"), squad);
    expect(matched[0].shirtNumber).toBe(9);
  });

  it("takes the sheet's jersey number when the squad player has none", () => {
    const squad = [member("a", "Nwosu Henry", null)];
    const { matched, warnings } = matchSquadCsvRows(rowsOf("14,Nwosu Henry,ST,TRUE"), squad);
    expect(matched[0].shirtNumber).toBe(14);
    expect(warnings).toEqual([]);
  });

  it("leaves a blank when the sheet's number is already worn in the squad", () => {
    const squad = [member("a", "Nwosu Henry", null), member("b", "Ade Bola", 14)];
    const { matched, warnings } = matchSquadCsvRows(rowsOf("14,Nwosu Henry,ST,TRUE"), squad);
    expect(matched[0].shirtNumber).toBeNull();
    expect(warnings[0]).toMatch(/#14 is already worn/);
  });

  it("does not hand one number to two blank players on the same sheet", () => {
    const squad = [member("a", "Nwosu Henry", null), member("b", "Ade Bola", null)];
    const { matched, warnings } = matchSquadCsvRows(
      rowsOf("14,Nwosu Henry,ST,TRUE", "14,Ade Bola,MF,TRUE"),
      squad
    );
    expect(matched.map((m) => m.shirtNumber)).toEqual([14, null]);
    expect(warnings).toHaveLength(1);
  });
});

describe("AdminScoreboardService.uploadMatchSquadCsv", () => {
  const MATCH_ID = "match-1";
  const TEAM_ID = "team-1";

  function setup(squad: TeamSquadCandidate[]) {
    const tx = {
      sbTeamSquad: { update: vi.fn(async () => ({})), create: vi.fn() },
      player: { update: vi.fn(async () => ({})), create: vi.fn() },
      sbMatch: { update: vi.fn(async () => ({})) },
      sbMatchSquadPlayer: {
        deleteMany: vi.fn(async () => ({})),
        createMany: vi.fn(async (_args: { data: unknown[] }) => ({})),
      },
    };
    const prisma = {
      sbMatch: {
        findUnique: vi.fn(async () => ({
          id: MATCH_ID,
          stats: {},
          homeTeamId: TEAM_ID,
          awayTeamId: "team-2",
          formationHome: null,
          formationAway: null,
        })),
      },
      sbTeamSquad: {
        findMany: vi.fn(async ({ where }: any) =>
          where.teamId === TEAM_ID
            ? squad
            : squad.filter((row) => where.id.in.includes(row.id))
        ),
      },
      player: { create: vi.fn() },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };
    // syncMatchSquadPlayers reads squad rows through the transaction handle.
    (tx.sbTeamSquad as any).findMany = prisma.sbTeamSquad.findMany;
    const service = new AdminScoreboardService(
      prisma as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never
    );
    return { service, prisma, tx };
  }

  it("rejects the whole sheet, writing nothing, when a name is not in the squad", async () => {
    const { service, prisma, tx } = setup([member("a", "Nwosu Henry", 9)]);
    const upload = service.uploadMatchSquadCsv(
      MATCH_ID,
      TEAM_ID,
      [HEADER, "9,Nwosu Henry,ST,TRUE", "10,New Boy,MF,TRUE"].join("\n")
    );
    await expect(upload).rejects.toBeInstanceOf(BadRequestException);
    await expect(upload).rejects.toThrow(/row 3: New Boy is not in this team's squad/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.player.create).not.toHaveBeenCalled();
    expect(tx.sbTeamSquad.create).not.toHaveBeenCalled();
  });

  it("updates the matched squad row and keeps its name and number", async () => {
    const { service, tx } = setup([
      member("a", "Nwosu Henry", 9),
      member("b", "Ade Bola", null, { position: null }),
    ]);
    const result = await service.uploadMatchSquadCsv(
      MATCH_ID,
      TEAM_ID,
      [HEADER, "14,NWOSU HENRY,ST,TRUE", "7,Bola Ade,DF,FALSE"].join("\n")
    );

    expect(result).toMatchObject({ imported: 2, starters: 1, bench: 1, jerseyNumbersFilled: 1 });
    expect(tx.sbTeamSquad.create).not.toHaveBeenCalled();
    expect(tx.player.create).not.toHaveBeenCalled();
    expect(tx.sbTeamSquad.update).toHaveBeenCalledWith({
      where: { id: "a" },
      data: { position: "ST", shirtNumber: 9 },
    });
    expect(tx.sbTeamSquad.update).toHaveBeenCalledWith({
      where: { id: "b" },
      data: { position: "DF", shirtNumber: 7 },
    });

    const written = tx.sbMatchSquadPlayer.createMany.mock.calls[0]?.[0].data ?? [];
    expect(written.map((row: any) => [row.playerName, row.jerseyNumber, row.playerId])).toEqual([
      ["Nwosu Henry", 9, "player-a"],
      ["Ade Bola", 7, "player-b"],
    ]);
  });
});
