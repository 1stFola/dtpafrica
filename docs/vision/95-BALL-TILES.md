# 95 — A tiled ball pass for small balls

8 October 2026. The detector misses a small ball that is plainly in view. This adds an
optional tiled pass for the ball only, as its own detector config, so a run with it is
a separate model version from a run without.

## What the pilot showed

The pilot's detect run (`801365f7`, COCO Faster R-CNN, version `929d327b`) found a ball
on 44% of frames overall. The rate per shot ran from 100% down to **15%**
(4.12–14.36 s) and **28%** (31.56–40.36 s).

The ball is tiny: median 14 px across, a quarter of detections under 12 px. torchvision
resizes a 720p frame's shorter side to 800 px, barely enlarging it, so a ball at that
size sits near the bottom of what COCO's Faster R-CNN can see.

**An earlier statement corrected:** possession's "ball lost on 1,176 of 1,243 frames"
in doc 94 was mostly not the detector. Only 2 of 7 shots were `live_play`, and ball
trajectory does not follow the ball in other shots.

## The experiment

59 sampled frames from the two weakest shots were run through the same registered
weights (`258fb6c6…`, checked by hash) three ways:

- **current:** shorter side 800;
- **higher resolution:** shorter side 1440;
- **tiles:** four overlapping corner tiles at 60% of the frame, each resized as current.

Every best detection scoring 0.3 or more was checked by eye.

| | Current | Higher resolution | 2×2 tiles |
|---|---|---|---|
| **4.12–14.36 s shot, 32 frames:** real ball | 2 | 9 | 9 |
| false positives | 0 | 3 | 3 |
| **31.56–40.36 s shot, 27 frames:** real ball | 7 | 5 (+1 unclear) | 6 (+2 probable) |
| false positives | 0 | 0 | 0 |

- **Shot 1:** the ball lies in open grass on frames 108–180, and the current pass
  finds it on 2 of 9 frames. Both larger scales find it on all 9, mostly at 0.95–1.00.
- **Shot 2:** each setting finds balls the others miss. Higher resolution alone is
  not better.
- **False positives** (boots, a leg, a player) all scored 0.34–0.61. Of the real balls
  the larger scales added, all but one scored 0.83 or more.

This counts verified finds on a sample. On frames where nothing was detected I did
not check whether a ball was visible, so it is not a recall figure.

## What was built

**A detector config, chosen by the model version.** The model version's `configKey`
decides what a detect job runs:

- `builtin/torchvision/fasterrcnn_resnet50_fpn/COCO_V1`: unchanged;
- `…/COCO_V1+ball-tiles/v1`: the same weights, plus the tiled pass.

Contract **1.20.0** (`DETECTOR_CONFIGS`, `DetectJobParams`):
- **The control plane** sends `params.detector.configKey` with every detect job.
  - It refuses a version whose config no worker runs (`DetectorConfigUnknown`).
  - `detector` is a reserved input, so a caller cannot choose it.
- **The worker** refuses a missing or unknown config before downloading anything. It
  reports the config it ran in the artifact and the summary (`detectorConfig`).
- **The control plane rejects a completion whose config is not the version's**
  (`ProvenanceMismatch`). That includes a worker older than 1.20 that reports none.
- **Detect needs a 1.20 worker.** Older workers keep their other stages.

**The tiled pass** (`stages/detect.py`):
1. Each frame is also run as four corner tiles, each 60% of the frame.
2. From the tiles, only ball boxes scoring **0.7 or more** are kept. People come only
   from the whole frame, since a person cut by a tile edge would come back as a second,
   smaller person.
3. A tiled ball overlapping a ball the whole frame found (IoU 0.3) is that ball. The
   whole frame's box is kept, so tiles add frames with a ball and never move one.
4. Two tiles seeing the same ball keep the more confident box.
5. The summary and artifact record the settings and `ballsAdded`.

**The cost:** about five times the inference per frame. The pilot's detect pass used
32 GPU-seconds, so the tiled version would take about 2.5 GPU-minutes on the same pod.

## QA

- **Suites:**
  - worker 595;
  - contracts 116;
  - web 278;
  - API 1,937 of 1,938 (the one failure is the local CRLF gate script, doc 89);
  - both typechecks and both builds pass.
- **Mutation testing:** 11 mutants, all killed. One survived the first run: dropping
  `detector` from the reserved inputs. The control plane's value already wins on a
  detect job, so a test now checks that a caller's `detector` is stripped from any
  other job.
- **New tests:**
  - worker: config refusals before download; the config and tile settings reported;
    the tile windows; the merge rules (add, never move or double, the more confident
    of two, nothing under 0.7, no people); the contract mirror;
  - API: the config sent and unforgeable; unknown and missing configs refused; a
    completion from another config, or from a worker that reports none, refused;
  - contracts: a 1.19 worker withheld from detect.
- **The real torch code, run from source in the GPU image on CPU:**
  - frames 116 and 124: the plain pass finds no ball; the tiled pass adds it at 0.97
    and 0.98;
  - frame 180: the plain pass's ball is kept unchanged;
  - frame 236: the boots seen in the experiment are not added.

## The run on the pilot (9 October 2026)

**Setup:**
- **Image:** `dtp-vision-worker:gpu-fe55265` in private ECR. The first push dropped
  mid-layer through Docker Desktop's proxy; the retry completed.
- **Model:** version `0.2.0-coco-ball-tiles` (`f9537db9`, candidate), the same model
  and weights as `929d327b`.
- **Pod:** one RunPod pod, through a Cloudflare quick tunnel. It registered 9.5 minutes
  after launch, the time going mostly to the image pull. Fola refreshed the registry
  credential first, because ECR tokens last 12 hours.

**Two runs on that pod:**
- **Job `92f19c93`** was queued without `sampleFps` and so ran at the stage's default
  of 2 fps (100 frames). It is not comparable with the plain run. It showed the config
  and the weights checks working on a GPU, and the tiles added 20 balls in 11
  GPU-seconds.
- **Job `ccf2a171`** ran at 25 fps, as the plain run `801365f7` did: 1,244 frames in
  139 GPU-seconds, with the weights hash verified.

**Afterwards:** the capacity service retired the pod 5 minutes after its last job, and
RunPod reported no pods on the account. The tunnel was closed. **Cost:** RunPod's
balance went from $9.6615 to $9.4073, so **$0.25**. Phase 6 spend is now $0.57 of $4.

**Frames with a ball, per shot:**

| Shot (ms) | Frames | Plain (`801365f7`) | Ball tiles (`ccf2a171`) | Frames with 2+ "balls" |
|---|---|---|---|---|
| 0–1040 | 26 | 26 | 26 | 16 → 17 |
| 1040–4120 | 77 | 67 | 67 | 48 → 49 |
| 4120–14360 | 256 | 38 | **78** | 0 → 0 |
| 14360–26000 | 291 | 154 | 166 | 28 → 31 |
| 26000–31560 | 139 | 64 | 75 | 0 → **7** |
| 31560–40360 | 220 | 61 | 72 | 1 → 2 |
| 40360–44360 | 100 | 63 | 97 | 6 → **54** |
| 44360–49706 | 134 | 74 | 118 | 3 → **53** |
| **All** | 1,244 | 547 (44%) | **699 (56%)** | |

**Integrity:** the plain pass's detections are identical, and first, in every frame;
the tiles only add. No frame lost a ball.

**What the added balls are.** I checked six crops per shot by eye:
- **4.12–14.36 s:** the match ball in open grass, at 0.95–0.99. A real gain.
- **40.36–44.36 s:** a real ball by the goal post. It only drifts as the camera pans,
  so it is probably a second, stationary ball, not the one in play.
- **44.36–49.71 s:** a player's yellow boots, at 0.81–0.97. False positives.
- **26–31.56 s:** a red leg, then a seated player's orange boots, at 0.73–0.91. False
  positives.

**So the 0.7 cut-off does not hold across the clip.** On the 59-frame sample every
false positive scored under 0.7. On the whole clip, brightly coloured boots score as
high as the ball. The tiles find the ball where it is clear and small, and they also
add confident boots and a second ball. The overall 44% → 56% overstates the gain.

## Ball trajectory on both

Both detection files went through the worker's own smoother (`ball_trajectory.Smoother`,
default config), offline, on CPU, with no job and nothing written. Every shot was
treated as `live_play` so the whole clip is compared; the real segments mark most
shots `unknown`.

The smoother does not choose between candidates. A frame with two or more balls scoring
0.5 or more is `ambiguous`, which counts as lost. So a false ball beside the real one
costs that frame, and a false ball alone is followed as if it were the ball.

**Observed frames:** 395 with the plain pass, 499 with tiles. Per shot:

| Shot (ms) | Gained | From a tile box | Lost | The tile box |
|---|---|---|---|---|
| 0–1040 | 0 | 0 | 0 | |
| 1040–4120 | 0 | 0 | 1 | |
| 4120–14360 | 40 | 40 | 0 | **the match ball** (checked) |
| 14360–26000 | 12 | 12 | 3 | not checked |
| 26000–31560 | 12 | 12 | 7 | partly boots |
| 31560–40360 | 12 | 12 | 0 | not checked |
| 40360–44360 | 44 | 44 | **32** | **the spare ball by the post** |
| 44360–49706 | 59 | 59 | **32** | **yellow boots** |

**Verdict:** the ball-tiles pass is **not usable as it stands**.
- **Where nothing else is ball-like**, it is a clear win: the 4.12–14.36 s shot went
  from 26 to 66 observed frames, all of them the match ball.
- **Where a boot or a spare ball is in view**, the trajectory follows the wrong object
  and loses the real ball on 32 frames in each of the last two shots.

Version `0.2.0-coco-ball-tiles` stays a candidate, and the plain run stays the
reference.

## A colour filter on the tiled balls (offline, $0)

**The rule.** A tiled ball box is kept only if, inside its inner ellipse:
- no pixel is warm: yellow, orange or red (OpenCV hue under 38 or over 165, saturation
  over 50, value over 70);
- at most 15% is grass green;
- and the box is roughly square (aspect 0.85–1.3).

Plain-pass boxes are never filtered.

**How it was chosen and checked.** Every tile-added box was cropped and labelled by eye
as match ball, spare ball or not a ball, before its scores were seen.
- **Tuning set:** 48 boxes, 8 per shot. Brightness alone did not separate them: boots
  with white socks scored as white as the ball. Warm colour did, once the hue range
  included yellow.
- **Held-out set:** 43 different boxes, labelled before the rule was applied.

| | Match ball kept | Spare ball kept | Not a ball kept |
|---|---|---|---|
| Tuning set | 16 of 16 | 10 of 10 | 1 of 22 |
| **Held-out set** | **11 of 12** | 10 of 11 | **2 of 20** |

The held-out mistakes were a red player and one yellow boot let through, and one match
ball rejected.

**Trajectory with the filter applied to the whole clip.** The filter dropped 121 of
the 272 tile-added balls.

| Shot (ms) | Plain | Tiles | Tiles + filter | Followed a tile box |
|---|---|---|---|---|
| 0–1040 | 14 | 14 | 14 | 0 |
| 1040–4120 | 29 | 28 | 28 | 0 |
| 4120–14360 | 26 | 66 | **63** | 37: the match ball |
| 14360–26000 | 126 | 135 | 133 | 9 |
| 26000–31560 | 57 | 62 | 58 | 1 |
| 31560–40360 | 53 | 65 | 64 | 11 |
| 40360–44360 | 38 | 50 | 54 | **46: the spare ball** |
| 44360–49706 | 52 | 79 | 46 | 0 |
| **All** | 395 | 499 | **460** | |

- **The boots are handled.** No observation in the boots shot (44.36–49.71 s) follows
  a tile box any more. It still loses 6 frames against the plain pass, where a boot
  that slipped through makes a frame ambiguous.
- **The spare ball is not.** In 40.36–44.36 s, 46 of 54 observed frames follow it.
  Colour cannot tell two balls apart.

## A parked-ball check (offline, $0)

**The method.**
1. The production `camera_motion` rows for the pilot (run `28e82c23`, reference-frame
   tracking) were chained within each shot to remove the camera's motion. The breaks
   fall exactly on the six cuts. This puts every ball candidate in its shot's fixed
   ground coordinates.
2. A candidate's **dwell** is the number of frames in that shot with a ball within
   6 px of the same ground spot.

**Labelled boxes:**
- **The spare ball by the post** (40.36–44.36 s) dwells **87 frames** of its 100-frame
  shot.
- **The match ball** never dwells more than **42**, even when nearly still for about
  1.5 s before a kick (frames 112–178).
- **Brief spare-ball sightings** by the stands dwell 1–3 frames. The check does not
  catch them.

**The rule:** a tile-added ball dwelling **60 frames (2.4 s) or more** is dropped as
parked. It drops 79 tile balls. Plain-pass boxes are never dropped, so a match ball
held still longer than 2.4 s at a set piece still has whatever the plain pass gave it.

**Trajectory, colour filter and parked check together:**

| Shot (ms) | Plain | Tiles | + colour | + colour + parked | Followed a tile box |
|---|---|---|---|---|---|
| 0–1040 | 14 | 14 | 14 | 14 | 0 |
| 1040–4120 | 29 | 28 | 28 | 28 | 0 |
| 4120–14360 | 26 | 66 | 63 | **63** | 37 |
| 14360–26000 | 126 | 135 | 133 | **133** | 9 |
| 26000–31560 | 57 | 62 | 58 | **58** | 1 |
| 31560–40360 | 53 | 65 | 64 | **64** | 11 |
| 40360–44360 | 38 | 50 | 54 | **40** | 3 |
| 44360–49706 | 52 | 79 | 46 | **46** | 0 |
| **All** | **395** | 499 | 460 | **446** | 61 |

In 40.36–44.36 s the spare ball no longer takes the trajectory: 40 observed frames, no
ambiguity.

**What the remaining tile-followed frames are.** The 23 outside the 4.12–14.36 s shot
were checked by eye:
- 15 are the match ball;
- 6 are spare balls seen too briefly to count as parked;
- 2 are not balls (a leg, and one unclear).

The 37 in 4.12–14.36 s are the match ball, as checked earlier.

**Net against the plain pass:**
- **51 more observed frames** (395 → 446), almost all of them the match ball.
- **Still lost:** 6 frames in the boots shot, and 1 in 1.04–4.12 s, where a boot or
  extra ball that slipped through makes a frame ambiguous.

These rules were tuned and checked on this one clip, so they are a measurement on the
pilot, not a validated filter.

## Next

1. **Build the filters into the pipeline, if Fola wants this path:**
   - **the colour check** belongs in the detect stage's tiled pass, which has the
     pixels;
   - **the parked check** belongs where camera motion is already pinned, which today is
     `calibrate` and not `ball_trajectory`, so it needs a new input.

   That would be a new detector config (`ball-tiles/v2`), and so a new candidate
   version and one more GPU run.
2. **Or wait for a ball model trained on DTP footage** (Phase 3), and keep this as
   evidence that the ball is findable at this size.

**Earlier options, now measured:**

1. **The parked ball.** The spare ball's position stays fixed on the pitch: it moves in
   the picture only as the camera pans. `camera_motion` already measures that pan for
   every frame, so a candidate that stays put once the camera's motion is removed, over
   many frames, can be flagged as a ball not in play. That can also be measured
   offline at $0.
2. **Or let trajectory choose by continuity** instead of calling every two-candidate
   frame ambiguous. That would change the smoother's "Unknown beats wrong" rule, which
   is a decision for Fola.
3. **Until then,** version `0.2.0-coco-ball-tiles` stays a candidate. The colour rule
   is an offline experiment (`colour_rule.py` in the QA scratch); it is not in the
   worker.
