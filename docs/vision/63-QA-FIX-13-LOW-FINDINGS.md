# 63 — QA fix 13: five low findings in the events and models services

The five low findings in [appendix B](./qa/B-api-phases-3-6.md) that
[62](./62-QA-FIX-12-DOCS.md) listed as not done. Four needed work; the fifth was already
done and is recorded here as such. One migration, of one nullable column. The contract
version stays `1.12.0`.

---

## The person who proposed an event does not accept it

**What was wrong.** A correction writes a new row that supersedes the old one, and the new
row's `decidedBy` is whoever corrected it. Self-acceptance was checked against that row
alone. So if Alice proposed an event and Bob corrected anything about it, even the note,
Alice could accept it: her own claim, confirmed by herself.

**What it does now.** Every row carries `proposedBy`, the author of the first row in its
chain. A proposal sets it; a correction carries it on. Acceptance is refused, with
`403 SelfAcceptanceRefused`, to the author of the current row and to the first proposer.

| Alice proposes, Bob corrects, then… | |
|---|---|
| Alice accepts | refused: she proposed it |
| Bob accepts | refused: he wrote this row |
| Carol accepts | accepted |
| Alice rejects, with a reason | allowed: saying it is wrong is not confirming it |
| Alice corrects again | allowed; the row is then hers, and she is still the proposer |

**The consequence to know about.** With only two reviewers, an event one of them proposed
and the other corrected can be accepted by neither. They can still move it on: the
proposer rejects it and the corrector proposes it afresh, which makes the corrector the
proposer and the first person free to accept. A third reviewer avoids the detour. This is
the rule the finding asked for; if it is too strict for the size of the team, the
alternative is to refuse only the current row's author, which is what it did before.

Someone who corrected in the middle of a longer chain, neither first nor last, is not
refused. The column holds the first proposer only.

**Rows from before the column.** The migration fills `proposed_by` for every existing row
by walking each chain back to its first row. A row it somehow missed has null there, and
the code then falls back to the row's own author, which is the old rule.

The screens follow: the inspector does not offer Accept to the proposer and says "you
proposed this and someone else corrected it; a third person accepts". Reject and Correct
stay.

## A correction is a person's row

A corrected row kept `method` and `modelVersionId` from the row it replaced. When a model
proposes candidates, a candidate a person had rewritten would still have said a model
proposed it. A correction is now `method: "manual"` with no model version. The row it
supersedes keeps both, so what the model proposed and what the person changed are two rows.

No model writes candidates yet (appendix F), so no existing row is affected.

## A refused promotion does not rewrite the row

When promotion found the candidate inside a replay, it set `inPlay` to false and replaced
`cameraSegmentId` on the candidate before refusing. That candidate had been accepted, so
the row in the database stopped being the row the second person accepted. The refusal is
now an audit entry, `event.promotion.refused`, with the segment and what the row said when
it was accepted, and the row is left alone.

The screen's Promote button reads `inPlay` from the row, so for a candidate accepted
before its segment was declared a replay, the button stays and each press is refused with
the reason. Correcting the candidate re-reads the segment.

## One shape for a refusal, one person check

`shared/refusals.ts` has three builders:

- `refusal(status, error, message, remediation)`: the shape every Vision refusal is meant
  to have.
- `notFound(what, id)`: `404 NotFound` with a remediation. A bare
  `new NotFoundException("…")` answered `error: "Not Found"` and nothing to do next.
- `personFor(error, detail)`: the check that the caller is a signed-in person. It was the
  same function in five services. Each service keeps its own error code and its own
  reason, so nothing a client matches on changes.

In the four services the finding named (`events`, `promotions`, `benchmarks`, `models`):

| Was | Now |
|---|---|
| 17 refusals thrown as a bare string | `notFound(…)`, or a named refusal with a remediation |
| `ModelTaskUnsupported`, `ModelVersionArchived` (benchmarks), `BenchmarkNotApplied`, `ModelTaskMismatch` without a remediation | each has one |
| `ReasonRequired` as `409` | `400`: nothing about the candidate is in the way, the request is missing a field |
| "… runs no model; do not pass modelVersionId" as a bare 400 | `400 ModelNotApplicable` |
| "Unknown model version" on a job's explicit version as a bare 400 | `400 ModelVersionUnknown` |

`PitchDimensionsInvalid` in the calibration service gained a remediation on the way past.

A test reads those four files and fails on a bare-string refusal or an object without
`remediation`, and on a service growing its own `requirePerson` again.

**Client-visible changes:** `ReasonRequired` is 400 where it was 409; an unknown id in
these four services answers `error: "NotFound"` where it was `"Not Found"`; two bare 400s
have names. The web matches on none of them.

## The gate's `comparedWith`: already done

The finding was that the promotion gate kept only the last production version it compared
against. [57](./57-QA-FIX-7-MODELS.md) added `comparedWithAll`, the list, and kept
`comparedWith` as its last entry for readers of the old field. Nothing to do.

## The migration

`20261005130000_vision_event_proposed_by`: `ALTER TABLE … ADD COLUMN IF NOT EXISTS
"proposed_by" TEXT`, and a recursive backfill that touches only rows where it is null.

## Tests and checks

| Check | Result |
|---|---|
| API suite | 1,512 passed (was 1,500); typecheck clean |
| Web | 213 passed (was 212); typecheck and build clean |
| Contracts, worker | not run: nothing in them changed |
| Mutation runner | 24 of 24 killed |
| Migration | `prisma migrate diff` both ways against the shadow database: no difference. Run twice on the dev database |
| `vision:eventcheck`, run twice | 98/98 (was 89). New: the proposer and the corrector are each refused and a third person accepts; a missing reason is a 400 with a remediation; the refused promotion is in the audit log; **the migration's backfill**, run by the gate on a real two-row chain with the column emptied, names the first author on both rows |
| The other nineteen gates, twice | all pass |
| `db:purge:gate-litter` | nothing to delete |

## What is not done

| Item | Why | Where |
|---|---|---|
| Bare-string refusals in the rest of the module | **Done since, in [64](./64-QA-FIX-14-REFUSAL-SHAPES.md).** As written then: about 125 remain in the annotation, sources, upload, worker, dataset, identity, calibration and jobs code. The finding named four services; those are done, and the test covers them. The helper is there for the rest | service by service |
| The same proposer rule for identity assignments | An identity has no correction chain: a new assignment supersedes by window, and acceptance already refuses its author | not planned |
| A corrector in the middle of a chain | Not refused; the column is the first proposer | if it is ever wanted, walk the chain at decision time |
| The inspector's new line, in a browser | The rule is a tested function and the line is one string. The page was not opened | next UI pass |

## After merge

The deploy applies the migration, which fills `proposed_by` on existing candidates. Nothing
to run by hand.
