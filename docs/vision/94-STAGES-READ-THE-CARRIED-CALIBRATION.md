# 94 — Stages read the carried calibration

8 October 2026. Step 3 of three for calibration on a moving camera. It follows the
camera motion of [92](./92-CAMERA-MOTION-AND-SHOTS.md) and the keyframes and
`calibrate` stage of [93](./93-KEYFRAMES-THAT-FOLLOW-THE-CAMERA.md).

## What changed for a person

A shot calibrated by keyframes no longer reads as uncalibrated. Possession, carry,
game state and the pitch positions on the identity page now place each frame through
that frame's own calibration, carried from the keyframes. Where no keyframe reached a
frame, the frame is Unknown and says so. Nothing is borrowed from a neighbouring frame
or from a run made for other keyframes.

- **Game-state minimap:** a frame that was not carried says "camera not followed here",
  and the caption says the metres come from this frame's carried calibration.
- **Possession summary:** counts carried shots apart ("1 follow a moving camera frame
  by frame from keyframes"), names their keyframes, and names the calibrate run.

## The rule: one current run, or none

`currentCarriedRun` (`calibration/carried-run.ts`) is the only reader. It takes the
latest succeeded `calibrate` job, and only if all of the following hold:

- **Its completion is whole:** one index and every chunk it declared, all under that
  attempt's prefix, with the current propagation version and an index checksum.
- **It is not stale:**
  - the same proxy bytes;
  - the same segments, with the same bounds and kinds;
  - the same current keyframes or whole-segment calibration on each.

  Filing or withdrawing a keyframe, or relabelling a shot, makes it stale at once.

With no current run, a keyframed shot is declared uncalibrated.

## How each consumer pins it

The run is pinned like a calibration is today: `CarriedCalibrationPin` = job, index
key, index checksum and chunk keys. The pinned objects are added to the job's
`readKeys`, so a worker can fetch exactly those and nothing else.

- **A keyframed segment is declared `quality: "carried"`:**
  - with `calibrationId` and `homography` null;
  - with its sorted `keyframeIds`, the thresholds version and the pitch the keyframes
    share.

  Keyframes of one segment that disagree on pitch size or thresholds are refused
  (`KeyframesDisagree`), not averaged.
- **Possession:** the snapshot carries the segments and the pin.
  - The worker reads frames through `Constraints.homography_at(ms, camera)`.
  - A frame with none is `calibration_unavailable`.
- **Carry (`events`):** reads the same pin from the possession index it was given.
  - A carry ends where the carried calibration stops.
  - An imported carry links evidence to every keyframe its frames came from.
- **Game state:** `params.carried` is pinned beside the segments.
  - A frame with no carried homography is `calibration_not_carried`, a new
    suppression reason.
- **Pitch positions** (`GET /vision/review/tracks/:id/pitch-positions`): reads only
  the chunks that hold the track's frames. Each chunk is checked against its index,
  and the index against the run.

**The worker checks the run as the control plane pinned it** (`carried_frames.py`):
- the index's checksum, role and proxy clock;
- chunk keys equal to the pin;
- each chunk's checksum;
- that every carried row is a passing, finite 3×3 transform, with no frame carried
  twice.

**A worker refuses before reading anything when:**
- a pin arrives with no carried segment;
- a carried segment arrives without a pin;
- a carried row has its own transform or calibration id.

Contract **1.19.0**. Possession, events and gamestate are served only to 1.19 workers,
since an older worker would not know a carried segment.

## Bugs fixed along the way

- **Possession could never be queued on a real database.** The check that the ball
  run's segments are the current ones compared two `JSON.stringify` strings. Postgres
  `jsonb` stores an object's keys in its own order (`kind`, `endMs`, `startMs`,
  `cameraSegmentId`), so the strings never matched and every request was refused with
  `PossessionEvidenceMismatch`. Mocked tests kept the key order and passed. It now
  compares with `sameEvidence`, which ignores key order. A test reads the segments in
  Postgres's order, and it fails against the old code. No possession run had ever
  succeeded on this database before this one.
- **The possession preflight counted a carried shot as uncalibrated:** it counted
  segments with a transform. It now counts carried ones too.
- **The shared carry contract refused carries on carried segments.** It accepts them
  now.

## QA

- **Totals:**
  - worker 583 (44 more than doc 93): pin parsing, row checks, loading and every
    checksum refusal, possession, carry and game state through carried frames, and the
    possession, events and gamestate stages loading the pinned run;
  - API 1,931 of 1,932 (38 more), with the one failure the local CRLF gate script
    (doc 89): the current-run rule and staleness, reading frames, each consumer's
    declaration, pin and `readKeys`, evidence import, keyframe links and the key-order
    fix;
  - contracts 115 (14 more): carried carries accepted and refused, and a 1.18 worker
    refused the three consuming stages;
  - web 278: the possession summary and the minimap's new reason;
  - both typechecks and both production builds.
- **Mutation testing:** 46 mutants. 44 were killed on the first run.
  - "staleness ignores the proxy" survived, because its test also changed the
    segments. The test now changes the proxy alone, and the mutant is killed.
  - "pitch positions read the first calibration" is equivalent: that branch only
    sees segments with no keyframes.
- **End to end on the pilot, through the API, the CPU worker and the browser:**
  - **The keyframe.** One keyframe on frame 800 of the 31.56–40.36 s shot: four grass
    points given corner labels, so players land inside a 105×68 pitch. This tests the
    mechanics, not a calibration of the pitch. Labelling the real markings on this
    oblique shot is a person's call.
  - **Before any run:** all 220 positions of a player track were
    `calibration_not_carried`.
  - **Follow the camera, with a 2 s reach:** 62 frames carried (789–850). The rest of
    the shot was `beyond_reach`.
  - **Pitch positions:**
    - 60 placed and 2 off the pitch (the player at the frame's edge);
    - 158 `calibration_not_carried`, exactly frames 851–1008;
    - recomputed by hand through each frame's own carried transform (frames 800, 820
      and 850) they agree to 0.004 m.
  - **Game state:** it pinned the run, read only the index and its one chunk, and
    placed 997 rows. 3,473 rows were `calibration_not_carried`. The minimap showed
    17 placed at frame 820, and "camera not followed here" at frame 900.
  - **Staleness:** relabelling the shot `live_play` made pitch positions fall back to
    `calibration_not_carried` at once, until the camera was followed again.
  - **Calibrated possession** (after re-running track and ball trajectory on the
    current shots):
    - it pinned the new run and read its index and chunk;
    - the import accepted the carried snapshot;
    - the page described it.

    This clip loses the ball on 1,176 of 1,243 frames, so it produced no candidates,
    and no carry could be proposed. No event model is registered locally.
  - **Cleanup:** the keyframe, the seven QA jobs (with their tracks), the imported
    possession run, the scratch admin and its audit rows were deleted, and the shot's
    kind was restored. Objects the QA jobs wrote to the staging derived bucket remain.
    They are unreferenced.

## Next

For a person, on the pilot: set each shot's kind, then file keyframes on clearly
marked frames, several seconds apart, using the real pitch markings. Then press
**Follow the camera**. After that, re-run ball trajectory, possession and game state.
A carry needs a clip where the ball is seen, and a registered event model.
