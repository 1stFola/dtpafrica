# 68 — QA fix 18: an audit row for every provision and every retire

[67](./67-QA-FIX-17-PROVISION-KEY.md) gave the worker on the box its own key and left
one thing undone: starting a worker and ending one wrote nothing to the audit log, for
any caller. Both now do.

---

## What is written

| Action | When | `data` |
|---|---|---|
| `worker.provisioned` | a token has been minted and the provider's launch has returned | `providerId`, `providerRef`, `resourceClass`, `image`, `bootstrapExpiresAt` |
| `worker.retired` | the worker's token has been rotated and the row marked retired | `providerId`, `resourceClass`, `alreadyRetired` |

Both rows have `targetKind: "vision_worker"` and the worker's id as `targetId`.

**The actor** is whoever came through the door:

| Caller | `actorMethod` | `actorId`, `actorEmail` |
|---|---|---|
| A signed-in admin | `jwt` | theirs |
| The operator key | `api_key` | none |
| The provision key | `provision_key` | none |

`provision_key` is a new value for `actorMethod`. The column is free text, so there is no
migration. The audit service's actor type is widened to admit it; an admin's auth context
still fits as it is.

**The bootstrap token is never written.** The row says a token was minted and when it
expires; only the caller ever saw it.

## What is not written

- A refused request: a wrong key, the provision key acting for another provider, a
  resource class the provider does not offer, a worker that does not exist.
- A provision whose launch failed. No worker runs, and the row would claim one does.

A retire of a worker already retired **is** written, with `alreadyRetired: true`. It
rotates the token again, so it is something that happened.

## How many rows

On the box the worker idles for a day before it exits and a fresh one is provisioned, so
an idle server writes about two rows a day. A hosted worker is one provision and one
retire per pod.

## The gates

Eight gates and the end-to-end gate provision a worker, so each would have left audit
rows behind.

- **`removeGateWorkers`** in `gate-harness.ts` removes a gate's workers and their audit
  rows together. The eight gates use it in place of their own delete.
- **The end-to-end gate** used to remove every unretired `local` worker in the database
  when it finished. It now removes the three it provisioned and nobody else's.
- **`db:purge:gate-litter`** removes the audit rows of the workers it removes, and
  reports any audit row whose worker no longer exists. Nothing but a gate deletes a
  worker, so such a row is a gate's.

## Tests and checks

| Check | Result |
|---|---|
| API suite | 1,541 passed (was 1,539); typecheck clean |
| Mutation runner | 14 of 14 killed: no row, the wrong actor either way, the token in the row, a row before the launch, the wrong target, a retire recorded as a provision, `alreadyRetired` stuck either way, a refused retire on the trail |
| `vision:trackcheck` | 71 of 71, twice. Four new checks against a running API and the real database: the box's worker has one provision and one retire under `provision_key`; the gate's worker has one provision under `api_key` and nothing from the refused retire; the row names the provider and class; the token is not in it |
| The seven other gates that provision a worker | all pass |
| `vision:e2echeck`, image rebuilt | 38 of 38 |
| After all of them | no worker rows and no worker audit rows left in the database; the litter check reports nothing |
| The litter purge | an orphaned worker audit row, planted by hand, is reported on a dry run and removed with `--apply` |

The other twelve gates were not rerun: they provision no worker and none of their code
changed. CI runs all twenty-two.

## What is not done

| Item | Why |
|---|---|
| **A screen for the trail** | Done since, in [69](./69-AUDIT-TRAIL-SCREEN.md). As listed: the rows are in `vision_audit_logs`; nothing in the admin app lists them, for this or any other action. |
| **A row when a worker registers** | Registering exchanges the bootstrap token for a worker token. It is the worker's act, not a person's, and is on the worker row (`tokenKind`, `firstSeenAt`). |
| **Workers that expire unretired** | A hosted pod that dies without retiring leaves a provision row and no retire row. That is accurate, and the worker row's `lastSeenAt` says when it went quiet. |

## After merge

Nothing to do. No migration, no new configuration. The first deploy after this writes a
`worker.provisioned` row when the box's worker starts.
