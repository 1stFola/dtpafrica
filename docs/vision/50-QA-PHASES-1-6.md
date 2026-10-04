# 50 — QA of Phases 1–6: what to fix

**Date:** 3 October 2026, after PR #209 merged. **Status:** findings only. Nothing in this
document has been fixed. It is the work list for a new session.

The audit was read-only and split six ways. Each area's full list, with file and line for
every finding, is in [`qa/`](./qa/):

| Appendix | Area | Critical | High | Medium | Low |
|---|---|---|---|---|---|
| [A](./qa/A-api-phases-1-2.md) | API control plane, Phases 1–2: jobs, worker API, upload, sources, rights, annotation, datasets | 2 | 9 | 13 | 7 |
| [B](./qa/B-api-phases-3-6.md) | API control plane, Phases 3–6: models, identity, calibration, clock, events | 1 | 7 | 14 | 9 |
| [C](./qa/C-worker.md) | Python worker | 0 | 6 | 13 | 9 |
| [D](./qa/D-web.md) | Web Vision UI | 2 | 6 | 16 | 6 |
| [E](./qa/E-infra-contracts-gates.md) | Infra, CI/CD, contracts, gates, migrations, OSS register | 2 | 7 | 11 | 9 |
| [F](./qa/F-backlog-not-built.md) | Docs backlog: still open, and promised but never built | — | — | — | — |

Some findings appear in more than one appendix, such as the segment-kind mismatch and the
admin key in the worker's environment. Fix each once.

**Test state at audit time:** API vision suite 737 passed; web 188 passed; worker pytest 252
passed; `vision:eventcheck` 64/64. Every suite is green. Most of what follows is in code the
tests never exercise: races, real footage, the deploy path, wide screens.

**Which findings are verified.** Items marked **VERIFIED** were re-read in the code by the
compiling session and are confirmed. Every other item comes from one auditor, with a file and
line. Read the cited code before changing it. That is the standing rule anyway.

---

## 1. Critical

| # | Finding | Where | Consequence |
|---|---|---|---|
| C1 | **VERIFIED.** Promotion reads the match clock differently from the recorder. The recorder logs `floor(elapsed/60)+1`, capped at the match's own `halfLength`, with added time in `metadata.addedMinute`. Vision uses `floor`, a fixed 45-minute second-half base, and lets added time run on (47). Matching compares `minute` alone. | B · `events.service.ts:221-227`, `clock/match-clock.ts:57-61` vs `apps/web/.../useMatchClock.ts:103-107`, `admin-match-stats.service.ts:1384-1390` | A 45+2 goal never matches and is re-created as 47'. First-half added time collides with the second half. Second-half minutes are wrong for youth matches with short halves. `secondInMinute` is rarely written, because the minutes are usually one apart. |
| C2 | **VERIFIED.** The worker's `proxy` input role points at a fixed key (`visionKeys.proxy(asset.id)`), but transcode writes the proxy under the job's own output prefix. | A · `worker/worker.controller.ts:246-249` vs `stages/transcode.py:40` | Detect, cuts and identify are handed a URL to an object that does not exist. Nothing has shown it yet, because no real pipeline has run past transcode. |
| C3 | Bootstrap and worker tokens share one column and one lookup. | A · `worker/worker-token.service.ts:86-120` | An unredeemed bootstrap token, which sits in provider env or cloud-init, can claim jobs and presign master reads. A worker token passed to `register` mints a fresh one, so the TTL can be extended without limit. |
| C4 | **VERIFIED.** The API image runs `prisma db push --accept-data-loss` on every start, including the automatic rollback. | E · `infra/api.Dockerfile:49`, `services/api/package.json:25`, `cd.yml:530-566` | Rolling back past a schema change drops the newer tables and columns, with their data. |
| C5 | **VERIFIED.** `ADMIN_API_KEY` comes from Secrets Manager and is never masked, then is written into the `run:` text of the Ansible deploy and rollback steps. | E · `cd.yml:362, 487, 554` | The full admin key may be readable in the Actions logs. `VISION_R2_ACCESS_KEY_ID` is exposed the same way. |
| C6 | The annotation workstation scales drawn boxes against the whole stage, ignoring the video's letterbox. | D · `AdminVisionTaskPage.tsx:214`, `admin-vision.css:359,460` | Gold boxes drawn on a wide window have the wrong x and width. The benchmark scores models against them. |
| C7 | **VERIFIED.** Approve and Reject on the Models page show only for stage `promotion_requested`, which does not exist. Reject also reads `p.promotions`, but the API returns `requests`. | D · `AdminVisionModelsPage.tsx:238,250` | A model promotion can never be approved or rejected from the UI. |

**What to do first.** C5 needs Fola, not only code. After masking the key, check past runs of
the CD workflow for it. If it appears, **rotate `ADMIN_API_KEY`** in `dtp/staging/app` and
redeploy. C4 changes how every future migration reaches live, so agree the new path with Fola
before changing it (see §3, PR-2). C6 may mean existing gold boxes need checking. Gold exists
only on dev today, so check before any gold version is frozen on live.

---

## 2. High, by theme

Details and fixes are in the appendices. Letters name the appendix.

**Rights, security and governance**
- Annotation's `annotatorId` comes from the request body. Anyone can submit as another person and then review their own work, which defeats the gold two-reviewer gate (A).
- `canAnalyze` is checked only at enqueue. Claim, retry and annotation media keep working after a revocation (A).
- `hasBlockingRestriction` ignores every restriction without a `deny` key, including the docstring's own example `{noIdentifiableMinors:true}` (A).
- A partner grant's `maxBytes` is never enforced on the bytes actually stored. One link can open many billed uploads (A).
- The evidence gate counts evidence rows whose upload never happened (A).
- Promotion's rights check omits `playerId`, so a player-level withdrawal does not stop a minor being named (B).
- The deploy prints R2 keys in plain text when it dumps the env file (E).
- The box checks out the branch tip, not the deployed SHA (E).
- Every ffmpeg subprocess inherits the full admin key, while decoding untrusted media (C, E).

**Data integrity and races**
- Job queue transitions (`fail`, `markRunning`, `heartbeat`, `succeed`) are read-then-update. The reaper and stale workers can overwrite a job that has moved on, so stage results can be applied twice (A).
- An automatic requeue reuses attempt 1's output prefix (A).
- Nothing ever sets `acquisitionStatus` to `acquired`. Every real upload is refused for datasets, so only seed data can build one (A).
- Two concurrent event corrections leave two current rows (B).
- Promotion can double-write. A second candidate enriching the same recorder event hits a unique constraint and returns a 500 (B).
- Re-approving the recorder's sheet deletes enriched rows. The candidate then looks unpromoted and can be promoted again (B).
- Promotion's create path adds a goal without updating the score or player stats (B).

**Pipeline correctness**
- The Hungarian assignment is wrong when a pair is forbidden: 96 of 3,000 fuzzed matrices came out wrong. It feeds the tracker and MOTA (C).
- Game state's `segment_at` is inclusive at a segment's end, so the first frame after a cut uses the previous camera's homography. The API's segment lookups have the same boundary issue (C, B).
- IDF1 merges tracks across assets, because local track ids repeat (C).
- The promotion smoke check counts only `detect` jobs, so track and identify models can never pass the gate (B).
- The calibration DTO and the web page use segment kinds outside the contract. `intro` and `halftime` cannot be declared, and scene-detect's `unknown` is refused (B, E, D).

**Worker and deploy robustness**
- When claim fails (expired token, contract mismatch, network), the worker never counts toward idle shutdown. A GPU pod would run forever (C).
- An unguarded `fail()` in an `except` block can crash the worker (C).
- Track and game state hold a whole match in Python dicts, several GB on an 8 GB class (C).
- The worker has no SIGTERM handling. Every deploy SIGKILLs it, losing the job and leaving worker rows stale (E).
- No container has memory or CPU limits. The worker's 2 GB tmpfs is RAM on a 2 GB box shared with Postgres (E).
- The deploy health check ignores a crash-looping worker (E).

**Workstation UI**
- The playback loop never attaches if media loads before the review data, so `proxyMs` freezes during playback (D).
- Positions load one request per track for up to 2,000 tracks, and every action restarts that loop (D).
- `U`, the `1`–`9` digits, and `A` `R` `M` `S` `?` are missing on the identity workstation (D, F). `U` is one of doc 08's non-negotiable behaviours, and docs 48 and 08 wrongly say the digits exist.
- `E` fires on Ctrl+E and on key repeat, creating duplicate candidates (D).
- "Request promotion" is never offered for staging→production (D).
- **VERIFIED.** The overview's annotation count uses states that do not exist, so it is always 0 (D).

**Gates and licensing**
- The event gate writes up to six goals into an arbitrary real `SbMatch`. No gate checks `DATABASE_URL` in code, and Ctrl-C skips cleanup (E).
- FFmpeg ships on the live box while the OSS register says "REVIEW REQUIRED — do not ship" (C, E). This is a decision for Fola, or for legal.

---

## 3. Suggested fix plan

One PR per batch, in this order. Each follows the usual loop: tests, gate twice, litter check,
a mutation runner where a rule changes, a doc report, and asking before every push. Start from
a fresh branch off `origin/main`, because `feat/vision-review-queue` was merged as PR #209.

| PR | Batch | Contents | Needs Fola |
|---|---|---|---|
| PR-1 | **Secrets** | Mask every fetched secret in `cd.yml`; pass secrets to Ansible by env or vars file (C5); stop the env-file dump printing R2 keys; separate bootstrap and worker tokens (C3); drop the admin key from the worker's environment after provisioning, and pass a minimal `env=` to subprocesses. | Rotate `ADMIN_API_KEY` if it appears in past logs. |
| PR-2 | **Deploy safety** | Remove `db:push` from the API image CMD and run `prisma migrate deploy` as an explicit forward-only step (C4); check out `DEPLOY_SHA`; worker `init: true`, SIGTERM handling and a grace period; memory and CPU limits; a disk-backed work dir and an ffmpeg thread cap; a worker-aware health check; normalise `VISION_ENABLED`; stop the worker when Vision is turned off. | Agree the migration path. Live is fully baselined (31/31), so `migrate deploy` will work from here. |
| PR-3 | **Job protocol** | Conditional queue transitions; a requeue prefix per attempt; map queue errors to 409/403; the proxy role resolved from the latest proxy variant (C2); strip reserved params; check the artifact bucket and the identify `trackJobId`. Worker side: claim failures count toward idle and a 401 re-registers; retry `fail` and `complete`; a heartbeat 4xx cancels; redact presigned URLs from errors; adopt the server's intervals. | — |
| PR-4 | **Rights and governance** | Set `acquisitionStatus` across the upload lifecycle; deny unrecognised restrictions; enforce grant bytes and single use; count only uploaded evidence; take `annotatorId` from the session; re-check `canAnalyze` at claim, retry and annotation media; audit `media.raw.read`; pass `playerId` in promotion's rights check. | — |
| PR-5 | **Events and the clock** | Promotion on the recorder's convention: `halfLength`, ordinal minute, added time, matching on half and minute and added minute (C1). Revisit `secondToWrite` and the gate's minute expectations. Make promotion single-write; refuse a stale promoted candidate; re-apply enrichment after a recorder rebuild; send `create` through ScoreBoard's score and stats lifecycle, or block it; conditional correct and decide; snapshot the anchors on acceptance; handle a half with no end. | The convention and the `create` behaviour change what reaches the public match record. |
| PR-6 | **Pipeline maths** | Hungarian with finite forbidden costs, plus a fuzz test; half-open segments in the worker and the API; IDF1 keyed by asset; the cuts score off-by-one; the coverage denominator; homography sign and off-pitch suppression; tracker ageing by time, ending at cuts; streaming track and game state; transcode `-map` with `-sn -dn`. | — |
| PR-7 | **Models and benchmarks** | A smoke check per task; thresholds keyed by task; atomic approval with one pending request per version; rollback that demotes others; the UI promotion buttons (C7, staging). | — |
| PR-8 | **Contract parity** | Segment kinds and calibration quality from the contract; `apps/web` depends on `@dtp/vision-contracts`, with duplicate constants removed (EVENT_TYPES, stages, the fingerprint prerequisite, job states); a contract-version compatibility rule; decide the "Zod schema for every Json column" rule. | The contract-versioning and Json-schema rules. |
| PR-9 | **Workstation UI** | Letterbox mapping on the annotation workstation (C6); the playback loop attaching; batched positions with a latest-track-job filter; the keyboard map, with `U` first; guards on `E` and modifiers; resetting state by `selectedId`, including `note`; refreshing the playback URL; frame-snapping stored times; no colour-only state; keyboard-operable boxes and landmarks; Events page actions from `allowedActions`. | Whether existing gold boxes need re-checking. |
| PR-10 | **Performance and indexes** | Queue filters and limits in SQL with batched anchors; the composite and foreign-key indexes listed in B and E, in one migration checked against the shadow DB; batched rights in dataset add, freeze and the promotion gate; `forAsset` pagination; latest jobs only on the asset list. | — |
| PR-11 | **Gates and CI** | `assertDevDatabase()` in every gate; SIGINT cleanup; a gate-owned `SbMatch`; purge coverage for gate users, events, models and workers; a CI job that runs the DB-only gates; compose validated with `--profile vision`; a smoke test of the bootstrap entrypoint. | — |
| PR-12 | **Docs** | 07's route drift (A and F list the real paths); the digit-key claim in docs 48 and 08; doc 44 saying the queue is unbuilt; DEPLOYMENT.md's migration count and steps; the CORS status in docs 42, 43 and 45 (it is set); stale code comments. | — |

**Also for Fola, not code:** separate R2 buckets and tokens per environment (E); the upload CLI
over HTTPS rather than the raw IP (E); the FFmpeg licence status (C, E); and the root EBS
volume, still 20 GiB though planned at 100 "before Phase 3" (F).

---

## 4. Corrections to the audit itself

- **The R2 CORS rule is set.** Docs 42, 43 and 45, and appendix F, still call it open. It was set for `http://54.225.155.75` and `http://localhost:5173` and verified on 2 October 2026.
- The relative `VISION_WORKER_CALLBACK_URL` in appendix A affects only hosted providers. The box's compose file sets an absolute URL.
- The two migrations with future-dated timestamps in appendix E are already applied on live. **Do not rename them.** Use real timestamps from now on.

## 5. What is not done or never built

Appendix F has the full list: every "What is not done" item from docs 15–49 still open, split
into blocked-on-external and buildable-now, and every route or screen the plan or contract
promised for Phases 1–6 that no report shows built. Examples include the ingestion wizard,
operations-dashboard panels, the quality dashboard, overlay toggles, `GET
/vision/review/:assetId/timeline` and `GET /vision/assets/:id`. Treat that list as product
backlog, not defects.

---

## 4. Where the plan ended

All twelve batches were built between 3 and 4 October 2026, one pull request each.

| PR | Batch | Pull request | Report |
|---|---|---|---|
| PR-1 | Secrets | #210 | [51](./51-QA-FIX-1-SECRETS.md) |
| PR-2 | Deploy safety | #211, hotfix #213 | [52](./52-QA-FIX-2-DEPLOY-SAFETY.md) |
| PR-3 | Job protocol | #212 | [53](./53-QA-FIX-3-JOB-PROTOCOL.md) |
| PR-4 | Rights | #214 | [54](./54-QA-FIX-4-RIGHTS.md) |
| PR-5 | Events and the clock | #215 | [55](./55-QA-FIX-5-EVENTS-CLOCK.md) |
| PR-6 | Pipeline maths | #216 | [56](./56-QA-FIX-6-PIPELINE-MATHS.md) |
| PR-7 | Models and benchmarks | #217 | [57](./57-QA-FIX-7-MODELS.md) |
| PR-8 | Contract parity | #218 | [58](./58-QA-FIX-8-CONTRACT-PARITY.md) |
| PR-9 | Workstation UI | #219 | [59](./59-QA-FIX-9-WORKSTATION.md) |
| PR-10 | Performance and indexes | #220 | [60](./60-QA-FIX-10-PERFORMANCE.md) |
| PR-11 | Gates and CI | #221 | [61](./61-QA-FIX-11-GATES-CI.md) |
| PR-12 | Docs | this one | [62](./62-QA-FIX-12-DOCS.md) |

Each report ends with what it did not do. Those lists, not this document, are what is
still open; [62](./62-QA-FIX-12-DOCS.md) gathers them in one place. The findings above are
left as they were found, so the reports can be read against them.
