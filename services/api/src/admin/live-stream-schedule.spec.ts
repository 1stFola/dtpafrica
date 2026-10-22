import { describe, expect, it, vi } from "vitest";
import {
  NO_RESULT_CEILING_MS,
  PUBLISH_LEAD_MS,
  UNPUBLISH_TAIL_MS,
  assessLiveStream,
  liveStreamWindow,
  type LiveStreamScheduleCandidate,
} from "./live-stream-schedule";
import { LiveStreamScheduleService } from "./live-stream-schedule.service";

/**
 * When a fixture's live stream goes up and comes down.
 *
 * The two mistakes pull apart: publishing late means viewers miss kickoff, unpublishing
 * late leaves a dead broadcast on the Live Games page. The tests on manual overrides
 * matter as much as the edges: a sweep that kept republishing a stream the admin took
 * down would make the Unpublish button useless for the length of a match.
 */

const KICKOFF = new Date("2026-10-19T15:00:00Z");
const MIN = 60_000;
const at = (offsetMin: number) => new Date(KICKOFF.getTime() + offsetMin * MIN);

function stream(over: Partial<LiveStreamScheduleCandidate> = {}): LiveStreamScheduleCandidate {
  return {
    isPublished: false,
    publishedAt: null,
    match: {
      status: "scheduled",
      kickoffAt: KICKOFF,
      updatedAt: at(-24 * 60),
      fullTimeAt: null,
    },
    ...over,
  };
}

function finishedAt(minutesAfterKickoff: number, over: Partial<LiveStreamScheduleCandidate> = {}) {
  return stream({
    match: {
      status: "finished",
      kickoffAt: KICKOFF,
      updatedAt: at(minutesAfterKickoff),
      fullTimeAt: at(minutesAfterKickoff),
    },
    ...over,
  });
}

describe("the constants say what was asked for", () => {
  it("is five minutes before kickoff and nothing after full time", () => {
    expect(PUBLISH_LEAD_MS).toBe(5 * MIN);
    expect(UNPUBLISH_TAIL_MS).toBe(0);
  });
});

describe("liveStreamWindow", () => {
  it("has no window without a fixture or a kickoff", () => {
    expect(liveStreamWindow(null)).toBeNull();
    expect(liveStreamWindow({ ...stream().match!, kickoffAt: null })).toBeNull();
  });

  it("opens five minutes before kickoff", () => {
    expect(liveStreamWindow(stream().match)!.opensAt).toEqual(at(-5));
  });

  it("closes at the recorded full-time whistle", () => {
    const window = liveStreamWindow(finishedAt(112).match)!;
    expect(window.closesAt).toEqual(at(112));
    expect(window.closesBy).toBe("full_time");
  });

  it("trusts the whistle over the status, which may lag behind it", () => {
    const window = liveStreamWindow({
      status: "live",
      kickoffAt: KICKOFF,
      updatedAt: at(50),
      fullTimeAt: at(100),
    })!;
    expect(window.closesAt).toEqual(at(100));
  });

  it("uses the last write to a finished match when no whistle is on record", () => {
    const window = liveStreamWindow({
      status: "finished",
      kickoffAt: KICKOFF,
      updatedAt: at(105),
      fullTimeAt: null,
    })!;
    expect(window.closesAt).toEqual(at(105));
    expect(window.closesBy).toBe("full_time");
  });

  it("caps that guess, because a correction days later also moves updatedAt", () => {
    const window = liveStreamWindow({
      status: "finished",
      kickoffAt: KICKOFF,
      updatedAt: at(3 * 24 * 60),
      fullTimeAt: null,
    })!;
    expect(window.closesAt).toEqual(new Date(at(0).getTime() + NO_RESULT_CEILING_MS));
  });

  it("closes at the ceiling for a game nobody records", () => {
    const window = liveStreamWindow(stream().match)!;
    expect(window.closesAt).toEqual(new Date(KICKOFF.getTime() + NO_RESULT_CEILING_MS));
    expect(window.closesBy).toBe("ceiling");
  });

  it("closes a postponed fixture when it was postponed", () => {
    const window = liveStreamWindow({
      status: "postponed",
      kickoffAt: KICKOFF,
      updatedAt: at(-3),
      fullTimeAt: null,
    })!;
    expect(window.closesAt).toEqual(at(-3));
  });
});

describe("assessLiveStream: publishing", () => {
  it("does nothing more than five minutes before kickoff", () => {
    expect(assessLiveStream(stream(), at(-6)).action).toBeNull();
    expect(assessLiveStream(stream(), new Date(at(-5).getTime() - 1)).action).toBeNull();
  });

  it("publishes at five minutes before kickoff", () => {
    expect(assessLiveStream(stream(), at(-5)).action).toBe("publish");
  });

  it("publishes a stream created after kickoff, while the game is on", () => {
    expect(assessLiveStream(stream(), at(30)).action).toBe("publish");
  });

  it("leaves a stream that is already up", () => {
    expect(
      assessLiveStream(stream({ isPublished: true, publishedAt: at(-60) }), at(-2)).action
    ).toBeNull();
  });

  it("does not republish a stream the admin took down during the window", () => {
    /* Auto-published at -5, unpublished by hand at +20: publishedAt is inside the window. */
    const takenDown = stream({ isPublished: false, publishedAt: at(-5) });
    expect(assessLiveStream(takenDown, at(25)).action).toBeNull();
  });

  it("publishes a stream last up for an earlier fixture or kickoff", () => {
    /* Relinked to this game, or the game was moved: the old publish predates the window. */
    const reused = stream({ isPublished: false, publishedAt: at(-7 * 24 * 60) });
    expect(assessLiveStream(reused, at(-5)).action).toBe("publish");
  });

  it("does not publish a stream whose game is already over", () => {
    expect(assessLiveStream(finishedAt(110), at(130)).action).toBeNull();
  });

  it("does not publish for a fixture postponed before the window opened", () => {
    const postponed = stream({
      match: { status: "postponed", kickoffAt: KICKOFF, updatedAt: at(-120), fullTimeAt: null },
    });
    expect(assessLiveStream(postponed, at(-5)).action).toBeNull();
  });

  it("does nothing for a stream with no fixture", () => {
    expect(assessLiveStream(stream({ match: null }), at(0))).toEqual({
      action: null,
      window: null,
    });
  });
});

describe("assessLiveStream: unpublishing", () => {
  const up = { isPublished: true, publishedAt: at(-5) };

  it("keeps the stream up until full time", () => {
    expect(assessLiveStream(finishedAt(110, up), at(109)).action).toBeNull();
    expect(
      assessLiveStream(finishedAt(110, up), new Date(at(110).getTime() - 1)).action
    ).toBeNull();
  });

  it("unpublishes the moment full time is blown", () => {
    expect(assessLiveStream(finishedAt(110, up), at(110)).action).toBe("unpublish");
  });

  it("unpublishes a stream the admin put up by hand before the game", () => {
    const manual = finishedAt(110, { isPublished: true, publishedAt: at(-90) });
    expect(assessLiveStream(manual, at(111)).action).toBe("unpublish");
  });

  it("leaves a stream the admin republished after the game, such as a replay", () => {
    const replay = finishedAt(110, { isPublished: true, publishedAt: at(150) });
    expect(assessLiveStream(replay, at(200)).action).toBeNull();
  });

  it("does nothing to a stream already down", () => {
    const down = finishedAt(110, { isPublished: false, publishedAt: at(-5) });
    expect(assessLiveStream(down, at(125)).action).toBeNull();
  });

  it("unpublishes an unrecorded game at the ceiling", () => {
    const unrecorded = stream(up);
    const ceiling = new Date(KICKOFF.getTime() + NO_RESULT_CEILING_MS);
    expect(assessLiveStream(unrecorded, new Date(ceiling.getTime() - 1)).action).toBeNull();
    expect(assessLiveStream(unrecorded, ceiling).action).toBe("unpublish");
  });

  it("unpublishes a stream that went up before the game was postponed", () => {
    const postponed = stream({
      ...up,
      match: { status: "postponed", kickoffAt: KICKOFF, updatedAt: at(-3), fullTimeAt: null },
    });
    expect(assessLiveStream(postponed, at(-2)).action).toBe("unpublish");
  });
});

describe("assessLiveStream over a whole match", () => {
  it("publishes once and unpublishes once", () => {
    let row = stream();
    const actions: string[] = [];
    /* A sweep every minute from an hour before kickoff to three hours after; the
       recorder blows full time at +108 and the match is marked finished then. */
    for (let m = -60; m <= 180; m++) {
      const now = at(m);
      if (m === 108) {
        row = {
          ...row,
          match: { status: "finished", kickoffAt: KICKOFF, updatedAt: now, fullTimeAt: now },
        };
      }
      const { action } = assessLiveStream(row, now);
      if (action === "publish") row = { ...row, isPublished: true, publishedAt: now };
      if (action === "unpublish") row = { ...row, isPublished: false };
      if (action) actions.push(`${action}@${m}`);
    }
    expect(actions).toEqual(["publish@-5", "unpublish@108"]);
  });
});

describe("LiveStreamScheduleService.sweep", () => {
  function fakePrisma(rows: Array<Record<string, unknown>>) {
    const updateMany = vi.fn(async ({ where }: { where: { id: string; isPublished: boolean } }) => {
      const row = rows.find((r) => r.id === where.id);
      return { count: row && row.isPublished === where.isPublished ? 1 : 0 };
    });
    return {
      prisma: {
        sbLiveStream: { findMany: vi.fn(async () => rows), updateMany },
      },
      updateMany,
    };
  }

  const matchRow = (over: Record<string, unknown> = {}) => ({
    status: "scheduled",
    kickoffAt: KICKOFF,
    updatedAt: at(-24 * 60),
    statisticsSheet: null,
    ...over,
  });

  it("publishes and unpublishes what is due, guarded on the state it read", async () => {
    const { prisma, updateMany } = fakePrisma([
      { id: "due", title: "A", isPublished: false, publishedAt: null, match: matchRow() },
      {
        id: "over",
        title: "B",
        isPublished: true,
        publishedAt: at(-200),
        match: matchRow({ status: "finished", statisticsSheet: { fullTimeAt: at(-90) } }),
      },
      { id: "early", title: "C", isPublished: false, publishedAt: null, match: matchRow({ kickoffAt: at(60) }) },
    ]);
    const service = new LiveStreamScheduleService(prisma as never);
    const result = await service.sweep(at(-5));

    expect(result).toEqual({ published: ["due"], unpublished: ["over"] });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "due", isPublished: false },
      data: { isPublished: true, publishedAt: at(-5) },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "over", isPublished: true },
      data: { isPublished: false },
    });
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it("does not report a write the guard refused", async () => {
    const { prisma } = fakePrisma([
      { id: "due", title: "A", isPublished: false, publishedAt: null, match: matchRow() },
    ]);
    prisma.sbLiveStream.updateMany.mockResolvedValueOnce({ count: 0 });
    const service = new LiveStreamScheduleService(prisma as never);
    expect(await service.sweep(at(-5))).toEqual({ published: [], unpublished: [] });
  });

  it("never throws", async () => {
    const prisma = {
      sbLiveStream: { findMany: vi.fn(async () => Promise.reject(new Error("db down"))) },
    };
    const service = new LiveStreamScheduleService(prisma as never);
    await expect(service.sweep(at(0))).resolves.toEqual({ published: [], unpublished: [] });
  });
});
