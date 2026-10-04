import { beforeEach, describe, expect, it, vi } from "vitest";
import { VisionEventsService } from "./events.service";

/**
 * The rules the service holds on top of the taxonomy module: a person's
 * proposal with its evidence found for it, a correction superseding, a second
 * person's decision, and the promotion that enriches the recorder's event or
 * creates one only on explicit instruction.
 */

const ASSET = "11111111-1111-4111-8111-111111111111";
const MATCH = "22222222-2222-4222-8222-222222222222";
const TRACK = "33333333-3333-4333-8333-333333333333";
const SLOT = "44444444-4444-4444-8444-444444444444";
const HOME = "55555555-5555-4555-8555-555555555555";
const AWAY = "66666666-6666-4666-8666-666666666666";

const mockPrisma = {
  visionVideoAsset: { findUnique: vi.fn(), findMany: vi.fn() },
  visionTrack: { findUnique: vi.fn() },
  sbMatchSquadPlayer: { findUnique: vi.fn(), findMany: vi.fn() },
  sbMatch: { findUnique: vi.fn(), update: vi.fn() },
  visionCameraSegment: { findFirst: vi.fn() },
  visionIdentityAssignment: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  visionClockAnchor: { findFirst: vi.fn() },
  visionEventCandidate: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  visionEvidenceLink: { createMany: vi.fn() },
  sbMatchEvent: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
};
const mockAudit = { record: vi.fn() };
const mockRights = { canPublishHighlight: vi.fn() };
const mockClock = { currentAnchors: vi.fn(), currentAnchorsFor: vi.fn() };
const mockLifecycle = { applyMatchEventToPlayerStats: vi.fn(), refreshStandingsForFinishedMatch: vi.fn() };

const alice = { userId: "alice", method: "session" } as never;
const bob = { userId: "bob", method: "session" } as never;
const keyed = { userId: null, method: "api-key" } as never;

let service: VisionEventsService;
let stored: Record<string, unknown>;

function candidate(over: Record<string, unknown> = {}) {
  return {
    id: "cand-1", videoAssetId: ASSET, sbMatchId: MATCH, type: "goal_candidate", taxonomyVersion: "2026.10.0", startMs: 100_000, endMs: 100_000,
    actorTrackId: TRACK, actorPlayerId: "p9", actorMatchSquadPlayerId: SLOT, sbTeamId: HOME, confidence: 1, method: "manual", modelVersionId: null,
    cameraSegmentId: "seg-1", inPlay: true, reviewState: "accepted", decidedBy: "alice", reviewedBy: "bob", reviewNote: null, note: null,
    promotedEventId: null, promotionKind: null, promotedBy: null, promotedAt: null, acceptedAnchorId: "anchor-1", supersededBy: null, createdAt: new Date(), evidence: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  service = new VisionEventsService(mockPrisma as never, mockAudit as never, mockRights as never, mockClock as never, mockLifecycle as never);
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma));
  mockPrisma.visionVideoAsset.findUnique.mockResolvedValue({ id: ASSET, durationMs: 6_000_000, sbMatchId: MATCH });
  mockPrisma.visionTrack.findUnique.mockResolvedValue({ id: TRACK, videoAssetId: ASSET });
  mockPrisma.sbMatchSquadPlayer.findUnique.mockResolvedValue({ id: SLOT, matchId: MATCH, teamId: HOME, playerId: "p9", playerName: "Nine" });
  mockPrisma.sbMatch.findUnique.mockResolvedValue({ id: MATCH, homeTeamId: HOME, awayTeamId: AWAY, competitionId: "comp-1", competition: { formatConfig: null }, statisticsSheet: null });
  mockPrisma.visionCameraSegment.findFirst.mockResolvedValue({ id: "seg-1", kind: "live_play", calibrations: [{ id: "cal-1" }] });
  mockPrisma.visionIdentityAssignment.findFirst.mockResolvedValue({ id: "ident-1" });
  mockPrisma.visionClockAnchor.findFirst.mockResolvedValue({ id: "anchor-1", half: 1, sourceMs: 9000, endMs: null });
  mockClock.currentAnchors.mockResolvedValue([{ half: 1, sourceMs: 9000, endMs: null }]);
  mockPrisma.visionEventCandidate.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    stored = { id: "cand-1", ...data, evidence: [] };
    return stored;
  });
  mockPrisma.visionEventCandidate.findUnique.mockImplementation(async () => stored ?? null);
  mockPrisma.visionEventCandidate.update.mockResolvedValue({});
  mockPrisma.visionEventCandidate.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.visionEvidenceLink.createMany.mockResolvedValue({ count: 0 });
  mockRights.canPublishHighlight.mockResolvedValue({ allowed: true });
  mockPrisma.sbMatchEvent.findMany.mockResolvedValue([]);
});

describe("proposing", () => {
  it("is a person's, in the taxonomy, inside the footage, on this asset and this match", async () => {
    await expect(service.propose({ videoAssetId: ASSET, type: "shot", startMs: 1, endMs: 2 }, keyed)).rejects.toMatchObject({ response: { error: "EventNeedsAPerson" } });
    await expect(service.propose({ videoAssetId: ASSET, type: "goal", startMs: 1, endMs: 2 }, alice)).rejects.toMatchObject({ response: { error: "UnknownEventType" } });
    await expect(service.propose({ videoAssetId: ASSET, type: "shot", startMs: 5, endMs: 2 }, alice)).rejects.toMatchObject({ response: { error: "EventOutsideAsset" } });
    await expect(service.propose({ videoAssetId: ASSET, type: "shot", startMs: 1, endMs: 7_000_000 }, alice)).rejects.toMatchObject({ response: { error: "EventOutsideAsset" } });
    mockPrisma.visionTrack.findUnique.mockResolvedValueOnce({ id: TRACK, videoAssetId: "other" });
    await expect(service.propose({ videoAssetId: ASSET, type: "shot", startMs: 1, endMs: 2, actorTrackId: TRACK }, alice)).rejects.toMatchObject({ response: { error: "ActorNotOnThisAsset" } });
    mockPrisma.sbMatchSquadPlayer.findUnique.mockResolvedValueOnce({ id: SLOT, matchId: "another-match", teamId: HOME, playerId: null });
    await expect(service.propose({ videoAssetId: ASSET, type: "shot", startMs: 1, endMs: 2, actorMatchSquadPlayerId: SLOT }, alice)).rejects.toMatchObject({ response: { error: "NotOnThisMatchSquad" } });
    await expect(service.propose({ videoAssetId: ASSET, type: "shot", startMs: 1, endMs: 2, sbTeamId: "77777777-7777-4777-8777-777777777777" }, alice)).rejects.toMatchObject({ response: { error: "TeamNotInThisMatch" } });
    expect(mockPrisma.visionEventCandidate.create).not.toHaveBeenCalled();
  });

  it("files the candidate with the evidence it can see: the actor, who they were said to be, the segment, its calibration, the half", async () => {
    const out = await service.propose({ videoAssetId: ASSET, type: "shot", startMs: 100_000, endMs: 101_000, actorTrackId: TRACK, actorMatchSquadPlayerId: SLOT, evidence: [{ kind: "detection_frame", targetId: "frame-2375" }] }, alice);
    expect(mockPrisma.visionEventCandidate.create.mock.calls[0]![0].data).toMatchObject({
      type: "shot", taxonomyVersion: "2026.10.0", startMs: 100_000, endMs: 101_000, actorTrackId: TRACK, actorPlayerId: "p9", actorMatchSquadPlayerId: SLOT, sbTeamId: HOME,
      method: "manual", cameraSegmentId: "seg-1", inPlay: true, decidedBy: "alice", sbMatchId: MATCH,
    });
    const links = mockPrisma.visionEvidenceLink.createMany.mock.calls[0]![0].data as { kind: string; targetId: string }[];
    expect(links.map((l) => `${l.kind}:${l.targetId}`)).toEqual(["track:" + TRACK, "identity:ident-1", "camera_segment:seg-1", "calibration:cal-1", "clock_anchor:anchor-1", "detection_frame:frame-2375"]);
    expect(out.matchClock).toBe("1:31");
    expect(out.promotable).toBe(false);
    expect(mockAudit.record.mock.calls[0]![0]).toMatchObject({ action: "event.proposed", targetKind: "vision_event_candidate" });
  });

  it("reads segments half-open: the millisecond a replay ends on is the play that follows", async () => {
    await service.propose({ videoAssetId: ASSET, type: "goal_candidate", startMs: 100_000, endMs: 100_000 }, alice);
    const query = mockPrisma.visionCameraSegment.findFirst.mock.calls[0]![0];
    expect(query.where).toEqual({ videoAssetId: ASSET, startMs: { lte: 100_000 }, endMs: { gt: 100_000 } });
    // Of two that overlap, the one that started latest; and the newest current calibration.
    expect(query.orderBy).toEqual({ startMs: "desc" });
    expect(query.select.calibrations).toMatchObject({ where: { supersededBy: null }, orderBy: { createdAt: "desc" }, take: 1 });
  });

  it("flags a candidate inside a replay as not play, and one under no segment as play", async () => {
    mockPrisma.visionCameraSegment.findFirst.mockResolvedValueOnce({ id: "seg-r", kind: "replay", calibrations: [] });
    await service.propose({ videoAssetId: ASSET, type: "goal_candidate", startMs: 100_000, endMs: 100_000 }, alice);
    expect(mockPrisma.visionEventCandidate.create.mock.calls[0]![0].data).toMatchObject({ inPlay: false, cameraSegmentId: "seg-r" });
    mockPrisma.visionCameraSegment.findFirst.mockResolvedValueOnce(null);
    await service.propose({ videoAssetId: ASSET, type: "goal_candidate", startMs: 100_000, endMs: 100_000 }, alice);
    expect(mockPrisma.visionEventCandidate.create.mock.calls[1]![0].data).toMatchObject({ inPlay: true, cameraSegmentId: null });
  });
});

describe("correcting and deciding", () => {
  it("supersedes with a new unreviewed row carrying the caller's evidence, and refuses a promoted one", async () => {
    stored = candidate({ reviewState: "accepted", evidence: [{ id: "l1", kind: "track", targetId: TRACK, note: null }, { id: "l2", kind: "detection_frame", targetId: "frame-1", note: null }] });
    const out = await service.correct("cand-1", { startMs: 99_000, endMs: 99_500 }, bob);
    const data = mockPrisma.visionEventCandidate.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ startMs: 99_000, endMs: 99_500, type: "goal_candidate", decidedBy: "bob", actorMatchSquadPlayerId: SLOT });
    expect(data.reviewState).toBeUndefined();
    // The acceptance and its clock stay with the row that was accepted; the new one starts clean.
    expect(data.acceptedAnchorId).toBeUndefined();
    const links = mockPrisma.visionEvidenceLink.createMany.mock.calls[0]![0].data as { kind: string; targetId: string }[];
    expect(links.some((l) => l.kind === "detection_frame" && l.targetId === "frame-1")).toBe(true);
    expect(mockPrisma.visionEventCandidate.updateMany).toHaveBeenCalledWith({ where: { id: "cand-1", supersededBy: null, promotedEventId: null }, data: { supersededBy: "cand-1" } });
    expect(out.supersedes).toBe("cand-1");

    stored = candidate({ promotedEventId: "ev-9" });
    await expect(service.correct("cand-1", { note: "late" }, bob)).rejects.toMatchObject({ response: { error: "EventPromoted" } });
    stored = candidate({ supersededBy: "cand-2" });
    await expect(service.correct("cand-1", { note: "late" }, bob)).rejects.toMatchObject({ response: { error: "EventSuperseded" } });
  });

  it("lets one of two corrections at once win: the other finds the row already superseded", async () => {
    stored = candidate({ reviewState: "unreviewed" });
    mockPrisma.visionEventCandidate.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.correct("cand-1", { note: "second" }, bob)).rejects.toMatchObject({ response: { error: "EventSuperseded" } });
    expect(mockAudit.record).not.toHaveBeenCalled();
  });

  it("is accepted by a second person and rejected with a reason", async () => {
    stored = candidate({ reviewState: "unreviewed", reviewedBy: null, acceptedAnchorId: null });
    await expect(service.decide("cand-1", "accepted", undefined, alice)).rejects.toMatchObject({ response: { error: "SelfAcceptanceRefused" } });
    await expect(service.decide("cand-1", "rejected", "", bob)).rejects.toMatchObject({ response: { error: "ReasonRequired" } });
    await service.decide("cand-1", "accepted", undefined, bob);
    // Conditional on still being the current, undecided row; and the clock it was accepted on is kept.
    expect(mockPrisma.visionEventCandidate.updateMany).toHaveBeenCalledWith({
      where: { id: "cand-1", supersededBy: null, reviewState: "unreviewed", promotedAt: null },
      data: { reviewState: "accepted", reviewedBy: "bob", reviewNote: null, acceptedAnchorId: "anchor-1" },
    });
    await service.decide("cand-1", "rejected", "a replay", bob);
    expect(mockPrisma.visionEventCandidate.updateMany.mock.calls[1]![0].data).toMatchObject({ reviewState: "rejected", reviewNote: "a replay", acceptedAnchorId: null });
    expect(mockAudit.record.mock.calls[1]![0]).toMatchObject({ action: "event.rejected", reason: "a replay" });
  });

  it("accepts off the clock with no anchor recorded", async () => {
    stored = candidate({ reviewState: "unreviewed", reviewedBy: null, acceptedAnchorId: null });
    mockClock.currentAnchors.mockResolvedValue([]);
    await service.decide("cand-1", "accepted", undefined, bob);
    expect(mockPrisma.visionEventCandidate.updateMany.mock.calls[0]![0].data).toMatchObject({ reviewState: "accepted", acceptedAnchorId: null });
  });

  it("does not change a decision in place, whether it reads decided or loses the race", async () => {
    stored = candidate({ reviewState: "accepted" });
    await expect(service.decide("cand-1", "rejected", "changed my mind", bob)).rejects.toMatchObject({ response: { error: "AlreadyDecided" } });
    stored = candidate({ reviewState: "rejected" });
    await expect(service.decide("cand-1", "accepted", undefined, bob)).rejects.toMatchObject({ response: { error: "AlreadyDecided" } });
    expect(mockPrisma.visionEventCandidate.updateMany).not.toHaveBeenCalled();

    stored = candidate({ reviewState: "unreviewed" });
    mockPrisma.visionEventCandidate.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.decide("cand-1", "accepted", undefined, bob)).rejects.toMatchObject({ response: { error: "AlreadyDecided" } });
    expect(mockAudit.record).not.toHaveBeenCalled();
  });
});

describe("promotion", () => {
  it("needs acceptance, a match, a recorder type, play, rights and a clock, in that order", async () => {
    stored = candidate({ reviewState: "unreviewed" });
    await expect(service.promote("cand-1", {}, bob)).rejects.toMatchObject({ response: { error: "NotAccepted" } });
    stored = candidate({ sbMatchId: null });
    await expect(service.promote("cand-1", {}, bob)).rejects.toMatchObject({ response: { error: "NoMatchLinked" } });
    stored = candidate({ type: "shot" });
    await expect(service.promote("cand-1", {}, bob)).rejects.toMatchObject({ response: { error: "NoScoreBoardType" } });
    stored = candidate();
    mockPrisma.visionCameraSegment.findFirst.mockResolvedValueOnce({ id: "seg-r", kind: "replay", calibrations: [] });
    await expect(service.promote("cand-1", {}, bob)).rejects.toMatchObject({ response: { error: "NotInPlay" } });
    expect(mockPrisma.visionEventCandidate.update).toHaveBeenCalledWith({ where: { id: "cand-1" }, data: { inPlay: false, cameraSegmentId: "seg-r" } });
    mockRights.canPublishHighlight.mockResolvedValueOnce({ allowed: false, reason: "scope denies publication" });
    await expect(service.promote("cand-1", {}, bob)).rejects.toMatchObject({ response: { error: "PublicationRightsRefused" } });
    // The actor is named to the check, so a player- or guardian-level withdrawal applies
    // (docs/vision/50, PR-4).
    expect(mockRights.canPublishHighlight).toHaveBeenLastCalledWith({ videoAssetId: expect.any(String), playerId: "p9" });
    mockClock.currentAnchors.mockResolvedValueOnce([]);
    await expect(service.promote("cand-1", {}, bob)).rejects.toMatchObject({ response: { error: "ClockNotAnchored" } });
    stored = candidate({ promotedEventId: "ev-1" });
    await expect(service.promote("cand-1", {}, bob)).rejects.toMatchObject({ response: { error: "AlreadyPromoted" } });
    expect(mockPrisma.sbMatchEvent.create).not.toHaveBeenCalled();
    expect(mockPrisma.sbMatchEvent.update).not.toHaveBeenCalled();
    expect(mockPrisma.visionEventCandidate.updateMany).not.toHaveBeenCalled();
  });

  it("writes only the minute the second person accepted: a re-anchored half, or one anchored later, is reviewed again", async () => {
    stored = candidate({ acceptedAnchorId: "anchor-0" });
    await expect(service.promote("cand-1", { create: true }, bob)).rejects.toMatchObject({ response: { error: "ClockChangedSinceAcceptance" } });
    stored = candidate({ acceptedAnchorId: null });
    await expect(service.promote("cand-1", { create: true }, bob)).rejects.toMatchObject({ response: { error: "ClockChangedSinceAcceptance" } });
    expect(mockPrisma.sbMatchEvent.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.sbMatchEvent.create).not.toHaveBeenCalled();
  });

  it("has no minute for extra time, and none for added time under an unmarked whistle", async () => {
    stored = candidate();
    mockClock.currentAnchors.mockResolvedValue([{ half: 3, sourceMs: 9000, endMs: null }]);
    mockPrisma.visionClockAnchor.findFirst.mockResolvedValue({ id: "anchor-1", half: 3, sourceMs: 9000, endMs: null });
    await expect(service.promote("cand-1", { create: true }, bob)).rejects.toMatchObject({ response: { error: "ExtraTimeNotRecorded" } });

    // 47:12 into a first half whose end nobody marked.
    stored = candidate({ startMs: 9000 + 47 * 60_000 + 12_000 });
    mockClock.currentAnchors.mockResolvedValue([{ half: 1, sourceMs: 9000, endMs: null }]);
    mockPrisma.visionClockAnchor.findFirst.mockResolvedValue({ id: "anchor-1", half: 1, sourceMs: 9000, endMs: null });
    await expect(service.promote("cand-1", { create: true }, bob)).rejects.toMatchObject({ response: { error: "HalfEndNotMarked" } });
    expect(mockPrisma.sbMatchEvent.create).not.toHaveBeenCalled();
  });

  it("enriches the recorder's goal at the same minute rather than adding a second", async () => {
    // 1:31 after kick-off is the second minute on the recorder's clock.
    stored = candidate();
    mockPrisma.sbMatchEvent.findMany.mockResolvedValue([{ id: "ev-23", type: "goal", minute: 2, teamId: HOME, playerId: null, metadata: { half: 1, addedMinute: null }, visionCandidate: null }]);
    mockPrisma.sbMatchEvent.findUnique.mockResolvedValue({ id: "ev-23", metadata: { playerNumber: 9 } });
    const out = await service.promote("cand-1", {}, bob);
    expect(out.promotion).toEqual({ kind: "enriched", eventId: "ev-23", half: 1, minute: 2, addedMinute: null, second: 31, minutesApart: 0 });
    const update = mockPrisma.sbMatchEvent.update.mock.calls[0]![0];
    expect(update.where).toEqual({ id: "ev-23" });
    expect(update.data.metadata).toMatchObject({ playerNumber: 9, vision: { contract: "VisionEventPromotionV1", candidateId: "cand-1", type: "goal_candidate", startMs: 100_000 } });
    expect(update.data.secondInMinute).toBe(31);
    // Claimed conditionally first, then linked.
    expect(mockPrisma.visionEventCandidate.updateMany).toHaveBeenCalledWith({
      where: { id: "cand-1", supersededBy: null, reviewState: "accepted", promotedAt: null, promotedEventId: null },
      data: expect.objectContaining({ promotionKind: "enriched", promotedBy: "bob" }),
    });
    expect(mockPrisma.visionEventCandidate.update).toHaveBeenCalledWith({ where: { id: "cand-1" }, data: { promotedEventId: "ev-23" } });
    // The stamp and the candidate say the same instant: one promotion, told apart from no other.
    const claimedAt = mockPrisma.visionEventCandidate.updateMany.mock.calls[0]![0].data.promotedAt as Date;
    expect(update.data.metadata.vision.promotedAt).toBe(claimedAt.toISOString());
    expect(mockPrisma.sbMatchEvent.create).not.toHaveBeenCalled();
    // Enriching changes no score and credits nobody: the recorder's goal already did both.
    expect(mockPrisma.sbMatch.update).not.toHaveBeenCalled();
    expect(mockLifecycle.applyMatchEventToPlayerStats).not.toHaveBeenCalled();
  });

  it("matches a goal in added time to the recorder's 45+2, not to the second half's 47th minute", async () => {
    const start = 9000 + 47 * 60_000 + 12_000;
    stored = candidate({ startMs: start, endMs: start });
    mockClock.currentAnchors.mockResolvedValue([{ half: 1, sourceMs: 9000, endMs: 9000 + 49 * 60_000 }]);
    mockPrisma.visionClockAnchor.findFirst.mockResolvedValue({ id: "anchor-1", half: 1, sourceMs: 9000, endMs: 9000 + 49 * 60_000 });
    mockPrisma.sbMatchEvent.findMany.mockResolvedValue([
      { id: "ev-second-half", type: "goal", minute: 47, teamId: HOME, playerId: null, metadata: { half: 2, addedMinute: null }, visionCandidate: null },
      { id: "ev-stoppage", type: "goal", minute: 45, teamId: HOME, playerId: null, metadata: { half: 1, addedMinute: 2 }, visionCandidate: null },
    ]);
    mockPrisma.sbMatchEvent.findUnique.mockResolvedValue({ id: "ev-stoppage", metadata: { half: 1, addedMinute: 2 }, secondInMinute: null });
    const out = await service.promote("cand-1", {}, bob);
    expect(out.promotion).toEqual({ kind: "enriched", eventId: "ev-stoppage", half: 1, minute: 45, addedMinute: 2, second: 12, minutesApart: 0 });
  });

  it("reads the second half from the match's own half length", async () => {
    // Thirty-minute halves; 1:12 after the restart is the 32nd minute, which is where the recorder logged it.
    const start = 2_000_000 + 72_000;
    stored = candidate({ startMs: start, endMs: start });
    mockClock.currentAnchors.mockResolvedValue([{ half: 1, sourceMs: 9000, endMs: 1_900_000 }, { half: 2, sourceMs: 2_000_000, endMs: null }]);
    mockPrisma.visionClockAnchor.findFirst.mockResolvedValue({ id: "anchor-1", half: 2, sourceMs: 2_000_000, endMs: null });
    mockPrisma.sbMatch.findUnique.mockResolvedValue({ id: MATCH, homeTeamId: HOME, awayTeamId: AWAY, competitionId: "comp-1", competition: { formatConfig: { halfLengthMinutes: 35 } }, statisticsSheet: { clock: { halfLength: 30, firstHalfStartedAt: "2026-10-03T10:00:00Z" } } });
    mockPrisma.sbMatchEvent.findMany.mockResolvedValue([{ id: "ev-32", type: "goal", minute: 32, teamId: HOME, playerId: null, metadata: { half: 2, addedMinute: null }, visionCandidate: null }]);
    mockPrisma.sbMatchEvent.findUnique.mockResolvedValue({ id: "ev-32", metadata: { half: 2 }, secondInMinute: null });
    const out = await service.promote("cand-1", {}, bob);
    expect(out.promotion).toMatchObject({ kind: "enriched", eventId: "ev-32", half: 2, minute: 32, second: 12, minutesApart: 0 });
  });

  it("writes the second beside the recorder's minute only when the minutes agree and the recorder gave none", async () => {
    stored = candidate();
    mockPrisma.sbMatchEvent.findMany.mockResolvedValue([{ id: "ev-next", type: "goal", minute: 3, teamId: HOME, playerId: null, metadata: null, visionCandidate: null }]);
    mockPrisma.sbMatchEvent.findUnique.mockResolvedValue({ id: "ev-next", metadata: null, secondInMinute: null });
    let out = await service.promote("cand-1", {}, bob);
    expect(out.promotion).toMatchObject({ kind: "enriched", minute: 3, second: null, minutesApart: 1 });
    expect(mockPrisma.sbMatchEvent.update.mock.calls[0]![0].data).not.toHaveProperty("secondInMinute");

    stored = candidate();
    mockPrisma.sbMatchEvent.findMany.mockResolvedValue([{ id: "ev-same", type: "goal", minute: 2, teamId: HOME, playerId: null, metadata: null, visionCandidate: null }]);
    mockPrisma.sbMatchEvent.findUnique.mockResolvedValue({ id: "ev-same", metadata: null, secondInMinute: 7 });
    out = await service.promote("cand-1", {}, bob);
    expect(out.promotion).toMatchObject({ kind: "enriched", minute: 2, second: 7, minutesApart: 0 });
    expect(mockPrisma.sbMatchEvent.update.mock.calls[1]![0].data).not.toHaveProperty("secondInMinute");
  });

  it("gives one recorder event to one candidate: a second landing on it is refused, before the write and at it", async () => {
    stored = candidate();
    mockPrisma.sbMatchEvent.findMany.mockResolvedValue([{ id: "ev-taken", type: "goal", minute: 2, teamId: HOME, playerId: null, metadata: null, visionCandidate: { id: "cand-0" } }]);
    await expect(service.promote("cand-1", {}, bob)).rejects.toMatchObject({ response: { error: "AlreadyEnriched" } });
    await expect(service.promote("cand-1", { create: true }, bob)).rejects.toMatchObject({ response: { error: "AlreadyEnriched" } });
    expect(mockPrisma.visionEventCandidate.updateMany).not.toHaveBeenCalled();

    // Two at once: neither saw the other's link, and the unique link refuses the loser.
    const { Prisma } = await import("@prisma/client");
    mockPrisma.sbMatchEvent.findMany.mockResolvedValue([{ id: "ev-race", type: "goal", minute: 2, teamId: HOME, playerId: null, metadata: null, visionCandidate: null }]);
    mockPrisma.sbMatchEvent.findUnique.mockResolvedValue({ id: "ev-race", metadata: null, secondInMinute: null });
    mockPrisma.visionEventCandidate.update.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" }));
    await expect(service.promote("cand-1", {}, bob)).rejects.toMatchObject({ response: { error: "AlreadyEnriched" } });
    expect(mockPrisma.sbMatchEvent.update).not.toHaveBeenCalled();
    expect(mockAudit.record).not.toHaveBeenCalled();
  });

  it("promotes once: a second promotion at the same moment claims nothing and writes nothing", async () => {
    stored = candidate();
    mockPrisma.visionEventCandidate.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.promote("cand-1", { create: true }, bob)).rejects.toMatchObject({ response: { error: "AlreadyPromoted" } });
    expect(mockPrisma.sbMatchEvent.create).not.toHaveBeenCalled();
    expect(mockPrisma.sbMatch.update).not.toHaveBeenCalled();
    expect(mockLifecycle.applyMatchEventToPlayerStats).not.toHaveBeenCalled();
  });

  it("refuses a candidate whose event has left the match record, until it is corrected", async () => {
    stored = candidate({ promotedAt: new Date(), promotionKind: "enriched", promotedEventId: null });
    await expect(service.promote("cand-1", { create: true }, bob)).rejects.toMatchObject({ response: { error: "PromotionStale" } });
    await expect(service.decide("cand-1", "rejected", "gone", bob)).rejects.toMatchObject({ response: { error: "PromotionStale" } });
    expect((await service.get("cand-1")).promotionStale).toBe(true);
    // A correction is the way back: a new row, unreviewed, with no promotion on it.
    await service.correct("cand-1", {}, bob);
    const data = mockPrisma.visionEventCandidate.create.mock.calls[0]![0].data;
    expect(data.promotedAt).toBeUndefined();
    expect(data.promotionKind).toBeUndefined();
  });

  it("creates a recorder event only on instruction, with the team known, and refuses an ambiguous match", async () => {
    stored = candidate();
    mockPrisma.sbMatchEvent.findMany.mockResolvedValue([{ id: "ev-far", type: "goal", minute: 30, teamId: HOME, playerId: null, metadata: null, visionCandidate: null }]);
    await expect(service.promote("cand-1", {}, bob)).rejects.toMatchObject({ response: { error: "NoMatchingEvent", nearest: { id: "ev-far" } } });
    stored = candidate({ sbTeamId: null, actorMatchSquadPlayerId: null, actorPlayerId: null });
    await expect(service.promote("cand-1", { create: true }, bob)).rejects.toMatchObject({ response: { error: "TeamUnknown" } });
    stored = candidate({ sbTeamId: "77777777-7777-4777-8777-777777777777", actorMatchSquadPlayerId: null, actorPlayerId: null });
    await expect(service.promote("cand-1", { create: true }, bob)).rejects.toMatchObject({ response: { error: "TeamUnknown" } });

    stored = candidate();
    mockPrisma.sbMatchEvent.findMany.mockResolvedValue([{ id: "a", type: "goal", minute: 1, teamId: HOME, playerId: null, metadata: null, visionCandidate: null }, { id: "b", type: "goal", minute: 3, teamId: HOME, playerId: null, metadata: null, visionCandidate: null }]);
    await expect(service.promote("cand-1", { create: true }, bob)).rejects.toMatchObject({ response: { error: "AmbiguousRecorderEvent" } });
    expect(mockPrisma.sbMatchEvent.create).not.toHaveBeenCalled();
  });

  it("adds a created goal to the timeline, the scoreline, the scorer's totals and the table together", async () => {
    stored = candidate();
    const row = { id: "ev-new", type: "goal", playerId: "p9", assistPlayerId: null, metadata: { source: "vision" } };
    mockPrisma.sbMatchEvent.create.mockResolvedValue(row);
    const out = await service.promote("cand-1", { create: true }, bob);
    expect(out.promotion).toEqual({ kind: "created", eventId: "ev-new", half: 1, minute: 2, addedMinute: null, second: 31, minutesApart: 0 });
    expect(mockPrisma.sbMatchEvent.create.mock.calls[0]![0].data).toMatchObject({
      matchId: MATCH, teamId: HOME, playerId: "p9", playerLabel: "Nine", type: "goal", minute: 2, secondInMinute: 31,
      metadata: { source: "vision", half: 1, addedMinute: null, vision: { candidateId: "cand-1" } },
    });
    expect(mockPrisma.visionEventCandidate.update).toHaveBeenCalledWith({ where: { id: "cand-1" }, data: { promotedEventId: "ev-new" } });
    expect(mockPrisma.sbMatch.update).toHaveBeenCalledWith({ where: { id: MATCH }, data: { homeScore: { increment: 1 } } });
    expect(mockLifecycle.applyMatchEventToPlayerStats).toHaveBeenCalledWith(row, "comp-1");
    expect(mockLifecycle.refreshStandingsForFinishedMatch).toHaveBeenCalledWith(MATCH);

    // The away side's goal counts for the away side.
    vi.clearAllMocks();
    mockPrisma.visionEventCandidate.updateMany.mockResolvedValue({ count: 1 });
    stored = candidate({ sbTeamId: AWAY, actorMatchSquadPlayerId: null, actorPlayerId: null, actorTrackId: null });
    await service.promote("cand-1", { create: true }, bob);
    expect(mockPrisma.sbMatch.update).toHaveBeenCalledWith({ where: { id: MATCH }, data: { awayScore: { increment: 1 } } });
  });

  it("reports the promotion even when crediting the scorer fails afterwards: the goal is on the record", async () => {
    stored = candidate();
    mockPrisma.sbMatchEvent.create.mockResolvedValue({ id: "ev-new", type: "goal", playerId: "p9", assistPlayerId: null, metadata: {} });
    mockLifecycle.applyMatchEventToPlayerStats.mockRejectedValueOnce(new Error("stats table locked"));
    const out = await service.promote("cand-1", { create: true }, bob);
    expect(out.promotion).toMatchObject({ kind: "created", eventId: "ev-new" });
    expect(mockAudit.record.mock.calls[0]![0]).toMatchObject({ action: "event.promoted" });
  });
});

describe("the queue", () => {
  /* Rows the fake holds and filters as the query asks: by who decided, by the footage, in
     the order and up to the number asked for. The queue used to do all of that in memory,
     after reading every undecided row there was. */
  type Row = { id: string; decidedBy: string; createdAt: Date; videoAssetId?: string; track?: { localTrackId: number; videoAssetId: string } } & Record<string, unknown>;
  type Where = { decidedBy?: { not: string }; videoAssetId?: string; track?: { videoAssetId?: string }; supersededBy?: null; reviewState?: string };
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 3, 8, minute));
  const event = (id: string, decidedBy: string, minute: number, asset = ASSET): Row => ({ id, videoAssetId: asset, type: "shot", startMs: 100_000, endMs: 100_000, actorTrackId: null, decidedBy, createdAt: at(minute) });
  const identity = (id: string, decidedBy: string, minute: number, asset = ASSET): Row => ({ id, trackId: TRACK, matchSquadPlayerId: SLOT, validFromMs: 40_000, validToMs: 90_000, decidedBy, createdAt: at(minute), track: { localTrackId: 4, videoAssetId: asset } });
  const holding = (rows: Row[]) => {
    const matching = (where: Where) =>
      rows.filter((r) => (!where.decidedBy || r.decidedBy !== where.decidedBy.not) && (!where.videoAssetId || r.videoAssetId === where.videoAssetId) && (!where.track?.videoAssetId || r.track?.videoAssetId === where.track.videoAssetId));
    return {
      findMany: async ({ where, take }: { where: Where; take?: number }) => matching(where).sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime() || x.id.localeCompare(y.id)).slice(0, take),
      count: async ({ where }: { where: Where }) => matching(where).length,
    };
  };
  const hold = (events: Row[], identities: Row[]) => {
    const e = holding(events);
    const i = holding(identities);
    mockPrisma.visionEventCandidate.findMany.mockImplementation(e.findMany as never);
    mockPrisma.visionEventCandidate.count.mockImplementation(e.count as never);
    mockPrisma.visionIdentityAssignment.findMany.mockImplementation(i.findMany as never);
    mockPrisma.visionIdentityAssignment.count.mockImplementation(i.count as never);
  };
  beforeEach(() => {
    mockPrisma.visionVideoAsset.findMany.mockResolvedValue([{ id: ASSET, sbMatchId: MATCH, sourceVideoRecord: { title: "Derby" }, sbMatch: { homeTeam: { name: "Home" }, awayTeam: { name: "Away" } } }]);
    mockPrisma.sbMatchSquadPlayer.findMany.mockResolvedValue([{ id: SLOT, playerName: "Nine", jerseyNumber: 9 }]);
    mockClock.currentAnchorsFor.mockImplementation(async (ids: string[]) => new Map(ids.map((id) => [id, id === ASSET ? [{ half: 1, sourceMs: 9000, endMs: null }] : []])));
  });

  it("is a person's, lists what is not theirs oldest first, and says the footage, the clock and the slot", async () => {
    await expect(service.queue({}, keyed)).rejects.toMatchObject({ response: { error: "EventNeedsAPerson" } });
    hold([event("ev-a", "alice", 120), event("ev-mine", "bob", 60)], [identity("id-a", "alice", 0)]);
    const out = await service.queue({ assetId: ASSET, limit: 10 }, bob);
    expect(out.me).toBe("bob");
    expect(out.waiting).toEqual({ events: 1, identities: 1 });
    expect(out.items.map((i) => `${i.kind}:${i.id}`)).toEqual(["identity:id-a", "event:ev-a"]);
    expect(out.items[0]).toMatchObject({ localTrackId: 4, sourceMs: 40_000, matchClock: "0:31", slot: { name: "Nine", jerseyNumber: 9 }, asset: { title: "Derby", match: "Home v Away" } });
    expect(out.items[1]).toMatchObject({ type: "shot", sourceMs: 100_000, matchClock: "1:31", slot: null });
    expect(mockPrisma.visionEventCandidate.findMany.mock.calls[0]![0].where).toEqual({ supersededBy: null, reviewState: "unreviewed", decidedBy: { not: "bob" }, videoAssetId: ASSET });
    expect(mockPrisma.visionIdentityAssignment.findMany.mock.calls[0]![0].where).toEqual({ supersededBy: null, reviewState: "unreviewed", decidedBy: { not: "bob" }, track: { videoAssetId: ASSET } });
  });

  it("asks the database for no more than the limit of each kind, and counts the depth instead of reading it", async () => {
    const events = Array.from({ length: 40 }, (_, n) => event(`ev-${String(n).padStart(2, "0")}`, n % 4 === 0 ? "bob" : "alice", 2 * n));
    const identities = Array.from({ length: 30 }, (_, n) => identity(`id-${String(n).padStart(2, "0")}`, "alice", 2 * n + 1));
    hold(events, identities);
    const out = await service.queue({ limit: 5 }, bob);
    expect(mockPrisma.visionEventCandidate.findMany.mock.calls[0]![0].take).toBe(5);
    expect(mockPrisma.visionIdentityAssignment.findMany.mock.calls[0]![0].take).toBe(5);
    // The oldest five of both kinds together, none of them bob's own (ev-00 and ev-04 are).
    expect(out.items.map((i) => i.id)).toEqual(["id-00", "ev-01", "id-01", "ev-02", "id-02"]);
    expect(out.count).toBe(5);
    // How deep the queue is, before the cut: 30 of the 40 events are not bob's.
    expect(out.waiting).toEqual({ events: 30, identities: 30 });
    // With no footage named, the identity query carries no relation filter to join on.
    expect(mockPrisma.visionIdentityAssignment.findMany.mock.calls[0]![0].where).toEqual({ supersededBy: null, reviewState: "unreviewed", decidedBy: { not: "bob" } });
  });

  it("reads the clock of every asset in the page with one question", async () => {
    hold([event("ev-a", "alice", 1, ASSET), event("ev-b", "alice", 2, "asset-2"), event("ev-c", "alice", 3, "asset-3")], []);
    const out = await service.queue({}, bob);
    expect(mockClock.currentAnchorsFor).toHaveBeenCalledTimes(1);
    expect([...mockClock.currentAnchorsFor.mock.calls[0]![0]].sort()).toEqual([ASSET, "asset-2", "asset-3"].sort());
    expect(mockClock.currentAnchors).not.toHaveBeenCalled();
    // Footage with no anchor has no clock to show; it is not an error.
    expect(out.items.map((i) => i.matchClock)).toEqual(["1:31", null, null]);
  });

  it("clamps the limit", async () => {
    hold([], []);
    await service.queue({ limit: 100_000 }, bob);
    expect(mockPrisma.visionEventCandidate.findMany.mock.calls[0]![0].take).toBe(500);
    await service.queue({ limit: 0 }, bob);
    expect(mockPrisma.visionEventCandidate.findMany.mock.calls[1]![0].take).toBe(1);
  });
});
