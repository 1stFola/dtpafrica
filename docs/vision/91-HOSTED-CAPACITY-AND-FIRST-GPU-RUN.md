# 91 — Hosted capacity that stops, and the pilot's first GPU run

8 October 2026. Follows [90](./90-HOSTED-WORKER-CALLBACK.md). Fola asked for the two
faults doc 90's run exposed to be fixed. RunPod was funded, and the pilot's detect
stage then ran on a rented GPU.

## The two faults, fixed

**1. Nothing stopped a pod.** No code in the control plane called a provider's
`terminate`. The worker quits after two idle minutes, but RunPod restarts a container
that exits, so a hosted pod billed until someone noticed. Ending a worker now ends its
cost:

- **`WorkerCapacityService.stop`** terminates a hosted worker's pod, then retires the
  worker, then records `worker.retired` with a `reason` and `terminated`. Termination
  comes first, because a retired row whose pod still runs is the bill this exists to
  stop. A provider's terminate is idempotent, so retiring an already retired hosted
  worker also stops a pod left running. Self-started providers (`local`, `mock`) are
  retired without a terminate.
- **`POST /vision/workers/:id/retire`** now goes through `stop`, and answers
  `{ ok, terminated }`.
- **The dispatcher's pass** now calls `reapIdle` after the job reap. It looks at every
  unretired hosted worker that has a pod, and:
  - keeps any worker that holds a claimed or running job;
  - stops a registered worker after **5 minutes** with no job activity (latest
    `finishedAt`/`heartbeatAt`, or its last token change);
  - stops a never-registered pod after **20 minutes**, which allows for a cold pull of
    the GPU image.

  One worker's failure is logged and the rest are still checked. A worker whose pod
  could not be terminated is not retired, so the next pass tries again.

**2. A failed launch left a live worker.** Provisioning mints a worker row and a
bootstrap token before calling the provider. When the launch threw (it did, the first
time: "account balance is too low"), the row kept a live token for capacity that did
not exist. The token is now revoked before the failure is passed on. There is no audit
row, because nothing was started. If revoking fails too, the launch's own error is
still the one reported.

**Also: a private image.** The RunPod adapter now sends `containerRegistryAuthId` from
`VISION_RUNPOD_REGISTRY_AUTH_ID`. That is the id of a credential created in RunPod;
the credential itself never passes through the API.

**QA:**

- **Tests:** a new `worker-capacity.spec.ts`, plus updates to the provision, dispatcher,
  DI and provider-conformance specs.
- **Mutation testing:** nine mutants killed:
  - no retire on launch failure;
  - the retire endpoint bypassing capacity;
  - a busy worker ignored;
  - the register grace equal to the idle grace;
  - idle measured without the latest job;
  - no terminate;
  - retire before terminate;
  - local workers terminated;
  - the dispatcher never reaping.
- **On real RunPod pods**, all three paths were seen to work:
  - **Operator retire:** retiring a pod that RunPod had exited returned
    `terminated: true`, and the pod was gone.
  - **Never registered:** a pod still unregistered at 20 minutes was terminated by the
    reaper with `reason: never_registered`.
  - **Idle:** a pod that finished its job was terminated by the reaper 5 minutes 10
    seconds later, with `reason: idle`.

## The pilot's first GPU run

**Setup:**

- **Image:** the GPU worker image was built from code identical to `main` at `9816ef0`
  and pushed to private ECR as `dtp-vision-worker:gpu-9816ef0c` (the repo keeps 10
  images, so the push expired the oldest, `e99fdd6`). Its FFmpeg is the GPL
  `4.4.2-0ubuntu0.22.04.1`, as the register's GPU row now records.
- **Licence:** Fola's ruling that DTP's private image may run on rented hardware is in
  the register's FFmpeg section.
- **Model:** the baseline was registered as `detector/torchvision-fasterrcnn-coco`,
  version `0.1.0-coco` (`929d327b`, candidate). The first run pinned its weights to
  `258fb6c6…`.
- **Callback:** the API was reached through a Cloudflare quick tunnel for the length of
  the run, then the tunnel was closed.

**What happened:**

1. **First pod.** RunPod exited it after 10 seconds. The image was never pulled: the
   first registry credential did not authenticate.
2. **Second pod.** With a credential created from a fresh ECR token, the pull started,
   but the worker had not registered by 20 minutes, and the reaper stopped the pod.
3. **Third pod.** It registered after 3 minutes, and detect ran.

**Detect on the 49.7 s clip** (job `801365f7`):

| Measure | Value |
|---|---|
| Frames | 1,244 at 25 fps, 43 s on the GPU |
| Person detections | 22,315 |
| Ball detections | 660 |
| Frames with a ball | 547 (44%) |

These are raw counts from the baseline, not accuracy: nothing has yet been compared
with human labels.

**Cost:** RunPod's balance went from $9.9730 to $9.6615, so **$0.31** for all three
pods, against the $4 ceiling. Card prices ranged from $0.27/h to $0.89/h as RunPod
fell through the GPU list.

**Then, on the local CPU worker** (`dtp-vision-engine:cpu-9816ef0c`, at $0), with the
tracker registered as DTP's own code (`tracker/dtp-bytetrack-iou` 0.1.0, `8fb1cf8f`):

- **cuts** found no camera change: one proposed segment covering the clip.
- **track** built 489 tracks.
- **ball_trajectory** marked all 1,243 frames lost with reason `camera_unknown`. No
  camera segment has been declared, so the stage refuses to call anything observed.
  That is the design: unknown beats wrong.

## What Phase 6 still needs, and who does it

1. **Declare the camera segment (a person).** One segment, 0 to 49,706 ms, `live_play`,
   if someone who has watched the clip confirms it holds no replay. The proposal ends at
   the proxy's 49,760 ms; a declaration must stop at the source's 49,706.
2. **Calibrate it (a person).** File the pitch calibration for that segment in the
   calibration workstation.
3. **Then the CPU stages (Claude, $0).** Rerun track and ball trajectory, so both pin
   the declared segment. Then run calibrated possession; register the weight-free carry
   rule (`event-carry/v1`); run carry; import the run for review.
4. **Gold labels (the two reviewers).** They submit their independent labels on the
   existing reference, reconcile, and the other person approves the freeze. Then the
   complete original carry run is scored against it.
5. **Close the gate (Fola).** Representative real-footage per-event and actor
   accuracy. One 50-second clip informs feasibility but cannot be representative.
   Phase 6 closes on a decision about what footage is enough.
