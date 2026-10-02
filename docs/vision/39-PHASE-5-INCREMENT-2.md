# 39 — Phase 5 Increment 2: where the camera cut

> Camera cuts reset calibration rather than propagating a stale homography across
> the cut.
> — [09-ML-PIPELINE](./09-ML-PIPELINE.md), § Calibration and game state

[38](./38-PHASE-5-INCREMENT-1.md) made the camera segment calibration's unit and
left a person to declare every one by hand. A ninety-minute broadcast has dozens;
handheld footage from a stand has one, plus the moments the operator swung to
the dugout. This increment proposes them: a CPU stage asks FFmpeg where the
picture changed, and the control plane files what it found beside the segments a
person declared, never over them.

---

## A cut is a score

FFmpeg's scene-change score is the mean absolute difference of a frame from the
one before, 0 to 1. A real cut is usually above 0.5; a fast pan rarely above 0.3.
The `cuts` stage runs the proxy through `select='gt(scene,T)'` — the default
threshold is 0.4 and a parameter — decoding once and encoding nothing, and reads
the moment of each kept frame off the `showinfo` lines FFmpeg prints. No model,
no dependency beyond the FFmpeg the image already has, and the arithmetic sits
apart from FFmpeg so a log it once printed is enough to test it, and enough for
the gate to run it on a machine with no FFmpeg at all.

The stretches between cuts are segments, in source time by the proxy's clock. A
cut within two seconds of the previous boundary is absorbed — a flash, a
transition, a two-frame insert — because a segment shorter than that cannot be
calibrated anyway, and a trailing sliver joins the last segment. With no cuts
the whole proxy is one segment. Cuts arrive in any order and leave sorted.

## Proposals, not facts

The completion files each proposed segment as `source: scene_detect`, kind
`unknown`, under three rules:

1. **A person's segment wins.** A proposal overlapping a segment a person
   declared, or one a person calibrated, is skipped and counted. A declaration
   is a fact about the footage; a filter's score is a guess.
2. **A new run replaces old guesses.** Earlier proposals nobody calibrated are
   deleted and this run's written; one somebody calibrated has become a fact and
   stays. A proposal identical to one already there is *already there*, not
   churned to a new id.
3. **A retry adds nothing.** The idempotency key the worker surface already
   enforces, and the rule above, between them.

A person may remove a segment that has no calibration — a wrong proposal or a
wrong declaration — and may not remove one that has: a calibrated segment is a
fact with a name on it, and its calibration is superseded instead.

## Verification

```
api tests              1,234 passed   (was 1,229)
vision-worker            225 passed   (was 211)
  cuts                     14
vision-contracts          54 passed
typecheck               api clean
vision:cutscheck        30/30 against the real API, Postgres and R2, with the
                        worker's real proposer on a log FFmpeg once printed and
                        a signed-in person; run twice; no litter, no rows left
```

The gate declares a replay segment by hand, queues `cuts`, has the mock worker
claim it and read the proxy by role, runs the proposer on a ten-minute log with
cuts at 61.2 s, 61.32 s and 180 s, and posts the result: three cuts, the sliver
absorbed, three segments in source time, two filed and one skipped for the
replay. A retry adds nothing. A person calibrates the last proposal; a second run
at a higher threshold replaces the uncalibrated proposal, keeps the calibrated
one as *already there*, and skips its new middle proposal for the replay. The
calibrated segment cannot be removed; the replay can.

Eighteen mutations, each caught: a cut read off a line that was not a frame;
cuts outside the proxy kept; slivers kept; a trailing sliver kept; cuts taken
unsorted; cuts and segments left in proxy time; segments from no duration; the
clock, the threshold bounds and the duration check removed; the threshold not
passed to FFmpeg; a calibrated proposal replaced; a person's segment overwritten;
a retry churning ids; an empty proposal filed; proposals filed as a person's; a
calibrated segment removed.

## What is not done

| | |
|---|---|
| **A real proxy through FFmpeg** | The filter graph is exercised against a log FFmpeg once printed; the stage on a real proxy runs on the pod with the rest of the worker. |
| **Kinds** | A proposal is of kind `unknown`. Telling a wide shot from a close one is a classifier's job, later; a person may set the kind when calibrating, and the editor should ask. |
| **The threshold** | 0.4 is FFmpeg's folk default. The first real matches will say whether grassroots handheld footage needs a different one; the parameter is there for that. |
| **The match clock** | A segment-level fact like calibration, still not anchored. Next. |
