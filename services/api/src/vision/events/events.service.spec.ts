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
  sbMatch: { findUnique: vi.fn() },
  visionCameraSegment: { findFirst: vi.fn() },
  visionIdentityAssignment: { findFirst: vi.fn(), findMany: vi.fn() },
  visionClockAnchor: { findFirst: vi.fn() },
  visionEventCandidate: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  visionEvidenceLink: { createMany: vi.fn() },
  sbMatchEvent: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
};
const mockAudit = { record: vi.fn() };
const mockRights = { canPublishHighlight: vi.fn() };
const mockClock = { currentAnchors: vi.fn() };

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
    promotedEventId: null, promotionKind: null, promotedBy: null, promotedAt: null, supersededBy: null, createdAt: new Date(), evidence: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  service = new VisionEventsService(mockPrisma as never, mockAudit as never, mockRights as never, mockClock as never);
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma));
  mockPrisma.visionVideoAsset.findUnique.mockResolvedValue({ id: ASSET, durationMs: 6_000_000, sbMatchId: MATCH });
  mockPrisma.visionTrack.findUnique.mockResolvedValue({ id: TRACK, videoAssetId: ASSET });
  mockPrisma.sbMatchSquadPlayer.findUnique.mockResolvedValue({ id: SLOT, matchId: MATCH, teamId: HOME, playerId: "p9", playerName: "Nine" });
  mockPrisma.sbMatch.findUnique.mockResolvedValue({ homeTeamId: HOME, awayTeamId: AWAY });
  mockPrisma.visionCameraSegment.findFirst.mockResolvedValue({ id: "seg-1", kind: "wide", calibrations: [{ id: "cal-1" }] });
  mockPrisma.visionIdentityAssignment.findFirst.mockResolvedValue({ id: "ident-1" });
  mockPrisma.visionClockAnchor.findFirst.mockResolvedValue({ id: "anchor-1" });
  mockClock.currentAnchors.mockResolvedValue([{ half: 1, sourceMs: 9000, endMs: null }]);
  mockPrisma.visionEventCandidate.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    stored = { id: "cand-1", ...data, evidence: [] };
    return stored;
  });
  mockPrisma.visionEventCandidate.findUnique.mockImplementation(async () => stored ?? null);
  mockPrisma.visionEventCandidate.update.mockResolvedValue({});
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
    const links = mockPrisma.visionEvidenceLink.createMany.mock.calls[0]![0].data as { kind: string; targetId: string }[];
    expect(links.some((l) => l.kind === "detection_frame" && l.targetId === "frame-1")).toBe(true);
    expect(mockPrisma.visionEventCandidate.update).toHaveBeenCalledWith({ where: { id: "cand-1" }, data: { supersededBy: "cand-1" } });
    expect(out.supersedes).toBe("cand-1");

    stored = candidate({ promotedEventId: "ev-9" });
    await expect(service.correct("cand-1", { note: "late" }, bob)).rejects.toMatchObject({ response: { error: "EventPromoted" } });
    stored = candidate({ supersededBy: "cand-2" });
    await expect(service.correct("cand-1", { note: "late" }, bob)).rejects.toMatchObject({ response: { error: "EventSuperseded" } });
  });

  it("is accepted by a second person and rejected with a reason", async () => {
    stored = candidate({ reviewState: "unreviewed", reviewedBy: null });
    await expect(service.decide("cand-1", "accepted", undefined, alice)).rejects.toMatchObject({ response: { error: "SelfAcceptanceRefused" } });
    await expect(service.decide("cand-1", "rejected", "", bob)).rejects.toMatchObject({ response: { error: "ReasonRequired" } });
    await service.decide("cand-1", "accepted", undefined, bob);
    expect(mockPrisma.visionEventCandidate.update).toHaveBeenCalledWith({ where: { id: "cand-1" }, data: { reviewState: "accepted", reviewedBy: "bob", reviewNote: null } });
    await service.decide("cand-1", "rejected", "a replay", bob);
    expect(mockAudit.record.mock.calls[1]![0]).toMatchObject({ action: "event.rejected", reason: "a replay" });
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
  });

  it("enriches the recorder's goal at the same minute rather than adding a second", async () => {
    stored = candidate();
    mockPrisma.sbMatchEvent.findMany.mockResolvedValue([{ id: "ev-23", type: "goal", minute: 1, teamId: HOME, playerId: null }]);
    mockPrisma.sbMatchEvent.findUnique.mockResolvedValue({ id: "ev-23", metadata: { playerNumber: 9 } });
    const out = await service.promote("cand-1", {}, bob);
    expect(out.promotion).toEqual({ kind: "enriched", eventId: "ev-23", minute: 1, second: 31, minutesApart: 0 });
    const update = mockPrisma.sbMatchEvent.update.mock.calls[0]![0];
    expect(update.where).toEqual({ id: "ev-23" });
    expect(update.data.metadata).toMatchObject({ playerNumber: 9, vision: { contract: "VisionEventPromotionV1", candidateId: "cand-1", type: "goal_candidate", startMs: 100_000 } });
    expect(update.data.secondInMinute).toBe(31);
    expect(mockPrisma.visionEventCandidate.update).toHaveBeenCalledWith({ where: { id: "cand-1" }, data: expect.objectContaining({ promotedEventId: "ev-23", promotionKind: "enriched", promotedBy: "bob" }) });
    expect(mockPrisma.sbMatchEvent.create).not.toHaveBeenCalled();
  });

  it("writes the second beside the recorder's minute only when the minutes agree and the recorder gave none", async () => {
    stored = candidate();
    mockPrisma.sbMatchEvent.findMany.mockResolvedValue([{ id: "ev-next", type: "goal", minute: 2, teamId: HOME, playerId: null }]);
    mockPrisma.sbMatchEvent.findUnique.mockResolvedValue({ id: "ev-next", metadata: null, secondInMinute: null });
    let out = await service.promote("cand-1", {}, bob);
    expect(out.promotion).toMatchObject({ kind: "enriched", minute: 2, second: null, minutesApart: 1 });
    expect(mockPrisma.sbMatchEvent.update.mock.calls[0]![0].data).not.toHaveProperty("secondInMinute");

    stored = candidate();
    mockPrisma.sbMatchEvent.findMany.mockResolvedValue([{ id: "ev-same", type: "goal", minute: 1, teamId: HOME, playerId: null }]);
    mockPrisma.sbMatchEvent.findUnique.mockResolvedValue({ id: "ev-same", metadata: null, secondInMinute: 7 });
    out = await service.promote("cand-1", {}, bob);
    expect(out.promotion).toMatchObject({ kind: "enriched", minute: 1, second: 7, minutesApart: 0 });
    expect(mockPrisma.sbMatchEvent.update.mock.calls[1]![0].data).not.toHaveProperty("secondInMinute");
  });

  it("creates a recorder event only on instruction, with the team known, and refuses an ambiguous match", async () => {
    stored = candidate();
    mockPrisma.sbMatchEvent.findMany.mockResolvedValue([{ id: "ev-far", type: "goal", minute: 30, teamId: HOME, playerId: null }]);
    await expect(service.promote("cand-1", {}, bob)).rejects.toMatchObject({ response: { error: "NoMatchingEvent", nearest: { id: "ev-far" } } });
    stored = candidate({ sbTeamId: null, actorMatchSquadPlayerId: null, actorPlayerId: null });
    await expect(service.promote("cand-1", { create: true }, bob)).rejects.toMatchObject({ response: { error: "TeamUnknown" } });
    stored = candidate();
    mockPrisma.sbMatchEvent.create.mockResolvedValue({ id: "ev-new" });
    const out = await service.promote("cand-1", { create: true }, bob);
    expect(out.promotion).toEqual({ kind: "created", eventId: "ev-new", minute: 1, second: 31, minutesApart: 0 });
    expect(mockPrisma.sbMatchEvent.create.mock.calls[0]![0].data).toMatchObject({ matchId: MATCH, teamId: HOME, playerId: "p9", playerLabel: "Nine", type: "goal", minute: 1, secondInMinute: 31, metadata: { vision: { candidateId: "cand-1" } } });

    stored = candidate();
    mockPrisma.sbMatchEvent.findMany.mockResolvedValue([{ id: "a", type: "goal", minute: 0, teamId: HOME, playerId: null }, { id: "b", type: "goal", minute: 2, teamId: HOME, playerId: null }]);
    await expect(service.promote("cand-1", { create: true }, bob)).rejects.toMatchObject({ response: { error: "AmbiguousRecorderEvent" } });
  });
});

describe("the queue", () => {
  it("is a person's, lists what is not theirs oldest first, and says the footage, the clock and the slot", async () => {
    await expect(service.queue({}, keyed)).rejects.toMatchObject({ response: { error: "EventNeedsAPerson" } });
    mockPrisma.visionEventCandidate.findMany.mockResolvedValue([
      { id: "ev-a", videoAssetId: ASSET, type: "shot", startMs: 100_000, endMs: 100_000, actorTrackId: TRACK, decidedBy: "alice", createdAt: new Date("2026-10-03T10:00:00Z") },
      { id: "ev-mine", videoAssetId: ASSET, type: "shot", startMs: 100_000, endMs: 100_000, actorTrackId: null, decidedBy: "bob", createdAt: new Date("2026-10-03T09:00:00Z") },
    ]);
    mockPrisma.visionIdentityAssignment.findMany.mockResolvedValue([
      { id: "id-a", trackId: TRACK, matchSquadPlayerId: SLOT, validFromMs: 40_000, validToMs: 90_000, decidedBy: "alice", createdAt: new Date("2026-10-03T08:00:00Z"), track: { localTrackId: 4, videoAssetId: ASSET } },
    ]);
    mockPrisma.visionVideoAsset.findMany.mockResolvedValue([{ id: ASSET, sbMatchId: MATCH, sourceVideoRecord: { title: "Derby" }, sbMatch: { homeTeam: { name: "Home" }, awayTeam: { name: "Away" } } }]);
    mockPrisma.sbMatchSquadPlayer.findMany.mockResolvedValue([{ id: SLOT, playerName: "Nine", jerseyNumber: 9 }]);
    const out = await service.queue({ assetId: ASSET, limit: 10 }, bob);
    expect(out.me).toBe("bob");
    expect(out.waiting).toEqual({ events: 1, identities: 1 });
    expect(out.items.map((i) => `${i.kind}:${i.id}`)).toEqual(["identity:id-a", "event:ev-a"]);
    expect(out.items[0]).toMatchObject({ localTrackId: 4, sourceMs: 40_000, matchClock: "0:31", slot: { name: "Nine", jerseyNumber: 9 }, asset: { title: "Derby", match: "Home v Away" } });
    expect(out.items[1]).toMatchObject({ type: "shot", sourceMs: 100_000, matchClock: "1:31", slot: null });
    expect(mockPrisma.visionEventCandidate.findMany.mock.calls[0]![0].where).toEqual({ supersededBy: null, reviewState: "unreviewed", videoAssetId: ASSET });
    expect(mockPrisma.visionIdentityAssignment.findMany.mock.calls[0]![0].where).toEqual({ supersededBy: null, reviewState: "unreviewed", track: { videoAssetId: ASSET } });
  });
});
