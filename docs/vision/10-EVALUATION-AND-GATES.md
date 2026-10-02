# 10 — Evaluation and promotion gates

## The core rule

**Do not hard-code a "good" metric today.** Run a baseline on representative Nigerian matches,
then set promotion thresholds per task from what that baseline shows. What matters is a permanent
held-out benchmark and a no-regression policy — not an arbitrary universal mAP target copied from
a paper trained on European broadcast footage.

Thresholds live in configuration and are versioned. Changing a threshold is a reviewed change with
a stated reason, not an edit during a release.

---

## The Nigeria gold benchmark

One locked, versioned, two-person-reviewed dataset that is **never trained on**.

| Property | Rule |
|---|---|
| Composition | Deliberately spans competition, venue, camera operator, day/night, resolution, kit similarity, and source-quality rank |
| Review | Two independent reviewers; disagreement measured and recorded |
| Mutability | Immutable once frozen. Adding to it creates a new version. |
| Tuning | **Editing the benchmark to make a model pass is prohibited.** If the benchmark is wrong, fix it openly as a new version and re-baseline every model against it. |

A benchmark you can quietly edit is not a benchmark.

---

## Metrics by subsystem

| Subsystem | Primary metrics | Slices that must be reported separately |
|---|---|---|
| Detection | mAP, per-class precision/recall, **ball recall** | wide shot, crowded box, night, compression, motion blur, occlusion, platform copy vs original master |
| Tracking | HOTA / IDF1 / MOTA, ID switches, fragmentation | camera pan and zoom, substitutions, similar kits, re-entry after occlusion |
| Identity | player and team accuracy, **unknown precision**, jersey top-k | duplicate jersey visible, back turned, goalkeeper kit, post-substitution |
| Calibration | reprojection error, valid-frame coverage | partial pitch, zoom, camera cut, non-standard pitch dimensions |
| Possession | segment accuracy, possessor precision/recall | 50/50 balls, aerial, tackles, ball invisible |
| Events | per-event precision/recall/F1, temporal tolerance, actor attribution accuracy | rare events, overlapping actions, camera cut, replay |
| Highlights | review acceptance rate, timestamp quality, relevance | clip length, rights state |
| VLM | structured-output validity, grounded-timestamp rate, hallucination rate | ambiguous clips, low quality, injection attempts |
| Wearable fusion | sync error, matched-session coverage, discrepancy rate | clock drift, missing samples, wrong device mapping |
| **Product** | **time to review a match, annotation minutes per hour of footage, cost per hour of footage** | queue failures, rework rate |

### Two metrics that are easy to skip and shouldn't be

**Unknown precision.** When the system says "I don't know", how often is that correct? A model
that achieves high identity accuracy by guessing confidently is worse than one that abstains
honestly — but only the unknown-precision metric makes that visible. Optimising accuracy alone
actively rewards the wrong behaviour.

**Correction time.** A model that is 5% better on mAP but doubles the time a reviewer spends
fixing its output is a worse model *for DTP*. The product row in the table above is not secondary;
it is the row that decides whether the corpus can actually be built at the pace the business
needs.

---

## Slice reporting

Every benchmark run writes `VisionMetricResult` rows per `(metric, slice)`. The dashboard never
shows a headline number without its slice breakdown, because that is exactly how a regression on
night footage hides behind an improved average.

Slices come from `qualityFlags` on the prediction envelope and from asset metadata captured at
ingestion. This is why the ingestion wizard asks about camera, lighting, and surface: those
answers become the axes the model is judged on. Capturing them later is guesswork.

Critical slices are marked in configuration. A regression on a critical slice blocks promotion
regardless of the headline.

---

## Promotion gate

A model version may not reach `staging` unless **all** of the following hold:

1. A benchmark run exists against the current locked gold dataset.
2. No critical slice regresses beyond the configured tolerance against the current production model.
3. Model card and licence metadata are complete — code, weights, and dataset licences recorded separately in [the OSS register](../licenses/OSS_REGISTER.md).
4. Dataset lineage is rights-clean: every member re-checked at promotion time, not just at freeze time.
5. Duplicate and leakage checks pass on the training dataset version.
6. Inference smoke tests pass on the built image.
7. The model is reproducible from git commit + dataset manifest + config + image tag.
8. **A second person approves.** The requester holds `vision.models.train`; the approver holds `vision.models.promote`. They may not be the same account.

Reviewer identity and the decision are persisted. Promotion is an auditable act.

### Canary and rollback

`staging` → `production` runs through a canary: a selected set of matches processed with the new
version while the current production model remains authoritative. Outputs are compared, disagreements
are surfaced in the failure gallery, and a reviewer signs off.

**Rollback is one operation.** `POST /vision/models/versions/:id/rollback` restores the previous
production version. It is tested as part of the Phase 10 gate, not discovered during an incident.

---

## Failure analysis

After each benchmark, cluster errors by condition rather than by magnitude: night and floodlight,
blur, compression, platform copy, crowded box, camera pan or zoom, occlusion, kit similarity,
overlays and replays, source quality.

Rank failure modes by **football and business impact**, not by frequency. A rare failure that
misattributes a goal matters more than a common failure on a throw-in.

Then recommend exactly one response per mode:

- more data in that slice;
- an annotation definition fix;
- a threshold change;
- a model change;
- a product guardrail (suppress the output in that condition);
- a source-quality policy change (stop accepting that source tier).

**Never tune by silently editing the locked benchmark.** If the benchmark is wrong, say so, fix it
as a new version, and re-baseline everything.

---

## Phase gates

Each phase has a gate that must **demonstrably** pass before the next begins. Code existing is not
a gate. The full list is in [11-PHASE-PLAN.md](./11-PHASE-PLAN.md); the evaluation-relevant ones:

| Phase | Gate |
|---|---|
| 0 | Existing app still works. R2 adapter integration test passes. No endpoint proxies large objects through EC2. Rights gating is covered by tests. A job spec targets the mock provider with no provider-specific fields in domain APIs. Migrations build from zero. |
| 1 | A catalog-only URL cannot be used for training (test). A rights-approved file uploads direct to R2 and **resumes after an interrupted connection** (test). Checksums and provenance persisted. Duplicate detection groups re-uploads. Frame seek agrees within one frame on the constant-FPS proxy. Revocation blocks future analysis immediately (test). |
| 2 | Dataset v1 is immutable, reproducible, rights-clean. No member has an external URL as its only source. Leakage checker proves no duplicate cluster or match crosses splits. Label handbook and schema version exist. Gold-set inter-reviewer disagreement is measured. |
| 3 | Held-out Nigeria benchmark meets configured thresholds. No critical source-quality slice collapses unexplained. Every prediction carries model version, source frame/time, and confidence. |
| 4 | Tracking quality and ID-switch metrics published on the locked benchmark. Identity accuracy **and unknown precision** measured. Public attribution blocked until approved. *As built: tracking in [33](./33-PHASE-4-INCREMENT-2.md); team accuracy and unknown precision in [37](./37-PHASE-4-INCREMENT-6.md), player accuracy awaiting a licensed jersey model; attribution in [35](./35-PHASE-4-INCREMENT-4.md).* |
| 5 | Valid-frame coverage and reprojection thresholds met. Camera cuts segment calibration correctly. Invalid calibration cannot silently produce speed or distance (test). *As built so far: reprojection error and provisional thresholds, manual segments, and the suppression test, in [38](./38-PHASE-5-INCREMENT-1.md); cuts proposed from the proxy and filed beside a person's, in [39](./39-PHASE-5-INCREMENT-2.md).* |
| 6 | Per-event precision/recall/F1 and actor attribution measured on the locked benchmark. Replays and intros do not create duplicate promoted events (test). |
| 7 | Every public metric and highlight traceable to approved evidence and a calculation version. Rejecting an upstream event marks dependents stale (test). |
| 8 | Search returns evidence IDs and timestamps. Hallucination eval set exists. Unsupported claims cannot become published facts automatically (test). |
| 9 | Alignment quality measured. Every fused feature reproducible from exact video, wearable, and calculation versions. |
| 10 | A model is reproducible from commit + manifest + config + environment. Rollback works. Monthly quality and cost report includes cost per analyzed match. Revoked assets are excluded from future training automatically (test). |

Several gates are written as "(test)" deliberately: they are assertions in CI, not statements in a
report. A gate that depends on someone remembering to check it will eventually be skipped under
delivery pressure.

---

## Monthly quality and cost report

One artifact, produced monthly, that the business can act on:

- benchmark metrics by subsystem and slice, with the trend against the previous three months;
- correction time per hour of footage;
- corpus growth: matches acquired, hours annotated, representation shifts;
- **cost per analyzed match**, with the largest cost drivers named;
- rights state: scopes expiring, revocations processed, deletion requests outstanding;
- incidents: wrong identities caught before publication, and any that were not.

The last line is the one that matters most and is the easiest to leave out.
