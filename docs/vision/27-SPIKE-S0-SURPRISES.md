# 27 — Spike S0: surprises, and how to get the number

**Status: in progress. No pod has run yet, so there is no cost-per-match number in this file.**

[11-PHASE-PLAN.md § Spike S0](./11-PHASE-PLAN.md#spike-s0--one-match-end-to-end) asks for two
deliverables of equal weight: a measured unit-economics fact, and *"a written list of every
surprise."* The plan is explicit that the list is where the real constraints surface. This is that
list, started before the pod exists, because the surprises began well before the GPU did.

Everything below marked **measured** was observed. Everything marked **unmeasured** is waiting on a
pod and must not be quoted until it is filled in. That distinction is the whole point of the file.

---

## What exists now

| Deliverable | State |
|---|---|
| `dtp-vision-engine:0.1` GPU image | [`services/vision-worker/Dockerfile.gpu`](../../services/vision-worker/Dockerfile.gpu) — written, **not yet built** (no Docker daemon or CUDA host here) |
| `detect` stage | [`stages/detect.py`](../../services/vision-worker/dtp_vision_worker/stages/detect.py) — torchvision Faster R-CNN, 12 tests |
| Benchmark harness | [`bench.py`](../../services/vision-worker/dtp_vision_worker/bench.py) → `dtp-vision-bench`, 20 tests |
| Cost-per-match number | **missing** — needs one pod run |
| Surprise list | this file |

---

## Surprises

### S0-1 — The contract promised a stage no worker could run *(measured)*

`packages/vision-contracts` has declared `detect` a job type since Phase 1 increment 2 and routed
it to `gpu_24gb`. The worker's stage registry held `probe`, `fingerprint`, `transcode`. The control
plane would therefore accept and dispatch a `detect` job that no worker could ever claim
successfully.

**Why it survived five increments:** the cross-language guard in `tests/test_contract.py` asserted
that *every implemented stage routes to `cpu_small`*. That assertion passed **because** `detect`
was unimplemented, and would have started failing the moment anyone implemented it — a test whose
green depended on the work not being done. It is now stated per class, in both directions
(`CPU_STAGES` must route to `cpu_small`; `GPU_STAGES` must route to something starting `gpu_`), and
the registry asserts the two sets partition `STAGES`.

**What it changes:** "the contract is mirrored in Python" is not the same claim as "the contract is
satisfied." Increment gates should check the second.

### S0-2 — The GPU image cannot be built `FROM` the CPU image *(measured)*

The CPU `Dockerfile` has promised since increment 2 that *"the GPU image builds FROM this one and
adds CUDA plus the model stack."* It cannot. The CPU base is `python:3.12-slim-bookworm`, which has
no CUDA runtime and no supported route to one short of replacing the base. Layering CUDA onto a slim
Debian Python is how you get an image that builds and then cannot see the card.

`Dockerfile.gpu` starts from `nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04` instead. The two images
share the **package and the contract**, not a base layer, and the CPU Dockerfile's comment has been
corrected rather than left to mislead the next person.

**What it changes:** one package now serves two images, so `detect` imports torch *inside* the
function that needs it. Verified: the CPU image loads the stage registry with no torch installed.

### S0-3 — Near-miss: apt's pip would have installed torch into an interpreter nothing runs *(measured)*

First draft of the GPU image installed `python3.11` on Ubuntu 22.04 and pointed `python3` at it with
`update-alternatives`, while `pip` still belonged to the distro's 3.10. Every wheel — including 2.5 GB
of torch — lands in 3.10's site-packages; `python3 -c "import torch"` then fails. The image would
have built and the worker would have started with no torch.

Fixed with an explicit venv (`python3.11 -m venv /opt/venv`) so one interpreter is unambiguous for
pip, the entry point and the smoke test. The image also now fails its own build if `torch`,
`torchvision`, `cv2`, `boto3` or the stage registry will not import.

**What it changes:** the build-time smoke test is not ceremony. It converts "the pod started and
every job failed" into "the image did not build."

### S0-4 — The off-the-shelf detector is a licence decision, not a convenience one *(measured)*

Ultralytics YOLO is the obvious choice and is **AGPL-3.0**, which would attach a copyleft obligation
to a pipeline DTP intends to run as a service. The default detector is therefore torchvision's
COCO-pretrained Faster R-CNN: **BSD-3-Clause**, no dependency beyond the torch stack the image needs
anyway, and COCO gives `person` and `sports ball` directly.

It is a floor, not a recommendation — Phase 3 trains RF-DETR on the real dataset. But S0's baseline
number is now a number for a model DTP can actually ship.

**What it changes:** nothing about Phase 3's plan. It does mean "we'll just use YOLO for the spike"
was never free, and `docs/licenses/OSS_REGISTER.md` should carry the comparison.

### S0-5 — The development machine has neither FFmpeg nor torch *(measured)*

Not a footnote: it means **no part of this pipeline can be run end to end outside a pod**, and the
first real numbers must come from the pod itself. Two consequences, both deliberate:

- `detect_frames` takes its detector as an argument, and `bench.Pipeline` takes every step as an
  argument, so the arithmetic — timestamps, batching, ball counting, scaling, cost — is tested
  without FFmpeg or CUDA. 55 tests run in under a second.
- The harness ships **inside** the image (`dtp-vision-bench`). A harness on a laptop measures a
  laptop.

### S0-6 — S0 was never blocked on RunPod authorization *(measured)*

Recorded because it was stated wrongly earlier in this work: the RunPod **MCP server** needs an
interactive OAuth flow, which a non-interactive session cannot complete. The *product* path needs
none of that — `runpod-compute-provider.ts` reads a plain `VISION_RUNPOD_API_KEY`. The actual
blocker was S0-1: the missing stage.

**What it changes:** the remaining blocker for the number is a funded pod and a rights-cleared
match, not a credential mechanism.

### S0-7 — Ball visibility has to be counted per frame, and cost is a sampling decision *(measured)*

Two arithmetic traps found while writing the stage, both of which would have produced
confident-looking wrong numbers:

- **Two balls in one frame is one frame with a ball.** Counting detections instead of frames reports
  visibility above 100% and flatters the footage. There is a test named for it.
- **2 fps, not 25.** A 96-minute match is ~11,500 sampled frames instead of ~144,000. The dominant
  cost driver in S0 is therefore a sampling decision, not the choice of GPU — which means
  "benchmark A6000 vs L4 vs 4090" answers a smaller question than the phase plan implies. Compare
  sample rates with the same urgency as cards.

### S0-8 — A one-off cost scaled linearly inflates the unit price by a factor *(measured)*

Model weight download and CUDA warm-up happen once per **pod**, not once per **match**. On a short
clip they dominate wall clock, and scaling total time linearly to 96 minutes multiplies them by
~48 — enough to quadruple the quoted cost per match. The harness times `loadDetector` separately,
scales only the per-clip work, and amortises the one-off over `--matches-per-pod` (default 1, the
pessimistic end). Checked by mutation: charging the one-off to every match fails the test named for it.

**What it changes:** any cost number must state its matches-per-pod assumption. Pricing a service on
a cold-start number is a pricing error.

### S0-9 — A synthetic clip has to be made deliberately ugly to measure anything *(measured)*

A flat green rectangle encodes to almost nothing and decodes almost instantly, so timings from it
are fantasy. `bench.synthetic_clip` draws ten moving high-contrast boxes and a small ball-sized one,
then adds temporal grain, so the encoder and decoder do real work. Even then the report carries
three caveats in the JSON itself: detection counts mean **nothing**, transcode is **understated**
(the clip is generated already at proxy resolution and CFR, unlike a real 1080p/VFR platform
download), and bytes are **optimistic**.

**What it changes:** a synthetic clip can retire plumbing risk and produce a throughput
*lower bound*. It cannot produce the exit number, and the report will not pretend otherwise —
`measuredEndToEnd` is false and the sentence says "projected from".

### S0-10 — No built-in price table *(design consequence)*

The harness has no default $/hour. A hardcoded rate is a guess reprinted as a measurement on every
future run, and provider pricing moves. Omit `--usd-per-hour` and the report carries timings with no
cost line and says "costs an unpriced amount".

A related one-liner, found by this suite going flaky rather than by reading: a short synthetic
clip costs a few hundred-thousandths of a dollar, which ceiled to a **zero-cent** budget — the exact
failure `budget_cents` was written to prevent, at the bottom of the scale instead of the top. A run
that cost anything now gets a budget of at least one cent.

**It took three attempts, and the first two were in the wrong place.** Worth recording in full,
because the pattern belongs to measurement code specifically:

1. `budget_cents` was guarded so a positive cost could not ceil to zero. CI still failed.
2. `cost_usd` rounded to six decimal places *before* the budget ever saw the number, so below about
   2.3ms of billed time a positive cost became exactly `0.0`. Guarded too. CI failed again,
   identically.
3. The actual source was `Timer`, which rounded each span to a millisecond **as it recorded it**. A
   step finishing in 400 microseconds was stored as `0.0`, so a hosted runner measured the whole
   stubbed pipeline as zero seconds — and zero seconds costs zero dollars however carefully every
   calculation downstream is guarded.

The rule that would have prevented all three: **round at the edge, never in the ledger.** Spans and
totals are now kept at full precision and rounded once, on the way into the report. The one display
rounding that still mattered — `projectedMatchSeconds` to a tenth — was widened to three places for
the same reason: a report printing 0.0 seconds beside a positive cost is the same mistake in
friendlier clothes.

**The second lesson cost as much as the first: a timing-dependent assertion is a coin toss.** Three
tests here compared wall clock against a constant. The amortisation test was the worst — `per_clip`
is multiplied by the 96-minute scale factor, so three milliseconds of file-system jitter between two
runs becomes 0.14 seconds of difference and swamps the thing being measured. Injecting a slower load
only narrowed it to one failure in six. All three now **pin the clock**: every reading is a fixed
tick apart, both runs measure identically, and the assertions are exact rather than tolerant. The
suite got faster in the process, and a runner quicker than this machine is now simulated
deliberately instead of hoped against.
### S0-11 — The cost ledger hardcoded `gpuSeconds: 0` *(measured)*

Found while checking that a `detect` job could actually be dispatched, claimed and billed.
`runner.run_one` reported a fixed `"gpuSeconds": 0` in every job's cost record. That was **true** for
as long as every stage was CPU — and it became false the moment the first GPU stage existed, in the
single field the cost model needs most.

Fixed narrowly: `StageResult.gpu_seconds` defaults to `None`, meaning "this stage did not touch a
GPU", and the runner reports it as zero. `detect` times the inference loop and reports it **only**
when the detector says it ran on CUDA, so a local CPU run does not invent GPU cost. Download,
sampling and upload stay wall-clock; calling them GPU seconds would corrupt the same number from the
other direction.

Mutation testing found a hole while confirming the fix: the real detector's device advertisement is
the one link no test could exercise without torch, and removing it broke nothing. It is now held by a
source scan, with the reason written into the test.

**What it changes:** the first pod run will produce a GPU-seconds figure per job rather than a zero,
which is what makes `12-COST-MODEL.md` verifiable against reality instead of against itself.

---

## Deviation from D5 — raised, and settled

[02-DECISIONS.md D5](./02-DECISIONS.md#d5--phase-0-sequencing) originally said S0 runs on throwaway
code and **"No S0 code is merged into `services/`."** Two files here sit inside
`services/vision-worker`:

- **`stages/detect.py`** — not throwaway. The contract has declared this stage for five increments
  (S0-1); it is Phase 3's baseline and the fix for a live inconsistency. Writing a second throwaway
  detector outside `services/` would leave the contract still lying.
- **`bench.py`** — must run inside the image being measured, and the image contains this package and
  nothing else.

**Settled 29 September 2026:** D5 is amended to permit exactly those two, and the phase plan now says
the same thing in all three places it stated the old rule. The measurements — clips, pod launch
configs, report JSON, scratch analysis — stay throwaway, which is what D5's concern (*"demo code
wearing an architecture's clothes"*) was actually protecting. Anything else a spike wants to add to
`services/` needs a further amendment there, not a precedent from this one.

---
## Unmeasured — what the pod run must fill in

Nothing in this section may be quoted anywhere until it has a number beside it.

| # | Question | Where it lands |
|---|---|---|
| U1 | R2 → pod download time and sustained MB/s for a full match | `secondsByStage.obtain` |
| U2 | Cold weight download + CUDA warm-up on a fresh pod | `totals.oncePerPodSeconds` |
| U3 | FFmpeg transcode time for a real 1080p/VFR source | `secondsByStage.transcode` |
| U4 | Sample + inference minutes for ~11,500 frames | `secondsByStage.sample/detect` |
| U5 | GPU utilisation, peak VRAM, and whether `BATCH_SIZE = 8` is right | `gpu` |
| U6 | **Cost per match** on A6000 vs L4 vs 4090 | `cost.usdPerMatch` |
| U7 | **Ball visibility % on real Nigerian grassroots footage** | `detection.ballVisibilityPct` |
| U8 | How badly platform compression destroys ball pixels | narrative, here |
| U9 | Upload behaviour on a Nigerian link (the plan calls this out specifically) | narrative, here |
| U10 | Whether `nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04` and `python3.11` on jammy both resolve | the `gpu-image` CI job |

U7 is the one that can change the roadmap: if the ball is visible in a small fraction of frames,
every downstream plan that assumes ball position needs rewriting, and Phase 6's possession engine is
affected. Better learned from one match than from a phase.

---

## Running it

Build, on a machine with Docker:

```bash
docker build -f services/vision-worker/Dockerfile.gpu -t dtp-vision-engine:0.1 services/vision-worker
```

There is no Docker daemon and no CUDA host on the development machine (S0-5), so the image in this
repository has **never been built**. Before spending pod time, run the `gpu-image` job in
`.github/workflows/ci.yml` — it is `workflow_dispatch`-only, deliberately off the push path because
the CUDA base plus cu124 torch is several GB, and it settles U10 and S0-3 for free. A hosted runner
has no GPU, so it proves the stack installs and `dtp-vision-bench` runs; it cannot prove CUDA
works.

Shake the plumbing down on a two-minute synthetic clip (throughput only — see S0-9):

```bash
docker run --rm --gpus all dtp-vision-engine:0.1 dtp-vision-bench --synthetic-minutes 2 --gpu-label "RTX A6000" --usd-per-hour 0.79 --out /tmp/dtp-vision/bench/report.json
```

The real run, against a rights-cleared match via a presigned R2 GET, which also measures U1:

```bash
docker run --rm --gpus all dtp-vision-engine:0.1 dtp-vision-bench --source "$PRESIGNED_R2_GET_URL" --gpu-label "L4" --usd-per-hour 0.43 --out /tmp/dtp-vision/bench/report.json
```

`--usd-per-hour` is the rate **actually being billed** — read it off the provider's console for that
pod, do not copy the examples above. Repeat per card, paste each report into this file, then fill in
U1–U10 and state the exit sentence in
[12-COST-MODEL.md](./12-COST-MODEL.md).
