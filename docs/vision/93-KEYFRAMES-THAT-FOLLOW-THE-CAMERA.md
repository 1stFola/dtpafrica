# 93 — Keyframes that follow the camera

8 October 2026. Step 2 of three for calibration on a moving camera, after the
camera motion of [92](./92-CAMERA-MOTION-AND-SHOTS.md). Step 3 is possession, carry,
game state and pitch positions reading the per-frame result.

## What a person does now

On a shot filmed by a panning camera:

1. Pause on a frame where markings are clear, place the landmarks, and press **File as
   a keyframe**. Every landmark must have been placed on the frame on screen.
2. Add more keyframes on frames where the view has moved.
3. Press **Follow the camera**.

While paused, the page draws the carried pitch lines, dashed in cyan, over any frame,
with a line such as "Carried from the keyframe at 00:32.000, 100 frame(s) away ·
usable", or why the frame has none. A keyframe can be withdrawn. **File for the whole
segment** remains the still-camera option.

## The data

`VisionPitchCalibration` gains two things (migration
`20261008120000_calibration_keyframes`, additive; every existing row is unchanged):

- **`frameIndex`.** Null for a whole-segment calibration. Set for a keyframe, true of
  that one proxy frame. A segment holds one whole-segment calibration or any number
  of keyframes, one per frame:
  - filing a keyframe supersedes the whole-segment calibration and any earlier keyframe
    on the same frame;
  - filing a whole-segment calibration supersedes everything current on the segment.
- **`withdrawnAt` / `withdrawnBy`.** A keyframe a person took back: no row replaces it.
  Audit action `calibration.withdrawn`.

**A keyframe is refused:**
- **`KeyframePointsSpanFrames`:** its points do not all carry one frame;
- **`KeyframeOutsideSegment`:** its frame lies outside the segment (half-open);
- **`ProxyWithoutFps`:** the proxy's frame rate is unknown.

**The existing readers ignore keyframes** (possession, game state, pitch positions and
event evidence). They read whole-segment calibrations only, so a moving-camera segment
reads as not calibrated: unknown, not wrong. Step 3 moves them to the per-frame rows.

## `calibrate`

Contract 1.18.0. Now a CPU stage after `camera_motion`; no model, no video read.

**At queue time the control plane pins** (`calibrateInputs`):
- the latest camera motion measured on the current proxy's bytes: index key and
  checksum, with chunks as `readKeys`;
- every segment with its current calibrations, oriented, with the clicked pixels and
  the pitch size.

**It refuses:**
- **`CameraMotionMissing`:** no camera motion on the current proxy;
- **`NoCalibration`:** nothing to carry;
- **`CalibrationPredatesProxy`:** a calibration made before the current proxy;
- **`CalibrateCpuOnly`:** a GPU was asked for;
- **`InvalidCalibrateConfig`:** reach or chunk size out of range.

**The worker** checks the index and every chunk against their checksums, then for each
frame takes:
- the segment's whole-segment calibration; or
- the nearest keyframe **in the same shot** within `reachMs` (default 10 s), carried as
  `C_i = C_k · T_k · T_i⁻¹` along the chained motion and oriented to face the camera; or
- a reason for having none: `no_camera_segment`, `segment_not_calibrated`,
  `calibration_failed`, `no_keyframe_in_shot`, `beyond_reach`, `keyframe_failed`.

A break (an edit cut) ends a shot, and nothing crosses it. Where a shot holds two
keyframes, the earlier is carried onto the later and compared at its clicked
landmarks: that is the drift on this footage, in metres. Rows go to one-minute
JSONL chunks; the index carries coverage, reasons and drift.

**`GET /vision/review/:assetId/calibration/frames/:frame`** returns one frame's row
from the latest run, with the pitch lines its homography draws at the pitch size the
person filed. It is marked `stale` when the run's pinned proxy, segments or
calibrations are no longer current.

## Camera motion became more accurate

Measured on the pilot before keyframes were built on it: chaining camera motion frame
by frame drifted **9.7 px** (median) after 200 frames (8 s). The error is checked
against features found independently by local template matching. Each pair's own
error is small, but they add up.

`camera_motion` now measures each frame **against a reference frame**, starting from
the last motion's prediction. A new reference is taken after 75 frames, or sooner when
fewer than half its corners still agree; a frame the reference cannot follow is
tracked as a pair, and starts the next reference. The rows are the same pair-to-pair
homographies, but chained they telescope back to the reference measurements, so error
accumulates once per reference.

| Measure | Frame by frame | Against a reference |
|---|---|---|
| Synthetic noisy pan, after 150 frames | 9.26 px | 0.20 px |
| Pilot, 60 frames on | 1.15 px | 0.39 px |
| Pilot, 120 frames on | 3.91 px | 0.34 px |
| Pilot, 200 frames on | 9.66 px | 0.24 px |

All six cuts are still found, in 21 s.

## QA

- **Totals:**
  - worker 539 tests;
  - contracts 101: a 1.17 worker is refused `calibrate` and keeps everything else;
  - API 1,893 of 1,894 (the local CRLF gate script, doc 89);
  - web 277;
  - both builds, both typechecks, and both migration diffs empty against the shadow database.
- **Worker:**
  - **Propagation:** 11 tests on a synthetic camera whose every frame's truth is known.
    A keyframe carried to its whole shot matches the truth within 1e-6 m. The tests
    also cover cuts, reach, the nearest keyframe in the frame's own shot, whole-segment
    and failed calibrations, half-open segments, a keyframe filed one metre off reported
    as 1.000 m of drift, orientation, and strict parsing.
  - **The stage:** 11 tests: carried rows against the truth, a cut, and nine refusals
    before any write.
  - **Reference tracking:** a drift regression test.
- **API:**
  - keyframe filing, superseding, the one-frame and segment rules, withdrawal, listing;
  - the frame lookup and its stale checks;
  - the queue pins and refusals, and result ingestion;
  - the existing readers asked only for whole-segment calibrations.
- **Mutation testing:** fourteen mutants, all killed. One survived the first run (the
  possession reader reading keyframes) and its test was added.
- **End to end on the pilot, in the browser, through the API and the CPU worker:**
  - **Find shots** again, with the new tracker.
  - Two keyframes filed from the page, on frames 800 and 1000 of the 31.56–40.36 s shot.
  - **Follow the camera:** all 220 frames of the shot carried; the rest of the clip
    accounted for by reason.
  - **Accuracy through the API's frame lookup:** the four keyframe features land within
    0.1–1.7 px of where independent matching finds them, 50–100 frames from a keyframe.
  - Withdrawing a keyframe marked the run stale on the page.

  The keyframes were four fixed features (stand and board corners) given corner labels:
  a test of the mechanics with a measurable answer, not a calibration of the pitch.
  They, their audit rows and the run were deleted afterwards.
- **A bug the run found.** The page took the playhead only from an animation loop,
  which a browser pauses in a hidden tab. A seek made outside the page's controls left
  the points named for frame 0, and the first two keyframes were filed on the wrong
  segment. They were deleted. The page now also follows the video's own `seeked` and
  `timeupdate` events.

## Next

Step 3: possession, carry, game state and pitch positions read the per-frame rows,
pinned into their evidence like calibrations are today.

**For a person, on the pilot:**
1. Remove the 0–1.04 s segment, and press **Find shots** again for the first shot.
2. Watch each shot and set its kind.
3. On each shot, file keyframes on frames where markings are clear, several seconds
   apart, then press **Follow the camera** and look at the dashed lines on the frames
   in between.
