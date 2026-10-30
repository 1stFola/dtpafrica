# 102 — The train stage

20 October 2026. Step 4 of the training plan (doc 98), first half: a run that fine-tunes
the detector on a frozen dataset and reports what it learned. Loading the trained
weights in `detect` is the second half, and comes next. Contract **1.23.0**.

## What a run is

1. **A person asks for it.** `POST /vision/models/training` (`vision.models.train`) takes
   `datasetVersionId`, **`budgetUsdCents` (never defaulted, 1–2000)**, an optional
   `resourceClass` (`gpu_24gb` by default, or `gpu_48gb`) and optional
   `hyperparameters`. Doc 12 gives training its own cap, approved per run, so the
   budget comes with every request.
2. **The control plane checks the dataset.** The dataset version must pass every check
   a model version would have to pass: frozen, no revoked members, no gold
   contamination. Every train and val member must also carry a training right *today*,
   not only when the version was frozen. The export must exist and cover the current
   members, and both splits need approved label windows.
3. **It pins the inputs.** It reads `samples.json`, records its SHA-256, and lists the
   export plus every train and val proxy as the job's `readKeys`. Gold and test members
   are not listed, so the worker cannot read them.
4. **The worker (`train`, a GPU stage) trains:**
   1. It checks the export's checksum and reads the labelled frames.
   2. It decodes those frames from the proxies.
   3. It fine-tunes torchvision's COCO Faster R-CNN with a new head for the contract's
      four classes.
   4. It scores the val split with the benchmark's own `evaluate()` at IoU 0.5.
   5. It writes `weights.pt`, `train-config.json` and `train-metrics.json` to the models
      bucket under the job's prefix.
5. **A person turns a succeeded run into a version.**
   `POST /vision/models/:id/versions/from-training` takes `jobId`, `version`,
   `gitCommit` and `licenceNote`. The weights key, checksum, dataset, config key
   (`trained/torchvision/fasterrcnn_resnet50_fpn/v1`) and worker image all come from the
   run. The registry's rules then apply as for any version: it is a `candidate`, and
   promotion needs a benchmark, a model card and a second person.

## Which frames it learns from

- **Every frame inside a label window**, with or without boxes. A labeller who looked
  and drew no ball box said "no ball here", and the model needs those negatives. Doc
  101's hard-frame tasks are one frame each, so each approved task is one training image.
- **Left out and counted:**
  - frames with an uncertain box, or under an uncertain window, as `skippedUncertain`.
    An unsure label is neither a positive nor a negative.
  - frames that will not decode, as `undecodable`. Seeking to a clip's very last frame
    can fail. If more than 1% of frames will not decode, the run is refused.
- **Refused before any GPU time:** an export whose checksum moved; a member missing from
  the export or tagged with another split; a label outside the four classes; a box
  outside every label window; no labelled frame in either split; and a job that names a
  model version. A run produces a version; it does not run one.

## The recipe

torchvision's reference recipe, kept small enough to read (`trainer.py`):

- SGD with momentum 0.9 and weight decay 1e-4;
- a linear warm-up over the first epoch, and the learning rate cut tenfold two thirds
  of the way through;
- horizontal flips;
- mixed precision on CUDA;
- **defaults:** 12 epochs, batch 4, learning rate 0.01, images kept at the proxy's
  native 720/1280;
- everything seeded, so a rerun on the same data and image is the same run.

Torch loads only inside the stage, so the CPU image still loads the stage registry.

**Cost estimate:** about 3,400 frames × 12 epochs on an RTX 4090 is roughly an hour, so
**about $0.70–$1 a run**. That is the 4090 detect rate from doc 101 scaled to training
steps; the first real run will measure it.

## QA

- **Contracts:** 119 tests. They include one that withholds `train` from 1.22 workers,
  which would otherwise fail it as an unknown stage.
- **Worker:** 654 tests pass. `test_train.py` covers:
  - negatives kept;
  - uncertain frames and windows skipped;
  - gold left unread;
  - the checksum pin;
  - every refusal;
  - undecodable frames counted, then refused past 1%;
  - val scoring;
  - three artifacts in the models bucket.
- **The real trainer**, `test_trainer_torch.py`, runs in the GPU image: one epoch on four
  synthetic frames, including a negative, with the weights loading back into a 5-way head.
- **API:** 2,166 tests. A run is refused without a budget, with out-of-range
  hyperparameters, with an empty val split, with a lapsed right, with no export or a
  stale one, or with no labels. Registration takes everything from the run, and refuses
  a failed run, a non-detect model, or a run that recorded no checksum.
  `scripts/gates.spec.ts` fails locally on CRLF in an untouched gate script, which is
  the known autocrlf artefact.
- **Smoke run on real frames:** in the GPU image on CPU, the real stage and trainer ran
  on two 1XCup clips:
  - 12 train and 4 val frames decoded with OpenCV;
  - the detector's pre-labels stood in for human labels;
  - one epoch, which produced 166 MB of weights, a config, and metrics;
  - the base checkpoint hashed to `258fb6c6…`, the COCO weights the pilots pinned.

  There was no end-to-end run through the control plane. That needs approved labels,
  and faking them would put invented labels into real footage's training data.

## Not yet

- **`detect` loading registered weights:** the next increment. Until then a version
  registered from a run cannot be run by detect, which refuses its config key.
- **The benchmark on a training dataset (fixed 28 Oct 2026).** The stage read every
  sample in the export as gold. The control plane lists predictions for gold members
  only, so a dataset that also had train and val members was refused: "2 gold
  member(s) have no detect artifact listed". A worker test reproduced exactly that.
  The stage now scores only samples tagged `gold`, and reports the rest as
  `otherSplitSamples`. An export with no gold sample is refused. The API side was
  already scoped to gold. It reaches a worker once the CPU image is rebuilt from this
  code.
- **The monthly GPU cap** (`VISION_MONTHLY_BUDGET_USD_CENTS`) is shown on
  `/vision/status` but nothing enforces it. Training has its own cap now (below).
- **A run's budget is per attempt.** The reaper and the worker both measure from the
  latest claim, and a job gets up to three attempts, so a run that keeps losing its
  worker can spend up to three times its budget. The monthly cap counts every
  attempt, so the month stays bounded.

## The monthly training cap (29 Oct 2026)

`VISION_MONTHLY_TRAINING_BUDGET_USD_CENTS`, $50 by default, is training's own cap for
the UTC calendar month (doc 12: "Separate, higher cap").

- **A finished run** counts the time of every attempt, from each `claimed` event to
  the event that ended it, at the configured rate (with any
  `VISION_RATE_*_USD_PER_HOUR` override).
- **A run still queued or running** counts its finished attempts plus its whole
  budget, which the current or next attempt may still use.
- **A run never claimed**, such as one cancelled in the queue, counts nothing.
- **A request** whose budget is more than what is left is refused with
  `TrainingMonthlyCapReached`, giving spent, held and left. The check runs after
  every other check, just before the run is queued. Two requests at the same moment
  could both pass. Runs are rare and asked for by a person, so that is accepted.
- `GET /vision/models/training/budget` (`vision.read`) returns the month: cap, spent,
  held, left and the number of runs.

## Files

- **Contracts:**
  - `packages/vision-contracts/src/train.ts`;
  - `jobs.ts` (1.23.0, `train` since 1.23.0);
  - `compatibility.spec.ts`.
- **Worker:**
  - `dtp_vision_worker/train_data.py`, with no torch;
  - `trainer.py`, torch;
  - `stages/train.py`;
  - `stages/__init__.py`, where `train` is a GPU stage;
  - `tests/test_train.py` and `tests/test_trainer_torch.py`.
- **API:**
  - `models/training.service.ts` and its spec;
  - `models.controller.ts`, the two routes;
  - `jobs/vision-jobs.service.ts`, where `enqueueDetached` takes a resource class;
  - `jobs/stage-results.service.ts` (`applyTrain`);
  - `docs/vision/07-API-CONTRACTS.md`, the regenerated route table.
