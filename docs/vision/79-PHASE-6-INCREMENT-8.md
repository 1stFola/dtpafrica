# Phase 6 Increment 8 — complete-run event evaluation

Implemented on 5 October 2026. This builds the evaluation interface missing from
[78](./78-PHASE-6-INCREMENT-7.md). It does **not** implement or enable the event
inference producer. The full Phase 6 gate remains open.

## What changed

A frozen event reference can now evaluate **one completed event inference run**,
separately from the current candidate ledger or a model version's accumulated
original candidates. Run evaluation reads the original artifact, never human
corrections or another inference attempt's predictions.

The evaluator requires a succeeded, model-bound `events` job on the same asset,
with a completion time, worker and idempotency record. Its saved completion and
append-only `succeeded` log must agree on the model, image, one JSON artifact and
checksum. The artifact must sit under the job's exact attempt prefix. The
registered event model must have weights checksum, commit, configuration and
worker image, all matching the original artifact. Source checksum, queued source
window, taxonomy, declared event count and weights also have to agree.

`event-inference/v1` explicitly records complete source-window coverage. The run
must cover the entire reference window and remain inside the original source
duration. This is the worker's coverage attestation, not an independent proof
that a decoder analysed every frame. Missing, partial or conflicting evidence
refuses scoring. An explicit empty event list on a valid complete run is scored
as zero predictions: reference events become misses, with precision unmeasurable.

Each artifact covers at most five minutes and 200 events. Reads are limited to
256KiB, checked against object metadata **and while streaming** from R2. A change
between HEAD and GET cannot remove the hard read bound. Existing object-store
callers retain their existing interface behavior unless they request a byte limit.

Reports and snapshots pin job, attempt, original artifact checksum, coverage,
completion time and model provenance. Only predictions whose start lies in the
reference window are scored, as in the earlier scopes. The complete artifact's
named actors are rights-checked before selecting those predictions. Saved report
reads continue to check the frozen reference and snapshot actors' current rights.
The audit records evaluation scope, model and inference job.

## API and producer contract

```json
{"scope":"complete_event_run","jobId":"completed-event-job-id"}
```

This is an optional body on `POST /vision/event-gold/:id/benchmarks`. The other
two scopes retain their behavior. A run ID cannot be combined with a model ID or
another scope. Job choices appear only after reference freeze; up to 100 recent
completed model-bound event jobs on that asset are listed. Listing is not a
provenance endorsement: evaluation checks the selected job in full.

The future producer must write one `event_inference` artifact containing:

- `schemaVersion: event-inference/v1`, job ID, attempt and asset ID;
- source checksum, model version ID, weights checksum, config key, commit and image;
- the event taxonomy version and `coverage: {startMs, endMs, complete: true}`;
- explicit `events`, each with unique local ID, event type, source boundaries,
  roster actor or null, finite confidence in `[0,1]`, and boolean `inPlay`.

The queued input pins `sourceChecksum`, `windowStartMs` and `windowEndMs`. The
completion names the model once in `modelVersionIds`, names the worker image,
and reports `modelVersionId`, `weightsSha256`, `sourceChecksum`, source window,
`eventCount` and `eventArtifactSha256` in its summary. Its single artifact
descriptor supplies bucket `derived`, role `event_inference`, JSON content type
and exact bytes. The job queue's append-only success log must preserve that same
completion. The checksum covers the exact uploaded bytes, not reserialized JSON.

There is currently **no `events` worker handler**, and the model-to-stage mapping
does not enable that producer. Wiring an approved adapter, model binding, worker
capability/version declaration, enqueue-owned source/window inputs and completion
validation is still required. This increment deliberately does not queue jobs,
import fake runs into real footage, or claim automatic inference is available.
No migration or new permission was added.

## QA and pilot state

- Full API: **1,638 tests across 104 files**; web: **246 across 23 files**;
  shared contracts: **75 across seven files**. API and web builds passed.
- Evidence tests cover wrong asset/type/model/image, failed/unbound runs, missing
  success logs, stale attempts, corrupt artifacts, incomplete/out-of-source windows,
  wrong counts and oversized reads. R2 SDK stream tests verify the hard byte cap.
- Real local Postgres QA used disposable synthetic completed-job records and
  in-memory artifacts. Single-run isolation, zero-output scoring, saved-report
  equality and artifact-tamper refusal passed. These records test the evaluator;
  they are not executed inference jobs or real accuracy results. They were removed.
- Browser QA used a temporary synthetic fixture with no API writes. Run selection,
  disabled scoring without a job, zero-output report, provenance and 390px layout
  passed. Fixture files were removed and temporary viewport settings restored.
- The real Jagaban Cup reference remains 0/2 submissions, unfrozen and unscored.
  The existing manual pass and carry remain unchanged and unreviewed. No paid
  compute ran: **$0 of the $4 ceiling** spent.

## Remaining phase gate

Both people must independently submit, reconcile and freeze their real labels.
The licensed inference/ball-detection path, possession processing and representative
held-out event and actor scores remain outstanding. A valid run artifact alone is
not representative accuracy and does not approve or promote a model. Phase 7 and
the user-requested commit/push remain deferred until the full Phase 6 gate passes.
