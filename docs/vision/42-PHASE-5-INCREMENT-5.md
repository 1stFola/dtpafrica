# 42 — Phase 5 Increment 5: metres per frame, and a row that says why not

> Row-level storage in Postgres is only for things a human reviews or a query
> filters on. Dense per-frame output lives in Parquet in R2, referenced by key.
> — [04-DATA-MODEL](./04-DATA-MODEL.md), § CV outputs

[38](./38-PHASE-5-INCREMENT-1.md) could place one track's positions in metres,
on request, through the control plane. That is a review aid, not game state: a
minimap, a heatmap or a distance over a match needs every track on every frame,
and the API must not become the data-plane hop that computes it
([01](./01-ARCHITECTURE.md), § 1). This increment is the `gamestate` stage: a
CPU worker reads the track artifact, places every foot point through the
calibration of the camera segment covering its moment, writes the rows as
Parquet chunks by source time, and reports an index and a coverage. The
suppression rule that [38](./38-PHASE-5-INCREMENT-1.md) built as a test is now
built into the data: a position under no passing calibration is a row with no
metres and a reason, not a number with a caveat.

---

## What the stage is given

A job is refused at enqueue until a succeeded `track` job carries a tracks
artifact (`TracksMissing`, as identify) and at least one camera segment carries
a calibration (`NoCalibration`, which says how many segments there are). Queued,
`inputs.params` carries the track artifact by declared key with the tracker
that made it, **every camera segment** on the asset in order with its current
calibration where a person filed one (`quality`, `homography`, `pitch`, or
nulls), the clock anchors, and the chunk size. Nothing a caller puts under
`params` for those keys survives: the gate posts a forged segment, anchor and
key and finds the real ones on the job.

Every segment, not every calibrated segment. The first gate run declared only
the calibrated ones, and the rows under a segment a person had declared but
never calibrated came out as `no_camera_segment`, which is a different fact
from `segment_not_calibrated`. The stage cannot tell the two apart unless the
control plane tells it, so now it does. A failed calibration is declared too,
with its quality; those rows say `calibration_failed`.

`gamestate` follows `track` in the stage order. The contract used to name a
`calibrate` prerequisite; no such stage exists, because calibration is a person's
row per camera segment ([38](./38-PHASE-5-INCREMENT-1.md)), and the control
plane checks for one at enqueue instead.

## What the stage writes

One row per track per frame, flat, so any reader in any language can filter it:

```
frame_index  source_ms  half  match_minute  local_track_id  class
x_m  y_m  camera_segment_id  quality  reason
```

The foot point is the bottom centre of the box, through the pixel-to-metres
homography. `x_m` and `y_m` are set only through a calibration that passed the
bar (`good` or `usable`, with a homography); otherwise both are null and
`reason` is one of `no_camera_segment`, `segment_not_calibrated`,
`calibration_failed`, `beyond_horizon`. The last is the horizon lesson from
[40](./40-PHASE-5-INCREMENT-3.md) applied to a point rather than a line: a box
whose foot lies at or past the horizon projects to a finite, mirrored, wrong
place, so it is suppressed, not placed. `half` and `match_minute` read on the
match clock of [41](./41-PHASE-5-INCREMENT-4.md) and are null off it — before
kick-off, between halves, unanchored. A suppressed row still names its segment,
its quality and its minute; only the metres are withheld.

Rows are chunked by `source_ms` into Parquet files of sixty seconds each by
default (`chunk-00004.parquet` is the fifth minute of source time), written
under the job's output prefix, with an index `gamestate.json` naming each
chunk's key, time range, byte size and coverage. A minute of a full match is a
few hundred kilobytes; a match is ninety files, not nine thousand rows a second
in Postgres. The index carries the Phase 5 gate's number: **valid-frame
coverage**, the share of distinct frames on which at least one row was placed
through a passing calibration — which, a calibration being per moment, is the
share of frames a passing calibration covered. It is a share of frames, not of
rows, so a track beyond the horizon on every frame does not lower it while a
segment nobody calibrated does.

## What the control plane keeps

Nothing in Postgres, on purpose, like detect. The completion must carry an index
and exactly the chunks the summary promises, with placed and suppressed counts,
or it is not applied; the job row keeps the artifact keys and the coverage.
`GET /vision/review/:assetId/game-state` returns the latest succeeded job's
coverage, what it was placed with (segments, calibrations, anchors), and a
presigned URL for the index and for each chunk. The API hands out the URLs and
reads none of the rows: the minimap of the next increment fetches Parquet
directly, which is what [01](./01-ARCHITECTURE.md) says the review UI does.

pyarrow (Apache-2.0) joins httpx as the worker's second dependency, for writing
the chunks. It is in the licence register.

## Verification

```
api tests              1,278 passed   (was 1,272)
  gamestate inputs         2
  gamestate results        2
  game-state read          2
vision-worker            241 passed   (was 225)
  game state              16
vision-contracts          54 passed
typecheck               api clean (contracts rebuilt at 1.9.0)
migration               none: nothing new in Postgres
vision:gamestatecheck   59/59 against the real API, Postgres and R2, with the
                        worker's own Python placing the rows and pyarrow reading
                        a chunk back; run twice; no litter, no rows or objects left
```

Twenty-seven mutations, each caught: the horizon test weakened two ways; the
foot point at the box's centre, and at its left edge; rows left in track order;
a segment's start or end made exclusive; a failed calibration passing; a usable
one failing; the two suppression reasons swapped; a passing quality with no
homography placing anyway; a clock anchor made exclusive; a half's end ignored;
the second half from minute zero; chunks twice too long; chunks unsorted;
coverage counting every frame, and counting rows instead of frames; suppressed
miscounted; chunk time bounds wrong; the reason column dropped from the Parquet
schema; the track count forgotten; the stage ignoring a tracker other than the
declared one; the index uploaded under the chunk role; chunk keys outside the
job's prefix; a zero chunk size accepted; and the summary reporting rows as
placed. Six of these survived the first run and are now each a test: both
segment bounds, chunk order from unordered rows, coverage over frames with a
track beyond the horizon, chunk time bounds, and a stage fixture whose second
track falls under no segment so its rows and its placed count differ.

The gate's walk is the calibration gate's, over three segments: calibrated good,
declared and never calibrated, calibrated and failed. Of 125 frames, 51 fall
under the good one; the stage places 102 rows and suppresses 148 with the two
reasons in the right counts, coverage `0.408`, three two-second chunks of which
the first is fully placed and the last fully suppressed; the walker's first
step reads ten metres on the halfway line and the twentieth frame reads 0.8
seconds on the clock; a chunk fetched from the presigned URL begins and ends
with the Parquet magic; and the control plane's own per-track placement from
[38](./38-PHASE-5-INCREMENT-1.md) agrees with the stage's on how many frames and
where.

## What is not done

| | |
|---|---|
| **The minimap** | Next. It fetches chunks straight from the bucket, which needs the R2 CORS rule the identity screen worked around ([36](./36-PHASE-4-INCREMENT-5.md)); that is infrastructure, not code. The rule was set on 2 October 2026; see [43](./43-PHASE-5-INCREMENT-6.md). |
| **Speed and distance** | A speed is a difference of placed rows; a distance over a window is their sum. Both belong to the metrics phase with the suppression rule already enforced row by row here. |
| **Smoothing** | Rows are the tracker's boxes projected, frame by frame, unsmoothed. A foot point jitters; a filter over it is a calculation version of its own, not a change to the data. |
| **Chunks on the match clock** | Chunks are by source time, the footage's own unit. A half is findable from the index's anchors; a chunk per minute of the match would move when the clock is re-anchored. |
| **Real footage** | The walk is synthetic, through a synthetic camera. The first calibrated real match sets the coverage a pod run achieves; the number here is the gate's, not the engine's. |
