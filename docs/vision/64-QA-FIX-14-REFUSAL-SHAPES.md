# 64 — QA fix 14: every refusal in the module has the shape

[63](./63-QA-FIX-13-LOW-FINDINGS.md) brought four services to one refusal shape and left
about 125 bare-string refusals in the rest of the Vision module. This does the rest. No
migration; the contract version stays `1.12.0`.

---

## What a refusal is

Every refusal the Vision API sends is now:

```jsonc
{
  "statusCode": 409,
  "error": "DatasetFrozen",          // which refusal, by name
  "message": "Dataset version gold-2026.3 was frozen on … and is immutable. Create a new version.",
  "remediation": "Create a new dataset version and make the change there."
}
```

A bare `new ConflictException("…")` sent `error: "Conflict"`: the status again, in words,
and nothing to do next. A screen or a script could tell one refusal from another only by
matching on the sentence.

## What changed

126 refusals in 17 files, all through the helpers in `shared/refusals.ts`:

| Area | Files | Refusals |
|---|---|---|
| Annotation | `annotation.service` | 32 |
| The worker's surface | `worker.controller`, `worker-token.service`, `vision-worker.guard` | 28 |
| Sources and rights | `sources.service`, `sources.controller` | 17 |
| Uploads | `upload.service`, `partner-uploads.controller`, `partner-upload.guard` | 15 |
| Datasets | `datasets.service` | 9 |
| Jobs | `vision-jobs.service`, `jobs.controller`, `tracks.controller` | 9 |
| Identity, calibration, clock | their services | 16 |

Of the 126, 43 were "Unknown *thing* *id*" with a 404 and became `notFound(…)`. The other
83 each got a name and a remediation written for that refusal.

**Nothing else about them changed.** Every message is word for word what it was, and
every status code is what it was. That is deliberate: the Python worker acts on status
codes alone, and tests and gates match on messages. The change a client can see is the
`error` field, which was the status in words and is now a name, and the new `remediation`.

Three choices worth knowing:

- **Where the code was deliberately vague, the name is too.** The partner upload guard
  answers "Invalid or expired upload link" for an unknown, a revoked and an expired link
  alike, so that a caller cannot learn which. All three are `UploadLinkInvalid`. The same
  for a worker token that is unknown, of the wrong kind or expired: `WorkerTokenInvalid`.
  A test holds two of those to the same answer.
- **`vision-jobs.service` keeps its 400s** for an unknown asset and an unknown job
  (`AssetUnknown`, `JobUnknown`). A 404 would be more usual; changing a status was out of
  bounds here.
- **The claim's contract refusal is `ContractMismatch`.** Doc 07 called it
  `400 Contract mismatch`, which was the start of its message, not a name.

`refusal()` now takes 401 as well, for the two guards.

One refusal was an object without a remediation and was not a bare string: the worker's
`ProvenanceMismatch` and `WeightsMismatch`. It has one now.

## The test covers the module

`shared/refusals.spec.ts` used to read the four services [63](./63-QA-FIX-13-LOW-FINDINGS.md)
named. It now walks every source file under `src/vision` and fails on:

- a refusal thrown as a bare string;
- a refusal object with no `remediation`;
- a refusal built with an empty name;
- a service with its own copy of the person check.

So the next refusal somebody writes has to have the shape.

## Two gaps the mutation run found

Neither is new behaviour; both were true and untested.

- **A retired worker's token.** Removing the check left every test passing. Tests now
  hold `verify` and `register` to `401 WorkerRetired`.
- **An unknown dataset version.** Its status was pinned nowhere. A test now holds add,
  split and freeze to `404 NotFound`, and a change to a frozen version to
  `409 DatasetFrozen`.

## Tests and checks

| Check | Result |
|---|---|
| API suite | 1,519 passed (was 1,512); typecheck clean. The existing tests passed unchanged, which is the check that no message or status moved |
| Web, contracts, worker | not run: nothing in them changed, and the web matches on no `error` value this touches |
| Bare-string refusals left in `src/vision` | 0, by the module-wide test and by a separate count |
| Mutation runner | 12 of 12 killed, after the two tests above; 10 of 12 before |
| All twenty gates that run without Docker, twice | all pass, unchanged but for `trackcheck` |
| `vision:trackcheck` | 58/58 (was 56): over HTTP, a 404 on an admin route and a 401 at the worker's door each carry a name and a remediation |
| `vision:e2echeck`, the real worker container | 38/38: the worker registers, claims, reads and completes against the reshaped surface |
| `db:purge:gate-litter` | nothing to delete |

## What is not done

| Item | Why | Where |
|---|---|---|
| A catalogue of the error names | There are about 180 across the module. They are in the code, each beside its message; a list in a doc would drift the way doc 07's routes did | generate it, if a client ever needs it |
| Statuses that could be better | `vision-jobs.service` answers 400 for an unknown id; some "already done" refusals are 400 where 409 would fit. Changing a status changes what the worker and scripts do | each on its own, with the client checked |
| Refusals outside Vision | The rest of the API (ScoreBoard, admin) was not in the QA | not planned |
| The web showing `remediation` | `adminFetch` shows `message`. Many messages already say what to do; the remediation is there for a screen to show beside it | a UI pass |

## After merge

Nothing to run. A client that matched on `error` being `"Bad Request"`, `"Not Found"`,
`"Conflict"`, `"Forbidden"` or `"Unauthorized"` from a Vision route would need to match on
the status code; none in this repository did.
