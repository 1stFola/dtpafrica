# 57 — QA fix 7: models and benchmarks

PR-7 of the fix plan in [50](./50-QA-PHASES-1-6.md) §3. It covers critical C7 and the model
findings in appendices B and D, and three identity findings from appendix B that
[55](./55-QA-FIX-5-EVENTS-CLOCK.md) and [56](./56-QA-FIX-6-PIPELINE-MATHS.md) left for this
batch. No migration and no contract change.

---

## Promotion can be done from the screen (C7)

The Models page showed Approve and Reject only for a stage called `promotion_requested`.
There is no such stage: a request is a row beside the version, not a stage of it. Reject
also read `promotions` from a reply that carries `requests`. "Request promotion" was offered
only from `benchmarked`, so the step from staging to production was not offered at all.
From the screen, a model could not be approved, rejected or sent to production.

- `GET /vision/models` now returns each version's `pendingPromotion`: the request waiting
  on a second person, with who asked and for which stage.
- The page's rules are a tested function, `model-promotion.ts`. It offers a request from
  `benchmarked` (to staging) and from `staging` (to production) when none is waiting;
  Approve and Reject on a waiting request to a different person who may promote; a line
  saying a second person decides to the person who asked; and Roll back on a production
  version.
- The rejection reason is kept per request. One shared field used to put the reason typed
  for one version on whichever version's Reject was pressed.

Checked in a browser against this branch's API, signed in as a scratch approver: the five
stages showed the buttons above, and rejecting the waiting request returned 201 and the row
then offered "Request promotion to production".

## The smoke check looks in the right stage

The gate's smoke check counted succeeded `detect` jobs whatever the model's task. A tracker's
runs are `track` jobs and an identify version's are `identify` jobs, so neither could ever
pass, and neither could be promoted. It now counts jobs of the stages that run the model's
task (`MODEL_TASK_BY_JOB_TYPE`). A task no stage runs yet fails with that as the reason.

## A bar belongs to a task

`minimums` was keyed by metric alone. The first detection minimum to be set, say `ap:all`,
would have failed every tracking and identify run as `missing`, because those runs do not
measure it. `minimums` is now keyed by task, and a run is judged against its own task's
bar. No minimum is set yet, so every verdict is still `unthresholded` and the thresholds
version is unchanged.

## One request, one decision, one production version

| Step | Before | Now |
|---|---|---|
| Request | Checked for a pending request, then created one. Two people asking at once both saw none | Created under a lock on the version, after looking again. The second is told `PromotionPending` |
| Approve | Three unconditional writes in a batch | One transaction under the version's lock and, for production, the task's. The request is approved only while pending (`PromotionDecided`), and the version moved only from the stage the request named (`StageChanged`) |
| Two versions of one task promoted at once | Each read "nothing in production" and both became production | The task's lock makes the second see the first and demote it |
| Reject | Unconditional update | Only while pending; a rejection does not overwrite an approval made a moment before |

The locks are Postgres advisory locks held to the end of the transaction, named by version
and by task. No migration.

## Rollback restores what is still where it was left

Rollback set the version to staging and its recorded predecessors to production, whatever
had happened to them since.

- A predecessor that was archived, promoted again or deleted is not quietly put back. The
  rollback is refused with `409 RollbackTargetMoved`, naming the version and its stage.
- Any other version of the task that reached production in between is demoted with the one
  rolled back, and reported as `alsoDemoted`. The task is left with exactly what was
  restored.
- Two rollbacks at once restore once; the second gets `AlreadyRolledBack`.

The gate's record now keeps every production version a candidate was compared with
(`comparedWithAll`), not only the last.

## Identity: three findings carried here

- **A decision is made once.** `accept` and `reject` wrote over whatever was there, so an
  accepted, public identity could be flipped to rejected and back, with the reviewer
  rewritten each time. A row is now decided only from `unreviewed`, by a conditional
  write (`409 AlreadyDecided`). To change a decision, assign the track again.
- **Sides are not swapped quietly.** `setSides` was an upsert. Every identity on the job was
  checked against the sides as they stood, and the identify benchmark reads them as truth.
  A different answer is now refused with `409 SidesAlreadyDecided` unless the caller sends
  `override: true`, and the audit records `identity.sides.changed` with the previous
  sides. The identity page's button becomes "Change sides" and says what it replaces.
- **A partial overlap keeps the rest.** Saying who a track was for its last ten seconds
  superseded an earlier assignment whole, erasing an accepted identity for the minute
  before. The part the new window does not cover is now filed again as its own row, with
  the old decision and its review as they were.

Rejecting an identity still appends the reason to the row's `note`. There is no separate
column for it, and with one decision per row it is written once.

## What a real gate found that the tests could not

The first run of `vision:promotioncheck` returned 500 on every promotion request. The lock
function returns `void`, which the database client cannot read back, and a mocked
transaction does not know that. The query now casts the result. The same run also showed
that the loser of two simultaneous rollbacks was told its target had "moved", because the
winner had just restored it; the claim is now taken first, so it is told
`AlreadyRolledBack`.

## Tests and checks

| Check | Result |
|---|---|
| API suite | 1,439 passed (Vision 863); typecheck and build clean |
| Web | 195 passed; typecheck and build clean |
| Mutation runner | 39 of 39 killed. One survived at first because the test's fake ignored part of its filter; the fake now honours it |
| `vision:promotioncheck`, run twice | 61/61 (was 45). New: two requests at once leave one pending; two approvals at once promote once, with one audit entry; the registry list names the waiting request; a rollback onto an archived version is refused; two rollbacks at once restore once |
| `vision:identitycheck`, run twice | 65/65 (was 53). New: no flipping a decision; sides refused, taken again unchanged, and changed with override and audit; an identity for one second in the middle of an accepted window leaves it accepted either side, in the database and in the public view |
| `modelcheck`, `identitymetricscheck`, `trackmetricscheck` | all pass |
| `vision:benchcheck` | 47/49, the same two stale expectations recorded in [53](./53-QA-FIX-3-JOB-PROTOCOL.md), for PR-11 |
| `db:purge:gate-litter` | nothing to delete |
| Browser | The Models page as a scratch approver, as above. The requester's own view ("a second person decides") is covered by the unit test, not the browser |

## What is not done

| Item | Why | Where |
|---|---|---|
| The smoke check per task, in a gate | Unit-tested for detect, track and identify. No gate promotes a tracker end to end | PR-11 |
| Batched rights in the promotion gate | Appendix B medium: one rights query per dataset member, and the gate runs twice | PR-10 |
| A partial unique index for one pending request | The lock does the job without a migration, and Prisma's schema cannot express a partial index, which CI's schema check would report | not planned |
| `loadArtifact` reading a whole track artifact; `forAsset` pagination | Appendix B medium | PR-10 |
| Refusal shapes without remediation; one shared `requirePerson` | Appendix B low | PR-12 |
| Deleting a camera segment that candidates reference | Appendix B medium | PR-8, with segment kinds |

## After merge

Nothing to run by hand. On live, a version that is `staging` can now be requested for
production from the Models page.
