# 23 — Phase 2 Increment 2: annotation

Models can be retrained. **Labelled Nigerian youth football, corrected by someone who
knows what they are looking at, cannot be bought.** That is the only asset in this
system with no substitute, so this increment is built around never losing it and
never trusting it blindly.

Four claims, all enforced rather than encouraged:

| | |
|---|---|
| A correction is never lost | A resubmission **supersedes**; both payloads survive at their own keys |
| Nobody approves their own work | Refused between identified users; an unattributable verdict is **recorded as one** |
| An annotator never sees the master | They get a presigned **proxy**, translated into proxy time |
| Footage nobody may analyse never reaches a human | Rights checked at task creation *and* at queueing |

---

## Why supersede instead of update

The obvious design is a labels row you edit. It is also the one that destroys the
most valuable data DTP generates: **the difference between the first attempt and the
corrected one is the training signal**, and it tells you where the model and the
handbook are weak. An `UPDATE` throws that away silently and permanently.

So a submission writes to `annotations/{taskId}/{versionId}.json` — keyed by
*version*, never by task, because a task-keyed path would overwrite on every
resubmission and look like it was working. `supersedesId` chains the attempts, and
the row keeps a SHA-256 so labels that change underneath are **detectable rather
than quietly trusted**: reading a version back verifies the checksum and refuses on
mismatch rather than handing over bytes nobody can vouch for.

Effort minutes are recorded on every submission, because a pre-labelling model that
is 5% more accurate and doubles correction time is a **worse** model for DTP, and
without the minutes nobody can tell which happened.

## Why the sampling strategy is mandatory with no default

Uniform random sampling produces a corpus of easy frames: mostly midfield, mostly
clear, mostly nothing happening. A model trained on that looks fine in evaluation and
fails on the crowded penalty box that decides matches.

Every task therefore records **why its window was chosen**, from a closed list, with
no default — a default would be `uniform_random`, and silently recording the control
group for a window somebody picked deliberately is exactly the drift that makes the
mix report meaningless. `GET /vision/annotation/mix` reports the **hard-case share**,
so "what fraction of our labels came from hard cases?" is answerable rather than a
matter of opinion. It returns `null`, not `0`, when there are no tasks: zero would
read as "no hard cases", which is a different claim from "no data".

## The claim race

Two annotators opening the tool at the same instant must never be handed the same
window — one of them wastes an hour, and the disagreement metric is polluted by work
that was never independent.

The first implementation was a `SELECT … FOR UPDATE SKIP LOCKED` followed by an
`UPDATE`. **That is a bug**: each Prisma query is its own transaction, so the row lock
is released the moment the `SELECT` returns. It is now one statement, exactly as the
job queue does it.

A sequential test cannot tell the two apart — the broken version passes it every
time. So the gate fires **two genuinely concurrent HTTP requests** against real
Postgres and asserts they receive different task ids.

## Proxy, not master, and in proxy time

`vision_annotator` deliberately lacks `vision.media.raw.read`. A service that handed
out a master URL would silently undo that, so a task on an asset with no proxy is
refused outright (`409 NoProxyAvailable`) rather than falling back.

The window is translated by the proxy's `sourceOffsetMs`. A proxy that does not start
at source zero would otherwise put **every** label a few seconds out — an error that
survives review because the labels look internally consistent with each other.

The test asserts the **bucket** passed to `presignGet`, not just the key. A
master-bucket presign under a proxy-shaped key would pass a key-only check while
handing an annotator raw youth footage.

---

## The finding that outgrew this increment

> **Request DTO validation does not run in the dev server.** It runs in production.

`services/api/package.json` runs dev as `tsx watch src/main.ts`. tsx uses esbuild,
which does not implement `emitDecoratorMetadata`, so `design:paramtypes` is absent and
Nest's `ValidationPipe` finds no metatype to validate against — **every request body
passes straight through**. The compiled output does carry the metadata (9
`design:paramtypes` entries in one controller), so `pnpm start` is unaffected.

Found by this gate. Three checks failed, and probing them directly showed
`POST /vision/annotation/schemas` accepting `version: ""` with
`definitions: "not-an-object"` and **creating the row** — a taxonomy made of character
indices, because `Object.keys("not-an-object").length` is 13 and sailed past a bare
emptiness check.

Two consequences worth stating plainly:

1. **Every gate script runs against dev**, so any guard that exists only in a DTO is
   one nothing has ever verified. Earlier increments' `400`s that looked like DTO
   rejections were in fact service-level throws.
2. Dev is more permissive than production, which is the wrong direction for a
   divergence to run.

**What was done here:** the closed vocabularies moved into the service —
`samplingStrategy`, `reason`, `decision`, `rejectionReason`, and the shape of
`definitions`. These are domain invariants in any case ("a sampling strategy is one of
these seven" is a fact about the corpus, not about HTTP), they now hold in every
environment, and the service tests cover them.

**What was not done:** the dev server still does not validate. Fixing that properly
means changing how dev runs — the Nest CLI, `ts-node`, or SWC, none of which is
currently a dependency — and that is a workflow decision, not a Vision one. Until
then, treat a DTO decorator as documentation plus a production guard, never as the
only guard.

## Self-review, and what the gate cannot prove

`api_key` auth is a single shared full-access credential with **no user id**, so
there is no "self" to compare over HTTP. Rather than let the control silently not
apply, a verdict with no user behind it is recorded as `unattributed: true` with its
`actorMethod` — and the gate asserts that flag, turning an invisible weakness into a
visible one.

Self-review *refusal* is covered by unit tests, verified by deleting the check and
watching the test fail.

---

## Endpoints

| | |
|---|---|
| `POST /vision/annotation/schemas` | Publish a taxonomy version. Reuse of a version → **409** |
| `POST /vision/annotation/schemas/:id/supersede` | Retire it. Refused while tasks are open against it |
| `POST /vision/annotation/tasks` | Create work. Rights, proxy and window all checked |
| `POST /vision/annotation/tasks/claim` | Atomic claim, returns a proxy URL in proxy time |
| `POST /vision/annotation/tasks/:id/submit` | A new version. Never an update |
| `GET /vision/annotation/versions/:id` | Labels, checksum-verified |
| `POST /vision/annotation/versions/:id/review` | Append-only verdict |
| `GET`/`POST /vision/annotation/queue` | The active-learning loop |
| `POST /vision/annotation/queue/:id/convert` | Queue item → task, carrying its reason as the strategy |
| `GET /vision/annotation/mix` | Hard-case share, review outcomes, correction time |

`vision.annotate` claims and submits; `vision.review` records verdicts;
`vision.datasets.manage` publishes schemas and decides what gets labelled, because
that is a corpus decision rather than a labelling one.

A rejection re-queues the window — **except for `rights_issue`**, which is a
governance problem and not a sampling signal. Re-queueing it would put footage back
in front of a human for exactly the wrong reason.

## Verification

```
api tests            470 passed  (was 415)
  annotation          52
contracts tests       22 passed
typecheck            clean
vision:annotationcheck  53/53 against live Postgres, the live API and live R2
other gates          selfcheck 27/27 · datasetcheck 54/54 · catalogcheck 30/30
```

The four headline refusals were each **mutation-tested**: the self-review check, the
proxy bucket, the supersede chain and the rights gate were broken one at a time, and
each produced a failing test. A check never seen to fail is not known to work.

## What is not done

| | |
|---|---|
| **No annotation UI** | Endpoints only. The drawing surface is a front-end increment, and CVAT remains the documented option for the drawing itself. |
| **No pre-labelling** | The task carries `preLabelModelVersionId` and marks itself pre-labelled, but nothing generates suggestions yet — there is no model. |
| **Inter-annotator agreement** | The data to compute it now exists (multiple versions per task, reviewer verdicts); the metric does not. |
| **Dev-server validation** | See above. A workflow decision. |
