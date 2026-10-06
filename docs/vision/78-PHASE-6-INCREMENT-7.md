# Phase 6 Increment 7 — original model event scoring

Implemented on 5 October 2026. This follows independent reference capture in
[77](./77-PHASE-6-INCREMENT-6.md). The full Phase 6 gate remains open.

## Problem and change

Scoring all current candidates mixes human proposals, corrections and model
versions. A corrected model error may disappear from that ledger. It therefore
cannot measure the original output of one model.

Frozen event references now offer an **Evaluation scope** selector:

- **All current candidates** retains the existing ledger score.
- **Original proposals from one model** selects one registered `event` model
  version. It includes every matching original in the source window, including
  originals subsequently superseded or rejected. Manual corrections and other
  model versions are excluded in SQL, before the bounded read.

Human corrections are already append-only manual rows without a model version;
the original keeps its model provenance. Repeated proposals from the selected
version count as extra predictions/duplicates. They are not silently deduplicated
or cherry-picked by review state or confidence. No confidence threshold is tuned
against gold.

The selection, source and reference checksums, complete candidate snapshot,
registered model key/version, weights checksum, commit, dataset, config key and
worker image are pinned in saved artifacts. The report displays its scope and
model provenance. Registered metadata is not proof that those weights actually
ran. Both source and prediction actors remain rights-gated, including saved
report reads. Invalid confidence, incompatible taxonomy and oversized lists
refuse evaluation rather than drop rows.

## API and UI

`POST /vision/event-gold/:id/benchmarks` accepts an optional body:

```json
{"scope":"model_original_candidates","modelVersionId":"registered-version-id"}
```

Omitting the body preserves `all_current_candidates`. A model ID without the
model scope, invalid selection, an unknown/non-event version, or a model scope
without a version is refused. No proposals from that version is also refused:
missing inference evidence does not prove a completed run predicted zero events.
There is no inference-completeness ledger yet, so legitimate zero-output event
runs require that next integration before they can be evaluated as such.

Model choices appear only after reference freeze. Independent reviewers receive
no model options or proposals while labelling. The UI lists up to 100 recent
registered event versions; the API accepts an explicitly named registered version.
No schema migration, new permission, model promotion or event publication is added.

## QA and pilot state

- Full API suite: **1,600 tests across 101 files**; focused scoring/reference: 22.
- Full web suite: **244 tests across 23 files**. API and web builds passed.
- Real local Postgres QA created disposable synthetic assets and two event model
  versions. The selected rejected/superseded original scored as an error while
  its correct manual replacement and the other model's correct prediction were
  excluded. Saved report equality and cleanup passed.
- Browser QA used a temporary synthetic UI fixture with no API writes. Scope
  switching, disabled action without a version, model selection, report provenance
  and 390px layout passed. Fixture files were removed and viewport restored.
- The real Jagaban Cup reference remains **0/2 submissions**, unfrozen and unscored;
  both original manual candidates remain unreviewed and unchanged. No paid compute
  ran: **$0 of the $4 pilot ceiling** spent.

## Remaining phase gate

Independent human submissions and reference freeze are still required. Automatic
event inference needs a provenance-checked complete-run artifact and an approved
ball-detection path for possession-based proposals. Representative held-out model
scores, actor attribution and replay/intro suppression must be demonstrated.
This increment does not establish those results or permit Phase 7.

Per the user's instruction, commit and push are deferred until the full Phase 6
gate is complete. Existing unrelated workspace changes must remain outside that
eventual commit.
