# 22 — Phase 2 Increment 1: the dataset factory

Annotation tooling is worthless if the dataset it produces cannot be trusted, so
the enforcement came first. This increment is **two refusals**, both now proven
against live Postgres, the live API and live R2:

1. Footage DTP has no right to train on **cannot enter a corpus**.
2. A dataset whose benchmark shares a match with its training set **cannot be
   frozen**.

Neither is a convention or a code review habit. Both are `409`s.

---

## The eligibility firewall

Four conditions, **all** of them, checked at insertion and again at freeze:

| Condition | Why it is not optional |
|---|---|
| `corpus = dtp_owned` | Research-only footage is catalogued for study, not training. This is the corpus firewall. |
| `canTrain` allowed **now** | A `dtp_owned` asset is not automatically trainable — a guardian can withdraw consent for footage DTP does own. Conflating the two would make the rights module decorative. |
| A real SHA-256 | A placeholder is what an in-flight upload leaves behind. Without it a dataset cannot prove which bytes it was built from. |
| `acquisitionStatus = acquired` | An authorised-but-never-fetched record has no bytes, and an asset with **no** source record has no acquisition to point at at all. |

**Partial success is deliberate.** An operator adding 200 assets gets the 198 that
qualify plus a list of the two that did not, with the remediation attached — not an
all-or-nothing failure with no explanation. The refusals are written to the audit
log in full, because "this footage was offered to a corpus and declined, and why" is
the record a partner or regulator actually asks for.

---

## Splits are assigned by group, never by member

Frames from the same match leak appearance into validation and make metrics look
strong while the model has learned nothing generalisable. So the unit of assignment
is the **group**, and a whole group lands in one split.

Grouping is broadest-first: **duplicate cluster → match → competition**, falling
back to the asset's own id.

- A cluster beats a match because *the same fixture re-uploaded at a different
  quality is two assets and one piece of football*. If the cluster lost, those two
  copies could land on opposite sides of a benchmark.
- An ungrouped asset becomes **its own group**, not a member of a shared `null`
  group — which would force every ungrouped asset into one split and starve the
  others.

### Deterministic, not shuffled

The split is `sha256(seed : groupKey) % total`. A random shuffle would make a
dataset version unreproducible, which defeats the point of versioning it: two
machines building "v1" would disagree about what v1 is. `gold` is carved from the
bottom of the hash space, so re-tuning train/val/test **does not reassign the
permanent holdout** — asserted directly.

---

## Three holes found while building it

### 1. A freeze straight after `addMembers` looked fully validated

New members default to `train`. So a version frozen without ever generating splits
was **100% train — one split, so the leakage check passed trivially**, and the
result was a corpus with no test set that looked clean.

Closed without a schema change: freeze compares the stored leakage report's member
count against the live one, so it refuses both "splits never generated" and the
quieter "members added after splits were generated". Two more `409`s
(`SplitsNotGenerated`).

### 2. Revoking a training right never reached the datasets that used it

`markRevoked` was written, tested — and **called by nothing**. Meanwhile
`revokeScope` flipped the grant to revoked and left every frozen dataset unflagged,
so a later training run would happily use footage whose consent was gone. That is
exactly the failure `containsRevokedMembers` exists to prevent.

`revokeScope` now resolves the scope to its assets and flags every version holding
one, returning `affectedDatasetVersions` so the operator sees the blast radius.

**A frozen dataset is flagged, never edited.** Deleting rows to look clean would
leave DTP unable to answer which datasets were affected.

> **A player-level withdrawal still cannot be resolved automatically.** Mapping a
> player to assets needs the identity graph, which arrives in Phase 4. Until then
> the response carries an explicit warning rather than reporting success with an
> empty list — an empty list would be a lie in the shape of a success.

### 3. The DI guard asked the next person to remember

`vision-di.spec.ts` carried a hand-maintained list under a comment saying *"If you
add a provider or controller, add it here."* "Coverage is complete" and "someone
remembered" are not the same claim.

Two tests now derive the expectation from `VisionModule`'s own metadata, so a
provider or controller added and not listed **fails the file** rather than being
silently skipped. Both were verified by deliberately removing the new entries and
confirming the failures fire — a guard that has never been seen to fail is not
known to work.

---

## Also fixed in passing

**The gate scripts were never typechecked.** `tsconfig.build.json` included
`src/**` and a list of seeds, but not `scripts/`. All six Vision gate scripts — the
evidence for every increment gate so far — were unchecked, and a duplicate `const`
in this increment's script got as far as *running* before esbuild complained. They
are in the typecheck now, which surfaced four pre-existing errors in
`vision-job-loop-check.ts` (TypeScript cannot trace an assignment made inside a
transaction callback, so the variable narrowed to `never` in the `finally`).

---

## Endpoints

| | |
|---|---|
| `POST /vision/datasets` | Create a version. Invalid split policy → **400** |
| `POST /vision/datasets/:id/members` | Add assets. Partial success with per-asset refusals |
| `POST /vision/datasets/:id/splits` | Assign whole groups, then re-check leakage |
| `GET /vision/datasets/:id/leakage` | Read-only, so the position is visible before a freeze is attempted |
| `GET /vision/datasets/:id/representation` | Distribution by split, competition, partner, source quality, resolution |
| `POST /vision/datasets/:id/freeze` | Every gate re-run, then immutable |

Reads need `vision.read`; every mutation needs `vision.datasets.manage`.

**There is no route that edits a frozen version, and none that forces a freeze past
a failed leakage check.** An operator under deadline pressure cannot reach for an
override that was never built.

---

## The manifest

Freeze writes `derived/datasets/{versionId}/manifest.json`: the policy, the leakage
verdict, the representation report, and every member with its checksum, split and
group key. It is what makes a version reproducible **from object storage without
reading the database** — the answer to "what was this model trained on".

`derived` rather than `master`, because the manifest is a projection of the members
table and regenerable from it. The `datasets/` prefix is exempt from lifecycle
expiry — see [05-STORAGE](./05-STORAGE.md).

---

## Schema

Five new models — `VisionLabelSchemaVersion`, `VisionAnnotationTask`,
`VisionAnnotationVersion`, `VisionReviewDecision`, `VisionActiveLearningItem` — plus
`leakageReport`, `representationReport` and `labelSchemaVersionId` on
`VisionDatasetVersion`, and `groupKey` / `sbMatchId` on `VisionDatasetMember`.

`groupKey` is **denormalised on purpose**: the leakage checker can group without
loading every asset, and a frozen manifest still records *how* the grouping was
decided even if the asset is later re-clustered.

Migration `20260925180000_vision_dataset_factory`: 24 statements, **zero `ALTER`s on
non-Vision tables**.

Only the dataset models are exercised by code in this increment. The annotation
models are schema-only until Increment 2.

---

## Verification

```
api tests            415 passed   (was 355)
  split policy        19
  dataset factory     36
typecheck            clean, 6 projects — now including the gate scripts
vision:datasetcheck  54/54 against live Postgres, live API, live R2
strays after run     0
```

The gate creates its leak **by writing splits straight into the database behind the
service's back**, because a checker that only ever sees states its own generator
produced has not been tested. It then confirms that regenerating splits — the
documented remedy — actually repairs it.

## What is not done

| | |
|---|---|
| **Annotation tooling** | Increment 2. The five models exist; nothing writes them. |
| **Player-level revocation** | Needs the identity graph (Phase 4). Flagged explicitly, not silently. |
| **`gold` enforcement at training time** | Nothing yet *reads* a dataset to train. The split is recorded and held out; the prohibition on tuning against it is not yet machine-enforced. |
| **Label schema content** | `definitions` is `Json` and no taxonomy has been authored. That is a football decision, not a code one. |
