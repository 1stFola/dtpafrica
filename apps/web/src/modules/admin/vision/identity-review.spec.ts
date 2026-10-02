import { describe, expect, it } from "vitest";
import type { VisionIdentityAssignment, VisionReviewTrack, VisionRosterCandidate } from "../../../api/vision";
import {
  candidateLabel,
  describeAssignment,
  filterCandidates,
  identifyJobOf,
  identitySummary,
  isPublic,
  mayAccept,
  positionAt,
  sideLabel,
  sortPositions,
  splitAt,
  toPercentBox,
  windowProblem,
} from "./identity-review";

const pos = (frameIndex: number, x = 100) => ({ frameIndex, proxyTimeMs: frameIndex * 40, sourceTimeMs: frameIndex * 40 + 5000, box: { x, y: 50, width: 40, height: 80 } });

describe("where a track is on the frame", () => {
  it("puts positions in frame order whatever order the artifact wrote them", () => {
    expect(sortPositions([pos(5), pos(3)]).map((p) => p.frameIndex)).toEqual([3, 5]);
  });

  it("is the position on exactly that frame, and nothing in a gap", () => {
    const positions = [pos(0), pos(1), pos(5)];
    expect(positionAt(positions, 40, 25)?.frameIndex).toBe(1);
    expect(positionAt(positions, 120, 25)).toBeNull(); // frame 3: hidden, not interpolated
    expect(positionAt(positions, 200, 25)?.frameIndex).toBe(5);
  });

  it("falls back to the nearest position within 50ms when the proxy has no rate", () => {
    const positions = [pos(0), pos(1)];
    expect(positionAt(positions, 55, null)?.frameIndex).toBe(1);
    expect(positionAt(positions, 300, null)).toBeNull();
  });

  it("draws a box as a fraction of the picture, clamped to it", () => {
    expect(toPercentBox({ x: 320, y: 180, width: 640, height: 360 }, 1280, 720)).toEqual({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
    expect(toPercentBox({ x: 1200, y: 700, width: 200, height: 100 }, 1280, 720)).toEqual({ x: 0.9375, y: 700 / 720, width: 0.0625, height: 1 - 700 / 720 });
    expect(toPercentBox({ x: 0, y: 0, width: 1, height: 1 }, null, 720)).toBeNull();
  });
});

describe("what window an action covers", () => {
  const track = { startMs: 9000, endMs: 19000 };

  it("mirrors the API's rules before the round trip", () => {
    expect(windowProblem(track, { from: 9000, to: 19000 })).toBeNull();
    expect(windowProblem(track, { from: 8000, to: 19000 })).toContain("inside the track");
    expect(windowProblem(track, { from: 9000, to: 19001 })).toContain("inside the track");
    expect(windowProblem(track, { from: 12000, to: 12000 })).toBe("The window is empty.");
    expect(windowProblem(track, { from: 12000.5, to: 13000 })).toContain("whole milliseconds");
  });

  it("splits at the playhead into two adjoining windows, and refuses the ends", () => {
    expect(splitAt(track, 14000.4)).toEqual({ before: { from: 9000, to: 14000 }, after: { from: 14000, to: 19000 } });
    expect(splitAt(track, 9000)).toBeNull();
    expect(splitAt(track, 19000)).toBeNull();
    expect(splitAt(track, 20000)).toBeNull();
  });
});

describe("how things are described", () => {
  const c = (over: Partial<VisionRosterCandidate> = {}): VisionRosterCandidate => ({
    matchSquadPlayerId: "s1", playerId: "p1", name: "Ada Obi", jerseyNumber: 7, position: "FW", isStarter: true, sbTeamId: "home", sbTeamSquadId: null, ...over,
  });

  it("finds a candidate by exact number or by part of a name", () => {
    const cands = [c(), c({ matchSquadPlayerId: "s2", name: "Bola Ade", jerseyNumber: 17, isStarter: false })];
    expect(filterCandidates(cands, "").length).toBe(2);
    expect(filterCandidates(cands, "7").map((x) => x.matchSquadPlayerId)).toEqual(["s1"]);
    expect(filterCandidates(cands, "17").map((x) => x.matchSquadPlayerId)).toEqual(["s2"]);
    expect(filterCandidates(cands, "ad").map((x) => x.matchSquadPlayerId)).toEqual(["s1", "s2"]);
    expect(filterCandidates(cands, "OBI").map((x) => x.matchSquadPlayerId)).toEqual(["s1"]);
  });

  it("labels a candidate with number, name, position and whether they started", () => {
    expect(candidateLabel(c())).toBe("#7 Ada Obi (FW, starter)");
    expect(candidateLabel(c({ jerseyNumber: null, position: null, isStarter: false }))).toBe("— Ada Obi");
  });

  const a = (over: Partial<VisionIdentityAssignment> = {}): VisionIdentityAssignment => ({
    id: "ia-1", trackId: "t1", playerId: "p1", matchSquadPlayerId: "s1", sbTeamId: "home", confidence: 1, method: "manual",
    validFromMs: 9000, validToMs: 14000, reviewState: "unreviewed", decidedBy: "u1", reviewedBy: null, note: null, supersededBy: null, createdAt: "", ...over,
  });
  const nameOf = (id: string) => ({ s1: "Ada Obi" } as Record<string, string>)[id];

  it("describes an assignment by who, when, how and its state", () => {
    expect(describeAssignment(a(), nameOf)).toBe("Ada Obi 9.0s–14.0s · unreviewed");
    expect(describeAssignment(a({ method: "propagated", reviewState: "accepted" }), nameOf)).toBe("Ada Obi 9.0s–14.0s · merged · accepted");
    expect(describeAssignment(a({ matchSquadPlayerId: null, playerId: null }), nameOf)).toBe("unknown 9.0s–14.0s · unreviewed");
  });

  it("public is accepted, named and current; nothing else", () => {
    expect(isPublic(a({ reviewState: "accepted" }))).toBe(true);
    expect(isPublic(a())).toBe(false);
    expect(isPublic(a({ reviewState: "accepted", playerId: null }))).toBe(false);
    expect(isPublic(a({ reviewState: "accepted", supersededBy: "ia-2" }))).toBe(false);
  });

  it("a second person may accept; the first may not, nor anyone a settled row", () => {
    expect(mayAccept(a(), "u2")).toBe(true);
    expect(mayAccept(a(), "u1")).toBe(false);
    expect(mayAccept(a(), undefined)).toBe(false);
    expect(mayAccept(a({ reviewState: "accepted" }), "u2")).toBe(false);
    expect(mayAccept(a({ supersededBy: "x" }), "u2")).toBe(false);
  });

  const match = { id: "m", homeTeam: { id: "home", name: "Home FC" }, awayTeam: { id: "away", name: "Away FC" } };
  const track = (over: Partial<VisionReviewTrack> = {}): VisionReviewTrack => ({
    id: "t1", localTrackId: 1, inferenceJobId: "job-i", artifactKey: "k", class: "player", startMs: 9000, endMs: 19000,
    team: { team: "A", confidence: 0.9, method: "kit_cluster", kitDescription: "red", reviewState: "unreviewed", inferenceJobId: "job-i" },
    sbTeamId: "home", identities: [], ...over,
  });

  it("labels a track's side with its kit and the team a person said it is", () => {
    expect(sideLabel(track(), match)).toBe("A · red → Home FC");
    expect(sideLabel(track({ sbTeamId: null }), match)).toBe("A · red → ?");
    expect(sideLabel(track({ team: { team: "A", confidence: 0.9, method: "kit_cluster", kitDescription: "red", reviewState: "corrected", inferenceJobId: "job-i" } }), match)).toBe("A · red → Home FC (overruled)");
    expect(sideLabel(track({ team: { team: null, confidence: 0.02, method: "kit_cluster", kitDescription: null, reviewState: "unreviewed", inferenceJobId: "job-i" }, sbTeamId: null }), match)).toBe("no side");
    expect(sideLabel(track({ team: { team: null, confidence: null, method: "not_clustered", kitDescription: null, reviewState: "unreviewed", inferenceJobId: "job-i" }, sbTeamId: null }), match)).toBe("not clustered");
    expect(sideLabel(track({ team: null, sbTeamId: null }), match)).toBe("no side");
  });

  it("summarises who a track is now, from current rows only", () => {
    expect(identitySummary(track(), nameOf)).toBe("nobody has said");
    expect(identitySummary(track({ identities: [a({ supersededBy: "x" }), a({ id: "ia-2", reviewState: "accepted" }), a({ id: "ia-3", matchSquadPlayerId: null, validFromMs: 14000, validToMs: 19000 })] }), nameOf)).toBe("Ada Obi ✓ / unknown");
  });

  it("picks the identify job most tracks were sided by", () => {
    expect(identifyJobOf([track(), track({ team: { team: "B", confidence: 1, method: "kit_cluster", kitDescription: null, reviewState: "unreviewed", inferenceJobId: "job-old" } }), track()])).toBe("job-i");
    expect(identifyJobOf([track({ team: null })])).toBeNull();
  });
});
