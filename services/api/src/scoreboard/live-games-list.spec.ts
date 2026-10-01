/**
 * Which matches reach the public Live Games list and the live ribbon.
 *
 * The list was a query on one column — `sb_matches.status IN ('live','halftime')` — and that
 * column is only ever written by the match editor. So a game its recorder had kicked off
 * read LIVE on its own card and was missing from Live Games, because nothing had told the
 * row. The list now asks the same question the card answers.
 *
 * Both halves matter and they fail differently. If the query is wrong the rows never arrive,
 * and no in-memory rule can put them back; if the rule is wrong the list fills with games
 * that are not being played. So the query shape is asserted here as well as the outcome.
 */
import { describe, expect, it, vi } from "vitest";
import { ScoreboardService } from "./scoreboard.service";

const sheet = (over: Record<string, unknown> = {}) => ({
  id: "sheet-1",
  status: "live",
  eventsStatus: "live",
  tallies: {},
  events: [],
  clock: null as unknown,
  kits: null,
  recorderName: "A Recorder",
  updatedAt: new Date(),
  idleLockedAt: null as Date | null,
  ...over,
});

const team = (id: string, name: string) => ({ id, name, shortName: name, slug: id, squad: [] });

const match = (over: Record<string, unknown> = {}) => ({
  id: "match-1",
  slug: "home-vs-away",
  status: "scheduled",
  minute: null,
  homeScore: 0,
  awayScore: 0,
  homeTeamId: "home",
  awayTeamId: "away",
  kickoffAt: new Date(),
  isPublished: true,
  meta: null,
  highlights: [],
  events: [],
  stats: {},
  homeTeam: team("home", "Home FC"),
  awayTeam: team("away", "Away FC"),
  competition: { id: "comp-1", name: "A Cup", isPublished: true },
  statisticsSheet: sheet(),
  ...over,
});

const underway = {
  halfLength: 45,
  half: 1,
  phase: "running",
  addedFirst: null,
  addedSecond: null,
  firstHalfStartedAt: new Date(Date.now() - 15 * 60_000).toISOString(),
  secondHalfStartedAt: null,
};
const beforeKickoff = { ...underway, phase: "pre_kickoff", firstHalfStartedAt: null };

/** The shape of a `findMany` call, so the test can read the query back. */
type FindManyArgs = { where?: Record<string, unknown>; take?: number };

function serviceFor(rows: Record<string, unknown>[]) {
  const findMany = vi.fn(async (_args: FindManyArgs) => rows);
  const prisma = {
    sbMatch: { findMany, findFirst: vi.fn(async () => rows[0]) },
    sbMatchSquadPlayer: { findMany: vi.fn(async () => []) },
    sbTeamSquad: { findMany: vi.fn(async () => []) },
  };
  return {
    findMany,
    service: new ScoreboardService(prisma as never, {} as never, {} as never, {} as never),
  };
}

const liveList = async (rows: Record<string, unknown>[]) => {
  const { service } = serviceFor(rows);
  return service.listMatches({ status: "live" });
};

describe("the query the live list runs", () => {
  it("asks for recordings in progress as well as rows marked live", async () => {
    /* Without this leg the rule below never sees the match, and the list stays as broken as
       it was. The sheet's clock is JSON, so the query casts the net and the rule decides. */
    const { service, findMany } = serviceFor([match()]);
    await service.listMatches({ status: "live" });

    const where = findMany.mock.calls[0]![0]!.where!;
    const legs = where.OR as Record<string, any>[];
    expect(legs).toHaveLength(2);
    expect(legs[0]).toEqual({ status: { in: ["live", "halftime"] } });
    expect(legs[1]!.statisticsSheet.idleLockedAt).toBeNull();
    expect(legs[1]!.statisticsSheet.updatedAt.gte).toBeInstanceOf(Date);
    /* Either track short of approved leaves the sheet unapproved. */
    expect(legs[1]!.statisticsSheet.OR).toEqual([
      { status: { not: "approved" } },
      { eventsStatus: { not: "approved" } },
    ]);
  });

  it("does not limit the rows it fetches, only the live ones it returns", async () => {
    /* A database-side `take` would be a limit on candidates. Ten scheduled fixtures ahead of
       one live game would fill the window and the panel would come back empty. */
    const { service, findMany } = serviceFor([match({ statisticsSheet: sheet({ clock: underway }) })]);
    await service.listMatches({ status: "live", limit: 5 });
    expect(findMany.mock.calls[0]![0]!.take).toBeUndefined();
  });

  it("still reads the column directly for any other status", async () => {
    const { service, findMany } = serviceFor([match()]);
    await service.listMatches({ status: "finished", limit: 5 });
    const where = findMany.mock.calls[0]![0]!.where!;
    expect(where.status).toBe("finished");
    expect(where.OR).toBeUndefined();
    expect(findMany.mock.calls[0]![0]!.take).toBe(5);
  });
});

describe("what reaches the live list", () => {
  it("lists a game whose recorder has kicked off, though the row says scheduled", async () => {
    const list = await liveList([match({ statisticsSheet: sheet({ clock: underway }) })]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "live" });
  });

  it("leaves out a fixture whose recorder has not kicked off", async () => {
    expect(await liveList([match({ statisticsSheet: sheet({ clock: beforeKickoff }) })])).toEqual([]);
  });

  it("leaves out a game an admin took off the public feed", async () => {
    const off = match({
      statisticsSheet: sheet({ clock: underway }),
      stats: { liveFeature: { enabled: false } },
    });
    expect(await liveList([off])).toEqual([]);
  });

  it("leaves out a recording the idle sweep stopped", async () => {
    /* The sweep exists so an abandoned recording stops reading as a live match. A list that
       kept it would hold it for ever, since nothing is going to move that clock again. */
    const stopped = match({
      statisticsSheet: sheet({ clock: underway, idleLockedAt: new Date() }),
    });
    expect(await liveList([stopped])).toEqual([]);
  });

  it("leaves out a game whose sheet has been submitted", async () => {
    const done = match({
      statisticsSheet: sheet({ clock: underway, status: "submitted", eventsStatus: "submitted" }),
    });
    expect(await liveList([done])).toEqual([]);
  });

  it("keeps a match an admin marked live by hand, with nobody recording it", async () => {
    const byHand = match({ status: "live", statisticsSheet: null });
    const list = await liveList([byHand]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "live" });
  });

  it("drops a match an admin left marked live after its sheet was submitted", async () => {
    /* The sheet is the later word, and a finished game is not a live one. */
    const stale = match({
      status: "live",
      statisticsSheet: sheet({ clock: underway, status: "submitted", eventsStatus: "submitted" }),
    });
    expect(await liveList([stale])).toEqual([]);
  });

  it("applies the caller's limit to the live matches, not to the candidates", async () => {
    const rows = [
      match({ id: "a", statisticsSheet: sheet({ clock: beforeKickoff }) }),
      match({ id: "b", statisticsSheet: sheet({ clock: underway }) }),
      match({ id: "c", statisticsSheet: sheet({ clock: underway }) }),
    ];
    const { service } = serviceFor(rows);
    const list = await service.listMatches({ status: "live", limit: 2 });
    expect(list.map((m: { id: string }) => m.id)).toEqual(["b", "c"]);
  });
});
