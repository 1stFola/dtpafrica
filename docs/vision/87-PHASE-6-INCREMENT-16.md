# Phase 6 Increment 16 — pilot prerequisites and evaluation handoff

Implemented 6 October 2026. The Events page now connects selected footage to
source rights/pipeline, registered detector versions, calibration, possession and
independent gold evaluation. This follows the original carry importer in
[86](./86-PHASE-6-INCREMENT-15.md).

## What the panel establishes

Current import analysis eligibility, match binding, duration, proxy availability,
stored stage states and bounded carry/import history come from existing API reads.
They are displayed as declarations, not artifact compatibility or licence approval.
The panel explains current proxy dimensions/checksum/clock requirements, licensed
ball/player evidence, recalibration and regeneration after input changes. Existing
queue/import services remain the authoritative compatibility checks.

Gold metadata is fetched separately for the selected asset using the existing
reviewer-scoped endpoint. Only reference labels, submission counts and freeze
status are displayed; independent label bodies are not fetched. Loading, missing
permission and request failure do not become a completed status. An empty scoped
list means no references accessible to that person, not proof that none exist.
The page advises confirming assignments before creating another reference.

Direct reference links open the existing assignment. The asset-scoped gold link
filters the reference list and preselects footage in the creation form. Late list
responses cannot replace a newer scope. Browser QA identified a zero window-end
default when preselected asset metadata loaded late; the input now updates to the
known duration. Original-run scoring is explained separately from reviewer
acceptance and candidate-only scoring. The phase gate is explicitly kept open.

## QA and actual pilot

All 266 web tests in 28 files passed, including blocked prerequisites, scoped
references, independence/freeze states, permission and unavailable status cases.
The final web production build passed. No API, worker, contract or schema runtime
change was needed. Read-only pilot checks still show zero gold submissions/runs,
an unfrozen reference, two distinct reviewer accounts, no QA leftovers and the
unchanged original manual pass/carry rows.

Browser QA verified the real pilot panel, its 0/2 reference metadata, the
asset-filtered gold link, selected footage and the source duration default. No
label was submitted, reference created/frozen, job queued or licence approved.
Screenshot: `vision-pilot-handoff-qa.png` in this chat's visualization directory.
Spend remains $0 against the user's $4 compute ceiling.

## Next

The two assigned people can submit their independent labels on the existing gold
reference now. Genuine inference still needs licensed ball/player detection and
compatible current proxy, tracking, calibration and calibrated possession.
The next implementation opportunity is a read-only compatibility preflight that
reports exact missing evidence using the queue guards, before an operator queues
work. Representative real-footage per-event and actor evaluation remains required
before Phase 6 can close; this handoff and short pilot are not an accuracy pass.
