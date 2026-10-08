# Phase 6 Increment 18 — ball trajectory and calibrated possession preflight

Implemented 8 October 2026, following the carry preflight in
[88](./88-PHASE-6-INCREMENT-17.md). Carry preflight could only say that possession
was missing. This increment checks the two stages upstream of carry the same way,
so an operator finds a blocker at the stage where it starts.

## Routes and scope

Both require `vision.read`:

- `GET /vision/assets/:assetId/ball-trajectory-preflight`, optional `detectJobId`.
- `GET /vision/assets/:assetId/possession-preflight`, optional `ballJobId` and `trackJobId`.

With no selection each uses the run queueing would use: the latest succeeded
detect run, or the latest succeeded ball trajectory and track runs.

All three preflights share one private `preflight` method in `VisionJobsService`.
It runs the same `prepareForAsset` that queueing runs and stops before a job id,
a queue write or an audit row. Each route is a thin wrapper around it, so a new
queue guard reaches its preflight with no further change. The result shape is
unchanged from carry: `videoAssetId`, `checkedAt`, `ready`, and either the resolved
inputs or the first refusal's status, code, message and remediation. A server
failure is still thrown, never reported as readiness. The carry route's behaviour
and fallback code (`CarryPreflightBlocked`) are unchanged.

**Ball trajectory** reports `detectJobId`, `detectorVersionId` and the number of
declared camera windows. It checks the same things queueing does: rights, match link,
prerequisites, detection provenance (source, proxy, weights, geometry, attempt
prefix), full proxy rate on the source clock, a bounded window and well-formed
camera segments.

**Possession** is always checked in calibrated mode, because carry refuses an
image-mode run. A check that passed image mode would clear footage the next stage
cannot use. It reports `ballJobId`, `trackJobId`, `constraintMode: "calibrated"`,
`cameraSegments` and `calibratedSegments`. Queueing accepts a calibration snapshot
in which no window passed, so the preflight does too. The count makes that visible
rather than adding a rule the queue does not have.

**Selections.** A selection must look like one job id (`[A-Za-z0-9-]{1,100}`),
otherwise the request is refused with `400 InvalidPreflightSelection`. Two cases
make this necessary. Queueing ignores a non-string selection and checks the latest
run instead. Over HTTP, the global `ValidationPipe` (`transform: true`) turns
`?ballJobId=a&ballJobId=b` into the string `"a,b"`. Neither check would concern the
run the operator named. This came to light against the running API, not in unit tests.

No keys, URLs, homographies or input specs are returned. Readiness is a snapshot,
not a reservation, licence approval or accuracy result.

## Interface

On the Events page, the pilot panel adds "Check ball trajectory inputs" and "Check
calibrated possession inputs" above the carry check, in pipeline order. Each runs
only when its button is pressed and clears when the footage changes. A response
that arrives after the footage changed is discarded. A refusal shows the first
blocker and its remediation, and says that later inputs have not been verified.
A passing possession check whose calibrated windows are fewer than its camera
windows warns that those windows produce no pitch-constrained evidence.

## QA

- API: 1,837 tests in 110 files. 1,836 passed. The one failure is
  `scripts/gates.spec.ts`, which reads `vision-annotation-check.ts` with CRLF line
  endings. That file is LF in the index; `core.autocrlf=true` rewrote it at
  checkout. It is untouched here and passes on CI's Linux checkout.
- `vision-jobs.spec.ts` checks preflight against enqueue for each refusal (ten for
  ball trajectory, eleven for calibrated possession), asserting the expected code
  per case so no two cases pass on the same early refusal. It also checks that the
  explicit selection is honoured, that no queue write, audit row or object key
  appears, that server failures propagate, and the calibrated-only rule.
- Six mutants of the new guards were all killed: image mode, the selection guard,
  server failure as a blocker, an unfiltered calibrated count, and a dropped detect
  or track selection.
- Web: 272 tests in 30 files. API typecheck, both production builds and
  `git diff --check` passed. Doc 07's route table was regenerated (136 routes).

**Real pilot** (local dev database, asset `c89444b0`, which has probe, fingerprint
and transcode succeeded):

- Ball trajectory: `PrerequisiteMissing`, detect has not succeeded.
- Possession: `PrerequisiteMissing`, ball trajectory and track have not succeeded.
- Carry: `PrerequisiteMissing`, as in increment 17.

Other cases against the running API:

- Unknown asset: `AssetUnknown`.
- Unlinked asset: `AssetNotLinked`.
- No session: 401.
- Duplicated selection: 400 `InvalidPreflightSelection`.

Browser QA used a scratch super-admin account, since removed. It confirmed that
no request is made until a button is pressed, that each button calls only its own
route, and that the exact blocker is shown. The pilot's job rows were unchanged
and no Vision audit row was written. No job was queued and no compute was used;
spend remains $0 against the $4 ceiling.

## Remaining work

The pilot now points to the first missing evidence: a licensed detector run at
the full proxy rate (detect), then track, ball trajectory, calibration and
calibrated possession, and a registered weight-free carry rule. Independent gold
labels can still be submitted now. Representative real-footage per-event and actor
accuracy is still required to close Phase 6. A detect preflight is the remaining
upstream gap, but detect is GPU work whose first blocker is licensing, which a
read-only check cannot clear.
