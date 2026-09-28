# 26 — Phase 2 Increment 5: the export, and the report that vouches for it

> FiftyOne-compatible export and a QA report.
> — [11-PHASE-PLAN](./11-PHASE-PLAN.md), Phase 2 build list

The export is the door footage leaves through. Every refusal upstream of it — the
eligibility firewall, the leakage checker, the gold benchmark — only matters if the
thing that finally walks out is the thing that was checked. So this increment is
mostly about what the export **will not** write.

---

## What comes out

`POST /vision/datasets/:id/export` writes three files beside the version's manifest,
in FiftyOne's own on-disk layout:

| | |
|---|---|
| `metadata.json` | `media_type: "video"`, the version's lineage, and two notes a first-time loader needs |
| `samples.json` | one sample per member: `filepath`, `tags`, `metadata`, `annotations`, `provenance` |
| `qa-report.json` | beside the data, so the export describes its own fitness without a database |

A split travels as a FiftyOne **tag**, which is how `dataset.match_tags("train")`
reads it. Labels are `TemporalDetections` — the right FiftyOne type for a labelled
time window, and what the corpus actually contains today.

## The two clocks, and the conversion between them

A label is stored in **source** time, because that is what it means: milliseconds
into the original match file. A sample points at the **proxy**, because the proxy is
what a machine can decode deterministically. So every window is shifted by the
proxy's `sourceOffsetMs` and converted to proxy frames.

Getting this wrong produces an export whose labels are internally consistent and a
few seconds out. Nothing looks wrong, review does not catch it, and the model trains
on it. Two off-by-ones live in that conversion:

- **A window is `[start, end)` in milliseconds; `support` is inclusive.** The last
  frame is the one holding the window's *final millisecond*, not the one beginning at
  `end`, which belongs to whatever comes next.
- **FiftyOne numbers video frames from 1**, while frame indices here start at 0.

At 25fps, `[0, 1000)` is frames **1–25**. Taking the frame at 1000ms gives 26 and
quietly lengthens every label in the corpus. The live gate checks this against
arithmetic worked out by hand in its own comments, because a conversion tested only
against itself proves nothing.

Each detection keeps `source_start_ms` and `source_end_ms` alongside its frames. The
frames address the file; the milliseconds are the meaning.

## Seven refusals

Each one produces a dataset that **loads, trains and benchmarks** and is wrong in a
way nothing downstream can see. That is why they are refusals and not warnings: a
dataset that fails to load gets fixed, one that loads and lies gets trained on.

| Refusal | Why |
|---|---|
| `DatasetNotFrozen` | A draft's membership still changes. An export from one cannot be reproduced, and any benchmark against it means nothing later. |
| `DatasetContainsRevokedMembers` | Revocation already blocks training runs. The export is how that footage would *reach* one, so the door is closed here too. |
| `GoldContamination` | Re-checked at export, because a version frozen before [Increment 4](./25-PHASE-2-INCREMENT-4.md) existed was never asked. |
| `missing_proxy` | The proxy is confirmed against the store, not trusted from the row. An export naming a file that is not there loads as a silently *smaller* dataset. |
| `proxy_without_fps` | A guessed frame rate produces labels that look precise and are wrong. |
| `payload_checksum_mismatch` / `payload_missing` | Whatever is in storage is not what the annotator submitted, so its window cannot be trusted either. |
| `label_before_proxy_start` / `label_past_proxy_end` / `empty_window` | A label addressing frames the proxy does not have. |
| `window_drifted_from_payload` | The payload records the window it was drawn against. If the task was re-cut afterwards, the labels describe different footage than they claim. |

Two deliberate design points inside these:

**Nothing is written unless the report passes.** A failed export is therefore its own
dry run — which is why there is no separate preview endpoint here, unlike
`GET :id/gold`. Attempting it costs a read and changes nothing.

**No override.** There is no query parameter to skip the QA check. An override at the
last door would make every gate before it optional, and the moment someone would
reach for it is exactly the moment it should not exist.

## Labels nobody signed off are left out, and counted

Only `approved` and `corrected` export. `corrected` is included deliberately — the
correction *is* the signal. `rejected` and unreviewed are excluded, and the report
distinguishes them: a reviewer saying no is a normal outcome, while nobody having
said anything means the work is unfinished rather than done.

A member left with nothing to export is reported but **not** fatal. Unlabelled
footage is legitimately useful for active learning; it just is not training data, and
the point is that it is counted rather than silently contributing nothing.

## What the QA report answers

Not "did it write?" but "is this corpus fit to train on?":

- samples and labels per split; total labelled minutes
- **the hard-case mix** — the share of labels that did not come from the control
  group. [media.ts](../../packages/vision-contracts/src/media.ts) says "what fraction
  of our labels came from hard cases?" must be answerable rather than a matter of
  opinion; this is where it gets answered. Reported as `null`, not `0`, when there are
  no labels at all.
- every label schema version present, so a corpus mixing two handbooks is visible
- the review mix, the annotator's own `uncertain` flag, and how much was pre-labelled
  — whether pre-labelling saves anyone time is measurable only if the corpus records
  which labels started from a model

## Verification

```
api tests              526 passed   (was 490)
  fiftyone export       36
vision-contracts        24 passed   (was 22)
vision:datasetcheck     99/99 against a real Postgres and R2  (was 69)
vision:annotationcheck  53/53      vision:catalogcheck  32/32
typecheck               clean
```

Nine mutations, each breaking the suite: 0-based frames instead of FiftyOne's 1-based;
the inclusive end taken at `end` rather than its final millisecond; `round` instead of
`floor`; the proxy offset not applied; the storage-presence check dropped; the
rejected-label filter dropped; the review-vocabulary filter dropped; and the grouping
of annotation versions back to their asset.

The gate exercises the whole path against a real Postgres and real R2: a draft is
refused, a proxy row without its object is refused, an unreviewed label exports as an
empty sample, a review makes it export, the frames come back as 26–50 for a label at
source 10–11s on a proxy offset by 9s, the stored labels are then tampered with and
the export is refused by name, and finally revoking the partner's right closes the
export as well.

### One bug this increment fixed in the last one

Writing the gate's cleanup exposed that **Increment 4's gold sections had been
littering the live database on every run** — twelve empty dataset versions and seven
label schema versions, because `cleanup` deleted versions whose label started with
`gate-` and the gold sections name theirs `gold benchmark <run>`. Cleanup is now
scoped to the run rather than to a prefix, deletes the objects it wrote to R2, and
deletes its own review rows, which are `SetNull` rather than cascade. Verified: two
consecutive runs leave the leftover count unchanged.

The rows from earlier runs are cleared by
[`purge-vision-gate-litter`](../../services/api/scripts/purge-vision-gate-litter.ts),
which is a dry run unless given `--apply`:

```bash
pnpm --filter @dtp/api db:purge:gate-litter
pnpm --filter @dtp/api db:purge:gate-litter -- --apply
```

That form is for a local database. The rows this clears are on the live one, and
there the host has no `node_modules` to run it with — it goes through the API
container instead. See *Run a maintenance script* in
[`infra/DEPLOYMENT.md`](../../infra/DEPLOYMENT.md).

Its patterns live in a tested module of their own, because they are the only thing
between the script and real data: a name qualifies only if it is *anchored* and ends
in a gate's eight-hex run id, so `gold benchmark for Lagos 2027` survives while
`gold benchmark 7c199849` does not. A dataset version with any member, or a schema
version something still points at, is reported and skipped rather than judged.

## What is not done

| | |
|---|---|
| **Boxes and tracks** | Today's payload is a window-level record — source window, position, uncertainty, notes. There are no object detections to export yet; those arrive with Phase 3 and, for dense drawing, CVAT. The export writes what exists rather than a shape nothing fills. |
| **Frame arithmetic in one place** | The workstation applies the same floor-don't-round rule in [annotation-time.ts](../../apps/web/src/modules/admin/vision/annotation-time.ts). They are separate because `apps/web` does not depend on the API's packages, and adding that dependency for one function was not worth a lockfile change. Both are tested against the rule rather than against each other — but this is a seam, and it is written down so it does not drift silently. |
| **Composition slices** | Venue, camera operator, day/night and kit similarity, still outstanding from [Increment 4](./25-PHASE-2-INCREMENT-4.md). |
| **Streaming large exports** | `samples.json` is built in memory and written as one object. Fine at Phase 2 scale; `visionKeys.datasetLabels` already reserves a sharded JSONL layout for when it is not. |
| **CVAT adapter** | Explicitly not a Phase 2 blocker. |
