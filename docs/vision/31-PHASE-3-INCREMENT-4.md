# 31 — Phase 3 Increment 4: two people, seven checks, one rollback

> A second person approves. The requester holds `vision.models.train`; the
> approver holds `vision.models.promote`. They may not be the same account.
> — [10-EVALUATION-AND-GATES](./10-EVALUATION-AND-GATES.md), Promotion gate

The registry has had `stage` since Phase 0 and `vision.models.promote` since the
RBAC was seeded, and nothing has ever moved a version except a hand on a database
row. This increment is the hand's replacement: a request, a decision by somebody
else, and a rollback that undoes exactly what the decision did.

---

## The person at both ends

The gate's eighth condition is the one that gives the other seven their meaning:
the person who approves is not the person who asked. So promotion needs a signed-in
person at both ends, and **the shared operator API key can do neither**. It has no
user id. A request and an approval made with it are indistinguishable, and a
two-person control that cannot tell two people apart is not a control.

This is stricter than annotation review, which records an unattributed verdict
rather than refusing it ([23](./23-PHASE-2-INCREMENT-2.md)). The difference is
what is at stake: a review decides one window; a promotion decides what the
product runs. The gate creates two real admin users with the seeded
`vision_ml_engineer` and `vision_admin` roles, signs in as each, and checks that
the key is refused, the trainer cannot approve, and an approver who also holds
`train` cannot approve their own request.

## The seven checks

Run at request time, stored on the request as they were found, and **run again at
approval** — a version is promoted on today's facts, not last week's. Each is
reported by name, and all of them rather than the first.

| Check | Fails when |
|---|---|
| `benchmark` | No completed run against a frozen gold version, or the latest one failed its thresholds. An `unthresholded` run is a warning, not a failure: it is what every run is until a baseline sets the bar ([30](./30-PHASE-3-INCREMENT-3.md)). |
| `regression` | The current production model of the same task has no run on the same gold version to compare against; or the candidate falls more than the tolerance below it on `ap:all` or `recall:ball`, on `all` or on any critical slice. |
| `model_card` | No object at `models/<version>/model-card.md`. |
| `licence` | A blank licence note. |
| `lineage`, `rights`, `leakage` | For a version trained on DTP footage: the dataset is a draft, holds revoked footage, has a member that lost its training right since the freeze — every member re-checked now — or a group that spans two splits. A pretrained baseline has no lineage to check and says so. |
| `reproducible` | Any of commit, config key, image tag or the weights checksum is missing. The checksum is pinned by the first worker run ([28](./28-PHASE-3-INCREMENT-1.md)); a version no worker has run cannot be promoted. |
| `smoke` | No succeeded `detect` job has run this version on the built image. |

The regression tolerance and the metrics compared live beside the thresholds in
[`benchmark-thresholds.ts`](../../services/api/src/vision/models/benchmark-thresholds.ts):
two hundredths on mAP and ball recall, which absorbs benchmark noise without hiding
a real drop. The gate drives a version that found nothing against one that found
half, and reads back `ap:all@all 0.000 vs production 0.250`.

## Stages, and what a promotion replaces

`benchmarked → staging → production`, one request per step, nothing else
promotable. Promotion to production demotes every other production version of the
same task to `staging` and **records their ids on the request**. That record is
the whole of rollback: `POST …/rollback` moves the version to `staging`, restores
exactly what it replaced, marks the promotion rolled back, and refuses to do it
twice. There is no searching for "the previous production model" during an
incident, and a version that replaced nothing has nothing to roll back to and says
so.

Every decision is audited to the person who made it: `model.promotion.requested`,
`model.promoted`, `model.promotion.rejected`, `model.rolled_back`.

## Routes

| Method | Path | Permission |
|---|---|---|
| `POST` | `/vision/models/versions/:id/promotion-request` | `vision.models.train`, a person |
| `POST` | `/vision/models/versions/:id/promote` | `vision.models.promote`, a different person |
| `POST` | `/vision/models/promotions/:id/reject` | `vision.models.promote`, with a reason |
| `POST` | `/vision/models/versions/:id/rollback` | `vision.models.promote` |
| `GET` | `/vision/models/versions/:id/promotions`, `/vision/models/promotions/:id` | `vision.read` |

## Verification

```
api tests              1,144 passed   (was 1,106)
  promotions              36
typecheck               clean; migration diff empty both ways
vision:promotioncheck   45/45 against the real API, Postgres, R2 and the Python
                        evaluator, as two signed-in people, run twice; no litter
```

Twelve mutations, each caught: the key allowed to request; self-approval allowed;
the gate not re-run at approval; a stage change since the request ignored; a
missing model card passing; unpinned weights passing; a regression of any size
passing; critical slices not compared; rights not re-checked per member; promotion
not demoting the incumbent; rollback restoring nothing; rollback reusing a
promotion already rolled back.

## What is not done

| | |
|---|---|
| **Canary** | [10](./10-EVALUATION-AND-GATES.md#canary-and-rollback) runs `staging → production` through a canary: selected matches processed by both versions, disagreements surfaced, a reviewer signing off. The disagreement comparison needs tracking and events to be meaningful; it arrives with them. |
| **Thresholds with numbers** | Still waiting on the first baseline run on real footage. Until then every promotion carries the `benchmark` warning, visibly. |
| **The registry screen** | Promotions, like benchmarks, have an API and no page. The approver reads the request's `checks` from the API today. |
| **Promotion of trained models** | The lineage checks are built and tested, but no version trained on DTP footage exists yet to run them against for real. |
