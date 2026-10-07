# Phase 6 Increment 15 — original carry imports

Implemented 6 October 2026. Completed `event-inference/v2` carry artifacts can
now enter the event review ledger. This completes the next implementation step
from [Increment 14](./85-PHASE-6-INCREMENT-14.md); it does not close Phase 6.

## Evidence and review

Imports validate the completed job/attempt, bounded artifact checksum, queued
input and model provenance through the same original-run evidence reader used
by scoring. Current analysis rights, source checksum/duration and match binding,
camera declarations, calibration/proxy geometry and clock, and original confirmed
track declarations must match. Weighted v1 artifacts are not imported here.

`VisionEventImportRun` pins the artifact, queued input, producer/model provenance,
current declarations and importer. Unique job/attempt and original prediction
mappings prevent duplication. A completed zero-output run records zero proposals.
Concurrent imports and retries return the original mapping, including superseded
original rows; corrections never recreate an original proposal.

Candidates start unreviewed with `method: model`, the original model and
confidence, local actor track and pinned track/camera/calibration evidence links.
Roster/team actors remain unknown. The importing person is the original proposer,
so acceptance requires a different person even after someone else corrects it.
Manual corrections append rows with `method: manual`, no model, the same import
run and no original prediction key. The original artifact remains the scoring
input. Imports create no published match events or statistics.

Reads mark imported originals and descendants stale when declarations change.
Correction, acceptance, rejection and promotion recheck current evidence before
mutation. The Events page exposes completed-run import and history, original vs
manual labels, and stale warnings; the inspector includes original run/checksum
provenance. Stale rows withhold action buttons and timeline correction.

## Database and QA

Additive migration `20261006010000_event_carry_imports` introduces the run table,
candidate provenance columns, unique original mappings and bounded count checks.
It was applied to the local development database without resetting or fabricating
a migration baseline. Prisma generation, schema parity and API/web builds passed.

Full API regression: 1,799 tests in 110 files. Full web regression: 261 tests in
27 files, followed by 17 passing event-review tests including one additional
stale-action guard. Existing worker/contracts were unchanged in this increment;
their previous checkpoint suites passed 492/99 tests.

Disposable local database QA verified independent acceptance, self-acceptance
refusal, correction provenance, preserved original content, concurrent import
safety, idempotency after correction and stale descendant refusals. Browser QA
checked import history, original evidence links and independent acceptance, then
changed only the disposable calibration to verify stale warnings and withheld
actions. Synthetic fixtures are removed after QA and are not real-footage accuracy
evidence. Screenshot: `vision-event-import-stale-qa.png` in this chat's visualization
directory. No paid inference ran; spend remains $0 against the $4 ceiling.

## Remaining gate and next work

The real pilot still needs a licensed ball detector and compatible source/proxy,
tracking, calibration and calibrated possession evidence before a genuine carry
run can be imported. Independent human gold submissions and representative
per-event/actor accuracy remain outstanding. Additional event types require
evidence and evaluation sufficient to distinguish them reliably. The next useful
implementation step is to make missing pilot prerequisites and the review/evaluation
handoff explicit, without treating synthetic checks as a passed accuracy gate.
