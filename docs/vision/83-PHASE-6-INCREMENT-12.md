# Phase 6 Increment 12 — immutable possession corrections

Implemented on 5 October 2026, following [82](./82-PHASE-6-INCREMENT-11.md).
The full Phase 6 gate remains open.

## Correction rules

An authorized signed-in reviewer can trim an imported interval, change its local
actor to a compatible confirmed player/goalkeeper track, or mark it Unknown.
Every proposal requires a reason and appends a `VisionPossessionCorrection`.
The original run, intervals, original decisions, checksums and artifact bytes are
unchanged. Human proposals carry no copied detection confidence or named player
claim. There are no match-event, statistics or publication writes.

Bounds use integer source milliseconds, source frame boundaries and half-open
intervals. Frame rounding matches the producer's round-to-even convention.
A clipped final source boundary is allowed. Corrections remain inside the
original interval, preventing overlaps with neighbours. Trimmed portions remain
unresolved Unknown; original coverage counters remain explicitly original.

Candidate actors must belong to the same asset and pinned tracking job, artifact,
tracker and detector versions. Their confirmed player/goalkeeper observations
must cover every contributing frame in the corrected window. The last contributing
frame, rather than the following interval boundary, governs track end coverage.
Original Unknown evidence cannot become a candidate: missing/ambiguous ball
evidence cannot be repaired by assigning a player. Candidate evidence can become
Unknown, preserving null actor/local-track fields.

Each proposal names its expected parent: the original segment ID initially, then
the latest correction ID. Proposals and correction decisions lock the root row
without updating it. Unique parent keys and per-segment version numbers make
concurrent proposals safe; stale drafts receive a conflict rather than replacing
another person's work. Reads return at most 20 versions per interval, ordered by
version rather than transaction start time. Further proposals require a new run.

`VisionPossessionCorrectionDecision` appends one immutable decision per proposal.
The proposal author cannot decide their own correction. The original run importer
may decide a correction authored by the other person, because importing model
evidence and authoring a manual interpretation are separate acts. A later proposal
requires a fresh independent decision; it inherits no acceptance. Superseded
proposals cannot receive new decisions. Rejection requires a reason. Original
interval decisions remain separate and explicitly labelled in the UI.

Current source analysis rights, checksum, duration and camera snapshot are checked
again for proposal and decision. Actor compatibility is rechecked at decision.
Changed evidence refuses writes and the original ledger remains available.

## API and reviewer view

Three routes extend the existing possession ledger:

- `GET /vision/review/possession/segments/:id/correction-tracks`: compatible actor
  options with local IDs and observed bounds; `vision.read`, current source rights,
  at most 500 tracks. Original Unknown returns no actor options.
- `POST /vision/review/possession/segments/:id/corrections`:
  `{parentKey,startMs,endMs,state,actorTrackId,reason}`; `vision.review` and a person.
- `POST /vision/review/possession/corrections/:id/decision`:
  `{decision,reason?}`; `vision.review`, a different person and the current version.

The **Possession** screen opens a correction editor next to each original interval.
It shows source bounds, compatible tracks, Unknown, reason, current proposal,
author, decision and full bounded revision history. Original and corrected windows
can seek the existing review proxy. Own-proposal review controls are withheld;
stale evidence or missing permission disables correction actions. The existing
collapsed main/Vision menus remain available.

## Migration and QA

Additive migration `20261005233000_possession_corrections` creates two tables,
relations, unique version/parent/decision indexes and structural CHECK constraints.
Only this additive SQL was applied to loopback local development. Historical
unbaselined migrations were not reset or marked deployed. Prisma schema comparison
reports no difference.

Automated QA: 1,724 API tests across 106 files and 256 web tests across 24 files
passed. This includes 19 new service cases for correction provenance, frame
rounding, overlap prevention, Unknown, actor compatibility, stale parents,
bounded revisions, self-review and superseded decisions, plus five reviewer UI
cases. The generated API inventory contains 131 routes.

Disposable local Postgres QA verified concurrent correction proposals and decisions,
CHECK constraints, self-review refusal, independent review of a later version and
unchanged original rows. Browser QA used the two existing authorized reviewers to
trim/reassign a synthetic candidate, refuse an off-frame draft, independently decide
corrections and inspect revision history. Synthetic evidence is not accuracy
evaluation of the Jagaban Cup footage.

Both final production builds passed. Desktop (1440×900) and narrow-screen
(390×844) visual QA passed. Inspection caught a nested vertical scroll area hiding
history and compressed columns splitting source times; the possession table now
uses page scrolling vertically and readable columns with horizontal scrolling on
narrow screens. The full page has no horizontal overflow; all correction controls
are reachable through the table's own horizontal scroll. Temporary viewport
overrides were removed and the real pilot page was restored with both menus collapsed.

All synthetic possession runs, original intervals/decisions, correction versions,
correction decisions, jobs, QA assets and their audit entries were removed.
Read-only final verification found zero possession ledger rows and zero real pilot
possession jobs. Actual pilot pass/carry rows remain unreviewed at their original
source bounds; the independent gold reference remains 0/2 submissions, unfrozen
and unscored. No new accounts or access grants were created. No paid compute ran.

## Next and phase gate

Next: calibrated football constraints for possession, followed by the automatic
event proposal producer. Licensed ball detection, independent human gold submissions
and representative real-footage accuracy evaluation remain required for the full
Phase 6 gate. Paid compute remains $0 against the user's $4 pilot ceiling.
Commit and push remain deferred until Phase 6 is complete.
