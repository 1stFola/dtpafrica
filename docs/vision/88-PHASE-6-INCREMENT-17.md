# Phase 6 Increment 17 — read-only carry compatibility preflight

Implemented 6 October 2026, following the pilot handoff in
[87](./87-PHASE-6-INCREMENT-16.md).

## Shared checks and scope

`GET /vision/assets/:assetId/carry-preflight` requires `vision.read`. Optional
query parameters are `modelVersionId` and `possessionJobId`. Without an explicit
selection it uses the same production-model and latest-possession resolutions
as queueing. The Events pilot panel exposes a rule selector and an explicit
check button; it never automatically requests a check or queues work.

Queueing and preflight use one shared input-preparation method: asset/match,
current analysis rights, succeeded prerequisites, model resolution, current proxy
clock and original calibrated carry evidence checks. The original evidence reader
checks bounded stored JSON and checksum/producer/calibration provenance. Queueing
still repeats all checks before generating a job ID and writing to the queue.

Preflight returns `videoAssetId`, `checkedAt` and `ready`. A passing result names
the resolved model and possession job. A blocked result includes the first
refusal's HTTP status, error code, message and remediation. Later inputs are not
claimed verified. Unexpected infrastructure/server failures propagate as errors;
they are not converted to readiness. Input specifications, object keys and URLs
are not returned. No queue, audit, database mutation, worker launch or paid compute
occurs. Readiness is a momentary snapshot, not a reservation, licence approval,
review decision or accuracy gate pass. Results clear when footage/rule changes,
and obsolete request responses are discarded.

## QA and real pilot

Focused API tests exercise passing original evidence, unchanged enqueue input
semantics, first-refusal parity for rights/prerequisites/model/camera/proxy/clock/
artifact tampering/asset/match, absence of queue/audit side effects and infrastructure
failure propagation. All 1,810 API tests in 110 files and 268 web tests in 29
files passed, along with both API/web production builds and whitespace checks.

Browser QA used the existing reviewer on the real pilot. The response was
`PrerequisiteMissing`: events requires possession and track to succeed first.
The UI showed the exact refusal and remediation, an explicit unchecked-later-inputs
notice and timestamp. No compatible carry rule is registered in the pilot registry.
The route inventory contains 134 routes. No schema migration was needed.
Read-only pilot checks confirmed gold remains 0/2, unfrozen with zero scores, two
distinct reviewers, no QA leftovers and unchanged original manual pass/carry rows.
Screenshot: `vision-carry-preflight-qa.png` in this chat's visualization directory.
Spend remains $0 against the $4 ceiling.

## Remaining work

The actual pilot still needs licensed ball/player detection, confirmed tracking,
current proxy/calibration provenance and a calibrated possession run, plus a
registered weight-free carry rule version. Independent gold labels can be submitted
now. The next implementation opportunity is prerequisite preflight for calibrated
possession and ball trajectory, reusing their original queue evidence guards so
the operator can diagnose the pipeline farther upstream. Representative real-footage
accuracy and actor evaluation remain necessary to close Phase 6.
