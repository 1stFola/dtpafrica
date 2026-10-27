# ADR-0009 — Incidents link to ScoreBoard by reference, through the sheet event first

**Status**: proposed (Phase 0) · **Decides**: how an incident points at a match event

## Context

During a live match, ScoreBoard events exist only in `SbMatchStatistics.events` (JSON,
client-generated string ids). `SbMatchEvent` rows (UUIDs) are written when the sheet is
approved, often after full time. The match clock lives in `SbMatchStatistics.clock` as
wall-clock anchors on server time. The venue may be offline, so the Edge may not see the
console's sheet at all during the match.

## Decision

- `FairPlayIncident` carries `matchId` and an optional `sheetEventId` (string). **The sheet
  event id is the link**, not an `SbMatchEvent` foreign key: re-approving a sheet deletes
  every `match_recorder` event and recreates it with a new UUID
  (`admin-match-stats.service.ts`, the `deleteMany` before `createMany` in approval), so
  an FK would be nulled by every correction.
- The current `SbMatchEvent` for an incident is looked up at read time. Approval writes
  `sheetId` and `recorderSequence` into the event's `metadata` today, but **not the sheet
  event's own id**, and a sequence index shifts when an event is inserted or removed.
  Phase 3 therefore proposes one line in the approval code — `sheetEventId: event.id` in
  that metadata — reviewed as a ScoreBoard change on its own. Until then an admin links
  by hand. Nothing is guessed from the minute alone.
- Live, an incident is created from a match minute, a manual bookmark or — when online — a
  sheet event the operator picks.
- Period starts are marked **on the Edge** (its own clock). When online, the console's
  anchors are compared and the difference stored, so a disagreement is visible, not
  averaged away.
- FairPlay reads ScoreBoard; it never writes events, the sheet or the score
  ([ADR-0001](./0001-shadow-mode-only.md)).

## Consequences

Incidents survive an offline match, a late sheet approval and any number of
re-approvals. The cost is a read-time lookup through JSON metadata instead of a join, and
one small ScoreBoard change that needs its own review.
