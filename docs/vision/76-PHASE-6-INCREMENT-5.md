# Phase 6 Increment 5: confidence-prioritised review

Implemented and locally QA checked on 5 October 2026.

## Why this is next

Phase 6 increments 1–4 provide the candidate ledger, decisions and promotion,
timeline/inspector, sub-minute precision, queue and boundary editing. The next
documented review gap was confidence-ranked navigation (docs 48, 49 and 08).
It can use the scores already stored on candidates and identity assignments,
without a GPU, new detector, schema migration or publication.

## Behaviour

- Review order offers Lowest confidence first and Oldest first. The UI defaults
  to confidence; the API retains oldest-first for existing callers.
- `GET /vision/review/queue?order=confidence` orders both kinds in SQL by ascending
  confidence, then creation time and ID, before their bounded reads. The merged
  result uses confidence, creation time, kind and ID. Counts still report the
  full waiting depth, and the caller's own, decided and superseded claims stay out.
- Queue responses include the applied order and each claim's stored confidence.
  The UI uses one global ordered table; grouping by asset could silently move a
  higher-confidence claim ahead of a lower-confidence one from another asset.
- Links preserve the chosen order, candidate/identity row and source seek time.
  The workstation's comma/period walk uses row identity, so equal timestamps and
  backwards jumps in source time remain navigable. It stops at either end; if a
  decision removes the cursor row, the next walk starts with the remaining first
  claim (or the last for previous). Changing order restarts the walk.
- Workstation walking covers loaded rows, including the current track-view limit;
  it does not claim to walk every track of a large asset. Bracket navigation still
  walks all current event candidates by source time.
- Scores are claim confidence, **not measured accuracy**. Manual scores currently
  default to 1; ties therefore use age. Ranking does not accept, reject, correct,
  publish or change a claim's confidence.
- URL query parameters preserve ordering across reloads. Obsolete queue requests
  are ignored when the reviewer changes order quickly.

The shared contract owns the order names and comparison rule. No worker job
contract, model or rights permission changes were required.

## QA

- Full API suite: 1,574 tests passed across 99 files; focused events: 59 passed.
- Full web suite: 237 tests passed across 20 files; API and web builds passed.
- Regression coverage includes ranking before limits, zero confidence, stable
  ties, both claim kinds, self-exclusion, honest depth, invalid-order fallback,
  same-time navigation, backwards stepping, removed cursors and deep-link state.
- Browser QA used the two already-authorised local reviewers. The author's queue
  excluded their two pilot proposals; the second reviewer saw both. Their stored
  scores tie at 1, so the pass appeared before the later carry.
- Opening the pass preserved confidence ordering. Period selected the carry at
  1,040ms; comma returned to the pass at 0ms. Neither was decided or corrected.
- Both selectors were operated in-browser; oldest-first survived reload. Desktop
  and 390px workstation checks passed, including accessible field labelling.
  Temporary viewport overrides were reset; the development API remained local.

## Phase gate and follow-up

This completes this review increment, **not the Phase 6 gate**. Event-gold capture
and a reproducible event benchmark evaluator remain buildable work. Real event
precision/recall/F1, actor accuracy and replay errors still need independent,
locked human references. Possession and automatic event proposals still need an
appropriately licensed and evaluated ball-detection path. Phase 7 remains gated.

No paid compute was launched; this increment spent $0 of the $4 pilot ceiling.
