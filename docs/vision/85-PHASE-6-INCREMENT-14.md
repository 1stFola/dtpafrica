# Phase 6 Increment 14 — automatic carry proposal producer

Implemented after [84](./84-PHASE-6-INCREMENT-13.md). The `events` CPU stage now
produces conservative carry proposals from original calibrated possession and
exact player observations. The full Phase 6 gate remains open.

## Rule and limits

`event-carry/v1` requires at least 1000 ms between the first and last observed
player foot points and at least 2 m net ground-plane displacement. A stationary
player or a long held possession interval alone does not produce a carry.
The duration ends at the last observation, without extending it through its held
frame interval. Detector foot points are scaled to the explicitly pinned proxy
geometry and projected through the original camera calibration.

Only original candidate possession intervals in passing calibrated live cameras
are eligible. Unknown intervals, camera changes, ball trajectory changes, local
track changes, missing/unconfirmed/weak player observations, invalid/off-pitch
projection and implausible player motion break the sequence. No interpolation or
backfill bridges those gaps. Contiguous chunk boundaries alone do not break it.
Player speed is capped at the stricter of the original possession limit and
12 m/s. Evidence confidence is the minimum contributing observation confidence;
it is not a calibrated probability of a football event.

This increment implements carries only. It does not infer passes, shots, goals,
teams, roster identities, ball height or established football control. Every
proposal's roster actor remains null; its original local track, trajectory and
camera IDs remain available in the artifact. A projected airborne ball remains a
limitation inherited from possession. Thresholds require real-footage evaluation.

## Queueing and reproducibility

The existing `POST /vision/jobs` route accepts:

```json
{
  "type": "events",
  "videoAssetId": "<clip-asset-id>",
  "modelVersionId": "<registered-carry-rule-version-id>",
  "params": { "possessionJobId": "<completed-calibrated-possession-job-id>" }
}
```

Omit `possessionJobId` to use the latest completed possession run. This does not
fall back to an older compatible run if the latest run is incompatible. The
current implementation completes the possession run's entire source window,
bounded to five minutes; it does not silently trim a longer run. It routes only
to `cpu_small`, with prerequisites `possession` and `track`.

The version is registered under task `event`, with `configKey: event-carry/v1`,
actual code commit and worker-image provenance, a licence note, and null weights
key/checksum. No learned weights exist for this rule. The sorted compact UTF-8
manifest checksum is:

`0618c52603b92990d68b65f0e854a1762ca84b82da84fbdbb83ac0dfd0751581`

The manifest pins the algorithm name, duration/displacement/speed thresholds and
200-event bound. It is explicitly separate from a weights checksum. Registration
and promotion retain the existing registry permissions and gates. No actual
pilot event rule version was registered, promoted or fabricated during this QA.

At enqueue the API uses the bounded possession evidence reader: original index,
segment chunks, checksums, completed attempt and append-only completion log must
agree. Current source, camera declarations, proxy geometry/checksum and calibration
must still match the original snapshot. Legacy image-only possession is refused.
Manual possession corrections and review decisions are never producer inputs.
The API owns the source window, rule provenance, original index and read keys;
caller-supplied replacements cannot override them.

The worker rechecks possession index/chunk and track bytes, source clock,
detector/tracker lineage, full-rate observations and camera cuts. It reads only
declared derived objects and writes one bounded JSON artifact under its own attempt.
Malformed evidence refuses without uploading a result. There is no GPU inference
or source-video decode in this stage.

## Output, scoring and UI

The new artifact is `event-inference/v2`. It contains complete source-window
coverage, an explicit events array (including zero), a registered rule version,
null weights checksum, manifest checksum, original possession and track checksums,
camera declarations and calibration snapshot. Complete coverage means all input
frames were considered; an empty output does not prove no football events occurred.

The shared validator and immutable event-run scorer accept v2 beside existing v1
weighted artifacts. The scorer verifies queued and logged original evidence,
model/image/commit, manifest, artifact bytes and full reference coverage. It never
substitutes current/manual event rows. All reference event types remain in the
score: types this carry-only producer cannot propose count as missed, rather than
being excluded to inflate accuracy. Actor attribution remains unknown.

The source pipeline exposes **Carry proposals**, a compatible registered rule
selector, thresholds, missing prerequisites and registry navigation. Existing
job-operator permissions still govern queueing. The score report identifies the
weight-free producer and original input checksums.

Completion validates the artifact declaration but creates no `VisionEventCandidate`
rows, decisions, player metrics or public match events. Import into the immutable
event reviewer workflow is the next increment. The `events` stage requires
contract 1.16.0; a 1.15 worker continues serving calibrated possession and other
unchanged stages but cannot claim carry jobs. No database migration is required.

## QA and pilot

Full suites passed: 1,763 API tests (108 files), 492 worker tests, 99 shared contract
tests and 259 web tests (26 files). The web stage-order expectation was updated
for the new stage before its successful rerun. Final carry guards, completion
side-effect refusals, scorer provenance, route inventory and Nest wiring passed
127 focused API checks, including eight new completion tests after the full API
run. A final current-proxy-clock guard passed 12 enqueue tests. Final carry
contract/worker-compatibility guards passed 35 focused shared checks.

Production API/web builds passed. Final read-only pilot checks confirmed zero
gold submissions/runs, an unfrozen reference, two distinct reviewers, no synthetic
fixture leftovers and unchanged original manual pass/carry rows. Browser QA
verified the reachable carry stage, rule selector and
empty-registry link, displayed thresholds, missing prerequisites and disabled
reviewer queue control. No queue button was clicked. The browser remained on
the actual pilot source at its normal viewport. Screenshot:
`vision-carry-proposals-qa.png` in this chat's visualization directory.

Synthetic fixtures used in automated tests are not real-footage accuracy evidence.
No real detector, ball, possession or event inference ran; no paid compute was
launched. Spend remains $0 against the $4 ceiling. The real pilot still needs
updated proxy provenance, licensed ball detection and compatible calibrated
observations. Two independent human gold submissions and representative evaluation
are outstanding. On 6 October 2026 the user authorized a checkpoint commit and
push of the accumulated implementation through this increment. That authorization
supersedes the earlier commit deferral; it does not close the full Phase 6 gate.

## Next

Import original v2 carry artifacts into the immutable event review ledger, with
idempotent attempt/proposal mapping, evidence links, current-evidence checks and
independent reviewer decisions. Preserve original artifacts for scoring when a
person corrects a candidate. Additional event types follow only with the evidence
and evaluation needed to distinguish them reliably.
