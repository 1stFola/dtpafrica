import { describe, expect, it } from "vitest";
import type { VisionEventCandidate, VisionReviewTrack } from "../../../api/vision";
import { allowedActions, candidateAt, describeCandidate, proposalAt, slotAt, stepCandidate, stepUncertainty, timelineMarks, uncertainties, windowProblem } from "./event-review";

const cand = (over: Partial<VisionEventCandidate>): VisionEventCandidate => ({
  id: "c", videoAssetId: "a", sbMatchId: "m", type: "shot", taxonomyVersion: "2026.10.0", startMs: 10_000, endMs: 10_000, actorTrackId: "t1", actorPlayerId: null, actorMatchSquadPlayerId: null, sbTeamId: null,
  confidence: 1, method: "manual", cameraSegmentId: null, inPlay: true, reviewState: "unreviewed", decidedBy: "alice", proposedBy: "alice", reviewedBy: null, reviewNote: null, note: null, promotedEventId: null, promotionKind: null, supersededBy: null,
  createdAt: "2026-10-03T00:00:00Z", matchClock: "0:01", scoreboardType: null, promotable: false, evidence: [], ...over,
});

describe("the timeline", () => {
  it("places current candidates on the clip as fractions, with a minimum width, and drops superseded ones", () => {
    const marks = timelineMarks([cand({ id: "a", startMs: 14_000, endMs: 16_000 }), cand({ id: "s", supersededBy: "x" }), cand({ id: "b", startMs: 9000, endMs: 9000 })], 9000, 10_000);
    expect(marks.map((m) => m.candidate.id)).toEqual(["a", "b"]);
    expect(marks[0]).toMatchObject({ left: 0.5, width: 0.2 });
    expect(marks[1]!.left).toBe(0);
    expect(marks[1]!.width).toBe(0.004);
    expect(timelineMarks([cand({})], 0, 0)).toEqual([]);
  });

  it("leaves out a candidate that ended before the clip began, or starts after it ends", () => {
    // A clip cut from the second half: every first-half event was stacked on its first pixel.
    const before = cand({ id: "before", startMs: 1000, endMs: 2000 });
    const across = cand({ id: "across", startMs: 8000, endMs: 10_000 });
    const edge = cand({ id: "edge", startMs: 9000, endMs: 9000 });
    const last = cand({ id: "last", startMs: 19_000, endMs: 19_000 });
    const after = cand({ id: "after", startMs: 19_001, endMs: 25_000 });
    const marks = timelineMarks([before, across, edge, last, after], 9000, 10_000);
    expect(marks.map((m) => m.candidate.id)).toEqual(["across", "edge", "last"]);
    // One that began before the clip and runs into it is drawn from the clip's start.
    expect(marks[0]).toMatchObject({ left: 0, width: 0.1 });
    expect(marks[2]!.left).toBe(1);
  });

  it("finds the candidate under the playhead, nearest start first, and none far away", () => {
    const list = [cand({ id: "early", startMs: 5000, endMs: 5000 }), cand({ id: "long", startMs: 9000, endMs: 12_000 }), cand({ id: "exact", startMs: 10_000, endMs: 10_000 })];
    expect(candidateAt(list, 10_100)?.id).toBe("exact");
    expect(candidateAt(list, 11_500)?.id).toBe("long");
    expect(candidateAt(list, 20_000)).toBeNull();
    expect(candidateAt([cand({ supersededBy: "x" })], 10_000)).toBeNull();
  });

  it("steps to the next and previous candidate by start", () => {
    const list = [cand({ id: "b", startMs: 20_000 }), cand({ id: "a", startMs: 10_000 }), cand({ id: "c", startMs: 30_000 })];
    expect(stepCandidate(list, 10_000, 1)?.id).toBe("b");
    expect(stepCandidate(list, 20_000, -1)?.id).toBe("a");
    expect(stepCandidate(list, 30_000, -1)?.id).toBe("b");
    expect(stepCandidate(list, 30_000, 1)).toBeNull();
    expect(stepCandidate(list, 10_000, -1)).toBeNull();
  });
});

describe("a proposal at the playhead", () => {
  const track = {
    id: "t1", localTrackId: 1, inferenceJobId: "j", artifactKey: "k", class: "player", startMs: 0, endMs: 60_000, team: null, sbTeamId: "home", matchClock: null,
    identities: [
      { id: "i-old", trackId: "t1", playerId: null, matchSquadPlayerId: "slot-old", sbTeamSquadId: null, sbTeamId: "home", confidence: 1, method: "manual", validFromMs: 0, validToMs: 60_000, reviewState: "accepted", decidedBy: "a", reviewedBy: "b", note: null, supersededBy: "i-new", createdAt: "2026-10-01T00:00:00Z" },
      { id: "i-new", trackId: "t1", playerId: null, matchSquadPlayerId: "slot-9", sbTeamSquadId: null, sbTeamId: "home", confidence: 1, method: "manual", validFromMs: 0, validToMs: 30_000, reviewState: "unreviewed", decidedBy: "a", reviewedBy: null, note: null, supersededBy: null, createdAt: "2026-10-02T00:00:00Z" },
      { id: "i-unknown", trackId: "t1", playerId: null, matchSquadPlayerId: null, sbTeamSquadId: null, sbTeamId: "home", confidence: 1, method: "manual", validFromMs: 30_001, validToMs: 60_000, reviewState: "unreviewed", decidedBy: "a", reviewedBy: null, note: null, supersededBy: null, createdAt: "2026-10-02T00:00:00Z" },
    ],
  } as unknown as VisionReviewTrack;

  it("takes the actor from the selected track and the slot it was said to be at that moment", () => {
    expect(slotAt(track, 10_000)).toBe("slot-9");
    expect(slotAt(track, 40_000)).toBeNull();
    expect(slotAt(null, 10_000)).toBeNull();
    expect(proposalAt(track, 10_000)).toEqual({ actorTrackId: "t1", actorMatchSquadPlayerId: "slot-9", sbTeamId: "home" });
    expect(proposalAt(null, 10_000)).toEqual({ actorTrackId: null, actorMatchSquadPlayerId: null, sbTeamId: null });
  });

  it("mirrors the window rule", () => {
    expect(windowProblem(0, 0, 1000)).toBeNull();
    expect(windowProblem(-1, 0, 1000)).toContain("before the footage");
    expect(windowProblem(5, 4, 1000)).toContain("ends before");
    expect(windowProblem(5, 1001, 1000)).toContain("past the footage");
  });
});

describe("words and actions", () => {
  it("describes a candidate in one line", () => {
    expect(describeCandidate(cand({ type: "goal_candidate", matchClock: "12:30" }), () => "#4 Nine")).toBe("goal candidate · 12:30 · #4 Nine · unreviewed");
    expect(describeCandidate(cand({ promotedEventId: "e", promotionKind: "enriched", inPlay: false, matchClock: null }), () => null)).toBe("shot · in the match record (enriched) · not play");
  });

  it("offers only what the service would allow this person", () => {
    const can = { review: true, publish: true };
    expect(allowedActions(cand({}), "alice", can)).toMatchObject({ correct: true, accept: false, reject: false, promote: false, yours: true });
    expect(allowedActions(cand({}), "bob", can)).toMatchObject({ accept: true, reject: true, promote: false, yours: false });
    expect(allowedActions(cand({ reviewState: "accepted", promotable: true }), "bob", can)).toMatchObject({ promote: true, accept: false });
    expect(allowedActions(cand({ reviewState: "accepted", promotable: true, inPlay: false }), "bob", can).promote).toBe(false);
    expect(allowedActions(cand({ promotedEventId: "e" }), "bob", can)).toMatchObject({ correct: false, accept: false, promote: false });
    expect(allowedActions(cand({ supersededBy: "x" }), "bob", can)).toMatchObject({ correct: false, accept: false });
    // Its event left the match record: it can be corrected, which starts review again, and nothing else.
    expect(allowedActions(cand({ reviewState: "accepted", promotable: true, promotionStale: true }), "bob", can)).toMatchObject({ correct: true, accept: false, reject: false, promote: false });
    expect(describeCandidate(cand({ reviewState: "accepted", promotionStale: true, matchClock: null }), () => null)).toBe("shot · left the match record");
    expect(allowedActions(cand({ reviewState: "accepted", promotable: true }), "bob", { review: true, publish: false }).promote).toBe(false);
  });

  it("does not offer Accept to the person who proposed it, even after someone else's correction", () => {
    const can = { review: true, publish: true };
    // alice proposed; bob corrected, so the latest row is bob's.
    const corrected = cand({ decidedBy: "bob", proposedBy: "alice" });
    expect(allowedActions(corrected, "alice", can)).toMatchObject({ accept: false, reject: true, correct: true, yours: false, proposedByYou: true });
    expect(allowedActions(corrected, "bob", can)).toMatchObject({ accept: false, reject: false, yours: true, proposedByYou: false });
    expect(allowedActions(corrected, "carol", can)).toMatchObject({ accept: true, reject: true, yours: false, proposedByYou: false });
    // A row from before the column: its author is the only proposer known.
    expect(allowedActions(cand({ decidedBy: "bob", proposedBy: null }), "alice", can)).toMatchObject({ accept: true, proposedByYou: false });
    expect(allowedActions(cand({ decidedBy: "alice", proposedBy: null }), "alice", can)).toMatchObject({ accept: false, yours: true });
  });
});

describe("the uncertainty walk", () => {
  const track = {
    id: "t1", localTrackId: 1, inferenceJobId: "j", artifactKey: "k", class: "player", startMs: 0, endMs: 60_000, team: null, sbTeamId: "home", matchClock: null,
    identities: [
      { id: "i-theirs", trackId: "t1", playerId: null, matchSquadPlayerId: "slot-9", sbTeamSquadId: null, sbTeamId: "home", confidence: 1, method: "manual", validFromMs: 20_000, validToMs: 30_000, reviewState: "unreviewed", decidedBy: "alice", reviewedBy: null, note: null, supersededBy: null, createdAt: "2026-10-02T00:00:00Z" },
      { id: "i-mine", trackId: "t1", playerId: null, matchSquadPlayerId: "slot-9", sbTeamSquadId: null, sbTeamId: "home", confidence: 1, method: "manual", validFromMs: 2000, validToMs: 3000, reviewState: "unreviewed", decidedBy: "bob", reviewedBy: null, note: null, supersededBy: null, createdAt: "2026-10-02T00:00:00Z" },
      { id: "i-old", trackId: "t1", playerId: null, matchSquadPlayerId: "slot-9", sbTeamSquadId: null, sbTeamId: "home", confidence: 1, method: "manual", validFromMs: 4000, validToMs: 5000, reviewState: "unreviewed", decidedBy: "alice", reviewedBy: null, note: null, supersededBy: "x", createdAt: "2026-10-01T00:00:00Z" },
      { id: "i-done", trackId: "t1", playerId: null, matchSquadPlayerId: "slot-9", sbTeamSquadId: null, sbTeamId: "home", confidence: 1, method: "manual", validFromMs: 6000, validToMs: 7000, reviewState: "accepted", decidedBy: "alice", reviewedBy: "bob", note: null, supersededBy: null, createdAt: "2026-10-01T00:00:00Z" },
    ],
  } as unknown as VisionReviewTrack;

  it("lists what is not mine, current and undecided, by source time", () => {
    const list = uncertainties(
      [cand({ id: "e-late", startMs: 50_000 }), cand({ id: "e-mine", startMs: 1000, decidedBy: "bob" }), cand({ id: "e-gone", startMs: 1500, supersededBy: "x" }), cand({ id: "e-decided", startMs: 1600, reviewState: "rejected" }), cand({ id: "e-early", startMs: 10_000 })],
      [track],
      "bob"
    );
    expect(list.map((i) => `${i.kind}:${i.id}@${i.sourceMs}`)).toEqual(["event:e-early@10000", "identity:i-theirs@20000", "event:e-late@50000"]);
    expect(list[1]!.trackId).toBe("t1");
  });

  it("steps to the next and the previous, and stops at the ends", () => {
    const list = uncertainties([cand({ id: "e-early", startMs: 10_000 }), cand({ id: "e-late", startMs: 50_000 })], [track], "bob");
    expect(stepUncertainty(list, 0, 1)?.id).toBe("e-early");
    expect(stepUncertainty(list, 10_000, 1)?.id).toBe("i-theirs");
    expect(stepUncertainty(list, 20_000, -1)?.id).toBe("e-early");
    expect(stepUncertainty(list, 50_000, -1)?.id).toBe("i-theirs");
    expect(stepUncertainty(list, 50_000, 1)).toBeNull();
    expect(stepUncertainty(list, 10_000, -1)).toBeNull();
  });
});
