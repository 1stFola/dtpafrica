# 38 — Phase 5 Increment 1: a homography that knows how wrong it is

> When calibration quality falls below threshold, every coordinate-derived metric —
> distance, speed, zone entries, heatmap density — is **suppressed and labelled**,
> not emitted with a caveat. A suppressed metric is honest; a wrong metric with a
> footnote is not.
> — [09-ML-PIPELINE](./09-ML-PIPELINE.md), § Calibration and game state

Phase 5 turns pixels into metres. This increment is its spine: the pitch as a
model, a homography per camera segment fitted from landmarks a person clicked,
a reprojection error that says how far to trust it, and the suppression rule
built as a test before any metric exists to be suppressed. The automatic
pipeline — pitch lines, keypoints, a `calibrate` stage — will write the same row
with `method: model`; the editor stays, because on wide handheld footage the
model fails often enough that [09](./09-ML-PIPELINE.md) calls the editor a
requirement, not a convenience.

---

## The pitch, in metres

105 × 68 unless the actual dimensions are known, and they are stored on every
calibration, because assuming 105 × 68 on a short pitch silently corrupts every
distance derived from it. Thirty-three landmarks are placed from the
dimensions — corners, halfway line, centre spot and circle, both penalty areas,
goal areas, penalty spots and posts — with the Laws' fixed measurements kept
fixed: the penalty spot is eleven metres out on a 90-metre pitch too. Dimensions
no pitch has are refused by name.

## The homography

Four or more correspondences between a click in the proxy and a landmark in
metres give a 3 × 3 projective map by the direct linear transform, after Hartley
normalisation of both point sets; without it the system is conditioned by pixels
in the thousands against metres in the tens. The eight unknowns are the
least-squares solution by Gaussian elimination with pivoting, and a near-singular
system is reported as *degenerate* — three landmarks on one line and one off it
is the common case — rather than returned as a number that looks fine. Too few
points and a point clicked twice are refused by name too. A page of arithmetic,
no dependency.

Trust is the reprojection error, measured both ways: every click projected onto
the pitch against the landmark it named, in metres, and every landmark projected
back against the click, in pixels. The metre figure is the one the suppression
rule reads, because a metre is what a distance will be wrong by. The error
reported is the error of the homography reported — a test holds the two together.

## How much to trust it

Provisional thresholds, versioned, recorded on every calibration:

| Quality | Rule |
|---|---|
| `good` | RMSE ≤ 0.75 m over at least six landmarks |
| `usable` | RMSE ≤ 2 m |
| `failed` | worse than that, or any single landmark more than 5 m out |

[10](./10-EVALUATION-AND-GATES.md) names the metric and not the bar; these are
what a careful person would accept from clicked landmarks on a 720p proxy, and
the first real matches will move them. `good` and `usable` both yield
coordinates; `failed` yields none.

## Segments, and a person

A camera cut resets calibration rather than carrying a stale homography across
it, so the camera segment is the unit. A person declares them — inside the
footage, never overlapping, with a kind — and calibrates one by clicking
landmarks; the operator key is refused for both, as it is for identity, because
a calibration is a judgement about the footage with a name on it. A fit that
cannot be made is refused and nothing is saved. A fit that can be made is filed
*whatever its quality*: a `failed` calibration is a fact about the footage, and
it is what makes the suppression rule fire rather than fall back to the last good
one. A new calibration supersedes the segment's current one; nothing is edited.
The editor's live readout is the same fit, saved nowhere.

## The rule, as a test

`GET /vision/review/tracks/:trackId/pitch-positions` is the first coordinate
anyone can derive, and it is built under the rule. Each position's foot point —
the bottom centre of the box — goes through the calibration of the segment
covering that moment. A position under no segment, under a segment with no
calibration, under one that `failed`, or beyond the horizon is not placed, and
says which. The distance covered is reported only when every position was
placed; otherwise the field is `{ suppressed: true, reason }` and there is no
number anywhere in the response. The gate asserts that last sentence literally.

## Verification

```
api tests              1,229 passed   (was 1,205)
  homography, pitch       11
  calibration service     11
vision-contracts          54 passed
vision-worker            211 passed
typecheck               api clean
migration               both shadow diffs empty
vision:calibrationcheck 41/41 against the real API, Postgres and R2, with a
                        synthetic camera and a signed-in person; run twice;
                        no litter, no rows left
```

The gate invents a camera — a known homography from the pitch to the picture —
seeds a track walking from ten metres to thirty along the halfway line as that
camera would have seen it, and has a person click six landmarks the camera would
have shown: the calibration comes back `good`, the first step at ten metres, the
last at thirty, the distance twenty. Then the same six with two landmarks
swapped: a homography exists, it fails the bar, it supersedes the good one, and
every position and the distance are suppressed and labelled.

Twenty-six mutations, each caught: three points accepted; a duplicate dropped
instead of refused; normalisation without scale, then without centring; a
singular system solved anyway; the root dropped from the root-mean-square; the
worst point taken as the last; the horizon mapped to a number; a singular matrix
inverted; the penalty spot moved; a pitch wider than long; a pitch of any
length; one bad landmark forgiven; `good` without enough points; `usable` with no
bar; an empty segment; a segment past the footage; the overlap test narrowed to
equality; an unknown landmark skipped; a degenerate fit saved; the current
calibration not superseded; a failed calibration placing positions; the first
segment used for every moment; a distance over a partial track; the box corner
used instead of the foot; the person requirement removed.

## What is not done

| | |
|---|---|
| **The automatic pipeline** | Pitch-line and keypoint detection need a model; none is in [`OSS_REGISTER.md`](../licenses/OSS_REGISTER.md). A `calibrate` stage writes the same row with `method: model` once one is. |
| **Camera-cut detection** | Segments are declared by hand. FFmpeg's scene-change filter on the proxy is a CPU stage that can propose them; the next increment. |
| **The editor screen** | The fit, the preview and the catalogue exist; the screen that shows a frame, takes the clicks and draws the pitch back over it does not yet. |
| **Valid-frame coverage** | The gate's other metric. `coverage.calibratedMs` is the start; per-frame validity needs the pipeline. |
| **Speed** | Distance over a track is the first derived metric; speed needs the frame clock and a smoothing choice, and sits with the game-state chunks. |
| **The match clock** | Still not anchored to the footage. It is a segment-level fact like calibration and belongs beside it. |
