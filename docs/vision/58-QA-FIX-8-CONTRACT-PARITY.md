# 58 — QA fix 8: contract parity

PR-8 of the fix plan in [50](./50-QA-PHASES-1-6.md) §3. It covers the contract findings in
appendices B, D and E. Fola's two rulings (4 October 2026) are built as taken: the version
rule below, and validators only for the Json columns a worker or a person writes into.
The contract version stays `1.12.0`: no stage's inputs or outputs change.

---

## Which worker may serve which stage

The worker's contract version had to equal the control plane's. Every bump retired every
worker image built before it, including the bumps that changed no stage. 1.10.0 and
1.11.0 did that to the GPU image for nothing.

The rule now has three parts.

1. The same major version.
2. The worker no newer than the control plane. A worker ahead of it may send what that
   control plane has never heard of.
3. Per stage, the worker at or past the version in which that stage's inputs or outputs
   last changed (`STAGE_CONTRACT_SINCE` in the contracts).

The control plane applies all three at claim (`workerCompatibility`) and hands a worker
only jobs of the stages it can serve. A job of another stage stays queued for a worker
that can. The worker applies the first two (`contract_compatible`); it cannot know what
changed after it was built, and does not need to, because it is not handed those stages.

**When you bump the version:** if the change touches a stage's inputs or outputs, move
that stage's entry in `STAGE_CONTRACT_SINCE` to the new version. If it touches none, move
nothing, and every worker goes on serving what it served.

Every entry starts at `1.12.0`. Under exact matching no older worker was being served, so
nothing is lost. A worker behind every stage is refused with "rebuild the worker image",
not left polling.

## Segment kinds are the contract's

The calibration editor and its DTO offered `wide`, `close`, `replay` and `other`. The
contract, and the rule that keeps a replayed goal out of the match record, speak of
`live_play`, `replay`, `intro`, `halftime`, `camera_cut` and `unknown`. Nobody could
declare an intro or half-time, so the not-in-play rule only ever fired on replays; and the
`unknown` that scene detection writes was outside the editor's set.

The DTO and the page now take the kinds from the contract. Migration
`20261005110000_vision_camera_segment_kinds` carries stored rows across: `wide` and
`close` become `live_play`, `other` becomes `unknown`. It changes data only and is safe to
run twice. The dev database had no segments; **on live, the deploy applies it**.

The framing (`wide` or `close`) was never read by anything, so nothing is lost by folding
both into `live_play`.

## The web reads the contract

The web app had no dependency on the contracts and kept hand copies. They drifted.

| Copy | Was | Now |
|---|---|---|
| Stage prerequisites | fingerprint needs probe | from `JOB_TYPE_PREREQUISITES`: fingerprint needs nothing, as the API has it. The button was greyed for no reason |
| Event types | listed twice | `VISION_EVENT_TYPES`, once |
| Job states | listed three times | `VISION_JOB_STATES` and `ACTIVE_JOB_STATES` |
| Segment kinds | `wide`, `close`, `replay`, `other` | `CAMERA_SEGMENT_KINDS`, with words for each |
| Calibration quality | its own union | the contract's type |
| Suppression reasons | a loose record | keyed by the contract's reasons, so a new one without words does not compile |

The web resolves `@dtp/vision-contracts` to the package's source, by a Vite alias and a
TypeScript path, the way it already takes `@dtp/engines`. The package imports nothing, so
the browser takes it as it is and the web image needs no extra build step.

Inside the contracts, `NON_PLAY_SEGMENT_KINDS` and `NON_LIVE_SEGMENT_KINDS` were two lists
of the same three kinds. They are now one list under two names.

## Json columns: validate what a worker or a person writes

[04](./04-DATA-MODEL.md) said every `Json` column needs a Zod schema in the contracts. The
package has no Zod and no runtime schemas, by a decision recorded in its README. The rule
is replaced by one the code can keep: a column written by a worker or a person is
validated at the door, and a column the control plane writes for itself has a documented
TypeScript shape. [04](./04-DATA-MODEL.md) now carries the inventory.

One gap was real. `VisionRightsScope.restrictions` was accepted as any object.

- A `deny` entry that is not a scope, such as `"canPublish"` for `canPublishHighlight`,
  read as a restriction and restricted nothing. `readRestrictions` in the contracts now
  refuses it when a grant is filed (`400 RestrictionsInvalid`), and the rights policy
  treats one already stored as a denial of every scope.
- A flag the policy does not understand is still stored, because a person may mean it.
  The reply now carries `restrictionsWarning` saying that the grant denies every scope,
  which is what [54](./54-QA-FIX-4-RIGHTS.md) made such a flag do.

## A segment a candidate rests on cannot be deleted

An event candidate takes its in-play flag from its camera segment and links to it as
evidence. There is no foreign key, so deleting the segment left both pointing at nothing.
`deleteSegment` now refuses with `409 SegmentReferenced` while a current candidate is filed
under the segment or links to it.

## Tests and checks

| Check | Result |
|---|---|
| Contracts | 65 passed (was 54) |
| Worker pytest | 328 passed |
| API suite | 1,448 passed; typecheck clean |
| Web | 196 passed; typecheck and build clean |
| Mutation runner | 25 of 25 killed, across contracts, API, worker and web |
| Migration | `prisma migrate diff` both ways against the shadow database: no difference |
| `vision:jobcheck`, run twice | 27/27 (was 25): a worker that cannot serve a job's stage is not handed it; one that can serve none is handed nothing. This is the only test of the queue's stage filter, which is raw SQL |
| `vision:calibrationcheck`, run twice | 41/41, on the contract's kinds |
| `eventcheck`, `gamestatecheck`, `trackcheck`, `catalogcheck`, `uploadcheck`, `identitycheck`, `cutscheck` | all pass |
| `vision:e2echeck`, the real container built from this branch | 38/38: the worker registers, claims and completes under the new rule |
| `db:purge:gate-litter` | nothing to delete |

## What is not done

| Item | Why | Where |
|---|---|---|
| The calibration page in a browser | The kind selector is covered by typecheck and unit tests. It was not opened in a browser | next UI pass, PR-9 |
| A worker on an older version served some stages | Unit-tested with a pretend newer control plane. It cannot be shown end to end until a bump leaves a stage's entry behind | the next contract bump |
| The clock's base minutes in the web | `match-clock.ts` mirrors the API's `HALVES`, which is not in the contracts | PR-9 |
| Three default pitch sizes in the contracts | Appendix B low | PR-12 |
| Runtime validators for label `definitions` and the worker's per-stage `summary` | `definitions` is free-form by design; each stage's summary is already parsed where it is applied | not planned |

## After merge

1. The deploy applies the data migration. On live, any segment declared as `wide`,
   `close` or `other` is renamed as above.
2. Nothing else to run by hand. The worker image and the API still deploy from one commit.
