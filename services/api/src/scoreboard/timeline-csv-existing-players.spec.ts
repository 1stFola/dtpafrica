import { describe, it, expect, vi } from "vitest";
import { ScoreboardService } from "./scoreboard.service";

/**
 * The match-center CSV uploads link a label to a player the fixture's squads already
 * hold, and never create one. They used to make a public player, and a squad row, for
 * every name they did not recognise.
 */
const MATCH_ID = "match-1";
const HOME = "team-home";
const AWAY = "team-away";

function setup() {
  let seq = 0;
  const prisma = {
    sbMatch: {
      findUnique: vi.fn(async () => ({
        id: MATCH_ID,
        competitionId: "comp-1",
        homeTeamId: HOME,
        awayTeamId: AWAY,
        homeTeam: { id: HOME, name: "Ikoyi Dolphin FC" },
        awayTeam: { id: AWAY, name: "OOA FA" },
        competition: { id: "comp-1" },
      })),
    },
    sbTeamSquad: {
      findMany: vi.fn(async () => [
        {
          teamId: HOME,
          playerId: "player-ugwu",
          displayName: "Ugwu David",
          player: {
            id: "player-ugwu",
            displayName: "Ugwu David",
            normalizedName: "ugwu david",
            slug: "ugwu-david",
          },
        },
      ]),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    sbMatchSquadPlayer: { findMany: vi.fn(async () => []) },
    player: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    sbMatchEvent: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => ({ id: `event-${++seq}`, ...data })),
      findMany: vi.fn(async () => []),
    },
  };
  const lifecycle = { applyMatchEventToPlayerStats: vi.fn(async () => undefined) };
  const service = new ScoreboardService(
    prisma as never,
    null as never,
    lifecycle as never,
    null as never
  );
  // Fire-and-forget metrics refresh; not what these tests are about.
  vi.spyOn(service, "ingestSipMetricsFromMatch" as never).mockResolvedValue(undefined as never);
  return { service, prisma };
}

describe("ingestShortMatchEventsCsv", () => {
  it("links a squad player and leaves an unknown name as a label, creating nobody", async () => {
    const { service, prisma } = setup();
    const csv = [
      "minute,event_type,team,player",
      "12',goal,Ikoyi Dolphin FC,UGWU DAVID",
      "30',goal,Ikoyi Dolphin FC,Brand New Boy",
    ].join("\n");

    const result = await service.ingestShortMatchEventsCsv(MATCH_ID, csv);

    expect(result.eventsCreated).toBe(2);
    expect(prisma.player.create).not.toHaveBeenCalled();
    expect(prisma.player.update).not.toHaveBeenCalled();
    expect(prisma.sbTeamSquad.create).not.toHaveBeenCalled();
    const written = prisma.sbMatchEvent.create.mock.calls.map(([args]: any) => [
      args.data.playerLabel,
      args.data.playerId,
    ]);
    expect(written).toEqual([
      ["UGWU DAVID", "player-ugwu"],
      ["Brand New Boy", undefined],
    ]);
  });

  it("checks every team name before writing the first event", async () => {
    const { service, prisma } = setup();
    const csv = [
      "minute,event_type,team,player",
      "12',goal,Ikoyi Dolphin FC,Ugwu David",
      "30',goal,Somebody Else United,Brand New Boy",
    ].join("\n");

    await expect(service.ingestShortMatchEventsCsv(MATCH_ID, csv)).rejects.toThrow(
      /Somebody Else United/
    );
    expect(prisma.sbMatchEvent.create).not.toHaveBeenCalled();
  });
});
