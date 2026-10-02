# 29 — Phase 3 Increment 2: boxes, and the frame they land on

> Classes: `player`, `goalkeeper`, `referee`, `ball`.
> — [11-PHASE-PLAN](./11-PHASE-PLAN.md), Phase 3

A detector is scored against boxes. The corpus had none: Phase 2's payload is a
window — source bounds, the annotator's doubt, a note — and
[26](./26-PHASE-2-INCREMENT-5.md#what-is-not-done) said so. This increment puts
boxes inside that window, in the payload, on the screen, and in the export, so
that Increment 3 has something to benchmark against.

The shape was the whole decision. Two choices, each the kind that produces a
dataset which loads and is wrong if made the other way:

- **A box's time is source time.** Like every label here. The export converts it
  to a proxy frame with the floor rule, so the frame a box lands on is the frame
  the annotator was looking at.
- **A box's geometry is normalised to the proxy frame**, `[0, 1]` on both axes,
  top-left origin. Pixels would tie every label to one transcode, and FiftyOne
  wants relative coordinates anyway.

---

## One rule, applied twice

`validateAnnotationBoxes` lives in the contracts
([annotation.ts](../../packages/vision-contracts/src/annotation.ts)), and both the
submit path and the export call it. A box the door accepted and the export refused,
or the reverse, would be exactly the drift the contracts package exists to prevent.

What it refuses, each with the index of the offending box, and all of them rather
than the first:

| Refusal | Why it is a refusal and not a warning |
|---|---|
| `box_outside_window` | Half-open, like the window: a box at `endMs` is on the first frame of whatever comes next, which this task never showed the annotator. |
| `box_unknown_class` | `person` is what the detector calls a player. The contract has four classes and the review UI knows those four. |
| `box_bad_geometry` | A corner past the edge of the picture, a zero size, a string. Float noise at the edge is absorbed and the size trimmed to fit, because a box dragged to the edge computes to 1.0000001 wide more often than not. |
| `box_model_claim_unsupported` | A box crediting a model that did not pre-label this task is a provenance claim nothing can stand behind. Refused, not stripped: silently turning a model's box into a person's would be the same lie the other way round. |
| `boxes_not_array`, `box_not_object`, `box_bad_time`, `too_many_boxes` | Shape. |

A payload with no `boxes` field is a Phase 2 payload and passes. An empty array is
"looked, found nothing to box", and passes too.

**At the door** (`POST /vision/annotation/tasks/:id/submit`), a refusal is
`400 InvalidBoxes` with the problems listed, and nothing is written. **At the
export**, the same rule runs again on the stored payload — because a payload can
be written behind the service's back, and the gate does exactly that to prove the
export catches it (`boxes_invalid`).

## Where a box lands

Source time, minus the proxy's offset, floored to a frame, numbered from one.
The same conversion as the window, with one less trap: a box names one frame, so
there is no inclusive end to get wrong. By hand, on a proxy that begins at source
9,000ms and runs at 25fps:

| source | proxy | frame | FiftyOne |
|---|---|---|---|
| 10,000 | 1,000 | 25.0 → 25 | **26** |
| 10,500 | 1,500 | 37.5 → 37 | **38** |
| 10,540 | 1,540 | 38.5 → 38 | **39** |

Rounding would have put the second on 39 and the third on 40. The gate checks
these three numbers against the file the export wrote.

The export writes them as FiftyOne's video idiom: `frames["38"].detections` is a
`Detections` holding `Detection` boxes with `bounding_box: [x, y, width, height]`.
Each carries its source time, whether the annotator doubted it, which model drew
it if one did, and the review verdict. The window-level `TemporalDetections` is
still there beside them; a Phase 2 member exports an empty `frames`.

**The workstation stores the start of the frame, not the scrubber's millisecond.**
`snapSourceTimeMs` takes the position, floors it to a frame, and stores that
frame's first millisecond in source time. Without it a box drawn on frame 37 could
be stored at 37.9 and still land on 37 — until a re-transcode nudges the rate, when
it lands on 38. The overlay decides "which boxes are on this frame" with the same
floor, so what the reviewer sees is what the corpus will carry.

## The screen

Drag on the picture to draw; `1`–`4` pick the class for the next box, or re-class
the selected one; `Delete` removes it; `U` marks it uncertain, or the whole window
when nothing is selected. The boxes are positioned elements in percentages of the
picture, not a canvas, so they follow it at any size with no repaint per frame, and
the class picker keeps a running count. Drawing is disabled while the clip plays:
the box would otherwise land on whichever frame the scrubber reached by the time
the pointer came up.

A correction starts from the last attempt. On load the latest version's payload is
read back and its boxes drawn — **a model's boxes dashed and tagged `model`**, a
person's solid. The reviewer sees which is which, or they agree with the model and
its error becomes ground truth.

Dense tracks across hundreds of frames still belong in CVAT, per the plan. Per-frame
boxes on sampled windows are drawn here, and the page's own comment no longer says
otherwise.

## What the QA report now answers

`boxes`, `boxesByClass`, `framesWithBoxes`, `boxesFromModel` and `boxesUncertain`,
beside the window-level counts. The fourth is the anchoring question, measured: how
much of the corpus's box-level truth is a model's suggestion a person kept.

## Verification

```
api tests              1,062 passed   (was 1,047)
  export: boxes           11
  submit: boxes            4
vision-contracts          48 passed   (was 30)
  box rule                18
web                      127 passed
  box arithmetic          18
typecheck               api, web and contracts clean
vision:boxcheck         40/40 against the real API, Postgres and R2, run twice
```

Nine mutations, each breaking a guard this increment added, each caught by a test:
the window's end accepted as inside it; a model claim accepted on a task no model
pre-labelled; the far edge allowed past the frame; the export rounding a box to its
frame instead of flooring; the export skipping the box rule; the export ignoring the
proxy offset for boxes; submit no longer checking boxes; the workstation storing the
scrubber's millisecond rather than the frame start; and the workstation choosing
boxes by exact millisecond rather than by frame.

The overlay was also exercised in the browser against the local API and a demo
task: draw, re-arm with `4`, draw, step a frame forward (the boxes leave) and back
(they return), click and `Delete`. That check found one trap before it shipped: a
freshly drawn box used to be selected, so the `4` meant to arm the next box
re-classed the one just drawn. A new box now starts unselected.

The gate publishes a schema, creates a task pre-labelled by a registered model,
and submits seven bad box sets by name before three good boxes. It then resubmits,
reviews, builds and freezes a dataset, writes a stand-in proxy object, exports, and
reads `samples.json` back to check frames 26, 38 and 39 and every field on the
boxes. Finally it writes a payload behind the service's back with a box crediting
a model that never pre-labelled the task, and the export refuses it by name.

## What is not done

| | |
|---|---|
| **Pre-labelling from a detect job** | The shape is ready — `fromModelVersionId` and the task's `preLabelModelVersionId` — but no route yet turns a `detect` artifact into a task's starting boxes. That is the active-learning loop's first half, and it needs the detect artifact normalised to the frame first (it is in proxy pixels today). |
| **Tracks** | A box is one frame. Linking boxes across frames is Phase 4's `VisionTrack`, and CVAT's job for dense drawing. |
| **The benchmark** | Now possible. Increment 3: a `benchmark` stage that scores a registered version's `detect` artifact against a frozen gold version's boxes per class and per slice, writes `VisionMetricResult` rows, and moves `candidate → benchmarked`. |
| **Box-level inter-reviewer disagreement** | The gold set measures disagreement by verdict. Measuring it by box overlap waits for two people to have boxed the same window. |
| **Frame strip** | The scrubber does not yet mark which frames carry boxes; the count beside the picker is the only hint. |
