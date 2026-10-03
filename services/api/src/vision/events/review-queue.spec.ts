import { describe, expect, it } from "vitest";
import { buildQueue, type QueueEventRow, type QueueIdentityRow } from "./review-queue";

const at = (iso: string) => new Date(iso);
const event = (over: Partial<QueueEventRow>): QueueEventRow => ({ id: "e", videoAssetId: "asset", type: "shot", startMs: 12_000, endMs: 12_000, actorTrackId: null, decidedBy: "alice", createdAt: at("2026-10-03T10:00:00Z"), ...over });
const identity = (over: Partial<QueueIdentityRow>): QueueIdentityRow => ({ id: "i", trackId: "t", videoAssetId: "asset", localTrackId: 4, matchSquadPlayerId: "slot", validFromMs: 5000, validToMs: 9000, decidedBy: "alice", createdAt: at("2026-10-03T09:00:00Z"), ...over });

describe("the review queue", () => {
  it("merges both kinds, leaves out the reader's own, and puts the longest-waiting first", () => {
    const q = buildQueue(
      "bob",
      [event({ id: "e-old", createdAt: at("2026-10-03T08:00:00Z") }), event({ id: "e-mine", decidedBy: "bob" }), event({ id: "e-new" })],
      [identity({ id: "i-mid" }), identity({ id: "i-mine", decidedBy: "bob" })],
      10
    );
    expect(q.items.map((i) => `${i.kind}:${i.id}`)).toEqual(["event:e-old", "identity:i-mid", "event:e-new"]);
    expect(q.waiting).toEqual({ events: 2, identities: 1 });
  });

  it("places each item at the start of its window in source time", () => {
    const q = buildQueue("bob", [event({ startMs: 12_000, endMs: 15_000 })], [identity({ validFromMs: 5000 })], 10);
    expect(q.items.find((i) => i.kind === "event")?.sourceMs).toBe(12_000);
    expect(q.items.find((i) => i.kind === "identity")?.sourceMs).toBe(5000);
  });

  it("cuts to the limit but counts what is waiting before the cut", () => {
    const events = [1, 2, 3].map((n) => event({ id: `e${n}`, createdAt: at(`2026-10-03T0${n}:00:00Z`) }));
    const q = buildQueue("bob", events, [identity({})], 2);
    expect(q.items.map((i) => i.id)).toEqual(["e1", "e2"]);
    expect(q.waiting).toEqual({ events: 3, identities: 1 });
    expect(buildQueue("bob", events, [], 0).items).toEqual([]);
  });

  it("orders two rows made at the same instant by kind then id, so the order is stable", () => {
    const same = at("2026-10-03T10:00:00Z");
    const q = buildQueue("bob", [event({ id: "b", createdAt: same }), event({ id: "a", createdAt: same })], [identity({ id: "z", createdAt: same })], 10);
    expect(q.items.map((i) => `${i.kind}:${i.id}`)).toEqual(["event:a", "event:b", "identity:z"]);
  });
});
