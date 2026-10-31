# FairPlay — phase plan, backlog and blockers

Phases follow PID §15. Efforts are ranges in focused engineer-days and assume the
equipment audit comes back with at least one recordable feed; they are estimates, not
commitments. P2 (any automatic classification) is out of V1 entirely.

---

## Phase 0 — discovery (this folder)

**Output**: [inventory](./inventory.md), [architecture](./architecture.md),
[equipment audit](./equipment-audit.md), [integration map](./integration-map.md),
[ADRs](./adr/), this plan. Documents only: no code, schema, cloud or DNS change.

**Gate — Fola decides:** (gates 2–8 decided on 28 Oct 2026: see [decisions.md](./decisions.md); gate 1 waits for the equipment audit)

1. The ingest topology, from the answered [equipment audit](./equipment-audit.md) (T1–T4),
   and therefore single- or multi-angle for the pilot.
2. The permission model and roles ([integration-map §3](./integration-map.md#3-permissions-and-roles)),
   including whether organisers get admin accounts.
3. Edge stack: Python FastAPI + SQLite ([ADR-0003](./adr/0003-edge-stack.md)).
4. Local TLS by internal CA on DTP-owned devices ([ADR-0004](./adr/0004-local-console-and-tls.md)).
5. A separate private R2 bucket for evidence, created later in Phase 3
   ([ADR-0006](./adr/0006-evidence-storage.md)).
6. Match deletion: `SetNull` + snapshot, not `Restrict`.
7. Who holds footage rights for the pilot fixtures, and whether the competition agreement
   covers recording for dispute review (see blockers).
8. FairPlay as its own `/admin/fairplay` area, linked from the ScoreBoard match center and
   kept out of the recorder console ([ADR-0010](./adr/0010-admin-placement.md)).

## Status

| Phase | State | Report |
|---|---|---|
| 0 — discovery | documents delivered; gate decisions open | [README](./README.md) |
| 1 — Edge media foundation | **partial: done on synthetic feeds, hardware acceptance pending** (items 1–5 below; item 6 synthetic only) | [phase-1-edge-foundation.md](./phase-1-edge-foundation.md) |
| 2 — replay console and synchronisation | **partial: accepted on the synthetic 30-minute fixture with the WAN cut; DEV bundles until Phase 3; hardware pending** (items 7–10; 11 is Phase 3) | [phase-2-replay-console.md](./phase-2-replay-console.md) |
| 3 — incidents and evidence | **partial: Edge side built (items 10–12) and tested on synthetic feeds with the WAN cut; found lost video at segment switches on audio+video feeds (fixed in the feed, #307)** | [phase-3-incidents-and-evidence.md](./phase-3-incidents-and-evidence.md) |
| 4 — cloud (items 13–16) | **partial: built and tested end to end against the real API, Postgres and an S3 server on synthetic data (merged, #310); the R2 bucket, the production migration and deploy await approval** | [phase-4-cloud.md](./phase-4-cloud.md) |
| 5 — resilience and defence in depth (Prompt 6) | **complete on synthetic data, awaiting Fola's sign-off of [residual-risks.md](./residual-risks.md): 5.1 review done (3 high, 8 medium, 9 low findings); 5.5 part 1 fixes the highs (F1, F3; F2's software half); part 2 the recommended mediums (F4, F5, F6, F8); 5.2 the failure drills (34/34 on synthetic feeds); 5.3 storage and upload failures (found and fixed F21 high, F22 low, F23 medium; 21/21); 5.4 security tests (Edge 13 tests over every route, cloud 53/53 over HTTP; found and fixed F24 low); 5.6 time-sync warnings (F11 fixed: the kernel's sync state, confirmed large offsets, measured uncalibrated uncertainty); 5.7 the request and erasure tool (D11, B15 built); 5.8 the runbook and residual risks (found and fixed F25 medium); 5.5 part 3 fixed F7, F9, F19 before the pilot (R2, R3, R6)** | [phase-5-threat-review.md](./phase-5-threat-review.md) |
| 6 — controlled pilot packaging (Prompt 7) | **in progress: 6.1 installer and configuration (install, controlled update with rollback, start at boot and a watchdog, the port plan, a checked variable reference; found and fixed F26 medium); 6.2 backup and restore (the Edge on a clean stack, the cloud's tables into a scratch database, withdrawn clips stay withdrawn)** | [edge-install.md](./edge-install.md), [edge-configuration.md](./edge-configuration.md), [edge-backup.md](./edge-backup.md) |
| 7 — independent acceptance review (Prompt 8) | not started | — |

## Prompts 6–8, in increments

The remaining prompts are taken one increment at a time: one PR each, each closed with
the prompt pack's phase handover template (section K), and nothing starts until Fola says
go. An increment that would need hardware, real footage, a deploy or a paid service stops
at that point and says so; on synthetic data it reports *pending*, never passed.

**Phase 5 — resilience (Prompt 6).** Much of the scenario list was already exercised on
synthetic feeds in Phases 1–4; 5.1 says which, so later increments only add what is missing.

| # | Increment | What it adds | Needs |
|---|---|---|---|
| 5.1 | Threat and failure review | every Prompt 6 scenario and security requirement against the PID and the merged code: covered (with the test that shows it), partly covered, or open; findings graded critical/high/medium/low. A document, no code | — |
| 5.2 | Failure drill harness | one fixture running the Edge-side drills in sequence with a drill log and measured recovery time and recovery point: WAN off 30 min, drone drop and reconnect, MediaMTX restarted mid-match (no file overwritten), Edge API killed (SQLite recovery, outbox resumes), console refreshed or asleep while recording continues, whole stack killed as a power cut | synthetic feeds |
| 5.3 | Storage and upload failures | disk soft and hard limits on a small volume, with the console's warning checked in the browser; an evidence upload cut halfway and resumed without a second evidence record (fault injected into the S3 mock) | — |
| 5.4 | Security tests | automated: bad pairing token, unauthorised user, guessed replay and evidence URLs, cross-match access, a member's role removed mid-match (today the venue keeps access until the 36 h bundle expires), device token rotation; no secret in logs, health output or the web bundle; every export audited | — |
| 5.5 | Fixes | the high and critical findings from 5.1–5.4, one PR per finding or a small group | depends on findings |
| 5.6 | Time-sync warnings | no hardware time sync, or a gross drone offset: a conspicuous warning instead of implied precision | — |
| 5.7 | Request and erasure tool (D11, B15) | the audited player/parent request tool, required before the first real match | — |
| 5.8 | Runbook and sign-off | monitoring and alert runbook, recovery time and recovery point table, residual-risk list for Fola to sign | 5.1–5.7 |

**Phase 6 — pilot packaging (Prompt 7).** Documentation and scripts; nothing is deployed.

| # | Increment | What it adds | Needs |
|---|---|---|---|
| 6.1 | Installer and configuration | pinned Compose and images, port plan, volumes, health checks, watchdog, controlled update; a complete variable reference checked against `config.py` and `.env.example` | — |
| 6.2 | Backup and restore | Edge database and manifests restored on a clean machine; cloud FairPlay tables restored into a scratch database | — |
| 6.3 | Operator procedures | pairing, rehearsal, kick-off and half-time marks, incidents, evidence, end of match, report, sync and archive; 90/60/30/15-minute checks; recovery SOP for network, camera, power and storage; training pages | — |
| 6.4 | Hardware validation checklist | what to measure on the matchday kit and how | writing it: none; running it: hardware |
| 6.5 | Licences | dependency inventory, notices, FFmpeg build review | Fola's B9/B10 rulings |
| 6.6 | Cost and rights | per-match storage and cost worksheet from measured bitrates; rights, consent, release and retention checklist | real bitrates need hardware; synthetic until then |
| 6.7 | Demo and go/no-go | synthetic demo dataset and the 8-minute walk-through, draft organiser demo report, release notes, pilot go/no-go checklist | — |

**Phase 7 — acceptance review (Prompt 8).** Run by a reviewer that did not build it (a fresh
session or the multi-agent cloud review), so the verdict is not the builder's own. Real
CPU, RAM and disk measurements need the matchday machine; without it those rows are
NOT TESTED. Production stays off until Fola signs the release.

**Outside the code, at any point:** the R2 bucket, the signing key and the production
deploy (Phase 4); the equipment audit (gate 1); footage rights and consent (D8); disk
encryption and a named custodian on the Edge machine (D12).

## P0 backlog, in order

| # | Item | PID | Phase | Effort | Depends on |
|---|---|---|---|---|---|
| 1 | Edge skeleton: `services/fairplay-edge`, Compose, pinned MediaMTX with the hardened config, `.env.example`, health endpoint, pytest in CI | FP-02 | 1 | 2–4 d | gate 3 |
| 2 | Synthetic feed generator: two clock-burned test streams with a known offset, a dropout and a marked "incident" (ffmpeg `testsrc` + drawtext) | FP-02 | 1 | 1–2 d | 1 |
| 3 | Segment manifest: hook + start-up sweep, SHA-256, ffprobe, partial-file flag | FP-08 | 1 | 2–3 d | 1 |
| 4 | Source health and watchdog: disconnect, recorder stopped, disk low/hard water marks, MediaMTX down | FP-14 (P0 part) | 1 | 2–3 d | 1 |
| 5 | Retention job that never deletes protected or unsynced segments | — | 1 | 1–2 d | 3 |
| 6 | **Phase 1 gate**: two-feed (or one-feed) recording test, disconnect one source, restart Edge, checksums verified — synthetic first, real kit when available | FP-02, FP-03 | 1 | 1–2 d | 1–5, hardware |
| 7 | Local auth: Edge CA + Uvicorn TLS, signed bundle verification (with a dev signing key), PIN login, session cookie | FP-11 | 2 | 3–5 d | gate 4 |
| 8 | Time model: periods, calibrations, offsets, uncertainty, failure states | FP-05 | 2 | 3–5 d | 3 |
| 9 | Local console: shadow banner, health, live preview, replay player via the Edge proxy, jump −10/−30/−60, 0.5×/1×, source selector, incident list | FP-03, FP-04 | 2 | 6–10 d | 7, 8 |
| 10 | Incidents and reviews: state machine, versions, four outcomes, reopen-as-audited | FP-06, FP-07 | 2 | 3–5 d | 9 |
| 11 | Clip jobs: stream-copy window, re-encode only on request, derivative hash + lineage | FP-08 | 2 | 2–4 d | 3, 10 |
| 12 | Edge audit hash chain and outbox with backoff | FP-09, FP-10 | 3 | 3–4 d | 10 |
| 13 | Cloud: migration, `fairplay` module, device pairing, credential bundle, sync batch, receipts | FP-01, FP-10 | 3 | 5–8 d | gate 2 |
| 14 | Cloud: evidence presign/confirm/read-url on a separate bucket, audit | FP-11 | 3 | 2–4 d | 13, bucket approval |
| 15 | Web admin: `/admin/fairplay` area, per-match page, devices, members, report view, match-center link | FP-01, FP-15 | 3 | 4–6 d | 13, gate 8 |
| 16 | **Phase 3 gate**: 30-minute WAN-off drill, 10× duplicate sync, wrong-device token refused, authorisation matrix | FP-09–11 | 3 | 2–3 d | 12–15 |
| 17 | Runbooks, matchday checklists, operator guide; three shadow matches | — | 4 | 5–10 d + matchdays | all, rights |

**Total P0**: roughly 47–80 engineer-days before the field pilot, wide because the
hardware and the Edge machine are unknown.

P1 after the pilot: side-by-side angles with alignment (FP-12), frame diagnostics (FP-13),
extended monitoring (FP-14), organiser report polish (FP-15), PDF.

## Prerequisites for Phase 1

Phase 1 starts when every **Required** row is ticked. **Required for hardware acceptance**
rows may stay open: Phase 1 then runs on synthetic feeds and its report marks hardware
acceptance *pending*, never passed.

| # | Prerequisite | Required | Evidence that it is met |
|---|---|---|---|
| P1 | Gate decision 3 (Edge stack) approved | Required | Fola's approval recorded in ADR-0003's status line |
| P2 | Gate decision 1 provisionally set: single-angle unless the audit proves ISO feeds | Required | ADR-0008 status line |
| P3 | A development machine for the Edge: Linux or Windows, Python 3.12, ffmpeg + ffprobe on `PATH`, Docker (Linux) or the MediaMTX native binary (Windows), ≥ 50 GB free | Required | `python --version`, `ffmpeg -version`, `ffprobe -version` and `mediamtx --version` (or the Compose image tag) pasted in the Phase 1 report |
| P4 | MediaMTX version chosen and pinned (release archive SHA-256 recorded), its release notes read against the settings in [architecture §3](./architecture.md#3-components) | Required | the pin and checksum in the Phase 1 PR; an OSS register row |
| P5 | OSS register rows added for MediaMTX, FastAPI/Starlette/Uvicorn/Pydantic, `cryptography` | Required | `docs/licenses/OSS_REGISTER.md` in the Phase 1 PR |
| P6 | Agreement that Phase 1 uses **synthetic footage only** (generated test patterns with burned-in clocks), no real match footage | Required | stated in the Phase 1 brief |
| P7 | Full-disk encryption on the machine that will be the matchday Edge | Required for hardware acceptance | screenshot of BitLocker / LUKS status |
| P8 | Equipment audit Gate rows E1–E8, E10, E14 answered with evidence | Required for hardware acceptance | the filled [equipment audit](./equipment-audit.md) |
| P9 | A measured 5-minute sustained write test on the matchday SSD | Required for hardware acceptance | command output in the Phase 1 report |
| P10 | Rights confirmed for any real fixture recorded in the bench test | Required before any real footage | B2 in [blockers](./blockers.md) closed |

What Phase 1 does **not** need: any cloud change, any schema migration, any R2 bucket, any
change to the existing API or web app.

## Blockers and escalations

Kept in one place: [blockers.md](./blockers.md), with the assumption register.

## Rollback

- **Phase 0**: delete `docs/fairplay/`. Nothing else changed.
- **Edge (Phases 1–2)**: separate service on a separate machine; stop it and the
  broadcast is unaffected by construction. Recordings stay on disk.
- **Cloud (Phase 3)**: the migration is additive. Rollback = deploy the previous image
  (CD already does this on a failed health check); the new tables stay, unused, and are
  dropped only by a later, approved migration. Turning FairPlay off is removing the role
  grants; no existing route depends on it.
