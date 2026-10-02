# 32 — Phase 4 Increment 1: tracks, and a gap that stays a gap

> `TrackerAdapter`; benchmark ByteTrack against BoT-SORT on DTP footage. Track
> stitching preserving uncertainty.
> — [11-PHASE-PLAN](./11-PHASE-PLAN.md), Phase 4

A detection is a box on one frame. Everything Phase 4 promises — team, jersey,
identity — hangs off a *track*: the same thing seen frame after frame. This
increment is the track spine: a `track` stage that links a detect artifact's boxes
across frames, one `VisionTrack` row per track for a reviewer to select, and
provenance naming both models a track is the product of.

---

## Two decisions before the first line

**The association is written here, not imported.** ByteTrack and BoT-SORT are
both still *review required* in the [licence register](../licenses/OSS_REGISTER.md),
and the register warns that tracking repositories pull Ultralytics transitively.
The algorithm itself is a page. [`tracking.py`](../../services/vision-worker/dtp_vision_worker/tracking.py)
is a ByteTrack-style two-round association — confident boxes first against every
live track's predicted position, then the weak boxes against whatever is still
unmatched and only where the track already was — with constant-velocity
prediction and greedy best-overlap matching. It is a floor, like the baseline
detector: the benchmark against the two repositories that the phase plan asks for
happens when their licences clear, and the harness to score it against gold
tracks is Increment 2's.

**A tracker is a model version.** It has no weights, but it has parameters, a
commit and an image, and a track that cannot name the tracker that made it cannot
be reproduced or rolled back. So `track` is model-bound like `detect`: dispatched
with exactly one tracker version, resolved from production or named, with the
registry's promotion rules applying unchanged. Every track row carries two ids:
the tracker, and the detector whose boxes it linked.

## What the tracker will not do

- **Interpolate.** A track's positions are observations. When the ball goes behind
  a player for ten frames, the track survives (up to `maxAge` frames) and those ten
  frames are absent from it. Nothing is filled in and presented as seen —
  [00 § Unknown beats wrong](./00-OVERVIEW.md).
- **Cross classes.** A ball track never absorbs a player box, however well it
  overlaps. Association is within class.
- **Write noise.** A track that never reached `minHits` is dropped and counted
  (`detectionsUnlinked`), so a detector that flickers is visible rather than
  producing a thousand one-frame tracks.
- **Link sparse detections.** Spike S0's `detect` samples at 2fps, where a player
  moves too far between frames to link. Below `MIN_TRACK_SAMPLE_FPS` (10) the stage
  refuses — and the control plane refuses first, at enqueue (`DetectionsTooSparse`),
  so no pod spins up to discover it. Run `detect` at the proxy's rate for an asset
  that will be tracked.

Every artifact records the parameters it was linked with, so a tracker version *is*
those numbers.

## What the job is given

A track job has an asset, so it gets the proxy clock like any stage downstream of
`transcode` — the enqueue rule now follows prerequisites transitively, since `track`
follows `detect` follows `transcode`. It also gets the one detect artifact it will
link, chosen by the control plane (the latest succeeded `detect` for the asset, or
the one named in `params.detectJobId`), declared on the job, and readable by
declared key and no other. A caller's own `readKeys` or `detections` are
overwritten, not trusted.

## What a row is

One `VisionTrack` per confirmed track: class, source-time window, frame window,
detection count, both model versions, and the artifact key holding its positions.
Unique on `(job, localTrackId)`, so a retried completion adds nothing. The
positions stay in the artifact: a match is thousands of tracks and millions of
positions, and only the former is something a person selects.

`GET /vision/assets/:id/tracks` lists them, by job or class.

## Verification

```
api tests              1,154 passed   (was 1,144)
  enqueue: track          5
  projection              4
vision-contracts          48 passed
vision-worker            164 passed   (was 140)
  tracking                16
  track stage              9
typecheck               api, web and contracts clean; migration diff empty both ways
vision:trackcheck       41/41 against the real API, Postgres, R2 and the real
                        Python tracker, run twice; no litter
```

The gate's footage is sixty frames at 25fps, by hand: one player walking right
five pixels a frame, one standing still, a ball hidden for ten frames in the
middle, and one box that appears once. The real tracker on the real artifact in
the store finds three tracks (two players, one ball), links 170 of 171 boxes,
drops the lone one, carries the ball across its gap with fifty observations and
none inside it, and ends the walker where he walked to.

Ten mutations, each caught: association ignoring class; no velocity prediction;
a weak box starting a track; tentative tracks written; a track never ageing out;
the stage accepting sparse detections; the stage accepting another detector's
artifact; enqueue accepting sparse detections; the proxy clock no longer following
transitive prerequisites; rows written under a tracker that is not the job's.

## What is not done

| | |
|---|---|
| **Tracking metrics** | HOTA / IDF1 / MOTA and ID switches on gold *tracks*, which the corpus does not have: Increment 2 adds track-level ground truth (linking gold boxes across frames in the workstation) and a `benchmark` that scores tracks, then the ByteTrack / BoT-SORT comparison the plan asks for. |
| **Team, jersey, identity** | Phase 4's remaining increments, each hanging off these rows. |
| **Split / merge review** | The workstation shows boxes, not tracks. Selecting, splitting and merging tracks is the review surface identity needs. |
| **Hungarian assignment** | Greedy best-overlap is deterministic and dependency-free; it is wrong only when two candidates are both good for two tracks. The tracking benchmark will say whether that happens often enough to matter. |
| **Parquet** | Positions are JSON in the artifact, as detections are. |
