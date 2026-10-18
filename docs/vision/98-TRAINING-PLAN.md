# 98 — The training plan: a football detector first

18 October 2026. The first scored run (doc 97) gave the engine 0 of 43 events on the 1XCup
clip. It makes carries only, and finds the ball in about a third of frames when the ball
is plainly visible in most. Every part of the engine that sees is a general model trained
on everyday photos, and the event logic is one hand-written rule. This plan is how it
learns football, starting with the part that blocks everything else: the ball.

## What already exists, and what does not

**In place** (a survey of the code, 18 October 2026):
- **Box labelling:** per-frame boxes for player, goalkeeper, referee and ball. There is a
  labelling workstation (`AdminVisionTaskPage`), review with reasons, and an
  active-learning queue.
- **Datasets:** frozen versions with train, val, test and gold splits, grouped by match so
  one match never sits in two splits. Training requires `dtp_owned` footage with training
  rights. The export is FiftyOne JSON.
- **Hold-out, enforced by match:**
  - Footage under an event answer key cannot enter a training split, and the reverse.
  - The check matches the asset, its checksum or the ScoreBoard match id.
  - So the **whole Divine Praise v Kiraa match** is already barred from training, not
    just the clip.
- **Registry and promotion:** a model version needs a licence note and a dataset that is
  frozen, rights-clean and not contaminated by gold. Promotion needs a benchmark on frozen
  gold, no regression, a model card, and a second person to approve.

**Missing:**
1. **A training stage.** `train` is declared in the contracts (on `gpu_48gb`, writing to
   the `models` bucket), but no worker stage implements it and the API does not handle it.
2. **Detect loading trained weights.** The worker always builds torchvision's COCO Faster
   R-CNN. A registered version's `weightsKey` is never passed through or loaded.
3. **Pre-labelled tasks.** A task can name the model that pre-labelled it, but nothing fills
   it with that model's boxes. A person would start from an empty frame.
4. **Hard-frame mining.** Nothing feeds the active-learning queue from detect output, such
   as frames where the ball was lost between two sightings (doc 97 found 476 such frames on
   one clip).

## The plan, in order

### Step 1 — Footage (Fola)

**Not the held-out match.** The Divine Praise v Kiraa match is excluded automatically, and
it stays the yardstick.

**Other 1XCup 2026 matches.** The media agreement grants computer-vision training on all
1XCup 2026 media.

**Spread beats volume.** Doc 11's rule: one or two matches each from Lagos Queens Cup, Coal
City, Scout to Pro and 1XCup beat ten from one. A model trained on one pitch and one camera
learns that pitch and that camera.

**First target:** 8–10 matches from at least two competitions, each ingested through the
usual rights flow.

### Step 2 — Pre-labels and hard-frame mining (Claude, engineering)

- Fill each labelling task with the current detector's boxes, so people **correct** rather
  than draw. The task already shows "Pre-labelled by a model — check, do not assume".
- Mine hard frames into the queue:
  - the ball lost between two sightings (as in doc 97);
  - the ball at low confidence;
  - frames where the full-frame and tiled passes disagree.
- About a third of frames are sampled at random, so the model also sees ordinary play
  (doc 09's sampling mix).

### Step 3 — Labelling (people)

**Ball first.** The ball is the blocker; players are already found well.
- Ball-only frames are quick: confirm, move or add one box.
- **First target: about 3,000 frames with a checked ball box,** across the 8–10 matches.
- At roughly 10–15 seconds a frame with pre-labels, that is about **8–12 hours** of
  labelling, split between two or three freelancers.

**Players, goalkeepers and referees second.** These are slower: 15–25 boxes a frame. About
**1,000 frames**, mostly to teach goalkeeper and referee apart, which COCO cannot do.

**Reviewing:**
- The train split needs one labeller and a spot-check.
- The **gold split** of the dataset (10% of matches, carved first) needs two independent
  reviewers per frame, as for the event answer key.

These are estimates. The first hour of real labelling will correct them.

### Step 4 — The training stage and loading trained weights (Claude, engineering)

- A `train` worker stage:
  - reads a frozen dataset's export and fine-tunes a detector;
  - uploads the weights to the `models` bucket;
  - reports the weights checksum and validation metrics, so a new model version can be
    registered with full lineage (commit, dataset, config, image and weights).
- `detect` gains config keys for trained weights. The control plane passes a presigned
  weights URL and checksum; the worker downloads, checks and loads them.

### Step 5 — Train, benchmark, promote

1. **First model: fine-tune the current torchvision Faster R-CNN.** It is BSD-3, already in
   the OSS register, already in the image, and needs no licence review. The register
   approves it as a baseline only, "not a candidate for production". Its job is to prove the
   loop end to end and to show how much football data moves ball recall.
2. **Production candidate: RF-DETR,** the architecture doc 09 names. Its core is Apache-2.0,
   but the register marks it **review required** before the first training run, and its
   Plus/XL weights are under separate terms. Fola's licence review comes before this step.
   Ultralytics YOLO stays rejected (AGPL), including anything that pulls it in through
   another package.
3. **Benchmark** on the dataset's gold split: ball recall, mAP and per-class precision and
   recall, by slice (wide, crowded box, blur, compression).
4. **Then the events test:** rerun the 1XCup clip end to end with the new detector, and
   score it against the frozen answer key. The figure to beat is 0 of 43.

### Step 6 — Event models (later)

Passes, shots, tackles and the rest need labelled events on training matches. The answer
key's labelling page already does that, and the time fixes from docs 97–98 apply. This
starts once the detector gives the possession step continuous ball tracks to work from.

## Compute and money

**Rates** (doc 12, indicative): A5000 24 GB at about $0.27/hour; A6000 48 GB at about
$0.53/hour.

**Estimate:** fine-tuning Faster R-CNN on about 3,000 frames is roughly 1–2 GPU hours a
run, so **$0.30–$1.00 per run**. A first round of three or four runs is about **$2–4**.

**The $4 pilot ceiling** has $2.81 left after the pilot (about $1.19 spent). Doc 12 gives
training a **separate, higher cap, approved explicitly per run**. Fola sets it before the
first training run.

## Decisions for Fola

1. **Footage:** which 8–10 matches, from which competitions, and confirmation that their
   rights cover training.
2. **Labellers:** who, how many hours, and at what rate. About 8–12 hours for the ball and
   more for players.
3. **Training budget:** a separate cap for training runs.
4. **Licence review of RF-DETR** before the production candidate. The Faster R-CNN baseline
   needs none.

## Engineering order (Claude)

| # | Work | Unblocks |
|---|---|---|
| 1 | Pre-labelled tasks from detect output | Faster labelling |
| 2 | Hard-frame mining into the queue | Labelling the right frames |
| 3 | `train` stage (torchvision fine-tune) and model-version registration | The first trained model |
| 4 | `detect` loading registered weights | Using it in the pipeline |
| 5 | RF-DETR adapter, after licence review | The production candidate |

Items 1 and 2 can start now, alongside Fola's footage and labellers. Item 3 needs a frozen
dataset to train on.
