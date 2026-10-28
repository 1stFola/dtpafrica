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
| 3 — incidents and evidence | **partial: Edge side built (items 10–12) and tested on synthetic feeds with the WAN cut; cloud side (13–15) not built; found lost video at segment switches on audio+video feeds** | [phase-3-incidents-and-evidence.md](./phase-3-incidents-and-evidence.md) |

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
