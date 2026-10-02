# 30 — Phase 3 Increment 3: the ledger, and a number with its slices

> Every benchmark run writes `VisionMetricResult` rows per `(metric, slice)`. The
> dashboard never shows a headline number without its slice breakdown.
> — [10-EVALUATION-AND-GATES](./10-EVALUATION-AND-GATES.md), Slice reporting

Increment 1 registered the model; Increment 2 put boxes in the corpus. This one
scores the first against the second and writes the result down in the only form
the promotion gate can read: per class, per slice, under a named thresholds
version, with a verdict. A model version now has a measured step after
`candidate`, and nothing after that step yet.

---

## What a benchmark is here

A `benchmark` job scores a model version's **detect artifacts** against a frozen
gold version's **exported boxes**. It runs no model. Three consequences, each a
decision rather than an accident:

- **It is a CPU stage.** The predictions needed a card; comparing them with truth
  is arithmetic, and routing arithmetic to a GPU would bill GPU rates for it. The
  contract now routes `benchmark` to `cpu_small`, which is 1.2.0.
- **Every gold member must already have a succeeded `detect` job by the exact
  version under test**, or the run is refused (`DetectionsMissing`, naming the
  members). A benchmark over the gold members that happened to have detections is
  a benchmark of a different, undeclared dataset.
- **Only frames the detector sampled are scored.** A box on a frame the artifact
  never looked at is not a miss; it is uncovered, and `framesScored /
  framesLabelled` says so. Counting it as a miss would measure the sampling rate
  rather than the model. To score every labelled frame, run `detect` on the gold
  members at the proxy's full rate.

## What the worker may read

A benchmark job has no asset, so the asset roles (`source`, `proxy`) do not apply.
Instead the control plane lists, on the job row, every object the worker may read:
the gold export and one detect artifact per member. The worker asks for each by
**declared key** (`input-url` with `role: "declared"`), and the control plane
refuses any key not on that list — a worker still cannot choose what it reads, it
can only ask for what it was told it may. The gate asks for a master-bucket key by
name and is refused.

## The arithmetic

[`evaluate.py`](../../services/vision-worker/dtp_vision_worker/evaluate.py), pure,
no torch, with a CLI so the same code runs on files by hand. Matching is greedy by
confidence, class-aware, one truth per prediction: a detector that draws two boxes
round one player is told so. Average precision is the all-point interpolated area
with the monotone envelope. Precision, recall, F1 and AP per class, plus `all`;
mAP is the mean over classes that had boxes in the slice, so a class absent from
a slice does not drag the mean to zero. Every metric carries its `support`, the
number of truths it rests on, because a recall of 1.0 over three boxes is not a
finding.

Slices come from the gold sample's provenance: `quality:<rank>`,
`competition:<name>`, `vfr:<bool>`. Every declared slice is reported even when
nothing on it was sampled, with `null` values, so "not measured" cannot be
mistaken for "no such slice".

The gate runs this evaluator on the files the export actually wrote, and checks
the numbers against arithmetic done by hand in its own comments: one hit, one
false positive and one miss over three boxes gives player precision 0.5, player
recall 0.5, player AP 0.5, ball recall 0, overall recall 1/3, mAP 0.25.

## The ledger

`VisionBenchmarkRun` and `VisionMetricResult`, as [04 § Models](./04-DATA-MODEL.md#7-models--phase-3)
drew them, with a migration that builds the schema from zero in both directions.
A run records which thresholds version judged it; the metrics are unique per
`(run, metric, slice)`, so a retried completion inserts nothing twice.

**Thresholds are configuration, and the configuration is empty.** [10](./10-EVALUATION-AND-GATES.md#the-core-rule)
says not to hard-code a good metric today: run a baseline on representative
Nigerian matches, then set the bar from what it shows. So
[`benchmark-thresholds.ts`](../../services/api/src/vision/models/benchmark-thresholds.ts)
ships version `2026.10.0-unset` with no minimums, and every run until a baseline
exists is judged `unthresholded` — a measurement with no bar to clear, which is
honest, rather than a bar copied from a paper trained on European broadcast
footage. When minimums are set, `judge` checks each on `all` and on every
critical slice (`quality:platform_copy` to start); a metric missing from `all`
fails, a critical slice with nothing to measure is skipped, and one that had boxes
and no value fails.

A completion moves the version `candidate → benchmarked`, and only from
`candidate`: a version already in staging being re-measured does not step back.
A job that fails for good marks its run `failed` with the worker's reason, and
moves nothing.

## Routes

| Method | Path | Permission |
|---|---|---|
| `POST` | `/vision/models/versions/:id/benchmark` | `vision.models.train` |
| `GET` | `/vision/models/versions/:id/benchmarks` | `vision.read` |
| `GET` | `/vision/models/benchmarks/:id` | `vision.read` |

Measuring is the trainer's job. Judging the measurement worthy of production is
somebody else's, and still has no route.

## Verification

```
api tests              1,106 passed   (was 1,062)
  benchmark ledger        22
  thresholds               9
  worker door              8 more
  projection               5 more
vision-contracts          48 passed
vision-worker            140 passed   (was 101)
  evaluation              31
  benchmark stage         14
typecheck               api, web and contracts clean; migration diff empty both ways
vision:benchcheck       49/49 against the real API, Postgres, R2 and the real
                        Python evaluator, run twice; no litter
```

Eleven mutations, each caught: matching that ignores class; a truth claimed twice;
AP without the envelope; an unsampled frame counted as a miss; predictions not
renumbered from one; the stage accepting another model's artifact; a
critical-slice regression ignored; a missing metric passing; a run requested with
a gold member nobody detected; the version moving to benchmarked from any stage;
an undeclared key readable.

## What is not done

| | |
|---|---|
| **Promotion** | `promotion-request`, `promote`, `rollback`, and the second approver. The ledger now gives them something to read. Increment 4. |
| **Thresholds with numbers** | Set from the first baseline run on real footage, as a reviewed change with a new version. |
| **A detect job that samples exactly the labelled frames** | Today a full-rate detect on the gold members scores everything; a `params.frames` option would score only what matters and cost accordingly. |
| **Slices beyond provenance** | Night, crowded box, motion blur: these need the quality flags the envelope reserves, attached at prediction or annotation time. |
| **The registry screen** | Benchmarks have an API and no page. |
