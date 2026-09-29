import { describe, it, expect, vi, beforeEach } from "vitest";
import { HomeService } from "./home.service";

/**
 * Covers how the "ScoreBoard History / Event-Backed Match Record" section on
 * the public player profile is assembled. Both private helpers are exercised
 * directly: they carry all of the matching and aggregation logic, and driving
 * them through publicPlayer() would need a mock of the entire profile select.
 */

const PLAYER_ID = "player-1";
const PLAYER = { id: PLAYER_ID, displayName: "Chidi Nwosu" };

function makeService(prisma: unknown) {
  return new HomeService(prisma as never, null as never);
}

/** Minimal SbMatchEvent row of the shape the include produces. */
function eventRow(overrides: Record<string, unknown> = {}) {
  const matchId = (overrides.matchId as string) ?? "match-1";
  const kickoffAt = (overrides.kickoffAt as Date) ?? new Date("2026-05-01T10:00:00Z");
  const team = { id: "team-1", name: "Akoka City", slug: "akoka-city", shortName: "AKC", logoUrl: null };
  return {
    id: (overrides.id as string) ?? "event-1",
    matchId,
    teamId: team.id,
    playerId: PLAYER_ID,
    assistPlayerId: null,
    playerLabel: null,
    playerLabel2: null,
    assistLabel: null,
    type: (overrides.type as string) ?? "goal",
    minute: (overrides.minute as number) ?? 10,
    detail: null,
    metadata: null,
    createdAt: (overrides.createdAt as Date) ?? new Date("2026-05-02T00:00:00Z"),
    team,
    match: {
      id: matchId,
      slug: `${matchId}-slug`,
      status: "finished",
      kickoffAt,
      venue: "Onikan Stadium",
      roundLabel: "Day 1",
      homeScore: 1,
      awayScore: 0,
      competition: { id: "comp-1", name: "Coal City", slug: "coal-city", season: "2026", country: "Nigeria" },
      homeTeam: team,
      awayTeam: { id: "team-2", name: "Vido 99", slug: "vido-99", shortName: "VID", logoUrl: null },
    },
    ...overrides,
  };
}

describe("scoreboard history — candidate query", () => {
  let calls: any[];
  let prisma: any;

  beforeEach(() => {
    calls = [];
    prisma = {
      sbMatchEvent: {
        findMany: vi.fn(async (args: any) => {
          calls.push(args);
          return [];
        }),
      },
    };
  });

  const run = (squadRows: any[] = []) =>
    (makeService(prisma) as any).findScoreboardHistoryEvents(PLAYER, squadRows);

  // Regression: the exact, foreign-key-linked events used to share a single
  // `take` with a branch matching every labelled event of the player's teams,
  // so a busy squad could crowd this player's own events out of the window.
  it("gives the linked lookup its own query, unmixed with team label matching", async () => {
    await run([{ teamId: "team-1", displayName: "Chidi Nwosu" }]);

    expect(prisma.sbMatchEvent.findMany).toHaveBeenCalledTimes(2);
    const [linked] = calls;
    const orClauses = linked.where.OR.map((c: any) => Object.keys(c)[0]).sort();
    expect(orClauses).toEqual(["assistPlayerId", "metadata", "playerId"]);
    expect(JSON.stringify(linked.where)).not.toContain("teamId");
  });

  // Regression: rows were truncated by `take` in createdAt order but presented
  // in kickoff order, so events could be dropped on a different axis to the
  // one the user sees.
  it("orders candidates by match kickoff, matching how they are presented", async () => {
    await run([{ teamId: "team-1", displayName: "Chidi Nwosu" }]);
    for (const call of calls) {
      expect(call.orderBy[0]).toEqual({ match: { kickoffAt: "desc" } });
    }
  });

  it("only considers published matches in published competitions", async () => {
    await run([{ teamId: "team-1", displayName: "Chidi Nwosu" }]);
    for (const call of calls) {
      expect(call.where.match).toEqual({ isPublished: true, competition: { isPublished: true } });
    }
  });

  it("skips the label query when there is no usable name to match on", async () => {
    await (makeService(prisma) as any).findScoreboardHistoryEvents(
      { id: PLAYER_ID, displayName: "   " },
      []
    );
    expect(prisma.sbMatchEvent.findMany).toHaveBeenCalledTimes(1);
  });

  it("does not return the same event twice when it is both linked and labelled", async () => {
    const shared = eventRow({ id: "dupe", playerLabel: "Chidi Nwosu" });
    prisma.sbMatchEvent.findMany = vi.fn(async () => [shared]);
    const rows = await run([{ teamId: "team-1", displayName: "Chidi Nwosu" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].historyMatchedBy).toBe("link");
  });
});

describe("scoreboard history — aggregates", () => {
  const build = (eventRows: any[]) =>
    (makeService({}) as any).buildScoreboardHistory([], eventRows);

  // Regression: aggregates were derived from the 50-event render slice, so a
  // player with more events than that had understated totals on their profile.
  it("counts every matched event, not just the rendered slice", () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      eventRow({
        id: `event-${i}`,
        matchId: `match-${i}`,
        kickoffAt: new Date(2026, 0, 1 + i),
        historyRole: "primary",
        historyLabel: PLAYER.displayName,
        historyMatchedBy: "link",
      })
    );

    const history = build(rows);

    expect(history.events).toHaveLength(50);
    expect(history.aggregates.events).toBe(60);
    expect(history.aggregates.goals).toBe(60);
    expect(history.aggregates.appearances).toBe(60);
    expect(history.appearances).toHaveLength(60);
  });

  /*
   * End-to-end over both helpers, which is where the understatement actually
   * came from: the finder used to slice to the render limit before the builder
   * ever counted, so a 60-goal player's profile reported 50.
   */
  it("reports full totals for a player with more events than the render limit", async () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      eventRow({ id: `event-${i}`, matchId: `match-${i}`, kickoffAt: new Date(2026, 0, 1 + i) })
    );
    const prisma = {
      sbMatchEvent: { findMany: vi.fn(async (args: any) => (args.where.OR ? rows : [])) },
    };
    const service = makeService(prisma) as any;

    const matched = await service.findScoreboardHistoryEvents(PLAYER, []);
    const history = service.buildScoreboardHistory([], matched);

    expect(matched).toHaveLength(60);
    expect(history.events).toHaveLength(50);
    expect(history.aggregates.events).toBe(60);
    expect(history.aggregates.goals).toBe(60);
    expect(history.aggregates.appearances).toBe(60);
  });

  it("separates goals, assists and cards by the role the player held", () => {
    const rows = [
      eventRow({ id: "g", type: "goal", historyRole: "primary", historyMatchedBy: "link", historyLabel: null }),
      eventRow({ id: "a", type: "goal", historyRole: "assist", historyMatchedBy: "link", historyLabel: null }),
      eventRow({ id: "y", type: "yellow_card", historyRole: "primary", historyMatchedBy: "link", historyLabel: null }),
      eventRow({ id: "r", type: "red_card", historyRole: "primary", historyMatchedBy: "link", historyLabel: null }),
    ];

    const history = build(rows);

    expect(history.aggregates.goals).toBe(1);
    expect(history.aggregates.assists).toBe(1);
    expect(history.aggregates.yellowCards).toBe(1);
    expect(history.aggregates.redCards).toBe(1);
    // All four events belong to the same match, so it is one appearance.
    expect(history.aggregates.appearances).toBe(1);
  });
});

describe("scoreboard history — a label carrying a shirt number", () => {
  /* The recorder captures a number, so the API stores `No. 8 OLAIYA FARUK`. Its dedupe
     key was `no 8 olaiya faruk` while the squad's was `olaiya faruk`, so they could
     never match -- and any event nothing later linked by foreign key was invisible on
     that player's profile. The goal showed on the fixture and the player had no idea
     the product knew about it. The whole DYNAMIC FC v HIGHKLASS SA timeline was in that
     state. */

  const runWith = async (rows: any[], player = { id: "other", displayName: "Olaiya Faruk" }) => {
    const prisma: any = {
      sbMatchEvent: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(rows),
      },
    };
    return (makeService(prisma) as any).findScoreboardHistoryEvents(player, [
      { teamId: "team-1", displayName: "Olaiya Faruk" },
    ]);
  };

  it("matches a scorer label that leads with the shirt number", async () => {
    const matched = await runWith([
      eventRow({ id: "e1", playerId: null, playerLabel: "No. 8 OLAIYA FARUK" }),
    ]);
    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({ historyRole: "primary", historyMatchedBy: "label" });
  });

  it("matches an assist label the same way", async () => {
    const matched = await runWith([
      eventRow({ id: "e2", playerId: null, assistPlayerId: null, assistLabel: "No. 8 Olaiya Faruk" }),
    ]);
    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({ historyRole: "assist" });
  });

  it("matches the second player on an event", async () => {
    const matched = await runWith([
      eventRow({ id: "e3", playerId: null, playerLabel2: "#8 OLAIYA FARUK" }),
    ]);
    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({ historyRole: "secondary" });
  });

  it("still matches a label with no number on it", async () => {
    const matched = await runWith([
      eventRow({ id: "e4", playerId: null, playerLabel: "Olaiya Faruk" }),
    ]);
    expect(matched).toHaveLength(1);
  });

  it("does not match somebody else who happens to wear a number", async () => {
    /* Stripping the number must not make every numbered label match every player. */
    const matched = await runWith([
      eventRow({ id: "e5", playerId: null, playerLabel: "No. 8 SOMEBODY ELSE" }),
    ]);
    expect(matched).toEqual([]);
  });

  it("does not match a bare number, which names nobody", async () => {
    const matched = await runWith([
      eventRow({ id: "e6", playerId: null, playerLabel: "No. 8" }),
    ]);
    expect(matched).toEqual([]);
  });
});
