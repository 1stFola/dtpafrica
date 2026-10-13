# 97 — The second pilot clip: machine-made calibration and the first full run

12–13 October 2026. Fola asked Claude to label the shots and mark the pitch on the
1XCup clip (doc 96) itself, then run the pipeline. This records how that was done, what
it measured, and one fix the run needed.

## Who made these decisions

Every shot label and keyframe below was made by software, not by a person:
- They are filed under a local account named **Claude (machine-made, not a person)**
  (`claude-machine@vision.localhost`), with the vision-reviewer role and 1XCup 2026 only.
  The audit trail names that account.
- The account cannot queue jobs. The operator key queued them, as for every other
  pipeline run.
- **The gold events are not machine-made and must not be.** They are what the pipeline is
  scored against, so they still need two different people working separately.

## The shot labels

All 12 proposed shots kept their proposed kinds, now declared:
- **Shots 1–6 and 12: live play.** Shots 2 and 5 are close-ups from other cameras, but
  play is live: the on-screen clock runs on, and they sit outside the replay.
- **Shots 7–11: replay.** They sit between two sponsor wipes, at 127.0 s and 137.0 s.

## The pitch marks

The pitch was marked by fitting a camera to the painted lines, not by eye:
- **The fit.** A pinhole camera was fitted to the white-line pixels of ten frames at once:
  one camera position shared by every frame of the main camera, the pitch's length and
  width, and each frame's pan, tilt, roll and zoom. The residual is the image distance
  from each marking pixel to the nearest painted line or arc the model draws.
- **How well it fits.** The median distance is 0.8–1.6 px per frame, across the centre
  circle, halfway line, far touchline, both penalty areas, goal areas and goal lines.
  A painted line is about 4 px wide.
- **The pitch it found: about 100 × 76 m,** not the 105 × 68 default. Both ends were seen
  by the same camera, so the length is measured. The width comes from the far touchline,
  which the halfway line ends on.
- **The keyframes.** Each landmark's pixel is that landmark projected through the fitted
  camera, filed with pitch 100 × 76.

| Frame | Shot | View | Landmarks | Quality |
|---|---|---|---|---|
| 1700 | 1 | centre circle, both sides | 6 | good |
| 2250 | 3 | left penalty area and goal | 7 | good |
| 2875 | 4 | right penalty area and goal | 11 | good |
| 3000 | 4 | right penalty area and goal | 11 | good |
| 3100 | 6 | right penalty area and goal | 11 | good |

**The reported error is not an accuracy figure.** Each keyframe reports about 0.01 m. That
only says the points agree with the fit that placed them. The honest accuracy is the
line fit above.

**Not calibrated:**
- shots 2 and 5 (close-ups);
- shot 12, from a corner camera the fit could not place;
- the replay.

### A trap in centre-circle keyframes

The catalogue's centre-view landmarks nearly all lie on one line. The centre spot, the
circle's near and far crossings, and the halfway line's far end are all on the halfway
line, and usually only one of the circle's left or right points is in view.

**The problem:**
- Four points on one line plus one off it do not fix a homography.
- The preview fitted frame 1000's five such points with 0.003 m error and rated it
  **usable**.
- Compared with the camera fit, that homography was **5–36 m wrong** away from the line.

**What was filed instead:** only frame 1700, where both sides of the circle show.

**What a person clicking the same points would have got:** the same misleading
"usable". That is now fixed (below).

### The fix: landmarks must fix the view

**Why the old check missed it:** the fit refused only exact degeneracy, which its
solver notices. Clicked pixels are never exactly collinear, so the system was
ill-conditioned rather than singular, and it solved.

**The new check** (`inGeneralPosition`, in `homography.ts`):
- It runs on the landmarks' pitch positions, which are exact.
- It needs some four landmarks with no three within 1 m of one line.
- A set without them is refused as `degenerate`, both in the editor's preview and when
  filing a calibration or keyframe (409 `CalibrationDegenerate`).
- Extra near-collinear landmarks do no harm, as long as four clear the bar.
- The editor now says what to add: landmarks off the line, such as both sides of the
  centre circle.

**Checked against the live API with this run's points:**
- frames 1000 and 375 (centre circle, one side) are refused;
- frames 1700 and 2875, which were filed, still fit as `good`.

**Tests:**
- the centre-view case is refused under five different sets of pixel noise, and with
  exact clicks;
- once both sides of the circle are in view, it fits and places a far point to within
  1 cm;
- penalty-area, goal and six-landmark sets still pass;
- a keyframe of the centre-view set is refused before any row or audit record is written.
- With the check disabled, the three new refusal tests fail.

## Following the camera

`calibrate` (job `debccaa1`, default reach 10 s) carried the five keyframes to **40.5% of
frames**.

**Accuracy against independent fits:**
- Every second of shots 1 and 3 was refitted to its own markings. 48 of those fits were
  reliable (median ≤ 1.6 px, ≥ 1,500 marking pixels).
- 19 of them fall inside the carried frames. Against them, the carried homography is off
  by:
  - **0.03–0.15 m** median within 2 s of a keyframe;
  - **3.1 m** median at 10 s (frame 2500, after a pan from the left penalty area to the
    centre circle).
- A carried frame keeps its keyframe's quality, `good`, at either distance.

**Coverage left out:**
- most of shot 1 (0–57 s), which shows the centre circle with only one side of it in view;
- the uncalibrated shots.

## The run

**Detect (GPU)**

| Item | Value |
|---|---|
| Job | `3fd77a8d`, RunPod, ball-tiles/v2, all 3,615 frames |
| Ball | in 1,982 frames |
| Tile balls | 366 added, 292 refused by the colour check |
| Pods | two, roughly 27 min billed together |
| Cost | about $0.40 at the earlier rate (RunPod had not billed them yet). Spend is about $1.19 of $4. |

**Why the first pod was lost:** `node --watch` restarted the API mid-run when OneDrive
touched the tree. The pod's heartbeat lapsed and the job was requeued. The second run had
the API without watch.

**Ball trajectory (`6e16e3fa`)**
- The ball is observed in 1,268 frames (35%).
- 198 parked tile balls were dropped.

**Track (`d3e5919e`)**
- 2,579 tracks: 2,478 players, 101 ball.
- The first try failed (see the fix below).

**Possession, calibrated (`046ad8ee`, `possession-candidates/v2`)**
- **2 candidate frames.**
- The block is upstream of calibration: in 1,109 frames the ball is seen but no player
  counts as near it.
- Measured on the artifacts: the ball's distance to the nearest foot is a median 0.58
  player heights (p25 0.34, p10 0.23).
- The gate is 0.25 heights. Only 158 of 1,268 frames pass it, and 200 ms continuity
  removes most of the rest.
- The gate is too tight for this camera and ball detector, or the ball point sits off the
  ball's ground contact. Which of the two needs a person to look at frames.
- Without calibration (`76e6a8a2`, v1) it found 6 frames.

**Game state (`0e06db1e`)**
- 21,048 player positions placed.
- Valid-frame coverage 0.405, the same as the carried calibration.

**Events (`c2828ae3`, the carry rule `6d7f8485`)**
- **0 events.** This follows from possession having almost no frames.

## A fix: a worker's completion past 100 kB

**The problem:** the track stage posts one compact row per track in its completion.
2,579 tracks passed Express's default 100 kB JSON limit, so the API answered 413 and the
job failed. The first pilot clip was 49.7 s, short enough to fit.

**The fix:**
- `shared/body-limits.ts` replaces Nest's body parser:
  - routes under `/api/v1/vision/worker/` accept up to 16 MB of JSON;
  - every other route stays at 100 kB.
  Worker routes are token-guarded.
- `body-parser` is pinned to 1.20.4, the version Nest already uses.

**Tests** (`body-limits.spec.ts`, on a real socket):
- a 100 kB+ completion passes on a worker route;
- the same body is refused on other routes, including `/vision/workers/provision` and a
  look-alike `/vision/worker-extra`;
- small bodies parse everywhere;
- a body over 16 MB is refused even on a worker route.

## The possession gate, looked at

Requested by Fola after the run. The judgements below are Claude's, from looking at crops
of the frames; no person has reviewed them.

**What was looked at.** For every frame where the ball was observed, the distance from the
ball to the nearest confirmed player's foot point (bottom centre of the box), in player
heights. 54 frames were sampled across that range and cropped with the ball, the box and
the foot point drawn on.

| Distance (player heights) | Frames | What the crops show |
|---|---|---|
| under 0.25 (the gate) | 158 | ball at the player's feet |
| 0.25–0.40 | 250 | about 23 or 24 of 24 sampled show a player on the ball, often dribbling it a stride ahead |
| 0.40–0.50 | about 150 | about 15 of 24; the misses are loose balls and bench staff or officials beside the pitch |
| over 0.6 | about 500 | loose balls and balls in the air |

**Re-running possession** (CPU only):

| Run | Gate | Continuity | Mode | Candidate frames |
|---|---|---|---|---|
| `046ad8ee` | 0.25 | 200 ms | calibrated | 2 |
| `097ef21a` | 0.40 | 200 ms | calibrated | 13 |
| `24236f00` | 0.40 | 80 ms | calibrated | 51 |
| `d120e805` | 0.40 | 80 ms | image only | 155 |

**The gate is not the main limit; the ball is.** The ball is observed in 35% of frames,
in bursts with a median length of 2 frames. Only 73 bursts reach 5 frames. Continuity
restarts at every missed frame, so:
- even the loosest calibrated run covers 1.4% of frames;
- its longest unbroken possession is 9 frames (0.36 s);
- the carry rule needs 1 s and 2 m, so carry (`e57664a6`) still found **0 events**.

**What would change it** (Fola's choice):
- bridge short ball gaps inside a trajectory (ball trajectory or possession continuity);
- a ball detector that sees the ball in more consecutive frames;
- the gate itself: 0.40 looks right for this camera, but it only matters once the ball is
  continuous.

### A fix: evidence a unit in the last place apart

**The problem:** carry refused the 51-frame run.
- The run's coverage, 51/3615, is `0.014107883817427386` in the worker's index but
  `0.01410788381742739` in the job row. A 17-digit float loses a digit on the way into the
  jsonb column (Postgres keeps 17 digits when given them directly, so the loss is on the
  write path).
- The API compared evidence as JSON strings, and the worker compared the queued index
  with `!=`, so a sound run was refused.
- The 2-frame run passed only because 2/3615 fits in 16 digits.

**The fix:**
- Evidence is now compared by value, in the API (`sameEvidence`) and the worker
  (`evidence.same_evidence`). Key order is free, numbers may differ by 1e-12 relatively,
  and nothing else is loosened (booleans are not numbers, and NaN matches nothing).
- The worker still pins the index bytes by checksum. It then uses those pinned bytes,
  not the queued copy.

**Tests:**
- the 51/3615 pair is accepted on a whole possession run (API) and a whole carry run
  (worker);
- a genuinely different coverage is still refused;
- with exact comparison put back, the new tests fail.

Checked live with the fixed worker code mounted into the CPU image: carry completed on
the 51-frame run.

## Option A: bridging short ball gaps

Fola chose to bridge short gaps first (option A), then start on a better ball detector
(option B).

**Simulated first**, on this clip's ball and track data, at the 0.40 gate and 200 ms
continuity:

| Gap allowed | Candidate frames | Stretches of 1 s or more |
|---|---|---|
| none | 54 | 0 |
| 6 frames | 187 | 2 |
| 15 frames | 203 | 4 |

So A alone was expected to give one or two carries here. The detector, not the bridging,
is the main limit.

**What was built.** Neither change gives a lost frame a coordinate.
- **Possession**, `possessionConfig.maxBallGapMs` (0–1000 ms, default 0, so unchanged
  unless set):
  - a loss the detector caused (no detection, low confidence, ambiguous, missing frame)
    no longer restarts the same player's continuity, if it lasts no longer than the gap;
  - continuity is then keyed on camera and player, since the ball's trajectory restarts
    after any loss;
  - gap frames stay Unknown with no point;
  - a jump, a cut, non-play or another player still resets it.
- **Carry `event-carry/v2`**, manifest `e06c0cf7…`, which adds `maxBallGapMs: 240`:
  - a carry stays open across Unknown `ball_lost` rows that short, for the same camera
    and player;
  - the ball's trajectory may change only across such a gap;
  - displacement and speed still come from the player's own position, frame by frame.
- **Registry:** model version 0.2.0 (`93b4cff6`), image `dtp-vision-engine:cpu-d868758`,
  built from commit d868758.

**Tests:**
- possession: a short gap holds the player; a long gap, a cut, another player and a
  motion jump each still reset it; the setting is bounded;
- carry: it survives a short loss; it ends on a long gap, a non-ball reason or another
  player; a trajectory change with no gap still never joins;
- the API passes the setting through, and refuses values out of range.

**Live run** on the clip, CPU only:

| Job | Settings | Result |
|---|---|---|
| Possession `ee333102` | calibrated, 0.40, 200 ms, 240 ms gap | 87 candidate frames (13 without the gap) |
| Carry `84008b01` | `event-carry/v2` | **1 carry** |

**The carry:** 01:20.3 to 01:23.1, track 3767, 3.4 m.
- Looking at the frames, it is a real carry: a Divine Praise player, shirt 8, dribbling
  the ball.
- In two frames the detector missed the ball, which was plainly at his feet. Those are the
  gaps the bridge spans.
- It is 7–10 s from the nearest keyframe, where calibration drift was measured at up to
  3 m. The 3.4 m figure is therefore uncertain.

This is Claude's reading of the frames, not a person's review. The gold labels will
score it.

## Still open

- **Gold:** two independent people label the clip's events.
- **The ball detector (option B):** the ball is found in 35% of frames, and most misses
  are frames with no ball detection at all. Bridging (option A, above) gives one carry;
  a football-specific detector is the main lever.
- **Centre-circle views with one side of the circle** are now refused, not fitted
  wrongly. Calibrating them would need more landmarks in the catalogue, for example
  points on the circle off the halfway line.
- **Carried quality:** a carried frame should lose quality with distance from its
  keyframe. The 3 m drift at 10 s is still labelled `good`.
- **The editor header** says "0s calibrated" when the shots have keyframes. It counts
  whole-segment calibrations only.
