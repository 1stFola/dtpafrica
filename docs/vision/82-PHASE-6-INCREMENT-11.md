# Phase 6 Increment 11 — possession ledger and reviewer view

Implemented on 5 October 2026, following [81](./81-PHASE-6-INCREMENT-10.md).
The full Phase 6 gate remains open.

## Reviewable evidence

`VisionPossessionRun` pins one successful job attempt, its original index key and
checksum, source checksum/window, worker image and complete producer snapshot.
`VisionPossessionSegment` preserves the original candidate and Unknown intervals.
`VisionPossessionDecision` appends one accepted/rejected decision per interval.
Import is idempotent by job and attempt. A second import cannot replace bytes,
duplicate segments or change the first importer. Nothing edits the source artifact
or original segment rows.

A signed-in reviewer with `vision.review` imports evidence. A different signed-in
reviewer decides each interval; the importer cannot review their own run. Rejection
requires a reason. A unique decision constraint makes concurrent decisions safe:
one succeeds, the other gets an explicit already-reviewed refusal. Confirming an
Unknown interval preserves its null actor and confidence. Accepted candidates
remain evidence in Vision; there is no publication, match event or statistics write.

The service rechecks current analysis rights on reads, imports and decisions.
Original source checksum/duration and camera declarations must still agree.
Changed source/camera evidence marks the reviewer view stale and refuses decisions.
Candidate decisions also require the original confirmed player/goalkeeper track,
tracking job, artifact and model lineage to remain available. No named player,
roster slot or team is inferred from a local track ID.

## Bounded import

Only a completed CPU `possession` job for the asset is importable. Its saved
completion and append-only succeeded log must agree on the exact attempt prefix,
artifacts, model-free completion, worker image, summaries and index checksum.
The API reads only bounded index and segment JSON, never media or dense tracks.

Limits: 1 MiB index, 4 MiB per chunk, 16 MiB total, 256 chunks, 20,000 segments
and the producer's one-million-frame bound. Metadata checks and hard streaming
read limits both apply. Each chunk checksum, actual counters, complete contiguous
frame-clock coverage, source/proxy/producer lineage and camera snapshot are checked.
Clock rounding matches Python's round-to-even, including half-millisecond ticks.

Candidates must lie wholly inside a live-play camera window and resolve to a
confirmed player or goalkeeper in the declared tracking run. Unknown rows cannot
carry an actor or confidence, and their reasons must match observed/lost trajectory
evidence. Gaps, overlaps, sparse or partial output, replay candidates, mismatched
counts and changed bytes refuse import before any ledger rows are written.
Runs exceeding review limits require smaller footage windows or suitable chunks;
the original derived artifacts remain available to their authorized consumers.

## API and UI

- `GET /vision/review/:assetId/possession` — imported runs and completed jobs;
  `vision.read` plus current source rights.
- `POST /vision/review/:assetId/possession/import` — `{jobId}`;
  `vision.review`, signed-in person and validated immutable evidence.
- `GET /vision/review/possession/runs/:id?cursor=0` — at most 100 intervals,
  including Unknown, provenance, staleness and the next ordinal cursor.
- `POST /vision/review/possession/segments/:id/decision` —
  `{decision: "accepted" | "rejected", reason?: string}`; second reviewer only.

`/admin/vision/possession?asset=<asset-id>` opens the reviewer view. It is reachable
from the Vision **Possession** menu entry and each Footage row's **Possession**
link. The view selects a completed run, imports its original evidence and shows
candidate/Unknown intervals with decisions, provenance and links to original tracks.
The review proxy uses existing `vision.media.raw.read` access; clicking an interval
seeks using its source offset. The importer sees “Other reviewer decides.”
Controls are disabled for stale or already-decided evidence. Candidate coverage
is explicitly not accuracy. Menu collapse behavior remains available.

Manual boundary/actor corrections are not part of this increment. Decisions are
immutable; a future correction must be a new reviewed version, never an overwrite.

## Migration and QA

The additive migration `20261005223000_possession_review` creates the three ledger
tables, their indexes, foreign keys and state/window/decision constraints. Prisma
generation and API compilation pass. On the loopback development database, only
this additive SQL was applied. The database's pre-existing unbaselined migration
history was not reset or marked as deployed.
Read-only database-to-Prisma schema comparison reports no difference.

Automated checks: 51 focused importer/service tests, reviewer controls and
source-offset tests, Nest DI, full API/web regressions and both production builds.
The full API run found a stale generated route table; regenerating it and rerunning
the route/possession/DI checks passed. The generated table now lists 128 routes.
Final counts: 1,705 API tests across 106 files (1,704 passed in the full run;
the documentation check was repaired and all 123 route/possession/DI checks
passed afterward), and 251 web tests across 24 files. Both production builds
passed. No worker contract or inference code changed in this increment.

Real local Postgres QA with disposable synthetic data verified idempotent imports,
self-review refusal, database CHECK constraints, concurrent decisions and unchanged
original rows. Browser QA used only the two existing authorized reviewers:
the second confirmed Unknown and rejected a synthetic candidate with a reason;
the first saw self-review controls withheld. Source seeking reached the expected
0.2 seconds and the proxy played. Browser QA caught a playback permission-name
typo; it was fixed to the existing permission, with no permission grants.
Final control styling and desktop layout were inspected.

All synthetic QA assets, runs, decisions, jobs and their review audit rows were
removed. No new accounts, credentials or access grants were created. Actual pilot
events and independent reference labels were not edited. No paid compute or model
inference ran; spend remains $0 against the $4 ceiling.

## Next and phase gate

Next: immutable possession boundary/actor corrections and review of those versions.
Calibrated football constraints, named actor attribution, the event inference
producer, licensed production ball detection, independent human gold submissions
and representative real-footage accuracy evaluation remain outstanding.
Commit and push remain deferred until the full Phase 6 gate is complete.
