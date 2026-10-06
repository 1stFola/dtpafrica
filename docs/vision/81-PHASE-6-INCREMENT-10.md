# Phase 6 Increment 10 — unreviewed possession candidates

Implemented on 5 October 2026. This follows the ball trajectory processor in
[80](./80-PHASE-6-INCREMENT-9.md). The full Phase 6 gate remains open.

## Behavior

The new `possession` CPU stage joins ball and player observations on the exact
source frame. A confirmed player or goalkeeper track is eligible only when the
raw observed ball point is near its box foot point and both observations meet
the configured confidence threshold. Distance is measured in image pixels,
relative to that player's box height. It is not distance in metres.

The same track must remain uniquely eligible for 200 ms by default before it
becomes a candidate. Earlier frames stay Unknown; nothing is backfilled. Missing
ball/player observations, weak evidence, contested proximity, non-play footage
and camera changes break continuity. A nearby weak competing track still causes
ambiguity; the nearest track never wins a contested picture. Referees and ball
tracks cannot be possessors. Smoothed ball coordinates cannot create contact:
the proximity check uses the retained raw observation.

Output segments cover the complete half-open original-source window, including
explicit Unknown intervals. They split on camera, trajectory, track, state and
reason changes and at chunk boundaries. Proxy padding is excluded. Candidate
IDs are local to the pinned tracking run; no roster, named player or team is
inferred. Each segment is `unreviewed`. Its `evidenceConfidence` is the minimum
contributing detector confidence, not a probability that possession is correct.

This is a provisional image-proximity candidate producer. It does not establish
football control of the ball, handle airborne contact reliably, or replace human
review and real-footage evaluation. Coverage counts candidate frames, not accuracy.

## Inputs and integrity

Contract `1.14.0` adds `possession`, with prerequisites `ball_trajectory` and
`track`. It routes to `cpu_small`; GPU overrides are refused. It loads no new
model or video bytes. Existing job authorization, source analysis rights and
budget controls apply. Older workers retain their existing stages; workers older
than 1.14.0 cannot claim possession.

The API selects succeeded runs on the same asset, optionally using `ballJobId`
and `trackJobId`. It owns the ball index/chunk keys, index checksum, tracking
artifact checksum, detector lineage, original source checksum/duration, proxy
clock/checksum, geometry and current camera snapshot. Caller-provided object keys
and provenance cannot replace those inputs. Both producer runs must consume the
same detection file checksum. Sparse tracks, old-attempt objects, changed camera
declarations, mismatched geometry/source/clocks or missing metadata refuse enqueue.
The tracker must have broken at all camera boundaries in the ball snapshot.

Tracking outputs now preserve source/proxy/geometry evidence, the detection file
checksum, track file checksum and `cameraCuts`. The existing `cuts` field remains
a count in tracker statistics; it is distinct from the boundary list. Old tracking
artifacts without this evidence require a compatible new run before possession.

The worker verifies the ball index, every declared ball chunk and the track file
against queued checksums. It validates full source-frame coverage, clocks, live
camera declarations, ball lost-state semantics and player geometry. Player
observations are indexed in a temporary SQLite file for an exact-frame join;
missing positions are never interpolated. Input limits are one million proxy
frames, ten million player observations, 50,000 track IDs and 100 player
observations per frame. Corrupt evidence fails before output upload.

Optional `possessionConfig` fields are `minBallConfidence` and
`minPlayerConfidence` (both default 0.5, allowed 0–1),
`maxFootDistanceHeights` (default 0.25, positive and at most 0.5), and
`minContinuityMs` (default 200, integer 80–2000). These are provisional settings,
not calibrated accuracy thresholds. `chunkMs` defaults to 60,000, allowed
10,000–600,000.

The immutable `possession-candidates/v1` JSON index and source-time JSONL segment
chunks live under the job's attempt prefix in derived storage. The index pins
input checksums, producer jobs/models, source/proxy, camera snapshot, configuration
and each output chunk checksum. Completion validation checks window coverage,
candidate/Unknown counts, reasons, upstream evidence and the unreviewed state.
It writes no match events, player metrics or accepted possession.

## QA and pilot

- Full worker suite: 421 passed. After adding the camera-cut integration case,
  all 19 possession stage tests passed, including the actual trajectory → track →
  possession producer chain with and without a cut (422 worker tests total).
- Full API suite: 1,650 passed across 104 files. After correcting the camera
  boundary metadata, all 37 enqueue tests passed, including an added boundary
  refusal test (1,651 API tests total).
- Web: 246 passed across 23 files. Contracts: 76 passed across seven files.
- API and web production builds passed. Local Footage shows the new candidate
  stage for the real pilot; its state correctly remains not run. The desktop
  layout was checked and the temporary viewport override restored.

The producer integration test found that tracker statistics overwrote a `cuts`
list with a count. The fix uses a separate `cameraCuts` field, and both sides of
the producer/enqueue contract were retested. All worker checks use synthetic
detections, not real detector inference or real possession accuracy evaluation.

No paid compute was launched; pilot spend remains $0 against the $4 ceiling.
The independent Jagaban Cup reference remains 0/2 submissions, unfrozen and
unscored. The two existing user-authored manual event candidates were not changed.
No accounts or permissions were created or expanded.

## Remaining work

Possession segment review/persistence in `VisionPossessionSegment`, calibrated
football constraints, named actor attribution, and the event inference producer
remain outstanding. This increment stores candidate segments as derived artifacts;
it does not claim the planned Postgres review ledger is implemented.
The next increment is the possession review ledger and reviewer view, preserving
immutable run evidence and Unknown intervals.

Production ball detector licensing and representative real-footage evaluation,
both independent human gold submissions and the full event/actor accuracy gate
remain required for Phase 6 completion. Commit and push stay deferred until that
gate is complete, as requested.
