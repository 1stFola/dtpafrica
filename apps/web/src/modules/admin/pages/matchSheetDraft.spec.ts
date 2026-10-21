import { beforeEach, describe, expect, it } from "vitest";
import type { MatchStatsSheet, RecordedEvent } from "../../../api/adminMatchStats";
import {
  eventsNotOnServer,
  markSynced,
  pruneStoredSheets,
  readDraft,
  readServerCopy,
  removedSince,
  writeDraft,
  writeServerCopy,
} from "./matchSheetDraft";

/**
 * The recorder's copy on the phone, which is what survives a dead spot.
 *
 * The rule every test here protects: something recorded on this phone and not yet on the
 * server is never thrown away -- not to make room, not on sync, not by a deletion that was
 * never sent.
 */

/** localStorage as a browser has it, with a quota that can be filled. */
class MemoryStorage {
  private items = new Map<string, string>();
  quotaChars = Number.POSITIVE_INFINITY;
  get length() {
    return this.items.size;
  }
  key(i: number) {
    return [...this.items.keys()][i] ?? null;
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    const used = [...this.items].reduce((n, [k, v]) => (k === key ? n : n + v.length), 0);
    if (used + value.length > this.quotaChars) throw new Error("QuotaExceededError");
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as { localStorage?: unknown }).localStorage = storage;
});

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
const draftOf = (events: RecordedEvent[], synced: boolean) => ({
  tallies: {},
  events,
  removedEventIds: [],
  clock: null,
  kits: { home: "#000000", away: "#ffffff" },
  synced,
});

describe("deletions are sent by id", () => {
  it("adds what disappeared to what was already waiting", () => {
    expect(removedSince([event("a"), event("b")], [event("a")], ["x"])).toEqual(["x", "b"]);
  });

  it("forgets a deletion when the event comes back", () => {
    expect(removedSince([event("a")], [event("a"), event("b")], ["b"])).toEqual([]);
  });

  it("names nothing when nothing was deleted", () => {
    expect(removedSince([event("a")], [event("a"), event("b")], [])).toEqual([]);
  });
});

describe("what has not reached the server", () => {
  it("counts the phone's events the server's copy lacks", () => {
    expect(eventsNotOnServer([event("a"), event("b"), event("c")], [event("a")])).toBe(2);
    expect(eventsNotOnServer([event("a")], [event("a"), event("z")])).toBe(0);
  });
});

describe("syncing", () => {
  it("takes the server's merged log and clears the sent deletions", () => {
    writeDraft("m1", { ...draftOf([event("a")], false), removedEventIds: ["gone"] });
    markSynced("m1", [event("a"), event("from-phone-2")]);
    const draft = readDraft("m1")!;
    expect(draft.synced).toBe(true);
    expect(draft.removedEventIds).toEqual([]);
    expect(draft.events.map((e) => e.id)).toEqual(["a", "from-phone-2"]);
  });

  it("reads a draft written before deletions were tracked", () => {
    storage.setItem("dtp_match_sheet_old", JSON.stringify({ tallies: {}, events: [], synced: false }));
    expect(readDraft("old")!.removedEventIds).toEqual([]);
  });
});

describe("the server's copy, for opening with no signal", () => {
  it("round-trips", () => {
    const sheet = { matchId: "m1", status: "live" } as unknown as MatchStatsSheet;
    writeServerCopy("m1", sheet);
    expect(readServerCopy("m1")).toEqual(sheet);
    expect(readServerCopy("m2")).toBeNull();
  });
});

describe("making room never costs an unsent tap", () => {
  it("clears other matches' synced drafts and old copies, and keeps their unsent drafts", () => {
    writeDraft("synced-match", draftOf([event("a")], true));
    writeDraft("unsent-match", draftOf([event("only-here")], false));
    writeDraft("current", draftOf([event("now")], true));
    writeServerCopy("other", { matchId: "other" } as unknown as MatchStatsSheet);
    writeServerCopy("current", { matchId: "current" } as unknown as MatchStatsSheet);

    pruneStoredSheets("current", 0);

    expect(readDraft("synced-match")).toBeNull();
    expect(readDraft("unsent-match")!.events[0].id).toBe("only-here");
    expect(readDraft("current")).not.toBeNull();
    expect(readServerCopy("other")).toBeNull();
    expect(readServerCopy("current")).not.toBeNull();
  });

  it("keeps a recent copy of another match unless room is needed", () => {
    writeServerCopy("yesterday", { matchId: "yesterday" } as unknown as MatchStatsSheet);
    pruneStoredSheets("current");
    expect(readServerCopy("yesterday")).not.toBeNull();
  });

  it("makes room and writes when the store is full of old matches", () => {
    for (let i = 0; i < 5; i += 1) writeDraft(`old-${i}`, draftOf([event(`e${i}`)], true));
    storage.quotaChars = 5 * JSON.stringify({ ...draftOf([event("e0")], true), updatedAt: 0 }).length + 10;
    expect(writeDraft("current", draftOf([event("now")], false))).toBe(true);
    expect(readDraft("current")!.events[0].id).toBe("now");
  });

  it("says so when even that is not enough, rather than pretending it saved", () => {
    writeDraft("unsent", draftOf([event("only-here")], false));
    storage.quotaChars = storage.getItem("dtp_match_sheet_unsent")!.length + 5;
    expect(writeDraft("current", draftOf([event("now")], false))).toBe(false);
    expect(readDraft("unsent")!.events[0].id).toBe("only-here");
  });
});
