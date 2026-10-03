import { beforeEach, describe, expect, it, vi } from "vitest";
import { reapplyEnrichment } from "./reapply-enrichment";

/**
 * The recorder's sheet was sent back and approved again: the rows it published
 * were deleted and written fresh. A candidate that had enriched one of them is
 * put back on the row that is the same event, by the rule that promoted it, or
 * left stale.
 */

const MATCH = "22222222-2222-4222-8222-222222222222";
const ASSET = "11111111-1111-4111-8111-111111111111";
const KICKOFF = 9000;
const PROMOTED = new Date("2026-10-03T12:00:00Z");

const db = {
  sbMatch: { findUnique: vi.fn() },
  sbMatchEvent: { findMany: vi.fn(), update: vi.fn() },
  visionEventCandidate: { findMany: vi.fn(), updateMany: vi.fn() },
  visionClockAnchor: { findMany: vi.fn() },
  $transaction: vi.fn(),
};

/** Accepted and promoted 47:12 into the first half -- the recorder's 45+2 -- and waiting on its event. */
const waiting = (over: Record<string, unknown> = {}) => ({
  id: "cand-1", videoAssetId: ASSET, sbMatchId: MATCH, type: "goal_candidate", taxonomyVersion: "2026.10.0",
  startMs: KICKOFF + 47 * 60_000 + 12_000, endMs: KICKOFF + 47 * 60_000 + 12_000, actorTrackId: "track-1", actorPlayerId: null, sbTeamId: "home",
  reviewState: "accepted", promotionKind: "enriched", promotedAt: PROMOTED, promotedEventId: null, acceptedAnchorId: "anchor-1", supersededBy: null,
  ...over,
});
const row = (over: Record<string, unknown> = {}) => ({ id: "new-1", type: "goal", minute: 45, teamId: "home", playerId: null, secondInMinute: null, metadata: { source: "match_recorder", half: 1, addedMinute: 2, recorderSequence: 4 }, visionCandidate: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  db.visionEventCandidate.findMany.mockResolvedValue([waiting()]);
  db.visionEventCandidate.updateMany.mockResolvedValue({ count: 1 });
  db.sbMatch.findUnique.mockResolvedValue({ competition: { formatConfig: null }, statisticsSheet: null });
  db.sbMatchEvent.findMany.mockResolvedValue([row()]);
  db.sbMatchEvent.update.mockResolvedValue({});
  db.visionClockAnchor.findMany.mockResolvedValue([{ id: "anchor-1", half: 1, sourceMs: KICKOFF, endMs: KICKOFF + 49 * 60_000 }]);
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
});

describe("after the recorder's sheet is rebuilt", () => {
  it("asks only for candidates that were enriched, are still current, and are waiting on their event", async () => {
    db.visionEventCandidate.findMany.mockResolvedValue([]);
    expect(await reapplyEnrichment(db as never, MATCH)).toEqual({ reapplied: [], stale: [] });
    expect(db.visionEventCandidate.findMany.mock.calls[0]![0].where).toEqual({ sbMatchId: MATCH, supersededBy: null, reviewState: "accepted", promotionKind: "enriched", promotedAt: { not: null }, promotedEventId: null });
    // Nothing waiting is the ordinary case, and costs one query.
    expect(db.sbMatch.findUnique).not.toHaveBeenCalled();
    expect(db.sbMatchEvent.findMany).not.toHaveBeenCalled();
  });

  it("puts the stamp and the second back on the row that is the same event, and links the candidate again", async () => {
    expect(await reapplyEnrichment(db as never, MATCH)).toEqual({ reapplied: ["cand-1"], stale: [] });
    expect(db.visionEventCandidate.updateMany).toHaveBeenCalledWith({ where: { id: "cand-1", supersededBy: null, promotedEventId: null, promotedAt: { not: null } }, data: { promotedEventId: "new-1" } });
    expect(db.sbMatchEvent.update).toHaveBeenCalledWith({
      where: { id: "new-1" },
      data: {
        // The row's own metadata kept; the stamp dated when the publisher promoted it, not now.
        metadata: { source: "match_recorder", half: 1, addedMinute: 2, recorderSequence: 4, vision: { contract: "VisionEventPromotionV1", candidateId: "cand-1", videoAssetId: ASSET, type: "goal_candidate", taxonomyVersion: "2026.10.0", startMs: waiting().startMs, endMs: waiting().endMs, actorTrackId: "track-1", promotedAt: PROMOTED.toISOString() } },
        secondInMinute: 12,
      },
    });
  });

  it("follows a goal the recorder moved by a minute, and writes no second under a minute that is not its own", async () => {
    db.sbMatchEvent.findMany.mockResolvedValue([row({ metadata: { source: "match_recorder", half: 1, addedMinute: 3 } })]);
    expect(await reapplyEnrichment(db as never, MATCH)).toEqual({ reapplied: ["cand-1"], stale: [] });
    expect(db.sbMatchEvent.update.mock.calls[0]![0].data).not.toHaveProperty("secondInMinute");
  });

  it("leaves the candidate stale when the recorder removed the goal, moved it further, or gave it to the other side", async () => {
    for (const rows of [[], [row({ minute: 40, metadata: { source: "match_recorder", half: 1, addedMinute: null } })], [row({ teamId: "away" })], [row({ type: "own_goal" })], [row({ minute: 47, metadata: { source: "match_recorder", half: 2, addedMinute: null } })]]) {
      db.sbMatchEvent.findMany.mockResolvedValue(rows);
      expect(await reapplyEnrichment(db as never, MATCH), JSON.stringify(rows)).toEqual({ reapplied: [], stale: ["cand-1"] });
    }
    expect(db.sbMatchEvent.update).not.toHaveBeenCalled();
    expect(db.visionEventCandidate.updateMany).not.toHaveBeenCalled();
  });

  it("does not choose between two rows equally near, and does not take a row another candidate has", async () => {
    db.sbMatchEvent.findMany.mockResolvedValue([row({ id: "a", metadata: { half: 1, addedMinute: 1 } }), row({ id: "b", metadata: { half: 1, addedMinute: 3 } })]);
    expect(await reapplyEnrichment(db as never, MATCH)).toEqual({ reapplied: [], stale: ["cand-1"] });
    db.sbMatchEvent.findMany.mockResolvedValue([row({ visionCandidate: { id: "cand-0" } })]);
    expect(await reapplyEnrichment(db as never, MATCH)).toEqual({ reapplied: [], stale: ["cand-1"] });
    expect(db.sbMatchEvent.update).not.toHaveBeenCalled();
  });

  it("gives one rewritten row to one candidate", async () => {
    db.visionEventCandidate.findMany.mockResolvedValue([waiting(), waiting({ id: "cand-2" })]);
    expect(await reapplyEnrichment(db as never, MATCH)).toEqual({ reapplied: ["cand-1"], stale: ["cand-2"] });
    expect(db.sbMatchEvent.update).toHaveBeenCalledTimes(1);
  });

  it("holds to the clock the candidate was accepted on: a half re-anchored since, or off the clock, stays stale", async () => {
    db.visionClockAnchor.findMany.mockResolvedValue([{ id: "anchor-2", half: 1, sourceMs: KICKOFF, endMs: null }]);
    expect(await reapplyEnrichment(db as never, MATCH)).toEqual({ reapplied: [], stale: ["cand-1"] });
    db.visionClockAnchor.findMany.mockResolvedValue([]);
    expect(await reapplyEnrichment(db as never, MATCH)).toEqual({ reapplied: [], stale: ["cand-1"] });
    db.visionClockAnchor.findMany.mockResolvedValue([{ id: "anchor-1", half: 3, sourceMs: KICKOFF, endMs: null }]);
    expect(await reapplyEnrichment(db as never, MATCH)).toEqual({ reapplied: [], stale: ["cand-1"] });
    expect(db.sbMatchEvent.update).not.toHaveBeenCalled();
  });

  it("reads the minute on the match's own half length", async () => {
    // Thirty-minute halves, and a candidate 1:12 after the restart: the 32nd minute, not the 47th.
    const start = 2_000_000 + 72_000;
    db.visionEventCandidate.findMany.mockResolvedValue([waiting({ startMs: start, endMs: start })]);
    db.visionClockAnchor.findMany.mockResolvedValue([{ id: "anchor-0", half: 1, sourceMs: KICKOFF, endMs: 1_900_000 }, { id: "anchor-1", half: 2, sourceMs: 2_000_000, endMs: null }]);
    db.sbMatch.findUnique.mockResolvedValue({ competition: { formatConfig: { halfLengthMinutes: 30 } }, statisticsSheet: null });
    db.sbMatchEvent.findMany.mockResolvedValue([row({ minute: 32, metadata: { half: 2, addedMinute: null } })]);
    expect(await reapplyEnrichment(db as never, MATCH)).toEqual({ reapplied: ["cand-1"], stale: [] });
    expect(db.sbMatchEvent.update.mock.calls[0]![0].data.secondInMinute).toBe(12);
    db.sbMatchEvent.findMany.mockResolvedValue([row({ minute: 47, metadata: { half: 2, addedMinute: null } })]);
    expect(await reapplyEnrichment(db as never, MATCH)).toEqual({ reapplied: [], stale: ["cand-1"] });
  });

  it("writes nothing on the row when the candidate was corrected or linked meanwhile", async () => {
    db.visionEventCandidate.updateMany.mockResolvedValue({ count: 0 });
    expect(await reapplyEnrichment(db as never, MATCH)).toEqual({ reapplied: [], stale: ["cand-1"] });
    expect(db.sbMatchEvent.update).not.toHaveBeenCalled();
  });

  it("leaves the candidate stale, and the approval standing, when the write fails", async () => {
    db.$transaction.mockRejectedValue(new Error("unique"));
    expect(await reapplyEnrichment(db as never, MATCH)).toEqual({ reapplied: [], stale: ["cand-1"] });
  });
});
