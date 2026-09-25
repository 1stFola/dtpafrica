# 11 — Phase plan

## Dependency map

```
SPIKE S0  One match end-to-end, throwaway code, measured cost
    ║  (runs alongside Phase 0; nothing merges into services/)
    ║
PHASE 0  Foundation, rights, storage + compute abstractions
    │  gate: rights + provenance + R2 + portable compute contracts exist
    ▼
PHASE 1  Partner catalog, acquisition, deterministic ingestion
    │  gate: rights-cleared immutable copies, exact timestamps, duplicate status
    ▼
PHASE 2  Nigeria dataset factory, annotation + review
    │  gate: representative, immutable, leakage-safe gold dataset
    ▼
PHASE 3  Player / ball / official detection
    │  gate: acceptable held-out Nigerian detection and ball recall
    ▼
PHASE 4  Tracking, team, jersey, identity
    │  gate: stable tracks + reviewable identity confidence + unknown precision
    ▼
PHASE 5  Pitch calibration, game state
    │  gate: valid transforms + calibration quality gating
    ▼
PHASE 6  Possession, event engine
    │  gate: reviewed actor/timestamp/event precision; no replay duplicates
    ▼
PHASE 7  Evidence, highlights, scouting metrics
    │  gate: metrics reproducible from approved evidence; staleness propagates
    ▼
PHASE 8  VLM interpretation, semantic search
    │  gate: VLM consumes approved evidence, never creates numeric truth
    ▼
PHASE 9  Wearable fusion contract, rating integration
    │  gate: clock/player alignment + calculation versioning
    ▼
PHASE 10 Production MLOps, active learning, scale
```

Phases are sequential in **dependency**. Engineering can overlap once interfaces are stable. A
phase is not complete because code exists — its gate must demonstrably pass. Gates are in
[10-EVALUATION-AND-GATES.md](./10-EVALUATION-AND-GATES.md#phase-gates).

---

## Spike S0 — one match, end to end

**Runs in parallel with Phase 0. Timeboxed. Nothing it produces is merged into `services/`.**

The HANDOFF asks for an infrastructure proof before module work; the PROMPT asks for the skeleton
first. Both are right about different risks, so both happen — separately. See
[02-DECISIONS.md, D5](./02-DECISIONS.md#d5--phase-0-sequencing).

| Do | Deliverable |
|---|---|
| Create R2 buckets, credentials, least-privilege tokens | Working config, documented |
| Create the RunPod project and launch an A6000 pod | Reproducible launch config |
| Establish R2 ↔ worker transfer over the S3 API | Measured transfer time |
| Build `dtp-vision-engine:0.1` (Ubuntu, CUDA, PyTorch, OpenCV, FFmpeg, S3 client) | A base image that starts clean on a fresh pod |
| Push **one real Nigerian match** through: download → probe → proxy → sample → off-the-shelf detector | Artifacts in R2 |
| Benchmark A6000 vs L4 vs RTX 4090 where available | Upload/download time, GPU and VRAM utilisation, processing time, FPS, cost per match |
| Write down every surprise | A list |

**Exit:** DTP can state a measured unit-economics fact — *"a 96-minute Nigerian match takes X
minutes to process and costs $Y on GPU Z"* — and has chosen a baseline GPU on measurement rather
than assumption. That number feeds pricing, competition proposals, and investor conversations, and
it feeds [12-COST-MODEL.md](./12-COST-MODEL.md).

**The list of surprises is the second deliverable and matters as much as the number.** It is where
the real constraints surface: upload behaviour on a Nigerian link, how bad platform compression is
for ball pixels, how long FFmpeg actually takes.

---

## Phase 0 — Foundation, rights, abstractions

**Build**

- Audit the existing app, API, DB, auth, deployment, admin — done; recorded in [02-DECISIONS.md](./02-DECISIONS.md).
- Prisma models and migrations for: source partners/channels/video records, rights evidence and scopes, video assets and variants, upload sessions, jobs, job events, job costs, audit entries. (Groups 1–3 in [04-DATA-MODEL.md](./04-DATA-MODEL.md).)
- `ObjectStore` interface, `R2ObjectStore`, `InMemoryObjectStore`.
- `ComputeProvider` interface, `MockProvider`, `LocalProvider`. RunPod boundary prepared but not leaking into domain types.
- Portable worker job spec and the OCI contract; `packages/vision-contracts` with generated JSON Schema.
- `RightsPolicy` service with the four independent scopes, expiry, restrictions, and structured denial reasons.
- RBAC: `vision.*` permission slugs and five seeded roles in the existing catalogue.
- `docs/licenses/OSS_REGISTER.md` populated for everything already in play.
- Config validation, structured logging, audit events, health endpoint, CI.

**Gate** — see [10](./10-EVALUATION-AND-GATES.md#phase-gates). Critically: *the existing app still
works*, and `pnpm typecheck` plus the existing 88 API tests stay green.

---

## Phase 1 — Catalog, acquisition, ingestion

**Build**

- `/admin/vision/sources` partner catalog; metadata-only registration with CSV/JSON import.
- Rights evidence upload and the acquisition authorization workflow. Source ranking: original master > authorized export > approved platform copy.
- `VisionPartnerUploadGrant` — tokenized partner upload links.
- Direct-to-R2 resumable multipart upload: 16 MiB parts, persisted sessions, resume, retry, idempotent finalize.
- SHA-256 and perceptual fingerprint; exact and near-duplicate detection; `duplicateCluster`.
- `probe`, `fingerprint`, and `transcode` job types on a **CPU worker class** — never on EC2.
- FFprobe metadata; VFR detection and flagging.
- Normalized constant-FPS proxy, HLS preview, thumbnails; deterministic source-time ↔ proxy-time ↔ frame conversion.
- Manual camera-segment metadata (live play, replay, intro, halftime, cuts).
- Match setup wizard linking `SbCompetition`, `SbTeam`, rosters, kickoff, venue, kit and camera notes.
- **`LambdaCloudProvider`** — the second compute provider, written now to prove the abstraction.

**Gate** — the resumable-upload interruption test and the revocation test are the two that matter
most. Both are CI assertions.

---

## Phase 2 — Dataset factory

**Build**

- Annotation tasks, annotation versions, label schema versions, review decisions, dataset versions and members, active-learning items.
- **DTP-native review workstation first** — identity, events, merge/split, approve/reject, disagreement queue.
- CVAT import/export adapter, on its own host, for dense box and track drawing. Not a Phase 2 blocker.
- Sampling strategies (the full list in [09-ML-PIPELINE.md](./09-ML-PIPELINE.md#sampling-strategies)).
- Dataset member eligibility enforcement: `corpus = dtp_owned`, `canTrain`, immutable checksum, acquisition status.
- Leakage-safe split generator and the leakage checker that blocks freeze.
- Source-quality and representation dashboards.
- FiftyOne-compatible export and a QA report.
- Gold benchmark subset: two-person review, locked and versioned.

---

## Phase 3 — Detection

RF-DETR behind `DetectorAdapter`, after licence registration. Classes: player, goalkeeper,
referee, ball. Tiled high-resolution ball path with temporal aggregation. `ball_unknown` emitted
rather than fabricated. Training only from DTP dataset versions, with full lineage in the model
registry. Benchmark per class and per slice.

## Phase 4 — Tracking and identity

`TrackerAdapter`; benchmark ByteTrack against BoT-SORT on DTP footage. Track stitching preserving
uncertainty. Kit-based team assignment with goalkeepers handled separately. Jersey candidates from
tracklets. Roster-assisted, time-aware identity. Review UI for split, merge, reassign, and mark
unknown. Unknown preserved; public attribution blocked until approved.

## Phase 5 — Calibration and game state

`CalibrationAdapter`, pitch line and keypoint pipeline, homography per camera segment. Camera-cut
handling. Human calibration editor. Pitch transforms with a reprojection quality score. Game-state
chunks in Parquet. Tactical minimap. **Suppression of coordinate-derived metrics when calibration
quality fails.**

## Phase 6 — Possession and events

Ball trajectory smoothing with explicit lost state. Possessor candidates and possession segments.
Versioned taxonomy mapped to `SbMatchEvent`. Live-play versus replay detection to prevent
duplicate events. Evidence links on every candidate. Event review UI with boundary and actor
correction. **Promotion path into `SbMatchEvent`**, plus the backwards-compatible sub-minute
precision widening.

## Phase 7 — Evidence, highlights, metrics

Clip generator writing to the `clips` bucket. Player evidence timeline. Highlight review and
publish workflow. `VisionCalculationVersion` registry. Metrics shipped only where prerequisites
hold. Staleness propagation on upstream correction. Player profile integration exposing approved
evidence only. **`SbHighlight.mediaUrl` widening** so R2-hosted clips can be published.

## Phase 8 — VLM and semantic search

`VideoLanguageModelAdapter`, managed API first. Approved clips plus structured context. Strict
JSON with evidence IDs and timestamps. No numeric authority. Embeddings and semantic search over
approved evidence, rights-filtered. `promptVersion` and `modelVersionId` stored. Hallucination
evaluation set.

## Phase 9 — Wearable fusion (contract only)

No wearable hardware exists in the product yet, so this phase ships the **schema and the versioned
feature contract**, not an integration: session and player mapping, clock alignment and drift
diagnostics, fused-feature shape, rating-feature versioning, and discrepancy surfacing rather than
blind averaging. Wearable data is the preferred ground truth for physical metrics when it exists;
video estimates always carry quality flags. Integration is scheduled when hardware exists. See
[02-DECISIONS.md, R7](./02-DECISIONS.md#what-was-removed-or-deferred).

## Phase 10 — Production MLOps and scale

DVC and MLflow lineage. Model stages with approval records. Canary matches and one-operation
rollback. Active-learning queue ranking. Monitoring: queue depth, GPU seconds and cost, storage
growth, failed transcodes, quality slices, correction time, drift. RunPod provider with automatic
shutdown and budget controls. Full rights-revocation lineage propagation. Metadata DB backup and a
documented R2 durability, retention, and versioning policy. Public and scout endpoints reading
approved evidence only.

---

## First 90 days

| Window | Focus | Done when |
|---|---|---|
| Week 1 | ~~Decisions confirmed~~ **✔ done 24 Sep 2026** — plus R2 and RunPod account creation, and partner agreement PDFs collected | All blockers in [13](./13-OPEN-QUESTIONS.md) resolved; accounts exist; [14](./14-RIGHTS-EVIDENCE-REQUIREMENTS.md) backfill under way |
| Weeks 1–2 | Spike S0 ‖ Phase 0 start | Cost-per-match number measured; base image builds; schema and abstractions landing |
| Weeks 2–4 | Phase 0 complete → Phase 1 | Rights gating tested; catalog live; direct-to-R2 resumable upload working end to end |
| Weeks 3–6 | Phase 1 complete → Phase 2 | First rights-cleared immutable match copies with proxies and exact frame mapping |
| Weeks 5–8 | Phase 2 | Native review workstation usable; first annotated batches; gold subset started |
| Weeks 7–10 | Phase 2 gate → Phase 3 | Dataset v1 frozen, rights-clean, leakage-checked; RF-DETR baseline training |
| Weeks 9–12 | Phase 3 | Nigeria detection benchmark published with slices; ball recall measured honestly |
| After 90 days | Phases 4–10 | Proceed only from measured gates |

This is roughly four weeks more conservative than the PID's original sequence, for two reasons:
Phase 1 now includes the second compute provider and the tokenized partner upload path, and Phase 2
includes a native review workstation that the PID assumed CVAT would cover. Both are cheaper to
build now than to retrofit.

---

## Acquisition order

Q6 answered **catalog all competitions** — correct, and cheap, since cataloguing is metadata only.
Acquisition and annotation must still be ordered, because those cost money and analyst hours.
Recommended first-dataset order, maximizing variation before volume:

1. **Lagos Queens Cup 2026** — women's football; the corpus currently has zero female representation.
2. **Coal City Scouting Tournament 2026** — Enugu; non-Lagos geography, pitches, and camera operators.
3. **Scout to Pro International Tournament 2026** — international sides; different kits and venues.
4. **1xCup 2026** — multi-zone Lagos; volume plus zone-to-zone variation.

Then depth: Jagaban Cup, DSL League, RAK League, Ex Internationals Cup. One or two matches from each
of the first four beats ten from any single one. Rationale in
[13, Q6](./13-OPEN-QUESTIONS.md#q6--first-competitions--resolved-all-competitions).

---

## Parallelisation

Once Phase 0 interfaces are stable, these can run concurrently:

- **Backend/platform:** Phases 1 and 2 control-plane work.
- **Data/annotation:** label handbook, annotator training, and gold-set governance — these do not
  need Phase 3 and are frequently the critical path, because a corpus cannot be rushed.
- **Frontend:** the review workstation, which is on the critical path for Phases 2, 4, and 6 and
  should not be started in Phase 4.
- **ML:** detector experiments on the S0 artifacts while Phase 2 assembles the real dataset.
- **Rights backfill:** collecting partner agreement PDFs, recording signatories, and granting
  partner-level scopes. Data entry, not engineering, but **Phase 1 cannot acquire a single match
  without it**. Start immediately. See [14](./14-RIGHTS-EVIDENCE-REQUIREMENTS.md#backfilling-the-existing-partners).

### New parallel track: scout identity — from ~Phase 5

Q5 answered **yes** to external scout accounts. There is no scout identity in the platform today.
This is platform work, not Vision work, and it is on Phase 8's critical path:

| Needs building | Notes |
|---|---|
| Scout auth context | A third alongside admin and academy. Recommended: separate, modelled on `AcademyAuthGuard` / `AcademyScopeGuard`. |
| Registration and vetting | Cannot be self-service — a scout account grants access to evidence about minors. |
| Entitlement model | Depends on whether access is paid, free, or tiered — [O2](./13-OPEN-QUESTIONS.md#o2--scout-portal-product-definition--blocks-phase-8). |
| Per-row rights filtering | `canShareWithScout` checked at query time. Already designed. |
| Access audit on minors' evidence | Scout identity, player, timestamp. Non-negotiable given Q2. |

Starting this at Phase 8 would stall Phase 8. Starting it around Phase 5 means it is ready when
semantic search is.

The single largest scheduling risk in this program is treating the dataset factory as a
prerequisite step rather than a continuously running function. It is the function.
