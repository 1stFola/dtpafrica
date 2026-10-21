# 103 — Detect loads trained weights

20 October 2026. Step 4 of the training plan (doc 98), second half. A model version
registered from a `train` run (doc 102) can now be run by `detect`. Contract **1.24.0**.

## How it works

1. **The version names its weights.** A version registered from a run has the config
   key `trained/torchvision/fasterrcnn_resnet50_fpn/v1`. It also records `weightsKey`
   (the run's `weights.pt` in the models bucket) and `weightsChecksum`.
2. **The control plane passes them on.** Queueing detect for such a version adds
   `detector.weights = {key, checksum, configKey}` to the job. `configKey` is the run's
   `train-config.json`, which sits beside the weights. Both files are added to
   `readKeys`, so the worker may read them and nothing else, and a caller cannot forge
   either one. A trained version with no weights file or checksum is refused
   (`TrainedWeightsMissing`).
3. **The worker checks before it loads.** Before the proxy is fetched, it reads the
   training config and refuses it if:
   - it is for another detector;
   - it records other weights than the version names;
   - it was trained on other classes;
   - it records no image sizes.

   It then downloads the weights and refuses them if their SHA-256 is not the version's.
   Loading unchecked bytes would run whatever happened to be at that key under the
   version's name.
4. **It builds the trained model.** It builds the fine-tuned architecture (Faster R-CNN
   with a 5-way head, at the run's image sizes) and fills it from the checked file
   with `weights_only=True`. Nothing is fetched from COCO.
5. **It reports in the contract's classes.** A trained model's labels already are the
   contract's classes, so **goalkeeper and referee come through as themselves**. The
   COCO baseline can only report `person` as `player`. The artifact's `classes` map says
   which mapping applied, and the completion carries the checked checksum, which the
   registry pins.

There are no ball tiles on trained weights for now. The tiles made up for COCO's
weakness on a small ball; whether a model trained on this footage still needs them is
something to measure after the first run.

## Contract 1.24.0 needs a new GPU image

`detect` moves from 1.21.0 to 1.24.0, so a worker built before this cannot claim
detect. Otherwise it would run the COCO detector under a trained version's name.
`train` (1.23.0) needs the new image anyway.

**Before the next GPU run, publish a GPU image from this code.** Use CI's manual GPU job
with `publish-gpu-image`. The current `gpu-aa22684` image (contract 1.21) will no longer
be handed detect jobs by a control plane at 1.24.

## QA

- **Contracts:** 120 tests, including detect withheld from a 1.23 worker.
- **Worker:** `test_detect.py` covers the trained path: the config and weights are
  fetched and checked before the proxy, contract classes are reported, the checked
  checksum is reported, and every refusal (missing weights, wrong bytes, a config for
  another detector, other weights, other classes, no sizes).
- **The round trip:** `test_trainer_torch.py`, run in the GPU image, trains tiny weights,
  loads them through detect's real loader, runs it, and gets only contract classes.
- **API:** the jobs spec covers the weights, checksum and training config handed to
  detect, the declared reads (a caller's own `readKeys` are dropped), and
  `TrainedWeightsMissing`.

**Not yet run on a pod:** it needs a trained version, and that needs labels.

## Files

- **Contracts:** `jobs.ts` (`DETECTOR_CONFIG_TRAINED`, `DetectJobParams.detector.weights`,
  `readKeys`, 1.24.0), `train.ts`, `compatibility.spec.ts`.
- **Worker:** `stages/detect.py` (`TrainedWeights`, `trained_weights`, and the
  trained-model branch of `_torchvision_detector`), `config.py`, `tests/test_detect.py`,
  `tests/test_trainer_torch.py`.
- **API:** `jobs/vision-jobs.service.ts`; `models/models.service.ts`
  (`ResolvedModelVersion` gains `weightsKey` and `weightsChecksum`);
  `jobs/vision-jobs.spec.ts`.
