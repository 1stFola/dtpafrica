import { describe, expect, it, vi } from "vitest";
import { pickRecordedVideo, type RecordedVideoCandidate } from "./recorded-video";
import { ScoreboardService } from "./scoreboard.service";

/**
 * Which broadcast the match centre offers as "Watch Recorded Video".
 *
 * The two mistakes: a button during the game that sends a viewer to a broadcast the Live
 * Games page is already playing, and a button before kickoff that leads to nothing.
 */

const KICKOFF = new Date("2026-10-19T15:00:00Z");
const at = (offsetMin: number) => new Date(KICKOFF.getTime() + offsetMin * 60_000);

function stream(over: Partial<RecordedVideoCandidate> = {}): RecordedVideoCandidate {
  return {
    id: "stream-1",
    title: "Home v Away live",
    youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    isPublished: false,
    publishedAt: at(-5),
    createdAt: at(-60 * 24),
    ...over,
  };
}

describe("pickRecordedVideo", () => {
  it("offers the stream once the schedule has taken it down", () => {
    expect(pickRecordedVideo([stream()], "finished")).toEqual({
      id: "stream-1",
      title: "Home v Away live",
      youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      thumbnailUrl: expect.stringContaining("abcdefghijk"),
    });
  });

  it("offers nothing while the stream is still up on the Live Games page", () => {
    expect(pickRecordedVideo([stream({ isPublished: true })], "live")).toBeNull();
    expect(pickRecordedVideo([stream({ isPublished: true })], "finished")).toBeNull();
  });

  it("offers nothing for a stream added ahead of a game that has not been played", () => {
    expect(pickRecordedVideo([stream({ publishedAt: null })], "scheduled")).toBeNull();
  });

  it("offers a link pasted after the game, though it never went up", () => {
    expect(pickRecordedVideo([stream({ publishedAt: null })], "finished")?.id).toBe("stream-1");
  });

  it("offers a stream the admin took down by hand", () => {
    expect(pickRecordedVideo([stream({ publishedAt: at(-5) })], "live")?.id).toBe("stream-1");
  });

  it("prefers the stream that went up last, then the newest", () => {
    const streams = [
      stream({ id: "first", publishedAt: at(-5) }),
      stream({ id: "restart", publishedAt: at(30) }),
      stream({ id: "never", publishedAt: null, createdAt: at(200) }),
    ];
    expect(pickRecordedVideo(streams, "finished")?.id).toBe("restart");
    expect(
      pickRecordedVideo(
        [
          stream({ id: "old", publishedAt: null, createdAt: at(100) }),
          stream({ id: "new", publishedAt: null, createdAt: at(200) }),
        ],
        "finished"
      )?.id
    ).toBe("new");
  });

  it("skips a stream with no link", () => {
    expect(pickRecordedVideo([stream({ youtubeUrl: "  " })], "finished")).toBeNull();
  });

  it("offers nothing when the fixture has no stream", () => {
    expect(pickRecordedVideo([], "finished")).toBeNull();
  });
});

describe("matchById carries the recorded video", () => {
  const team = (id: string) => ({ id, name: id, shortName: id, slug: id, squad: [] });
  const row = (liveStreams: unknown) => ({
    id: "match-1",
    slug: "home-vs-away",
    status: "finished",
    minute: null,
    homeScore: 1,
    awayScore: 0,
    homeTeamId: "home",
    awayTeamId: "away",
    kickoffAt: KICKOFF,
    isPublished: true,
    formationHome: null,
    formationAway: null,
    meta: null,
    highlights: [],
    events: [],
    stats: {},
    homeTeam: team("home"),
    awayTeam: team("away"),
    competition: { id: "comp-1", name: "A Cup", isPublished: true, formatType: "LEAGUE" },
    statisticsSheet: null,
    liveStreams,
  });

  function serviceFor(match: Record<string, unknown>) {
    const findFirst = vi.fn(async (_args: unknown) => match);
    const prisma = { sbMatch: { findFirst } };
    return {
      service: new ScoreboardService(prisma as never, {} as never, {} as never, {} as never),
      findFirst,
    };
  }

  it("reads the fixture's streams and returns the recording, not the stream list", async () => {
    const { service, findFirst } = serviceFor(row([stream()]));
    const detail = (await service.matchById("match-1")) as Record<string, unknown>;

    expect(findFirst.mock.calls[0][0]).toMatchObject({
      include: { liveStreams: { select: { isPublished: true, publishedAt: true } } },
    });
    expect(detail.recordedVideo).toMatchObject({
      id: "stream-1",
      youtubeUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    });
    expect(detail).not.toHaveProperty("liveStreams");
  });

  it("returns null while the broadcast is still live", async () => {
    const { service } = serviceFor(row([stream({ isPublished: true })]));
    const detail = (await service.matchById("match-1")) as Record<string, unknown>;
    expect(detail.recordedVideo).toBeNull();
  });
});
