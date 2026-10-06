# Phase 6 Increment 6 — independent event references and scoring

Implemented on 5 October 2026. The capture and scoring increment is complete;
the real-footage Phase 6 gate remains open.

## Workflow

**Event gold** is available from the Vision menu and dashboard. A reviewer creates
a source-time window of at most five minutes, assigns two different existing
reviewers and fixes the matching tolerance before collecting labels. Creation
reserves the asset, checksum copies and the entire linked match from new training
or validation freezes, exports and model registrations. Already frozen training
or validation footage cannot become event gold. Reservation and dataset freezes
share a database lock to prevent concurrent leakage.

Each reviewer watches the proxy without candidate overlays and independently
records live events, actors or explicit unknowns, and replay/intro/halftime
intervals. Empty lists require a completeness acknowledgement. Drafts are lost on
navigation/reload; submissions are immutable. The other labels stay hidden until
both submit. Disagreement is measured without assuming either reviewer is correct.
Reconciliation creates an append-only proposal with a reason. The other assigned
reviewer must approve that exact proposal to freeze it. Concurrent transitions
are conditional. Frozen references require a new version for changes.

Analysis and named-player rights are rechecked throughout. Small derived JSON
artifacts have SHA-256 integrity checks, source provenance and schema versions.

## Scoring

Compatible types match one-to-one when both boundaries are within the fixed
tolerance. Matching maximises count before minimising timing error; actor identity
does not influence pairing. Reports include overall/per-type support,
precision/recall/F1, conditional actor accuracy, actor recall, boundary errors,
misses, extra duplicates and unsuppressed non-play proposals. Missing support is
not measurable rather than perfect accuracy.

A run pins all current candidates starting inside the window, including manual
and reviewed candidates. References and predictions are capped at 200 each;
oversized inputs are refused. Reports retain source, reference and prediction
checksums, scorer version, methods and model versions. Candidate snapshot scoring
does not promote a model or constitute a production model benchmark gate.

## Pilot handoff

[Open the pilot reference](http://localhost:5173/admin/vision/event-gold?reference=d1f7c061-4e54-4723-aba8-6066eb3e3c2e).

- Jagaban Cup 2026, 36 Lion FC versus FC Bethel Sporting, 22 May 2026.
- Reference `d1f7c061-4e54-4723-aba8-6066eb3e3c2e`, asset
  `c89444b0-2b9b-4af4-a616-ff29b9dc75a8`, window `[0, 49706)` ms.
- Tolerance 500ms is a pilot comparison setting, not an accuracy target.
- Reviewers: `1stfola@gmail.com` and `fola@dtp.africa`.
- Collecting, **0/2 submissions**. QA submitted no real labels or decisions and
  left the two existing manual proposals unchanged. Compute spend remains $0/$4.

Each person signs in separately, independently labels the complete clip and
submits. After both submissions, reconcile disagreements; the other reviewer
approves and freezes. The saved scoring action then becomes available. Proxy
padding is excluded from source labels. This 49.706-second clip cannot establish
representative match accuracy. Licensed ball detection, automatic proposals,
broader held-out footage and measured gate thresholds remain required before
closing Phase 6 or entering Phase 7.

## Database and QA

Migration `20261005193000_event_gold` adds four tables. The existing local database
has no Prisma migration baseline: `migrate deploy` refused it with P3005. Only the
new additive SQL was applied locally with `prisma db execute`; no database reset
or invented baseline was performed. Baselined deployments use the checked-in
migration through their normal workflow.

- Full API: 1,596 tests/101 files; final focused event-gold tests: 18.
- Full web: 241 tests/22 files; contracts: 71 tests/six files.
- API and web builds passed. Matching agrees with exhaustive optimal matching on
  100 small generated cases.
- Local database QA used existing authorised reviewers and isolated synthetic
  fixtures. Blinding, concurrent submissions, second approval, immutability,
  checksum integrity, non-play scoring and training reservation passed. Derived
  artifacts used an in-memory store; fixtures were removed.
- Browser QA exercised proxy playback, independent editing, completeness and
  roster choices without submitting real human labels.
