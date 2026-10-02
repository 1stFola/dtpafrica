# 33 — Phase 4 Increment 2: gold tracks, and a number for a tracker

> Tracking quality and ID-switch metrics published on the locked benchmark.
> — [10-EVALUATION-AND-GATES](./10-EVALUATION-AND-GATES.md), Phase 4 gate

[32](./32-PHASE-4-INCREMENT-1.md) linked boxes into tracks and said, honestly, that
nothing could measure how well. This increment gives the corpus tracks of its own —
boxes an annotator has linked across frames — and scores a tracker version against
them in the ledger, the same way a detector is scored, with the metrics the phase
gate names.

---

## A box may belong to a track

The annotation payload's box gains a `trackId`: the annotator's own name for the
thing, the same on every frame it appears. Two rules join the one rule from
[29](./29-PHASE-3-INCREMENT-2.md), applied at the door and again at export:

| Refusal | Why |
|---|---|
| `track_class_conflict` | One track id, two classes. A player cannot become the ball. |
| `track_frame_conflict` | One track id twice on one frame. A thing is in one place at a time. |

Both are properties of the list rather than of a box, so they are checked once the
boxes are known, and reported by the index of the box that broke them.

The export carries a linked box as FiftyOne's `index` — numbered per label in
order of first appearance, which is how FiftyOne links boxes across frames — with
the annotator's own id beside it as `track_id`, so the number can be traced back.
The QA report counts `goldTracks`.

**In the workstation** a new box joins the track of the box it overlaps on the
previous frame (same class, overlap at least a half), and starts a new track
otherwise. The tag shows `#id`; `N` gives the selected box a new track when the
link was wrong, `L` links it to the track of the box selected before. A high
threshold and a class match make a wrong link rare and a glance away, never a
silent merge of two players.

## The metrics

[`track_metrics.py`](../../services/vision-worker/dtp_vision_worker/track_metrics.py),
pure arithmetic over the export and a `tracks` artifact, per class and per slice,
with the definitions the papers use:

- **MOTA** = 1 − (misses + false positives + switches) / gold boxes.
- **ID switch**: a gold track matched this frame to a different predicted track
  than the last time it was matched. **Fragmentation**: matched, then lost, then
  matched again — a hole in coverage, whoever covered it.
- **IDF1**: with gold ids assigned to predicted ids one-to-one so that the frames
  they coincide on are maximised, 2·IDTP / (2·IDTP + IDFP + IDFN).
- Frame matching is class-aware, at the IoU threshold, and **prefers to keep the
  pair that held last frame**, as CLEAR requires, so a momentary better overlap is
  not charged as a switch.

Both the per-frame matching and the IDF1 assignment use an optimal assignment
([`assignment.py`](../../services/vision-worker/dtp_vision_worker/assignment.py),
the Hungarian method in a page of pure Python), which also replaces the greedy
association in the tracker itself and closes the caveat [32](./32-PHASE-4-INCREMENT-1.md)
recorded: greedy pairing is wrong exactly when two candidates are both good for
two tracks, the crossing-players case.

The arithmetic is held to cases worked out by hand. One identity switch in the
middle of a ten-frame track: MOTA 0.95, IDF1 0.75. A three-frame hole: MOTA 0.85,
IDF1 34/37, one fragmentation, no switch. Two tracks that swap ids: two switches,
IDF1 0.5.

## The ledger scores a tracker

`POST /vision/models/versions/:id/benchmark` on a tracker version finds, for each
gold member, the latest succeeded `track` job by that version and its `tracks`
artifact (`TracksMissing` names the members without one), and queues a `benchmark`
job with `task: "track"`. The stage branches on the task, refuses an artifact
produced by another tracker, and reports `mota`, `idf1`, `idsw`, `frag` and `tracks`
per class and slice into the same `VisionMetricResult` rows. Promotion compares a
tracker on `idf1:all` and `mota:all` rather than the detector's metrics — the
regression metrics are now per task.

## A bug the gate found

Ten gold boxes forty milliseconds apart on a 25fps proxy exported onto nine
frames. `(1160 / 1000) * 25` is 28.999999999999996 in binary floating point, and
the export floored it to frame 28, beside the box already there. The worker's
conversion had guarded this since [28](./28-PHASE-3-INCREMENT-1.md); the two
TypeScript copies had not. All three now multiply before dividing and absorb the
noise, and the exact value is pinned in both specs. It would have put every
twenty-ninth frame's labels one frame early for as long as nobody compared the
count.

## Verification

```
api tests              1,159 passed   (was 1,154)
vision-contracts          54 passed   (was 48)
vision-worker            180 passed   (was 164)
  track metrics           16
web                      135 passed   (was 127)
typecheck               api, web and contracts clean
vision:trackmetricscheck 30/30 against the real API, Postgres, R2 and the real
                        Python scorer, run twice; no litter
```

Thirteen mutations, each caught: a switch never charged; a fragmentation never
charged; IDF1 pairing ids in sorted order instead of optimally; the continuity
preference dropped; the Hungarian method replaced by cheapest-first; one track with two
classes allowed; one track twice on a frame allowed; the export numbering every
linked box 1; the export flooring a boundary early again; a tracker benchmarked
against detect artifacts; a tracker's promotion comparing detection metrics; the
workstation linking across classes; the workstation flooring a boundary early
again.

## What is not done

| | |
|---|---|
| **HOTA** | MOTA and IDF1 are what the gate names first; HOTA's detection-association decomposition over thresholds is a later addition to the same scorer. |
| **The comparison the plan asks for** | The in-house tracker can now be scored; ByteTrack and BoT-SORT still cannot be *run* until their licences clear. |
| **Track review** | The workstation links boxes; it does not yet show a predicted track to split, merge or reassign. That is identity's review surface, next. |
| **Covered-frame accounting for trackers** | A tracker is scored on every gold frame; `framesScored` reports what its input covered only through the detect artifact's sampling, which the track artifact does not record yet. |
