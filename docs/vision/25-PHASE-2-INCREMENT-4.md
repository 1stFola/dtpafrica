# 25 — Phase 2 Increment 4: the gold benchmark

> A benchmark you can quietly edit is not a benchmark.
> — [10-EVALUATION-AND-GATES](./10-EVALUATION-AND-GATES.md#the-nigeria-gold-benchmark)

Every claim this programme later makes about a model is measured against the Nigeria
gold benchmark. So the benchmark's credibility *is* the product, and the two ways it
can quietly stop being credible are now refused rather than documented.

---

## Two refusals, both of silent failures

### A gold set cannot freeze without two independent reviewers

A gold member whose labels one person checked is one person's opinion. Two, and the
disagreement between them, is evidence.

`freeze` now refuses with **`GoldNotDoubleReviewed`** and names the members that are
short. Three things it deliberately does not accept as two reviewers:

- **The same person twice.** One opinion recorded twice.
- **An unattributed verdict.** `api_key` auth carries no user id, so a second
  unattributed review is indistinguishable from the first — counting it would let one
  person clear the bar alone. They are counted separately and reported, so the reason
  a member fails is visible rather than mysterious.
- **No review at all.**

### Gold is never trained on — across versions

Holding a match out of train in v1 and putting it in train in v2 destroys every
measurement ever taken against v1, and **nothing about v2 looks wrong at the time**.
That is the whole danger: the number still appears, it just measures the model's
memory instead of its ability.

`freeze` refuses with **`GoldContamination`**, naming the frozen version that holds
the footage out. Two decisions inside it:

- **Matched by asset, not by group.** Two versions may group differently, and it is
  the footage a model memorises.
- **Only a *frozen* version's gold counts.** A draft is still being arranged, and
  treating its gold as binding would block work on the very corpus someone is
  assembling.

`val` is checked alongside `train`: validation steers training, so tuning against
held-out footage is the same leak wearing a different name.

## Disagreement is measured, not assumed away

The disagreement rate between the two reviewers is computed at freeze and stored on
the version's representation report. It reports **`null`, not `0`**, when nothing is
double-reviewed — "no disagreement" and "no evidence" are different claims.

A gold set reporting zero disagreement is not automatically good news. It often means
the second reviewer rubber-stamped the first, and the number is there so that is
visible.

## Before the door, not at it

`GET /vision/datasets/:id/gold` runs the same two checks read-only, so a reviewer can
see what is missing before starting rather than discovering it when the freeze is
refused. It returns `canFreeze` along with the members that are short and any
contamination.

This matters more than it looks: a frozen version cannot be edited, so a gold set that
reaches freeze one review short can only be fixed by cutting a new version.

---

## What this increment did not need to build

`representationReport` and the `gold` split already existed from Increment 1 — the
split policy has always allocated gold first, so extending the corpus never reassigns
what is already held out. Representation already slices by competition, partner,
source-quality rank, resolution and variable frame rate.

Still missing from the composition the spec asks for: **venue, camera operator,
day/night and kit similarity.** Camera operator and kit similarity have nowhere to live
in the schema yet; day/night is derivable from kickoff time and is worth adding when
there is footage whose slices would be read.

## Verification

```
api tests            490 passed   (was 480)
  gold benchmark      10
vision:datasetcheck   69/69 against a real Postgres and R2  (was 54)
typecheck            clean
```

The gate exercises both refusals end to end: a gold-only version is built, freezing it
is refused, the same reviewer twice is shown not to count, a second reviewer clears the
bar, the disagreement is measured and recorded, and a later version that would train on
that footage is refused by name.

Three mutation tests: counting unattributed reviews as distinct reviewers, dropping the
frozen-only filter on held-out gold, and reporting `0` instead of `null` for
disagreement. Each broke the suite.

A fourth mutation covers the batched read: `goldReadiness` now fetches every gold
member's annotation versions in one query instead of one per member, because it runs
inside `freeze` and a gold set is hundreds of matches. Grouping those versions back to
the right asset is the part that can silently go wrong, so a test fails if it does.

Adding the gates also exposed something in the *existing* freeze tests: their Prisma
mock answered every read of the members table with the same rows, whatever the filter.
That was harmless while freeze read members once; with three filters it reported every
member as gold and as contaminated. The mock now honours the filters, which is also
what makes the next gate to read that table safe to add.

> **One thing the gate cannot do over HTTP.** Two *attributed* reviews need two user
> identities, and the gate authenticates with an api key that carries none. The reviews
> are therefore created through Prisma as fixtures — which is also precisely what the
> unattributed-review rule exists to refuse.

## What is not done

| | |
|---|---|
| **FiftyOne export and QA report** | The remaining Phase 2 build item. |
| **Composition slices** | Venue, camera operator, day/night, kit similarity — see above. |
| **Re-baselining on a new benchmark version** | The rule that a corrected benchmark re-baselines every model is written down but nothing enforces it, because there are no models yet. |
| **CVAT adapter** | Explicitly not a Phase 2 blocker. |
