/**
 * What a sheet reaching full time actually writes to its match.
 *
 * `final-score-sync.spec.ts` covers the rule; this covers the call around it, which is where
 * the consequences are: which columns move, whether the standings are told, and whether a
 * held score is still a finished match.
 *
 * It matters now because public live approval defaults on. The sync sits behind that switch,
 * so on live it has never run for these matches — the next save is the first time.
 */
import { describe, expect, it, vi } from "vitest";
import { AdminMatchStatsService } from "./admin-match-stats.service";

const fullTime = {
  halfLength: 45,
  half: 2,
  phase: "finished",
  addedFirst: null,
  addedSecond: null,
  firstHalfStartedAt: new Date(Date.now() - 100 * 60_000).toISOString(),
  secondHalfStartedAt: new Date(Date.now() - 50 * 60_000).toISOString(),
};

/** Three goals for the home side, as the sheet holds them. */
const threeOne = [
  { id: "a", type: "goal", minute: 5, side: "home", playerNumber: 9, half: 1 },
  { id: "b", type: "goal", minute: 30, side: "home", playerNumber: 9, half: 1 },
  { id: "c", type: "goal", minute: 70, side: "home", playerNumber: 7, half: 2 },
  { id: "d", type: "goal", minute: 80, side: "away", playerNumber: 11, half: 2 },
];

function harness(args: { published: [number, number]; timelineFromElsewhere: number }) {
  type UpdateArgs = { where: { id: string }; data: Record<string, unknown> };
  const update = vi.fn(async (_args: UpdateArgs) => ({}));
  const prisma = {
    sbMatch: { update },
    sbMatchEvent: {
      count: vi.fn(async (q: { where: Record<string, unknown> }) =>
        /* The scoped count is the one carrying the metadata filter. */
        "metadata" in q.where ? 2 : 2 + args.timelineFromElsewhere
      ),
    },
  };
  const lifecycle = {
    onMatchFinished: vi.fn(async () => {}),
    refreshStandingsForFinishedMatch: vi.fn(async () => {}),
  };
  const service = new AdminMatchStatsService(prisma as never, lifecycle as never, {} as never);
  const match = {
    id: "match-1",
    status: "scheduled",
    minute: null,
    homeScore: args.published[0],
    awayScore: args.published[1],
    stats: {},
    competition: { formatConfig: null },
  };
  const run = (sheet: { events: unknown; clock: unknown }) =>
    (
      service as unknown as {
        syncFinalScoreFromSheet: (m: unknown, s: unknown) => Promise<void>;
      }
    ).syncFinalScoreFromSheet(match, sheet);
  return { run, update, lifecycle, match };
}

describe("a sheet reaching full time", () => {
  it("publishes its score and tells the standings", async () => {
    const { run, update, lifecycle } = harness({ published: [0, 0], timelineFromElsewhere: 0 });
    await run({ events: threeOne, clock: fullTime });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0]!).toMatchObject({
      where: { id: "match-1" },
      data: { homeScore: 3, awayScore: 1, status: "finished", minute: 90 },
    });
    expect(lifecycle.onMatchFinished).toHaveBeenCalledWith("match-1");
  });

  it("writes nothing before full time", async () => {
    const { run, update, lifecycle } = harness({ published: [0, 0], timelineFromElsewhere: 0 });
    await run({ events: threeOne, clock: { ...fullTime, phase: "running" } });
    expect(update).not.toHaveBeenCalled();
    expect(lifecycle.onMatchFinished).not.toHaveBeenCalled();
  });
});

describe("a sheet that disagrees with a timeline it does not own", () => {
  it("marks the match finished and leaves the published score alone", async () => {
    /* The three live matches this exists for: a timeline entered through the match-event
       editor, and a sheet that would take a goal off the published scoreline. */
    const { run, update, lifecycle } = harness({ published: [4, 1], timelineFromElsewhere: 6 });
    await run({ events: threeOne, clock: fullTime });

    expect(update).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0]![0]!.data;
    expect(data).toEqual({ status: "finished", minute: 90 });
    expect(data.homeScore).toBeUndefined();
    expect(data.awayScore).toBeUndefined();
    /* Finished for the first time, so the standings still need the match. They take the
       score from the row, which is the published one. */
    expect(lifecycle.onMatchFinished).toHaveBeenCalledWith("match-1");
  });

  it("touches nothing at all when the match was already finished", async () => {
    const { run, update, lifecycle, match } = harness({
      published: [4, 1],
      timelineFromElsewhere: 6,
    });
    match.status = "finished";
    await run({ events: threeOne, clock: fullTime });

    expect(update).not.toHaveBeenCalled();
    expect(lifecycle.onMatchFinished).not.toHaveBeenCalled();
    expect(lifecycle.refreshStandingsForFinishedMatch).not.toHaveBeenCalled();
  });

  it("follows the sheet when the whole timeline came from this console", async () => {
    const { run, update } = harness({ published: [4, 1], timelineFromElsewhere: 0 });
    await run({ events: threeOne, clock: fullTime });
    expect(update.mock.calls[0]![0]!.data).toMatchObject({ homeScore: 3, awayScore: 1 });
  });
});

describe("a training sandbox", () => {
  it("is left alone, score and status both", async () => {
    const { run, update, match } = harness({ published: [0, 0], timelineFromElsewhere: 0 });
    match.competition = { formatConfig: { isTraining: true } } as never;
    await run({ events: threeOne, clock: fullTime });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("a match taken off the public feed", () => {
  it("keeps its score out of the sync", async () => {
    /* Unchanged: the switch gates this as it always did. What changed is its default. */
    const { run, update, match } = harness({ published: [0, 0], timelineFromElsewhere: 0 });
    match.stats = { liveFeature: { enabled: false } } as never;
    await run({ events: threeOne, clock: fullTime });
    expect(update).not.toHaveBeenCalled();
  });
});
