# ADR-0001 — Shadow review and post-match evidence only, enforced in code

**Status**: proposed (Phase 0) · **Decides**: what V1 may do at a match

## Context

The PID allows two V1 modes, shadow review and post-match assessment, and reserves
"authorised referee support" for a future project after football-authority, competition and
referee approval. The master prompt makes any request to activate it a stop-and-escalate.

A feature flag that exists but is off is one config change from on. A field like
`overturned` that exists but is unused invites a UI to fill it.

## Decision

- `FairPlaySession.mode` accepts exactly `shadow` and `post_match`. There is no third value,
  no flag, and no code path for referee contact, challenges or decision changes.
- `FairPlayReview.authorityMode` is always `shadow`; the cloud refuses anything else.
- Findings record what the footage shows (`supports_original`, `supports_alternative`,
  `inconclusive`, `footage_unavailable`) and never a ruling. No "Referee Overturned" control.
- FairPlay never writes `SbMatchEvent`, `SbMatchStatistics` or a score.
- The console shows a permanent **SHADOW REVIEW — NOT VAR** banner; reports carry the same
  line and the PID's governance note. Nothing is marketed as VAR or FVS.
- A test asserts each of the above, so removing one fails CI.

## Consequences

Adding authorised support later is a deliberate schema and code change with its own
review, which is the point. The cost is that a future trial cannot be switched on quickly.

## Alternatives rejected

A disabled feature flag (PID §7.4 mentions one): rejected for V1, because it ships the
dangerous path dormant. The flag belongs to the separate approval project.
