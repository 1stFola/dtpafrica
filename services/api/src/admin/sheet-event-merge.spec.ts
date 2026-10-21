import { describe, expect, it, vi } from "vitest";
import { AdminMatchStatsService, type RecordedEvent } from "./admin-match-stats.service";
import { mergeRecordedEvents } from "./sheet-event-merge";

/**
 * A save no longer replaces the event log; it merges into it by id.
 *
 * The loss this guards against: a recorder's phone drops out, they carry on from a second
 * phone, and whichever phone saves last wipes the events only the other one had -- or a
 * console that opened before an event reached the server wipes it on its next save.
 */

const event = (id: string, over: Partial<RecordedEvent> = {}): RecordedEvent => ({
  id,
  type: "foul",
  minute: 10,
  addedMinute: null,
  side: "home",
  playerNumber: 4,
  secondaryPlayerNumber: null,
  half: 1,
  ...over,
});
const ids = (events: RecordedEvent[]) => events.map((e) => e.id);

describe("mergeRecordedEvents", () => {
  it("keeps an event the server holds that the save did not carry", () => {
    const stored = [event("a", { minute: 5 }), event("phone-2", { minute: 20 })];
    const incoming = [event("a", { minute: 5 }), event("b", { minute: 30 })];
    const merged = mergeRecordedEvents(stored, incoming);
    expect(ids(merged.events)).toEqual(["a", "phone-2", "b"]);
    expect(ids(merged.kept)).toEqual(["phone-2"]);
  });

  it("removes an event only when the save names it", () => {
    const stored = [event("a"), event("b", { minute: 12 })];
    const merged = mergeRecordedEvents(stored, [event("a")], ["b"]);
    expect(ids(merged.events)).toEqual(["a"]);
    expect(merged.kept).toEqual([]);
  });

  it("takes the save's version of an event it carries, so an edit lands", () => {
    const stored = [event("a", { playerNumber: 4 })];
    const merged = mergeRecordedEvents(stored, [event("a", { playerNumber: 9 })]);
    expect(merged.events).toEqual([event("a", { playerNumber: 9 })]);
  });

  it("keeps the save's order, and puts a kept event where it happened, before full time", () => {
    const stored = [event("other", { minute: 70, half: 2 })];
    const incoming = [
      event("ko", { type: "kick_off", minute: 0 }),
      event("x", { minute: 40 }),
      event("y", { minute: 80, half: 2 }),
      event("ft", { type: "full_time", minute: 90, addedMinute: 3, half: 2 }),
    ];
    expect(ids(mergeRecordedEvents(stored, incoming).events)).toEqual(["ko", "x", "other", "y", "ft"]);
  });

  it("does not double kick-off or full time that two phones each filed", () => {
    const stored = [event("ko-1", { type: "kick_off", minute: 0 }), event("ft-1", { type: "full_time", minute: 90, half: 2 })];
    const incoming = [event("ko-2", { type: "kick_off", minute: 0 }), event("ft-2", { type: "full_time", minute: 90, half: 2 })];
    expect(ids(mergeRecordedEvents(stored, incoming).events)).toEqual(["ko-2", "ft-2"]);
  });

  it("is the old behaviour when the console has seen everything", () => {
    const log = [event("a"), event("b", { minute: 20 })];
    expect(mergeRecordedEvents(log, log)).toEqual({ events: log, kept: [] });
  });
});

describe("saveTallies merges instead of replacing", () => {
  const ctx = { method: "jwt", userId: "recorder-a", permissions: ["scoreboard.stats.record"] };
  const running = { halfLength: 45, half: 1, phase: "running", firstHalfStartedAt: "2026-10-21T12:00:00Z" };

  function setup(stored: RecordedEvent[]) {
    const sheet = {
      matchId: "match",
      recorderId: "recorder-a",
      status: "live",
      eventsStatus: "live",
      clock: running,
      events: stored,
      updatedAt: new Date(),
    };
    const store = {
      findUnique: vi.fn().mockResolvedValue(sheet),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const service: any = Object.create(AdminMatchStatsService.prototype);
    service.prisma = { sbMatchStatistics: store };
    service.logger = { warn: vi.fn() };
    service.loadMatch = vi.fn().mockResolvedValue({ competition: {} });
    service.present = vi.fn((_match, row) => row);
    service.syncFinalScoreFromSheet = vi.fn();
    return { service, store };
  }

  it("keeps what another phone filed when an older phone saves", async () => {
    const { service, store } = setup([event("a"), event("from-phone-2", { minute: 30 })]);
    await service.saveTallies("match", {}, ctx, { events: [event("a"), event("offline", { minute: 20 })] });
    const data = store.updateMany.mock.calls[0][0].data;
    expect(ids(data.events)).toEqual(["a", "offline", "from-phone-2"]);
    expect(data.lastEventAt).toBeInstanceOf(Date);
    expect(service.logger.warn).toHaveBeenCalledTimes(1);
  });

  it("deletes what the recorder deleted", async () => {
    const { service, store } = setup([event("a"), event("mis-tap", { minute: 30 })]);
    await service.saveTallies("match", {}, ctx, { events: [event("a")], removedEventIds: ["mis-tap"] });
    expect(ids(store.updateMany.mock.calls[0][0].data.events)).toEqual(["a"]);
  });

  it("does not count a save that grew nothing as somebody filing an event", async () => {
    const { service, store } = setup([event("a")]);
    await service.saveTallies("match", {}, ctx, { events: [event("a")] });
    expect(store.updateMany.mock.calls[0][0].data.lastEventAt).toBeUndefined();
  });
});
