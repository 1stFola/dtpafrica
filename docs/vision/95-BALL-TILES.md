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

## Next

1. Build and push the GPU image at this commit.
2. Register a new detector version with the ball-tiles config, pinned to that image.
3. Re-run detect on the pilot. This is the one step that spends money: a few cents
   against the $4 ceiling, with $0.31 spent so far.
4. Compare ball coverage per shot with run `801365f7`.
