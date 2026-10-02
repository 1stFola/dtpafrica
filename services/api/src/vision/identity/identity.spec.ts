import { ConflictException, ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminAuthContext } from "../../admin/auth/admin-auth.types";
import { InMemoryObjectStore } from "../storage/in-memory-object-store";
import { VisionIdentityService } from "./identity.service";

/**
 * Identity: a roster, a window, a person, and a second person.
 *
 * Every refusal here is a way a minor could otherwise be named wrongly, or by a
 * machine, or by one person alone.
 */

const ASSET = "aaaa1111-2222-4333-8444-555566667777";
const MATCH = "bbbb1111-2222-4333-8444-555566667777";
const HOME = "cccc1111-2222-4333-8444-555566660001";
const AWAY = "cccc1111-2222-4333-8444-555566660002";
const JOB = "dddd1111-2222-4333-8444-555566667777";
const TRACK = "eeee1111-2222-4333-8444-555566660001";
const OTHER = "eeee1111-2222-4333-8444-555566660002";
const SLOT_HOME = "ffff1111-2222-4333-8444-555566660001";
const SLOT_AWAY = "ffff1111-2222-4333-8444-555566660002";
const PLAYER = "99991111-2222-4333-8444-555566660001";

const mockPrisma = {
  visionJob: { findUnique: vi.fn() },
  visionVideoAsset: { findUnique: vi.fn() },
  sbMatch: { findUnique: vi.fn() },
  sbMatchSquadPlayer: { findMany: vi.fn(), findUnique: vi.fn() },
  visionTeamSide: { upsert: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  visionTeamAssignment: { findFirst: vi.fn(), updateMany: vi.fn() },
  visionTrack: { findUnique: vi.fn(), findMany: vi.fn() },
  visionIdentityAssignment: { create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
};
const mockAudit = { record: vi.fn() };

const reviewer: AdminAuthContext = { method: "jwt", roleSlug: "vision_reviewer", roleName: null, permissions: [], userId: "u-reviewer", email: "r@dtp.test" };
const second: AdminAuthContext = { method: "jwt", roleSlug: "vision_admin", roleName: null, permissions: [], userId: "u-second", email: "s@dtp.test" };
const apiKey: AdminAuthContext = { method: "api_key", roleSlug: null, roleName: null, permissions: [] };

let service: VisionIdentityService;
let created: Record<string, unknown>[];
let store: InMemoryObjectStore;
const config = { playback: { urlTtlSeconds: 600 } };

function track(over: Record<string, unknown> = {}) {
  return { id: TRACK, videoAssetId: ASSET, startMs: 9000, endMs: 19000, class: "player", videoAsset: { sbMatchId: MATCH }, ...over };
}
function slot(over: Record<string, unknown> = {}) {
  return { id: SLOT_HOME, matchId: MATCH, teamId: HOME, squadId: "sq-1", playerId: PLAYER, playerName: "A. Player", ...over };
}
const sideA = (over: Record<string, unknown> = {}) => ({ id: "ta-1", trackId: TRACK, inferenceJobId: JOB, team: "A", confidence: 0.9, method: "kit_cluster", kitDescription: "red", reviewState: "unreviewed", createdAt: new Date(), ...over });

beforeEach(() => {
  vi.clearAllMocks();
  created = [];
  store = new InMemoryObjectStore();
  service = new VisionIdentityService(mockPrisma as never, mockAudit as never, store, config as never);
  mockAudit.record.mockResolvedValue(undefined);
  mockPrisma.sbMatch.findUnique.mockResolvedValue({ id: MATCH, homeTeamId: HOME, awayTeamId: AWAY });
  mockPrisma.visionTrack.findUnique.mockResolvedValue(track());
  mockPrisma.visionTrack.findMany.mockResolvedValue([]);
  mockPrisma.visionTeamAssignment.findFirst.mockResolvedValue(sideA());
  mockPrisma.visionTeamAssignment.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.visionTeamSide.findUnique.mockResolvedValue({ inferenceJobId: JOB, team: "A", sbTeamId: HOME });
  mockPrisma.sbMatchSquadPlayer.findUnique.mockResolvedValue(slot());
  mockPrisma.visionIdentityAssignment.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
    const row = { id: `ia-${created.length + 1}`, supersededBy: null, reviewState: "unreviewed", ...data };
    created.push(row);
    return Promise.resolve(row);
  });
  mockPrisma.visionIdentityAssignment.updateMany.mockResolvedValue({ count: 0 });
  // Both forms: an array of operations, or a callback given the client itself.
  mockPrisma.$transaction.mockImplementation((arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => Promise<unknown>)(mockPrisma) : Promise.all(arg as Promise<unknown>[])
  );
});

describe("which team a side is", () => {
  beforeEach(() => {
    mockPrisma.visionJob.findUnique.mockResolvedValue({ id: JOB, type: "identify", state: "succeeded", videoAsset: { id: ASSET, sbMatchId: MATCH } });
    mockPrisma.visionTeamSide.upsert.mockImplementation(({ create }: { create: Record<string, unknown> }) => Promise.resolve({ ...create }));
  });

  it("is decided by a person, never the operator key", async () => {
    await expect(service.setSides(JOB, { A: HOME, B: AWAY }, apiKey)).rejects.toMatchObject({ response: { error: "IdentityNeedsAPerson" } });
    expect(mockPrisma.visionTeamSide.upsert).not.toHaveBeenCalled();
  });

  it("names the match's two teams, one each", async () => {
    await expect(service.setSides(JOB, { A: HOME, B: HOME }, reviewer)).rejects.toMatchObject({ response: { error: "SidesSame" } });
    await expect(service.setSides(JOB, { A: HOME, B: "someone-else" }, reviewer)).rejects.toMatchObject({ response: { error: "SidesNotTheMatch" } });
    const out = await service.setSides(JOB, { A: AWAY, B: HOME }, reviewer);
    expect(out.sides).toEqual({ A: AWAY, B: HOME });
    expect(mockPrisma.visionTeamSide.upsert).toHaveBeenCalledTimes(2);
    expect(mockPrisma.visionTeamSide.upsert.mock.calls[0]![0].create).toMatchObject({ inferenceJobId: JOB, team: "A", sbTeamId: AWAY, decidedBy: "u-reviewer" });
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "identity.sides.decided", targetId: JOB }), reviewer);
  });

  it("belongs to a succeeded identify job", async () => {
    mockPrisma.visionJob.findUnique.mockResolvedValue({ id: JOB, type: "track", state: "succeeded", videoAsset: { id: ASSET, sbMatchId: MATCH } });
    await expect(service.setSides(JOB, { A: HOME, B: AWAY }, reviewer)).rejects.toMatchObject({ response: { error: "NotAnIdentifyJob" } });
  });
});

describe("who a track could be", () => {
  beforeEach(() => {
    mockPrisma.sbMatchSquadPlayer.findMany.mockResolvedValue([
      { id: SLOT_HOME, playerId: PLAYER, playerName: "A. Player", jerseyNumber: 7, position: "FW", isStarter: true, teamId: HOME, squadId: "sq-1" },
    ]);
  });

  it("is the side's match squad when the side is decided", async () => {
    const out = await service.candidates(TRACK);
    expect(out.narrowedBy).toBe("side");
    expect(out.sbTeamId).toBe(HOME);
    expect(mockPrisma.sbMatchSquadPlayer.findMany.mock.calls[0]![0].where).toEqual({ matchId: MATCH, teamId: HOME });
    expect(out.candidates[0]).toMatchObject({ matchSquadPlayerId: SLOT_HOME, playerId: PLAYER, jerseyNumber: 7, isStarter: true });
    expect(out.clock).toContain("not anchored");
  });

  it("is the whole match squad on request, for a reviewer about to overrule the kit", async () => {
    const out = await service.candidates(TRACK, true);
    expect(out.narrowedBy).toBe("match");
    expect(out.sbTeamId).toBe(HOME);
    expect(mockPrisma.sbMatchSquadPlayer.findMany.mock.calls[0]![0].where).toEqual({ matchId: MATCH });
  });

  it("is the whole match squad when the kit said nothing, or nobody said which team the side is", async () => {
    mockPrisma.visionTeamAssignment.findFirst.mockResolvedValue(sideA({ team: null }));
    expect((await service.candidates(TRACK)).narrowedBy).toBe("match");
    mockPrisma.visionTeamAssignment.findFirst.mockResolvedValue(sideA());
    mockPrisma.visionTeamSide.findUnique.mockResolvedValue(null);
    const out = await service.candidates(TRACK);
    expect(out.narrowedBy).toBe("match");
    expect(mockPrisma.sbMatchSquadPlayer.findMany.mock.calls.at(-1)![0].where).toEqual({ matchId: MATCH });
  });
});

describe("saying who a track is", () => {
  it("takes a person", async () => {
    await expect(service.assign(TRACK, { matchSquadPlayerId: SLOT_HOME }, apiKey)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.visionIdentityAssignment.create).not.toHaveBeenCalled();
  });

  it("keeps the window inside the track and non-empty", async () => {
    await expect(service.assign(TRACK, { matchSquadPlayerId: SLOT_HOME, validFromMs: 8000 }, reviewer)).rejects.toMatchObject({ response: { error: "WindowOutsideTrack" } });
    await expect(service.assign(TRACK, { matchSquadPlayerId: SLOT_HOME, validToMs: 19001 }, reviewer)).rejects.toMatchObject({ response: { error: "WindowOutsideTrack" } });
    await expect(service.assign(TRACK, { matchSquadPlayerId: SLOT_HOME, validFromMs: 12000, validToMs: 12000 }, reviewer)).rejects.toMatchObject({ response: { error: "WindowEmpty" } });
  });

  it("refuses a slot from another match", async () => {
    mockPrisma.sbMatchSquadPlayer.findUnique.mockResolvedValue(slot({ matchId: "another-match" }));
    await expect(service.assign(TRACK, { matchSquadPlayerId: SLOT_HOME }, reviewer)).rejects.toMatchObject({ response: { error: "NotOnThisMatchSquad" } });
  });

  it("refuses a player from the other side unless the person says the side is wrong, and then marks the side corrected", async () => {
    mockPrisma.sbMatchSquadPlayer.findUnique.mockResolvedValue(slot({ id: SLOT_AWAY, teamId: AWAY }));
    await expect(service.assign(TRACK, { matchSquadPlayerId: SLOT_AWAY }, reviewer)).rejects.toMatchObject({ response: { error: "SideDisagrees" } });
    const out = await service.assign(TRACK, { matchSquadPlayerId: SLOT_AWAY, acceptSideMismatch: true }, reviewer);
    expect(out.sideCorrected).toBe(true);
    expect(mockPrisma.visionTeamAssignment.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["ta-1"] } }, data: { reviewState: "corrected" } });
    expect(out.assignment).toMatchObject({ sbTeamId: AWAY, method: "manual" });
  });

  it("writes the window and supersedes every current assignment it overlaps", async () => {
    const out = await service.assign(TRACK, { matchSquadPlayerId: SLOT_HOME, validFromMs: 12000, validToMs: 15000 }, reviewer);
    expect(out.assignment).toMatchObject({ trackId: TRACK, playerId: PLAYER, matchSquadPlayerId: SLOT_HOME, sbTeamId: HOME, method: "manual", validFromMs: 12000, validToMs: 15000, decidedBy: "u-reviewer", confidence: 1 });
    expect(mockPrisma.visionIdentityAssignment.updateMany).toHaveBeenCalledWith({
      where: { trackId: TRACK, supersededBy: null, id: { not: "ia-1" }, validFromMs: { lt: 15000 }, validToMs: { gt: 12000 } },
      data: { supersededBy: "ia-1" },
    });
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "identity.assigned", targetId: TRACK }), reviewer);
  });

  it("defaults the window to the whole track", async () => {
    const out = await service.assign(TRACK, { matchSquadPlayerId: SLOT_HOME }, reviewer);
    expect([out.assignment.validFromMs, out.assignment.validToMs]).toEqual([9000, 19000]);
  });

  it("records unknown as a null player, and never propagates it", async () => {
    const out = await service.assign(TRACK, { matchSquadPlayerId: null }, reviewer);
    expect(out.assignment).toMatchObject({ playerId: null, matchSquadPlayerId: null, sbTeamId: null, method: "manual" });
    expect(mockPrisma.sbMatchSquadPlayer.findUnique).not.toHaveBeenCalled();
    await expect(service.assign(TRACK, { matchSquadPlayerId: null, propagateTo: [OTHER] }, reviewer)).rejects.toMatchObject({ response: { error: "PropagateUnknownRefused" } });
  });

  it("propagates the same person onto other tracks of the asset over their whole window", async () => {
    mockPrisma.visionTrack.findMany.mockResolvedValue([{ id: OTHER, videoAssetId: ASSET, startMs: 30000, endMs: 40000 }]);
    mockPrisma.visionTeamAssignment.findFirst.mockResolvedValueOnce(sideA()).mockResolvedValueOnce(sideA({ id: "ta-2", trackId: OTHER, team: null }));
    const out = await service.assign(TRACK, { matchSquadPlayerId: SLOT_HOME, propagateTo: [OTHER, OTHER, TRACK] }, reviewer);
    expect(out.propagated).toHaveLength(1);
    expect(out.propagated[0]).toMatchObject({ trackId: OTHER, playerId: PLAYER, method: "propagated", validFromMs: 30000, validToMs: 40000, note: "propagated from ia-1" });
    expect(mockPrisma.visionIdentityAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ trackId: OTHER, validFromMs: { lt: 40000 }, validToMs: { gt: 30000 } }) }));
  });

  it("holds the roster rule on every propagated track too", async () => {
    mockPrisma.visionTrack.findMany.mockResolvedValue([{ id: OTHER, videoAssetId: ASSET, startMs: 30000, endMs: 40000 }]);
    mockPrisma.visionTeamAssignment.findFirst.mockResolvedValueOnce(sideA()).mockResolvedValueOnce(sideA({ id: "ta-2", trackId: OTHER, team: "B" }));
    mockPrisma.visionTeamSide.findUnique.mockResolvedValueOnce({ sbTeamId: HOME }).mockResolvedValueOnce({ sbTeamId: AWAY });
    await expect(service.assign(TRACK, { matchSquadPlayerId: SLOT_HOME, propagateTo: [OTHER] }, reviewer)).rejects.toMatchObject({ response: { error: "SideDisagrees" } });
    expect(mockPrisma.visionIdentityAssignment.create).not.toHaveBeenCalled();
  });

  it("refuses to propagate to a track that does not exist or belongs to another asset", async () => {
    mockPrisma.visionTrack.findMany.mockResolvedValue([{ id: OTHER, videoAssetId: "another-asset", startMs: 0, endMs: 1 }]);
    await expect(service.assign(TRACK, { matchSquadPlayerId: SLOT_HOME, propagateTo: [OTHER, "nope"] }, reviewer)).rejects.toMatchObject({
      response: { error: "PropagateTargetInvalid", missing: ["nope"], foreign: [OTHER] },
    });
  });
});

describe("a second person", () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: "ia-9", trackId: TRACK, decidedBy: "u-reviewer", reviewState: "unreviewed", supersededBy: null, note: null, ...over });

  beforeEach(() => {
    mockPrisma.visionIdentityAssignment.findUnique.mockResolvedValue(row());
    mockPrisma.visionIdentityAssignment.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...row(), ...data }));
  });

  it("accepts; the person who assigned cannot", async () => {
    await expect(service.accept("ia-9", reviewer)).rejects.toMatchObject({ response: { error: "SelfAcceptanceRefused" } });
    await expect(service.accept("ia-9", apiKey)).rejects.toMatchObject({ response: { error: "IdentityNeedsAPerson" } });
    const out = await service.accept("ia-9", second);
    expect(out).toMatchObject({ reviewState: "accepted", reviewedBy: "u-second" });
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "identity.accepted", targetId: "ia-9" }), second);
  });

  it("rejects with a reason kept on the row", async () => {
    const out = await service.reject("ia-9", "back turned, cannot tell", second);
    expect(out).toMatchObject({ reviewState: "rejected", reviewedBy: "u-second", note: "rejected: back turned, cannot tell" });
    expect(mockAudit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "identity.rejected", reason: "back turned, cannot tell" }), second);
  });

  it("reviews only a current assignment", async () => {
    mockPrisma.visionIdentityAssignment.findUnique.mockResolvedValue(row({ supersededBy: "ia-10" }));
    await expect(service.accept("ia-9", second)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("what the public may read", () => {
  beforeEach(() => {
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue({
      id: ASSET,
      sbMatchId: MATCH,
      sbMatch: { id: MATCH, homeTeam: { id: HOME, name: "Home FC" }, awayTeam: { id: AWAY, name: "Away FC" } },
      variants: [{ fps: 25, sourceOffsetMs: 5000, durationMs: 5000, width: 1280, height: 720 }],
    });
    mockPrisma.visionTeamSide.findMany.mockResolvedValue([{ inferenceJobId: JOB, team: "A", sbTeamId: HOME }]);
  });

  it("names the match's teams and the proxy clock beside the tracks, for the screen", async () => {
    mockPrisma.visionTrack.findMany.mockResolvedValue([]);
    const out = await service.forAsset(ASSET, false);
    expect(out.match).toEqual({ id: MATCH, homeTeam: { id: HOME, name: "Home FC" }, awayTeam: { id: AWAY, name: "Away FC" } });
    expect(out.proxy).toMatchObject({ fps: 25, sourceOffsetMs: 5000, width: 1280 });
  });

  it("is only an accepted, named, current assignment; tracks with none are not listed", async () => {
    mockPrisma.visionTrack.findMany.mockResolvedValue([
      { id: TRACK, localTrackId: 1, class: "player", startMs: 9000, endMs: 19000, teamAssignments: [sideA()], identities: [{ id: "ia-1", playerId: PLAYER, matchSquadPlayerId: SLOT_HOME, reviewState: "accepted" }] },
      { id: OTHER, localTrackId: 2, class: "player", startMs: 9000, endMs: 19000, teamAssignments: [], identities: [] },
    ]);
    mockPrisma.sbMatchSquadPlayer.findMany.mockResolvedValue([{ id: SLOT_HOME, playerName: "A. Player", jerseyNumber: 7 }]);
    const out = await service.forAsset(ASSET, true);
    expect(out.tracks[0]!.identities[0]).toMatchObject({ id: "ia-1", slot: { name: "A. Player", jerseyNumber: 7 } });
    const where = mockPrisma.visionTrack.findMany.mock.calls[0]![0].include.identities.where;
    expect(where).toEqual({ supersededBy: null, reviewState: "accepted", playerId: { not: null } });
    expect(out.count).toBe(1);
    expect(out.tracks[0]).toMatchObject({ id: TRACK, sbTeamId: HOME, team: { team: "A", kitDescription: "red" } });
  });

  it("shows a reviewer every current assignment and every track", async () => {
    mockPrisma.visionTrack.findMany.mockResolvedValue([
      { id: OTHER, localTrackId: 2, class: "player", startMs: 9000, endMs: 19000, teamAssignments: [], identities: [] },
    ]);
    const out = await service.forAsset(ASSET, false);
    expect(mockPrisma.visionTrack.findMany.mock.calls[0]![0].include.identities.where).toEqual({ supersededBy: null });
    expect(out.count).toBe(1);
    expect(out.tracks[0]).toMatchObject({ team: null, sbTeamId: null });
  });
});

describe("what the screen plays and draws", () => {
  it("presigns the proxy, never the master, with the playback TTL", async () => {
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue({
      id: ASSET,
      variants: [{ objectKey: "proxies/x/proxy.mp4", fps: 25, sourceOffsetMs: 5000, durationMs: 5000, width: 1280, height: 720 }],
    });
    const out = await service.media(ASSET);
    expect(out.url).toContain("proxies/x/proxy.mp4");
    expect(out).toMatchObject({ fps: 25, sourceOffsetMs: 5000, width: 1280, expiresInSeconds: 600 });
    expect(mockPrisma.visionVideoAsset.findUnique.mock.calls[0]![0].select.variants.where).toEqual({ kind: "proxy" });
  });

  it("refuses an asset with no proxy rather than offering the master", async () => {
    mockPrisma.visionVideoAsset.findUnique.mockResolvedValue({ id: ASSET, variants: [] });
    await expect(service.media(ASSET)).rejects.toMatchObject({ response: { error: "ProxyMissing" } });
  });

  it("reads one track's positions out of the artifact, through the control plane", async () => {
    mockPrisma.visionTrack.findUnique.mockResolvedValue({ id: TRACK, artifactKey: "inference/j/1/tracks.json", localTrackId: 3 });
    await store.putSmallObject("derived", "inference/j/1/tracks.json", JSON.stringify({
      trackerVersionId: "trk", tracks: [
        { localTrackId: 1, positions: [{ frameIndex: 0 }] },
        { localTrackId: 3, positions: [{ frameIndex: 0, box: { x: 1, y: 2, width: 3, height: 4 } }, { frameIndex: 1 }] },
      ],
    }), "application/json");
    const out = await service.positions(TRACK);
    expect(out).toMatchObject({ trackId: TRACK, localTrackId: 3, key: "inference/j/1/tracks.json", trackerVersionId: "trk" });
    expect(out.positions).toHaveLength(2);
    expect(out.positions[0]).toEqual({ frameIndex: 0, box: { x: 1, y: 2, width: 3, height: 4 } });
    // A track the artifact never reported has no positions, not an error.
    mockPrisma.visionTrack.findUnique.mockResolvedValue({ id: TRACK, artifactKey: "inference/j/1/tracks.json", localTrackId: 9 });
    expect((await service.positions(TRACK)).positions).toEqual([]);
  });

  it("refuses a missing artifact by name rather than returning nothing", async () => {
    mockPrisma.visionTrack.findUnique.mockResolvedValue({ id: TRACK, artifactKey: "inference/gone/1/tracks.json", localTrackId: 3 });
    await expect(service.positions(TRACK)).rejects.toMatchObject({ response: { error: "ArtifactMissing" } });
  });
});
