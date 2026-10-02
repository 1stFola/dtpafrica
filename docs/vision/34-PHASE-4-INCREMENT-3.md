# 34 — Phase 4 Increment 3: which side a track is on

> Team assignment from kit appearance clustering, computed per match rather than
> globally, because kit colours repeat across competitions. Goalkeepers are handled
> separately — their kit is deliberately different and will cluster on its own.
> — [09-ML-PIPELINE](./09-ML-PIPELINE.md), § Tracking and identity

Identity is built from evidence in a stated order, and this increment is the first
step of it: every track gets a side, or an honest *no side*, from the colour of its
shirt. It lands as an `identify` stage on the CPU, one `VisionTeamAssignment` row
per track, and a review state that starts `unreviewed` — because the phase gate
says public attribution is blocked until a person approves, and nothing here is
shown to anyone.

Jersey candidates, the second step, are **not** here. See the last section for why.

---

## A kit is a colour, read off the shirt

The stage reads the proxy by role and the one track artifact the control plane
declared, decodes a handful of frames per track, and takes a colour histogram of
the torso of each track's box on each: the middle half across, from a fifth of the
way down to just over a half. Head and shorts are excluded on purpose. Shorts are
often the *other* colour of the same kit, and skin and hair are not a side.

The histogram has fourteen bins: twelve hues, each centred on the colour it is
named for, and two for pixels with no hue worth counting — dark and light — because
a white kit and a black kit are real and have no hue. Pixels darker than shadow are
skipped. Up to five frames per track are sampled, spread from its first sighting to
its last, and averaged, so that one frame of motion blur or a referee crossing in
front does not decide the colour. A frame FFmpeg cannot decode is skipped and
logged, not fatal: one bad frame must not void a match.

Frames are decoded at the proxy's native size, because the track artifact's boxes
are in the proxy's own pixels and the proxy's width is not written in a detect
artifact; the frame itself says how wide it is. And a frame is sought half a frame
early: FFmpeg keeps the first frame at or after the seek point, and a seek to
exactly `n / fps` lands on frame *n* or *n+1* depending on rounding in the
container's timebase. Half a frame before lands on *n* every time.

## Two sides, and the honest third answer

The players' kits — and only the players' — are clustered into two sides with
k-medoids, starting from the two most different kits. Medoids rather than means on
purpose: a centre is always a real kit, so a track in a third colour cannot drag a
side's centre toward itself and then be counted as near it. The first version of
this increment used k-means, and a purple track between a red side and a blue one
was pulled into the reds by exactly that mechanism. The test that caught it is kept.

A third kit that forms its own tiny side — under a fifth of the clustered tracks —
is an outlier, set aside as `kit_outlier`, and the sides are found again without
it. Without this a lone yellow bib, further from both kits than they are from each
other, becomes a centre, and *both* teams land on the other side. That failure is
in the tests too.

Then the part that matters most. Each track's margin is how much nearer its kit is
to its own side than to the other, as a share of the distance between the two
sides. A side is named only when the margin clears `minMargin` (0.15). Below it
the track keeps `method: kit_cluster` and `team: null` with its margin recorded —
it was looked at, and the answer is *unknown*. Unknown beats wrong. A wrong side
on a fifteen-year-old's goal is a harm no accuracy metric repays, and
[10-EVALUATION-AND-GATES](./10-EVALUATION-AND-GATES.md) measures unknown precision
for exactly this reason.

Goalkeepers and referees are never clustered (`not_clustered`). Their kit is
different by rule, and clustering it would either make a third side or pull one of
the two. A track no frame could be read for is `not_clustered` with zero samples.

The two sides are `A` and `B`: clusters, not teams. Which is the home side is the
roster's job, in the next increment, when a side has a jersey and a squad to match.
Each kit is described by its dominant bin (`red`, `blue`, `white`, `dark`) for a
reviewer's eye and written on the row as `kitDescription`.

## The stage, and the rows

`identify` is model-bound like `track`: an algorithm with parameters, registered as
a version so that every assignment names what made it, and routed to `cpu_small`
because colour arithmetic over a few hundred decoded frames needs no card. The
contract moves to **1.5.0** for it.

Queued, an identify job declares the latest succeeded track job's artifact (or the
one in `params.trackJobId`), the tracker that made it, and the proxy clock, and
refuses `TracksMissing` otherwise. The worker reads that one key and the proxy, and
refuses a job with no version, no track key, no clock, or an artifact made by a
tracker other than the one declared — before reading anything.

The completion becomes one `VisionTeamAssignment` per track the job saw, attached
to the `VisionTrack` rows of the track job the artifact came from and unique on
`(track, identify job)`: a re-run proposes anew rather than editing. A row for a
track the track job never reported is skipped and counted, not fatal — the tracks
table is the authority on which tracks exist. Each row carries `team`,
`confidence`, `method`, `kitDescription`, the identify version, `reviewState`
(`unreviewed`) and `supersededBy`, so a review correction will supersede rather
than overwrite, like every other prediction. `GET /vision/assets/:id/tracks` now
returns each track's latest assignment beside it.

## Verification

```
api tests              1,164 passed   (was 1,159)
vision-contracts          54 passed
vision-worker            211 passed   (was 180)
  kits                     23
  identify stage            8
web                      135 passed
typecheck               api, web and contracts clean
migration               both shadow diffs empty
vision:teamcheck        51/51 against the real API, Postgres, R2 and the real
                        Python histogram and clustering, run three times; no litter
```

The gate paints a 640×360 frame itself — four red figures, four blue, one purple,
one yellow goalkeeper — hands it to the worker's own histogram through the kits
CLI, clusters the result with the worker's own clustering, and checks what it was
told by hand: two sides, red and blue; eight assigned at the full margin; purple
clustered but unknown with no margin at all; the goalkeeper never clustered; the
same features saying the same thing twice. Then it posts that result as the
completion and reads the rows back.

Twenty-nine mutations, each caught: shadow pixels counted; white and dark merged;
hue bins off by half a bin; the saturation threshold removed; the torso region
widened to the whole box; a too-small region accepted; a region not clipped to the
frame; the distance not absolute; frames not spread; the furthest pair taken on a
tie; a medoid that never moves; goalkeepers clustered; the outlier pass removed;
the share rule's edge moved; the margin fixed at one; the margin threshold removed;
every track on side A; the unknown count zeroed; outlier rows dropped; white
described as a hue; the CLI accepting a frame of the wrong size; and, in the stage,
every one of its four refusals removed, an undecodable frame made fatal, only the
first frame sampled, the provenance not reported, and the proxy read as the source.

## What is not done

| | |
|---|---|
| **Jersey candidates** | The pipeline's second step needs a digit model, and no OCR or digit-recognition checkpoint is in [`OSS_REGISTER.md`](../licenses/OSS_REGISTER.md) yet. Adding one is a licence decision first and an increment second. A number read off single frames is also wrong often enough to be worse than none; the plan says *across a tracklet*, which needs the crop selection this increment's sampling is the start of. |
| **Which side is which** | `A` and `B` are clusters. Mapping them to the two squads needs a jersey on at least one track, or a person. |
| **The real decoder on a real proxy** | FFmpeg is not installed here or in CI. The frame decoder is exercised with an injected frame in the worker's tests and will run for real on the pod run Spike S0 still needs. |
| **Thresholds** | `minMargin` and the outlier share are starting values from hand-drawn frames. Real footage — shadows, floodlights, two kits both mostly white — will move them, and the ledger has no identity metrics yet to move them against. |
| **Review** | The rows start `unreviewed` and nothing reads them but the tracks route. The split, merge, reassign and mark-unknown surface is identity's, next. |
