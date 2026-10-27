# ADR-0008 — Single-angle mode is a first-class mode, not a degraded one

**Status**: proposed (Phase 0) · **Decides**: what ships if only a programme feed exists

## Context

Nothing in the repo or the PID establishes that the switcher exposes isolated camera
feeds ([equipment audit](../equipment-audit.md)). Promising two angles on that basis is a
standing stop condition.

## Decision

- `FairPlaySession.angleMode` is `single` or `multi`, set at session creation from the
  sources actually configured and recording. The console and reports state it.
- In `single` mode the side-by-side view, cross-camera calibration and "switch angle"
  controls are absent, not greyed out; incidents record `anglesAvailable: 1`.
- If the single source is the switched programme, the console shows a standing note that
  cuts, replays and graphics may hide an incident, and `footage_unavailable` is offered
  prominently.
- Two-angle capture is a hardware prerequisite recorded in the phase plan, bought only
  after the audit and the pilot show it is needed.

## Consequences

The pilot can run on whatever exists today. Reports from single-angle sessions will be
weaker evidence, and say so.
