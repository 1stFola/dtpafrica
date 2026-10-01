/**
 * The whole public path, from a sheet in the database to what a visitor is told.
 *
 * `public-live-state.spec.ts` covers the rule; this covers the wiring, which is where the
 * bug actually lived. The complaint was that approving a fixture for the public feed made
 * it read as live immediately — the card said LIVE, the match centre opened a live feed,
 * and the game had not kicked off. Three separate reads of the sheet decided that, and a
 * rule fixed in one of them is a rule fixed nowhere.
 */
import { describe, expect, it, vi } from "vitest";
import { ScoreboardService } from "./scoreboard.service";

const MATCH_ID = "match-1";

const sheet = (over: Record<string, unknown> = {}) => ({
  id: "sheet-1",
  status: "live",
  eventsStatus: "live",
  tallies: {},
  events: [],
  clock: null as unknown,
  kits: null,
  recorderName: "A Recorder",
  updatedAt: new Date("2026-09-30T14:00:00.000Z"),
  idleLockedAt: null,
  ...over,
});

const team = (id: string, name: string) => ({ id, name, shortName: name, slug: id, squad: [] });

const match = (over: Record<string, unknown> = {}) => ({
  id: MATCH_ID,
  slug: "home-vs-away",
  status: "scheduled",
  minute: null,
  homeScore: 0,
  awayScore: 0,
  homeTeamId: "home",
  awayTeamId: "away",
  kickoffAt: new Date("2026-09-30T15:00:00.000Z"),
  isPublished: true,
  formationHome: null,
  formationAway: null,
  meta: null,
  highlights: [],
  events: [],
  stats: {},
  homeTeam: team("home", "Home FC"),
  awayTeam: team("away", "Away FC"),
  competition: { id: "comp-1", name: "A Cup", isPublished: true, formatType: "LEAGUE" },
  statisticsSheet: sheet(),
  ...over,
});

/** The service with nothing behind it but the one match under test. */
function serviceFor(row: Record<string, unknown>) {
  const prisma = {
    sbMatch: {
      findFirst: vi.fn(async () => row),
      findMany: vi.fn(async () => [row]),
    },
    sbMatchSquadPlayer: { findMany: vi.fn(async () => []) },
    sbTeamSquad: { findMany: vi.fn(async () => []) },
  };
  return new ScoreboardService(prisma as never, {} as never, {} as never, {} as never);
}

/**
 * The clock a sheet carries before Kick off.
 *
 * The console writes this the first time the recorder saves anything, so `no clock` is not
 * what a real pre-kickoff sheet looks like -- it looks like this. A gate that only tested
 * for a missing clock would pass every one of these straight through.
 */
const beforeKickoff = {
  halfLength: 45,
  half: 1,
  phase: "pre_kickoff",
  addedFirst: null,
  addedSecond: null,
  firstHalfStartedAt: null,
  secondHalfStartedAt: null,
};

/** A sheet mid-first-half, as the console writes it once Kick off is pressed. */
const kickedOff = {
  halfLength: 45,
  half: 1,
  phase: "running",
  addedFirst: null,
  addedSecond: null,
  firstHalfStartedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  secondHalfStartedAt: null,
};

/** Two goals on the sheet that the row has never been told about. */
const twoGoals = [
  { id: "ev-1", type: "goal", minute: 5, side: "home", playerNumber: 9, half: 1 },
  { id: "ev-2", type: "goal", minute: 22, side: "home", playerNumber: 7, half: 1 },
];

describe("a fixture approved for the public feed, before kickoff", () => {
  it("opens no live feed", async () => {
    const detail = await serviceFor(match()).matchById(MATCH_ID);
    expect(detail.liveSheet).toBeNull();
  });

  it("opens no live feed with the clock the console writes before the whistle", async () => {
    /* Not a missing clock -- a clock sitting at `pre_kickoff`, which is what a sheet
       actually holds once the recorder has opened it. */
    const detail = await serviceFor(
      match({ statisticsSheet: sheet({ clock: beforeKickoff, events: twoGoals }) })
    ).matchById(MATCH_ID);
    expect(detail.liveSheet).toBeNull();
  });

  it("does not read as live on the card with that same clock", async () => {
    const [card] = await serviceFor(
      match({ statisticsSheet: sheet({ clock: beforeKickoff, events: twoGoals }) })
    ).listMatches({});
    expect(card).toMatchObject({ status: "scheduled", homeScore: 0, awayScore: 0 });
  });

  it("opens no live feed even once the recorder has filed events", async () => {
    /* The old rule let a single event stand in for kickoff, so a recorder noting anything
       before the whistle published a game in progress. */
    const detail = await serviceFor(
      match({ statisticsSheet: sheet({ events: twoGoals }) })
    ).matchById(MATCH_ID);
    expect(detail.liveSheet).toBeNull();
  });

  it("publishes the fixture's own score, not the sheet's", async () => {
    const [card] = await serviceFor(
      match({ statisticsSheet: sheet({ events: twoGoals }) })
    ).listMatches({});
    expect(card).toMatchObject({ status: "scheduled", homeScore: 0, awayScore: 0 });
  });

  it("does not read as live on the card", async () => {
    const [card] = await serviceFor(
      match({ statisticsSheet: sheet({ events: twoGoals }) })
    ).listMatches({});
    expect(card.status).not.toBe("live");
  });
});

describe("the same fixture once the recorder has kicked off", () => {
  it("opens the live feed", async () => {
    const detail = await serviceFor(
      match({ statisticsSheet: sheet({ clock: kickedOff, events: twoGoals }) })
    ).matchById(MATCH_ID);
    expect(detail.liveSheet).not.toBeNull();
    expect(detail.liveSheet?.score).toEqual({ home: 2, away: 0 });
  });

  it("reads as live on the card, with the sheet's score", async () => {
    const [card] = await serviceFor(
      match({ statisticsSheet: sheet({ clock: kickedOff, events: twoGoals }) })
    ).listMatches({});
    expect(card).toMatchObject({ status: "live", homeScore: 2, awayScore: 0 });
    expect(card.minute).toBeGreaterThan(0);
  });
});

describe("the admin's switch, once the game is under way", () => {
  const underway = match({ statisticsSheet: sheet({ clock: kickedOff, events: twoGoals }) });

  it("shows the feed for a match nobody has switched", async () => {
    /* Approved by default: a fixture with no `liveFeature` on it is on the feed. */
    const detail = await serviceFor(underway).matchById(MATCH_ID);
    expect(detail.liveSheet).not.toBeNull();
  });

  it("closes the feed for a match an admin switched off", async () => {
    const off = { ...underway, stats: { liveFeature: { enabled: false } } };
    const detail = await serviceFor(off).matchById(MATCH_ID);
    expect(detail.liveSheet).toBeNull();
    const [card] = await serviceFor(off).listMatches({});
    expect(card).toMatchObject({ status: "scheduled", homeScore: 0, awayScore: 0 });
  });
});
