# 02 — Decisions: reconciling the three source documents

Three documents describe the Vision Engine, all dated 24 September 2026:

| Ref | Document | Role |
|---|---|---|
| **PID** | `DTP_Africa_Vision_Engine_PID_v2_Cloudflare_R2_YouTube.docx` | Product scope, phases, risks, taxonomy |
| **HANDOFF** | `DTP_Vision_Engine_Architecture_Build_Handoff.docx` | Infrastructure freeze v1: R2 + RunPod + EC2 |
| **PROMPT** | `DTP_Vision_Engine_Master_Coding_Agent_Prompt_v2.md` | Executable implementation contract |

They agree on the important things: EC2 stays as control plane, R2 is the master object store,
GPU compute is on-demand and replaceable, YouTube is a catalog and not a data lake, rights gate
everything, and nothing public gets claimed without human review.

They contradict each other on eleven points. This document rules on each, and records what was
added and removed on top of the three. **Where this document and a source document disagree, this
document wins** — and the reason is stated so a future reader can overturn it with better
information.

---

## Contradictions and rulings

### D1 — Control-plane language

- **PID §3.1 / §4.1:** API is Python FastAPI; Phase 0 creates `services/api` (FastAPI).
- **PROMPT rule 1–2:** inspect first, reuse working components, least disruptive design.
- **Reality:** `services/api` already exists as NestJS 10 + Prisma 6, 217 files, ~250 routes, and holds the whole football graph and RBAC.

**Ruling: NestJS.** The Vision control plane is a new module inside the existing API. Python is
confined to `services/vision-worker`. The PROMPT's own reuse rule overrides the PID's stack
preference, and the PID's instruction would otherwise have the agent overwrite a working service.

*Cost of this ruling:* the Python ML ecosystem is one process boundary away from the control
plane. Mitigated by `packages/vision-contracts` and a strict worker API.

---

### D2 — Bucket layout

- **HANDOFF §3:** six buckets by content type — `dtp-raw-video`, `dtp-datasets`, `dtp-annotations`, `dtp-models`, `dtp-generated-clips`, `dtp-vision-results`.
- **PID §3.2:** one bucket, `object://dtp-vision/`, with content prefixes.

**Ruling: four buckets, split by access and retention policy, not by content type.** Bucket
boundaries should follow the things that are actually configured per bucket — credentials,
lifecycle rules, versioning, and public-read posture. Splitting `datasets` from `annotations`
gives no policy difference; splitting immutable masters from regenerable derivatives gives a
large one.

Full layout and the mapping from the HANDOFF's six buckets is in
[05-STORAGE.md](./05-STORAGE.md).

---

### D3 — Fallback GPU provider

- **HANDOFF §8–9:** RunPod primary, Lambda Cloud secondary, Vast.ai for cheap experiments.
- **PROMPT §2.3 / PID §3.1:** provider-agnostic, RunPod initial, no named fallback.

**Ruling: both, and they are not in conflict.** `ComputeProvider` is the contract; RunPod is the
default implementation; Lambda Cloud is a second implementation written in Phase 1 *specifically
to prove the abstraction holds*. Vast.ai is permitted for non-production experiments only and
never for a job whose output enters a dataset or a published fact.

Writing the second provider early is the point. An abstraction with one implementation is a
guess.

---

### D4 — YouTube acquisition

- **HANDOFF §11:** "Partner Video → Authorized ingestion / download → Cloudflare R2".
- **PROMPT §3 / PID §5.0:** a URL is catalog metadata only; do not build around scraping or downloading; acquisition is a separate rights-gated workflow.

**Ruling: the stricter reading.** The HANDOFF's flow is valid *only* as the output of the
rights-gated acquisition workflow. **V1 ships no automated downloader of any kind.** Acquisition
is one of three recorded, human-authorized methods:

| Method | Meaning |
|---|---|
| `partner_direct_upload` | Partner uploads their master through a tokenized upload link |
| `partner_authorized_export` | Rights owner supplies an export; DTP staff uploads it |
| `platform_copy_authorized` | A platform copy, only with written owner authorization recorded as rights evidence |

There is no fourth option. See [03-RIGHTS-AND-GOVERNANCE.md](./03-RIGHTS-AND-GOVERNANCE.md).

---

### D5 — Phase 0 sequencing

- **PROMPT Phase 0:** schema, abstractions, rights, RBAC. Explicitly "no video/ML code is required yet."
- **HANDOFF §13/§16:** Phase 1 is an infrastructure spike — one real Nigerian match end to end through R2 and a GPU pod, producing a measured cost per match.

These are different philosophies, not different content. The PROMPT builds the skeleton first;
the HANDOFF de-risks the pipe first.

**Ruling: run both, and keep them separate.** Phase 0 proceeds as written. Alongside it,
**Spike S0** runs one real match end to end on throwaway code. Its only permitted deliverables
are (a) the measured cost-per-match number, (b) the base Docker image, and (c) a written list of
surprises. **No S0 code is merged into `services/`.** The spike answers "does this pipe work and
what does it cost"; Phase 0 answers "what is the system". Conflating them produces demo code
wearing an architecture's clothes.

See [11-PHASE-PLAN.md](./11-PHASE-PLAN.md).

---

### D6 — The football graph already exists

- **PID §3.3 / PROMPT §6** list `competition`, `season`, `match`, `venue`, `team`, `player`, `roster_entry`, `lineup`, `substitution`, `position` as entities to create.
- **Reality:** DTP has all of these — `SbCompetition`, `SbCompetitionStage`, `SbTeam`, `SbTeamSquad`, `SbMatch`, `SbMatchSquadPlayer`, `Player` — with 13 migrations, live data, and seeded competitions.

**Ruling: create none of them.** Vision entities carry foreign keys into the existing graph.
Creating a parallel football graph would split player identity across two tables, which destroys
the one thing the platform is built on.

There is a further trap: the schema **already contains a `Match` model** (line 196,
the SIP metrics match) *and* `SbMatch`. A third `match` would be actively dangerous. All Vision
models are therefore prefixed `Vision*`. See [04-DATA-MODEL.md](./04-DATA-MODEL.md).

---

### D7 — RBAC

- **PROMPT §Phase 0:** "Implement RBAC: vision_admin, annotator, reviewer, ml_engineer, scout_readonly."
- **Reality:** DTP has `AdminRole` / `AdminPermission` / `AdminRolePermission` / `AdminUser`, a 30-slug permission catalogue, seeded role presets, `AdminAuthGuard`, and `PermissionsGuard`.

**Ruling: extend, do not implement.** The five personas become five seeded roles built from new
`vision.*` permission slugs added to the existing catalogue. No new auth system, no second login,
no second session token. Scouts are a partial exception — see D11.

---

### D8 — Separate admin app

- **PID §4.1:** Phase 0 creates `apps/admin` (TypeScript web UI).
- **Reality:** a full admin exists at `apps/web/src/modules/admin` with ~50 pages, `AdminAuthContext`, `AdminRequirePermission`, `AdminLayout`, `AdminTableShell`, `AdminPageHeader`, toasts, and search pickers.

**Ruling: no new app.** Vision admin screens live under `apps/web/src/modules/admin/vision/` and
mount inside the existing `AdminApp`, reusing its auth, layout, and permission gates. One
exception mirrors the existing `MatchConsoleApp` pattern: the **review workstation** renders
outside `AdminLayout`, because a frame-accurate video workstation needs the full viewport.

---

### D9 — CVAT

- **PID §3.1:** "CVAT + DTP review wrapper — avoid building low-level box/track annotation from scratch."
- **Reality:** CVAT self-hosted is a multi-container stack needing several GB of RAM. It cannot run on the `t3.small`, and standing it up is not a two-day task.

**Ruling: split the annotation problem in two.**

| Work | Tool | Why |
|---|---|---|
| Dense box and track drawing | CVAT, on its own host, behind an import/export adapter | Genuinely tedious to build; CVAT is good at it |
| Identity assignment, event marking, track merge/split, approve/reject | **DTP-native review workstation** | CVAT has no concept of a roster, a substitution window, or a football event. This is the screen DTP needs anyway |

Phase 2 is **not blocked on CVAT**. The native review workstation ships first; the CVAT adapter
follows. The DTP schema stays canonical in both cases.

---

### D10 — Highlights and events collide with existing models

Neither source document noticed this. Two concrete schema conflicts:

- **`SbHighlight.youtubeUrl` is a required `String`.** Vision produces R2-hosted clips. A Vision clip cannot be written to the existing highlight table as it stands.
- **`SbMatchEvent.minute` is an `Int`.** Vision produces millisecond-precision timestamps with confidence and evidence links. Truncating to a whole minute throws away exactly the precision that makes the evidence worth having.

**Ruling:** Vision writes to its own `VisionEventCandidate` and `VisionHighlight` tables. On
reviewer approval, a **promotion step** writes into `SbMatchEvent` / `SbHighlight` so ScoreBoard
and the public site keep working unchanged. Phase 6/7 widens the ScoreBoard models
(`SbMatchEvent.secondInMinute` or a millisecond column; `SbHighlight.mediaUrl` + `provider`
alongside the existing `youtubeUrl`) in a backwards-compatible migration. The Vision row remains
the evidence of record; the ScoreBoard row is the published projection.

**Confirmed 24 Sep 2026:** [Q7](./13-OPEN-QUESTIONS.md#q7--scoreboard-and-vision-events--resolved-option-b-vision-enriches)
selected option **(b)** — the recorder's pitch-side event stays canonical and Vision *enriches* it.
The promotion step is therefore an **enrichment** step: it attaches Vision evidence to a matching
existing `SbMatchEvent`, and creates a new one only where the recorder logged nothing and a reviewer
approves. Re-confirmed by DTP leadership; no ambiguity remains.

---

### D11 — Scout access

- **PID §2.3:** `scout_readonly` is listed among the admin personas.
- **Reality:** DTP's `AdminUser` is staff. Scouts and clubs are not admin users; there is an `Academy` portal with its own auth (`AcademyAuthGuard`, `AcademyScopeGuard`) but no scout identity at all.

**Ruling: defer scout-facing surfaces to Phase 8, and treat scout identity as a separate
problem.** In Phases 0–7, `vision_scout_readonly` is a staff role used by DTP's own analysts.

**Updated 24 Sep 2026:** [Q5](./13-OPEN-QUESTIONS.md#q5--external-scout-accounts--resolved-yes)
answered **yes — external scouts get accounts.** That is new platform scope: a third auth context
alongside admin and academy, with vetting, per-row rights filtering, and an access audit on every
view of a minor's evidence. It is **platform work on Phase 8's critical path**, and should be built
in parallel from roughly Phase 5 rather than discovered at Phase 8. Product definition is
[O2](./13-OPEN-QUESTIONS.md#o2--scout-portal-product-definition--blocks-phase-8).

---

## What was added

Things none of the three documents cover, which will break the build if left undecided.

| # | Addition | Why it matters |
|---|---|---|
| A1 | **Transcode runs on a worker, not EC2** | FFmpeg on a 90-minute match would pin both vCPUs for hours and starve the live site. Neither document says where transcode runs. |
| A2 | **Worker never holds R2 credentials or a DB connection** | Workers ask the control plane for a presigned PUT per output key; the control plane validates the key is under that job's allowed prefix. No standing credentials on ephemeral third-party hardware. |
| A3 | **Worker API authentication spec** | Both documents say "callback endpoint" and stop. Job-scoped worker tokens, short TTL, HMAC on completion, idempotency keys. See [06](./06-JOBS-AND-COMPUTE.md). |
| A4 | **Tokenized partner upload grants** | Grassroots partners do not have DTP admin accounts. Without this there is no way for a partner to hand over a master file. `VisionPartnerUploadGrant` gives a scoped, expiring, auditable upload link. |
| A5 | **Minors as a mechanism, not a risk row** | DTP is a *youth* platform. `Player.dateOfBirth` already exists. Minor status drives footage access control, retention, and publication defaults from Phase 0, not Phase 10. |
| A6 | **NDPA 2023 / data-subject rights** | No source document mentions Nigerian data protection law. The `deletion_request` entity exists; the obligations behind it do not. Flagged for counsel — see [03](./03-RIGHTS-AND-GOVERNANCE.md) and [13](./13-OPEN-QUESTIONS.md). Not legal advice. |
| A7 | **Artifact granularity rule** | Per-frame objects in R2 produce millions of tiny objects: slow, and Class A/B operations cost more than the storage. Inference artifacts are **few large Parquet files**, never one object per frame. |
| A8 | **Cost-per-match is computed, not just logged** | The HANDOFF asks DTP to be able to say "X minutes, $Y per match". That needs a defined formula and a roll-up table, not scattered log lines. See [12](./12-COST-MODEL.md). |
| A9 | **Research-corpus firewall** | SoccerNet must be impossible to train on, not merely discouraged. `VisionVideoAsset.corpus` is an enum; `dataset_member` insertion hard-fails unless `corpus = dtp_owned` and `canTrain = true`. |
| A10 | **Concrete resumable-upload parameters** | "Resumable multipart" is not a spec. 16 MiB parts, per-part retry with backoff, 7-day session TTL, persisted `VisionUploadSession`, and an explicit kill-the-connection resume test in CI. |
| A11 | **Promotion of Vision output into ScoreBoard** | See D10. Without it, approved Vision events are invisible to the product. |
| A12 | **Statement timeouts and read paths for Vision queries** | Vision tables will dwarf the football graph. Shared Postgres on 2 GB needs explicit protection. |

---

## What was removed or deferred

| # | Removed / deferred | Reason |
|---|---|---|
| R1 | Parallel football entities (`match`, `team`, `player`, `competition`, `season`, `venue`, `roster_entry`, `lineup`, `position`) | Already exist. See D6. |
| R2 | FastAPI control plane | See D1. |
| R3 | Separate `apps/admin` | See D8. |
| R4 | Redis + Celery in V1 | See [01, Queue](./01-ARCHITECTURE.md#queue-postgres-not-redis). Interface kept so it is a swap. |
| R5 | Self-hosted CVAT as a Phase 2 blocker | See D9. |
| R6 | Any automated third-party video downloader | See D4. |
| R7 | **Phase 9 wearable integration** | No wearable device exists in the product. Phase 9 ships the schema and the versioned feature contract only. Integration is scheduled when hardware exists. |
| R8 | Self-hosted VLM | Managed API first. Self-hosting is a cost decision to make with real usage numbers, not before. |
| R9 | `assistant_referee` detection class in Phase 3 | Adds annotation cost for a class with almost no downstream use. Revisit if offside work ever starts. |
| R10 | Named GPU prices from the HANDOFF benchmark table | Prices move. The table is preserved in [12-COST-MODEL.md](./12-COST-MODEL.md) as *indicative, re-verify before procurement* — never as a planning input. |
| R11 | MinIO | AGPLv3. Not embedded without a licensing decision. R2 is the managed S3-compatible store. |
| R12 | Real-time / live analysis | Confirmed non-goal for V1. Restating it because it is the most likely thing to get requested mid-build. |

---

## Standing disagreements worth revisiting

Honest notes on rulings that could reasonably go the other way later:

- **D1 (NestJS).** If the ML side grows to need tight control-plane coupling — online inference, a feature store, model serving in-process — a Python service alongside NestJS becomes defensible. The trigger would be measured friction at the contract boundary, not preference.
- **D2 (four buckets).** If R2 ever gains per-prefix credential scoping, collapsing to one bucket becomes attractive. Object keys are designed so that migration is a bucket rename, not a re-key.
- **Queue.** The Postgres queue is a scale bet. It is wrong above a few concurrent workers, and the `JobQueue` interface exists precisely so losing that bet is cheap.
