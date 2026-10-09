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

## Next

1. **Filter tiled candidates before merging.** Both kinds of false ball have a tell:
   - **colour:** the boots are yellow and orange, and the match ball is mostly white;
   - **motion:** the spare ball only moves with the camera.

   A colour check on each tiled box can be measured offline against the frames already
   checked by eye, at $0, before any new GPU run.
2. **Or leave the ball to a model trained on DTP footage**, which Phase 3 already
   plans. The tiles show the ball is findable at this size; what is missing is telling
   it from boots.
