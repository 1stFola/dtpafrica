# 72 — Phase 6 Increment 4: draggable event boundaries

5 October 2026.

## Phase 6 status checked

Increments [1](./44-PHASE-6-INCREMENT-1.md), [2](./48-PHASE-6-INCREMENT-2.md)
and [3](./49-PHASE-6-INCREMENT-3.md) have their implementation in the repository:
the candidate ledger and promotion rules, timeline and inspector, sub-minute
ScoreBoard timestamps, and review queue. The focused event backend suite and
web suite pass in this checkout.

This does **not** complete the Phase 6 gate. Ball trajectory smoothing with lost
state, possessor candidates, possession segments and automatic event proposals
still await a licensed ball detector. Event precision, actor attribution and
replay duplicate prevention still need evaluation on rights-cleared real footage
with gold events. The existing unit tests are not that evaluation.

## Boundary correction from the timeline

The selected, correctable candidate now has draggable Start and End controls
under the timeline. Each displays source time including milliseconds; the
control itself works in proxy time and snaps to the proxy frame before adding
the source offset. Without a frame rate it uses milliseconds and says so.

Neither boundary can cross the other, and a drag stays inside the visible clip.
An instant event can be expanded by moving End first. The native range controls
also work with keyboard arrows and expose the source timestamp to assistive
technology.

Dragging changes a local draft. **Apply boundaries** sends both bounds through
the existing correction endpoint, creating a new, unreviewed candidate. Reset
discards the draft. Promoted and superseded candidates, users without review
permission, and requests already in flight get no boundary controls. The page
also checks correction eligibility before dispatch and uses the candidate the
editor supplied, rather than choosing one again from the moving playhead.

No schema, worker, API or taxonomy change.

**Follow-up on real footage:** [74](./74-LOCAL-PILOT-CLIP.md) records the padded
proxy tail this clip exposed. The media API now supplies original duration and
the boundary controls stop at it; the last padded frames cannot become evidence.

## QA

| Check | Result |
|---|---|
| Full web suite | 229 tests passed across 18 files |
| Focused API event suite | 56 tests passed across 4 files |
| Web production build | Passed, including TypeScript and About prerender |
| Final web typecheck and diff whitespace check | Passed |
| Timing regressions | Proxy offset, frame snapping, missing fps, fractional fps, clip limits, crossing bounds and instant events covered |
| Rendered controls | Accessible names, proxy values, source timestamps, frame steps, unchanged Apply disabled, permission/promotion/busy gating covered |

The web test configuration now includes `.spec.tsx` so the rendered-control
checks run in the standard suite. Browser interaction with real footage and the
live API was not exercised here. The Phase 6 real-footage gate remains open.
