# Open-source and model licence register

Mandated by the Master Coding Agent Prompt v2.0 (rule 13). **Nothing enters the DTP Vision Engine
without an entry here.**

The rule that catches people out: **a repository's licence does not cover its pretrained weights,
its training datasets, or its transitive dependencies.** Each is recorded separately.

> Engineering record, not legal advice. Anything marked **REVIEW REQUIRED** needs a qualified
> adviser before it reaches production.

## Status values

| Status | Meaning |
|---|---|
| `APPROVED` | Cleared for the stated use |
| `REVIEW REQUIRED` | Not cleared. Do not ship. |
| `RESEARCH ONLY` | Architecture, taxonomy, and benchmark learning only. **Never in the commercial training corpus or the production runtime.** |
| `REJECTED` | Will not be used; reason recorded |
| `CANDIDATE` | Under evaluation, not yet used anywhere |

## Use classes

`runtime` (ships in the product or worker image) · `training-only` (used to build a model, not
shipped) · `dev-tool` (developer machines and CI only) · `reference` (read, not linked)

---

## Detection, tracking, calibration

| Component | Link | Code licence | Weights licence | Use | Status | Notes |
|---|---|---|---|---|---|---|
| torchvision Faster R-CNN (ResNet-50 FPN), COCO-pretrained | pytorch/vision | BSD-3-Clause | BSD-3-Clause (distributed with torchvision); pretrained on COCO 2017 upstream, by PyTorch, not by DTP | runtime | APPROVED as the **Spike S0 / Phase 3 baseline only** | Chosen over YOLO for licence, not accuracy ([27, S0-4](../vision/27-SPIKE-S0-SURPRISES.md)). COCO has no goalkeeper or referee, so the baseline maps every `person` to `player` and says so in each artifact. Registered as `detector/torchvision-fasterrcnn-coco`; the first worker run pins the version to the checksum of the weights it loaded. Not a candidate for production: Phase 3 trains RF-DETR. |
| RF-DETR | roboflow/rf-detr | Apache-2.0 (core) | Apache-designated for core weights; **Plus/XL under separate terms** | runtime | **REVIEW REQUIRED** before first training run | Core is the baseline. Confirm the exact weight variant before use — the variant, not the repo, is what matters. |
| ByteTrack | ifzhang/ByteTrack | MIT (verify at pinned commit) | n/a | runtime | **REVIEW REQUIRED** | Verify transitive deps; some tracking repos pull Ultralytics. |
| BoT-SORT | NirAharon/BoT-SORT | Verify at pinned commit | n/a | runtime | **REVIEW REQUIRED** | Benchmark candidate against ByteTrack. |
| *In-house association* (`dtp_vision_worker/tracking.py`) | this repository | DTP's own code | n/a | runtime | — | A ByteTrack-style two-round IoU association written here so that no tracking repository is linked while the two above are under review ([32](../vision/32-PHASE-4-INCREMENT-1.md)). It is the floor the two are benchmarked against once cleared. |
| *In-house kit clustering* (`dtp_vision_worker/kits.py`) | this repository | DTP's own code | n/a | runtime | — | Colour histograms of the shirt and two-side k-medoids, standard library only; the first step of identity ([34](../vision/34-PHASE-4-INCREMENT-3.md)). Jersey reading waits on a digit-recognition model being added to this register first. |
| *In-house homography* (`services/api/src/vision/calibration/homography.ts`) | this repository | DTP's own code | n/a | runtime | — | The direct linear transform with Hartley normalisation and Gaussian elimination, a page of arithmetic with no dependency, so that calibration by hand needs no computer-vision library on the control plane ([38](../vision/38-PHASE-5-INCREMENT-1.md)). Pitch-line and keypoint detection will need a model, and that model enters this register first. |
| pyarrow (Apache Arrow) | apache/arrow | Apache-2.0 | n/a | runtime | APPROVED | Writes and reads the game-state Parquet chunks in the worker (`dtp_vision_worker/gamestate.py`). Pure library; no model, no weights. |
| MMTracking | open-mmlab/mmtracking | Apache-2.0 | per-model | reference | CANDIDATE | Benchmark reference. |
| TrackLab | TrackingLaboratory/tracklab | Verify | per-model | reference | **REVIEW REQUIRED** | Dependencies include Ultralytics — see below. |
| **Ultralytics (YOLO)** | ultralytics/ultralytics | **AGPL-3.0** (or commercial licence) | — | — | **REJECTED for runtime** | AGPL is incompatible with the proprietary product without a commercial licence. It arrives transitively through several tracking repos — **check every dependency tree**. If a commercial licence is ever bought, revisit as a deliberate decision. |
| OpenCV | opencv/opencv | Apache-2.0 (4.5+) | n/a | runtime | APPROVED | Core video and geometry. |
| FFmpeg | ffmpeg.org | **GPL-2.0-or-later build** (the distribution's package, `--enable-gpl`, with libx264 and libx265) | n/a | runtime | APPROVED **for use inside DTP's own worker only**, including on rented hosted-GPU hardware (ruling of 8 October 2026) | The build configuration is the licence, and this one is GPL. Cleared on 4 October 2026 by Fola Sanni on the basis below, with a condition: the image is not given to anyone outside DTP. Extended on 8 October 2026 to DTP's private image run by a hosted GPU provider on DTP's behalf. See [FFmpeg](#ffmpeg-what-is-installed-and-on-what-basis-it-is-cleared). |

### FFmpeg: what is installed, and on what basis it is cleared

**What is installed.** Neither worker image builds FFmpeg. Each installs its base
distribution's package:

| Image | Base | Package | Licence of the build |
|---|---|---|---|
| CPU worker (`services/vision-worker/Dockerfile`) | Debian 12 (`python:3.12-slim-bookworm`) | `ffmpeg 7:5.1.9-0+deb12u1`, with `libx264-164` and `libx265-199` | GPL-2.0-or-later: configured with `--enable-gpl --enable-libx264 --enable-libx265` among others; `ffmpeg -L` prints the GNU General Public License, version 2 or later |
| GPU worker (`services/vision-worker/Dockerfile.gpu`) | Ubuntu 22.04 (`nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04`) | `ffmpeg 4.4.2-0ubuntu0.22.04.1` | GPL-2.0-or-later: configured with `--enable-gpl`. Confirmed in the built GPU image on 8 October 2026 (`ffmpeg -L` prints the GPL), the image pushed to private ECR as `dtp-vision-worker:gpu-9816ef0c` |

The versions are what the distributions served on 4 October 2026. A rebuild picks up
their security updates; the licence of the build does not change with those.

**What DTP uses of it.** The worker runs `ffmpeg` and `ffprobe` as separate programs,
through a command line. It links no FFmpeg library into DTP's code. It encodes the proxy
video with libx264, which is the GPL part that matters: an LGPL-only build has no libx264.

**The basis.** The GPL's conditions attach to giving copies of the software to others.
Running it does not trigger them. The worker images are built by DTP's CI, pushed to
DTP's own private registry, and run on DTP's own server. No copy leaves DTP, so there is
nobody to whom source must be offered, and DTP's own code, which only starts the
program, is not a derived work of it.

**The condition.** This clearance holds only while the image stays inside DTP. Review
this row again **before** any of these:

- the image, or FFmpeg in any form, is given to a partner, a customer or the public;
- the image is made pullable from a public registry;
- the worker is run by a hosted GPU provider. Handing an image to a provider to run on
  DTP's behalf is usually not treated as distribution, but it is the first time a copy
  would sit on someone else's machines, so it is decided then and not assumed now;
- FFmpeg's libraries are linked into DTP's code, or the build is changed.

**Ruling, 8 October 2026: a hosted GPU provider.** Asked before the first RunPod run of the
GPU worker, Fola Sanni ruled that running DTP's own private image on rented hardware stays
inside this clearance. The image is pulled from DTP's private registry with DTP's credential,
runs on DTP's behalf under DTP's account, and is not offered to the provider or anyone else to
use. The provider holds a copy only as the machine that runs it. The other three triggers
above are unchanged, and a public registry, a shared template or an image handed to the
provider for its own use would each need this row reviewed again.

If any of those is wanted and the answer is no, the alternative is an LGPL-only build
with another H.264 encoder in place of libx264.

**What this does not cover.** Patents. H.264 and H.265 are covered by patent pools
whatever software encodes them, and a software licence says nothing about that. It is a
separate question from this row and is not answered here.

CI holds this row to the image: the gates job reads the licence the built image's
`ffmpeg` reports and fails if this row names a different one.

This is the engineering record of a decision, and, as the head of this file says, not
legal advice.

## Annotation, dataset and MLOps tooling

| Component | Link | Licence | Use | Status | Notes |
|---|---|---|---|---|---|
| CVAT (Community) | cvat-ai/cvat | MIT | dev-tool | APPROVED | Self-hosted, own host. Third-party assets in integrations carry separate terms. |
| FiftyOne | voxel51/fiftyone | Apache-2.0 | dev-tool | APPROVED | Dataset QA and error analysis. |
| DVC | iterative/dvc | Apache-2.0 | dev-tool | APPROVED | Dataset and artifact lineage. |
| MLflow | mlflow/mlflow | Apache-2.0 | dev-tool | APPROVED | Experiments and model registry. |
| hyparquet | hyparam/hyparquet | MIT | runtime (browser) | APPROVED | Decodes game-state Parquet chunks in the review UI (`apps/web/.../game-state.ts`). Pure JavaScript, no dependencies; snappy is the one codec it carries, so the worker writes snappy. |
| Kloppy | PySport/kloppy | Verify | reference | CANDIDATE | Event/tracking standardization reference. DTP keeps its own canonical schema. |
| SportsLabKit | AtomScott/SportsLabKit | **GPL implications** | reference | **RESEARCH ONLY** | Useful reference. Do not link into the product without legal review. |
| MinIO | min.io | **AGPL-3.0** | — | **REJECTED** | Managed S3-compatible store (R2) used instead. Recorded so the decision is not silently reversed. |

## Research corpora and reference implementations

**All SoccerNet footage is research-only and must never enter the DTP commercial training corpus.**
Enforced structurally: `VisionVideoAsset.corpus = research_only` makes dataset membership
impossible. See [04-DATA-MODEL.md](../vision/04-DATA-MODEL.md) and
[09-ML-PIPELINE.md](../vision/09-ML-PIPELINE.md#corpus-firewall).

| Component | Link | Code | Data | Status |
|---|---|---|---|---|
| SoccerNet Game State Reconstruction | SoccerNet/sn-gamestate | audit at pinned commit | **research-only** | RESEARCH ONLY — architecture reference |
| SoccerNet Calibration | SoccerNet/sn-calibration | audit | **research-only** | RESEARCH ONLY |
| SoccerNet Action Spotting | SoccerNet/sn-spotting | audit | **research-only** | RESEARCH ONLY — taxonomy reference |
| SoccerNet Jersey Number | SoccerNet/sn-jersey | audit | **research-only** | RESEARCH ONLY |

## Video-language models

| Component | Link | Code | Model/data terms | Status |
|---|---|---|---|---|
| InternVideo (v3) | OpenGVLab/InternVideo | Apache-2.0 | per-artifact review needed | **REVIEW REQUIRED** |
| VideoLLaMA3 | DAMO-NLP-SG/VideoLLaMA3 | Apache-2.0 code | repository describes a **research preview / non-commercial** model position | **RESEARCH ONLY** until cleared |
| Managed VLM API (provider TBD) | — | n/a | provider terms, incl. data-retention and training-on-input | **REVIEW REQUIRED** | Phase 8 starts here. **Confirm the provider does not train on DTP footage** — that is the clause that matters for youth video. |

## Infrastructure services

| Service | Link | Status | Notes |
|---|---|---|---|
| Cloudflare R2 | developers.cloudflare.com/r2 | APPROVED (config pending Q4) | S3-compatible, zero egress. Jurisdiction and versioning per [13-OPEN-QUESTIONS Q4](../vision/13-OPEN-QUESTIONS.md). |
| RunPod | runpod.io | APPROVED | Default compute provider. Verify data-handling terms for youth footage. |
| Lambda Cloud | lambda.ai | CANDIDATE | Fallback provider, implemented Phase 1. |
| Vast.ai | vast.ai | **Experiments only** | Marketplace hardware of varying provenance. **No job whose output enters a dataset or a published fact may run here.** |

---

## Adding an entry

1. Pin the exact commit or package version. "Latest" is not a licence position.
2. Record **three** licences separately: code, weights, training data.
3. Walk the dependency tree. `pip-licenses` or equivalent, output attached to the entry. This is
   where AGPL arrives uninvited.
4. State the use class and where it ships.
5. Set status. Anything not `APPROVED` or `RESEARCH ONLY` does not ship.
6. For a model, also record it in the model card at `models/{modelVersionId}/model-card.md`.

## Before each model promotion

Part of the promotion gate in [10-EVALUATION-AND-GATES.md](../vision/10-EVALUATION-AND-GATES.md):

- Every component in the training and inference path has an entry here.
- No entry in the path is `REVIEW REQUIRED`, `RESEARCH ONLY`, or `REJECTED`.
- No training dataset member came from a `research_only` corpus.
- The model card records the weights lineage — including the licence of any pretrained checkpoint
  the model was initialised from.

The last point is the one most often missed: fine-tuning an encumbered checkpoint produces an
encumbered model, no matter how clean the training data was.
