# 92 — Camera motion and the shots between cuts

8 October 2026. Step 1 of three for calibration that follows a moving camera
(Fola's option B). Step 2 is keyframe calibrations carried along this motion;
step 3 is possession, carry, game state and pitch positions reading the per-frame
result.

## Why

The pilot clip was filmed by one camera panning across the whole ground. In 50
seconds it moves from one goal to the halfway line, to the other goal and back, and
most frames show one or two faint markings. A calibration is one fixed mapping per
camera segment, so on this footage it is right for the frame it was made on and
wrong a second later. Most grassroots video will be filmed like this.

The clip is also not one shot. It has six edit cuts, and the `cuts` stage
(FFmpeg's scene score, threshold 0.4) missed every one: a cut inside one stadium
does not change the picture enough to score as one.

## `camera_motion`: what it does

A new CPU job type, contract 1.17.0. Prerequisite `transcode`; no model. Workers
older than 1.17.0 go on serving every other stage.

- **Pinned to the proxy.** The control plane pins the current proxy's checksum, as
  its completed transcode recorded it (`pinnedProxy`, refused as `ProxyUnpinned`
  otherwise), and the source duration. The worker refuses any other bytes.
- **Two passes of one streamed FFmpeg decode** at 640 px wide, so a full match is
  never held in memory:
  - **Overlay mask, one frame a second.** A textured pixel that never changes while
    the frames span the clip is a fixed graphic, and is masked so it cannot pull the
    fit towards "no motion". If most textured pixels never change, the camera barely
    moved: nothing is masked, rather than masking a still camera into having nothing
    to track.
  - **Every pair of frames.** Up to 600 corners, followed by pyramidal Lucas-Kanade,
    a homography by RANSAC at 1 px. Players and the ball move on their own, and
    RANSAC leaves them out.
- **A pair that does not fit** is matched again directly (ORB, ratio test). It is
  believed only as a move one frame can make:
  - a shift of at most 30% of the frame;
  - a zoom change of at most 5%;
  - almost no change of perspective.

  Otherwise it is a **break**, and nothing is carried across it.
- **Output:**
  - Per-frame rows (homography in proxy pixels, frame f-1 to f) in one-minute JSONL
    chunks, each checksummed, plus an index with the shots.
  - The API proposes the shots as camera segments with `source: camera_motion`,
    clipped to the source's end.

## On the pilot clip

| Measure | Result |
|---|---|
| Frames | 1,244 in about 27 s on the CPU worker |
| Pairs tracked | 1,237, median 487 agreeing points |
| Edit cuts found | 6 (at 4.12, 14.36, 26.00, 31.56, 40.36 and 44.36 s) |
| Shots | 7 |

Each cut was checked by eye.

**A first version bridged three of the cuts.** Each was a cut from a wide shot to a
closer one of the same ground, which matches directly. The fits implied zooms of 17%,
15% and 43% in a single frame. The one-frame plausibility limits were added because
of this, with a test that reproduces it.

**Drift.** Within a shot, chaining the per-pair motion across 200 frames (32 s to
40 s) lands frame 32 on frame 40 with no visible doubling of stands, boards or goal.

## Also changed

**Proposals:**
- `cuts` and `camera_motion` proposals go through one routine. A later run of either
  source replaces earlier uncalibrated proposals of either source; a person's
  segment, or a calibrated one, is never replaced or overlapped.
- Proposals are clipped to the source's end. The `cuts` proposal on the pilot ended
  at 49,760 ms, 54 ms past the footage, so a person could neither declare beside it
  nor keep it.

**A person sets a segment's kind.** `PATCH /vision/review/camera-segments/:id`
(`vision.review`) with `{ kind }`.
- On a proposal this is the person adopting it: it becomes `manual`, with their
  name, and later runs no longer replace it.
- It is refused (`SegmentReferenced`) while current event candidates were filed
  under the segment.
- Audit action `camera.segment.updated`.

**The proxy's width is stored.** `applyTranscode` saved the proxy's height but never
its width, though the worker reported both. Calibrated possession needs the width,
and refused for "missing geometry" that had been measured all along. The pilot was
re-transcoded: the output is byte-identical (checksum `bc06e77b…`, the one detect
recorded), so detect, track and ball trajectory remain valid.

**The calibration page:**
- **Find shots** queues `camera_motion`.
- Each segment has a kind selector ("label as…" on a proposal), and proposals read
  "proposed shot" or "proposed cut".
- The segment at the playhead is now half-open (`start <= t < end`), as the API and
  worker read it; before, the frame at a cut belonged to two shots.
- An action's outcome, refusals included, appears beside the controls that caused
  it, with the remediation. Before, it appeared at the top of the page, out of sight
  of the side panel's buttons.

**Errors keep their remediation.** `AdminApiError` keeps the refusal's code and
remediation, and `describeFailure` puts them in words for any page.

**Licences.** OpenCV (`opencv-python-headless`, Apache-2.0) and NumPy (BSD-3-Clause)
are worker dependencies, recorded in the register. The wheel's bundled LGPL FFmpeg is
not used for decoding.

## QA

- **Totals:** worker 516 tests; contracts 100 (a 1.16 worker is refused `camera_motion` and keeps every other stage); API 1,875 of 1,876 (the one failure is the local CRLF checkout of an untouched gate script, doc 89); web 275. Both builds and the API typecheck pass.
- **Worker:**
  - 14 on synthetic video with known motion: pan, zoom, moving players, a fixed
    graphic, a still camera, an edit cut, a whip pan, a cut to a closer shot, a
    sideways jump beyond the limit, and featureless frames.
  - 10 on the stage: the pinned proxy, chunk checksums, shots, and refusals before
    any read.
- **API:** stage results (camera-motion proposals, cross-source replacement, clipping,
  width), queue inputs and refusals, kind setting.
- **Web:** segment lookup, wording, and error remediation.
- **Mutation testing:** eleven mutants of the new guards, all killed. Two survived the
  first run and showed missing tests, which were added: the bridge shift limit on its
  own, and a new run replacing its own earlier shots.
- **End to end on the pilot, in the browser:**
  - **Find shots** was refused with the remediation shown beside it.
  - Transcode was re-run.
  - **Find shots** again: the job was pinned and the CPU worker found 6 cuts. Six
    proposals appeared; the first shot was skipped for overlapping a person's 0–1.04 s
    segment, and the last was clipped to 49,706.
  - A shot was labelled live play from the page, with the right row and audit.
  - That label was then reverted, so labelling stays a person's decision.

## For a person, next

1. On the calibration page, remove the 0–1.04 s segment.
2. Press **Find shots** to propose all seven shots.
3. Watch each shot and set its kind: live play, or replay if it is one.
4. Step 2 then lets each shot be calibrated from a few keyframes.
