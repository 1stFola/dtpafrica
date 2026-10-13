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

**What a person clicking the same points would get:** the same misleading "usable". The
calibration check should refuse near-collinear points, or the catalogue should offer
centre-view points off the halfway line. This is still open.

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

## Still open

- **Gold:** two independent people label the clip's events.
- **Possession:** decide the foot-distance gate for this footage, after looking at frames
  where the ball is at a player's feet but is refused.
- **Centre-circle keyframes:** refuse near-collinear points, or add landmarks off the
  halfway line.
- **Carried quality:** a carried frame should lose quality with distance from its
  keyframe. The 3 m drift at 10 s is still labelled `good`.
- **The editor header** says "0s calibrated" when the shots have keyframes. It counts
  whole-segment calibrations only.
