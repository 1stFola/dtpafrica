# 19 — Phase 1, Increment 4: resumable upload, and the dispatcher

**Gate: PASS** — `vision:uploadcheck` reports 21/21 against live R2, including the
interruption test this increment exists for.

---

## Why resume is the whole feature

The binding constraint is not the object store, it is Nigerian connectivity. A
6 GB master over an unstable link **will** be interrupted. If an interruption
means starting from zero, partners stop uploading and the corpus — the thing that
is actually DTP's moat — never gets built.

So session state lives on the server, and resume is authoritative against **what
the store actually holds**, not what a client remembered to report. A client that
died mid-upload never reported its last part, and over a bad link that is the
normal case rather than the exception.

That is why `ObjectStore` gained `listParts`: the server asks the store.

### The gate

```
Interruption
  part 1 accepted by the store                      true      (5 MiB lands)
                                                              (part 2 never sent)
Resume
  server knows part 1 landed                        1
  and reports its size                              5242880
  tells the client where to carry on                2
  part 2 accepted after resuming                    true
  both parts now known                              2
  byte count is the full file                       5246976

Complete
  and is the whole file, not a truncated one        5246976
```

Bytes never traverse the API. Every route returns metadata or a signed URL; the
client PUTs directly to the store. That is what keeps a 2 vCPU control plane out
of the path of a 6 GB file.

## Decisions worth naming

**Rights are checked at the door.** Refusing after 6 GB has landed would be both
useless and expensive. A catalogue-only source, a refused acquisition, a missing
acquisition method, or a partner with no rights evidence attached are each refused
before a session opens — with a `remediation` string saying what to fix. The
catalogue-only refusal is asserted against the live API.

**A gap is refused, not completed.** If part 2 is missing between 1 and 3,
completing anyway produces a **silently truncated master** — the worst outcome
available, because there is no versioning to recover from and the truncation would
look like a valid file.

**The store's byte count wins over the client's estimate.** `expectedBytes` is
advisory; a mismatch is logged rather than enforced, because a client's figure can
be wrong and a size check is also what a truncated upload looks like.

**Auto-queueing failure does not fail the upload.** Completion queues `probe` and
`fingerprint` — cheap, CPU-only, and needing no match linkage. If the analysis
grant is missing, the bytes are safely stored and the jobs can be queued later, so
the refusal is logged rather than surfaced as a failed upload. *(This is how the
gate first "failed": my fixture had rights evidence but no `canAnalyze` scope, and
the product did exactly the right thing.)*

**A partner grant scopes to its own session**, and a foreign session returns 404
rather than 403 — a grant holder has no business learning that other sessions
exist. The check sits in the service, not the controller, so no route can forget it.

**An aborted session removes its placeholder asset.** It never held bytes, and a
permanent `uploading` row nothing will ever finish is worse than no row.

---

## The dispatcher — finally scheduled

`reap()` has existed and been tested since Increment 1 with nothing calling it.
That meant a wedged worker held its job **indefinitely**. Deferred three times;
now done.

`VisionJobDispatcher` runs on a timer inside the API process and does two things,
both of which exist because **the thing that should report a problem is exactly
the thing that has gone away**:

| | |
|---|---|
| **Reap abandoned work** | A killed pod never reports a failure, so its job would sit `running` forever. Also enforces budgets, since a wedged worker will not notice it has outgrown its own. |
| **Expire stale upload sessions** | An abandoned multipart upload is billed by the store indefinitely and appears in no listing. Nothing else surfaces it. |

Details that matter: it runs once per heartbeat interval (checking faster finds
nothing new, since a job is only reaped after several missed beats); it will not
run two passes concurrently, which would double-reap; one job failing does not
stop the other or the timer; and the timer is `unref`'d so it cannot hold the
process open during shutdown.

**Single-instance assumption, recorded rather than guessed at.** With more than one
API replica every replica would reap. Harmless today — the operations are
idempotent and transactional — but wasteful, and a leader lock is the right answer
before scaling out.

Live on the running API:

```
GET /vision/jobs/dispatcher
{"dispatcherRunning":true,"stats":{"ticks":54,...,"errors":0},
 "oldestQueuedAgeSeconds":null,"staleHeartbeats":0}
```

---

## Verification

```
api tests           299 passed  (was 258)
worker tests         21 passed
contract tests       22 passed
selfcheck         27/27
r2check           11/11   live R2
jobcheck          23/23   live Postgres + R2
e2echeck          37/37   real container + live R2
uploadcheck       21/21   live R2, with a real interruption
typecheck         clean, 6 projects
```

The DI guard also grew a refinement: it now distinguishes an unresolved dependency
from legitimately-empty state, via a short explicit allow-list. `VisionJobDispatcher.timer`
is null until the timer starts, which it does not while Vision is disabled — and an
unexplained entry in that list would hide the very bug the file exists to catch, so
each one says why.

---

## Not in this increment

| Deferred | Note |
|---|---|
| Partner-facing upload routes | `VisionPartnerUploadGrant` and the service-level scoping exist and are tested; the tokenised `/vision/partner-uploads/*` controller does not. Needed before a club secretary can actually hand over a file. |
| Source catalog + rights screens | `/admin/vision/sources`. The upload path now works but has no UI. |
| Second hosted compute provider | To prove the abstraction holds. |
| `media.py` unit tests | Exercised end to end, still not in isolation. |
| Leader lock on the dispatcher | Only needed when the API scales past one replica. |
