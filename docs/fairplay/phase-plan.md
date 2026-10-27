# FairPlay — phase plan, backlog and blockers

Phases follow PID §15. Efforts are ranges in focused engineer-days and assume the
equipment audit comes back with at least one recordable feed; they are estimates, not
commitments. P2 (any automatic classification) is out of V1 entirely.

---

## Phase 0 — discovery (this folder)

**Output**: [inventory](./inventory.md), [architecture](./architecture.md),
[equipment audit](./equipment-audit.md), [integration map](./integration-map.md),
[ADRs](./adr/), this plan. Documents only: no code, schema, cloud or DNS change.

**Gate — Fola decides:**

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

## P0 backlog, in order

| # | Item | PID | Phase | Effort | Depends on |
|---|---|---|---|---|---|
| 1 | Edge skeleton: `services/fairplay-edge`, Compose, pinned MediaMTX with the hardened config, `.env.example`, health endpoint, pytest in CI | FP-02 | 1 | 2–4 d | gate 3 |
| 2 | Synthetic feed generator: two clock-burned test streams with a known offset, a dropout and a marked "incident" (ffmpeg `testsrc` + drawtext) | FP-02 | 1 | 1–2 d | 1 |
| 3 | Segment manifest: hook + start-up sweep, SHA-256, ffprobe, partial-file flag | FP-08 | 1 | 2–3 d | 1 |
| 4 | Source health and watchdog: disconnect, recorder stopped, disk low/hard water marks, MediaMTX down | FP-14 (P0 part) | 1 | 2–3 d | 1 |
| 5 | Retention job that never deletes protected or unsynced segments | — | 1 | 1–2 d | 3 |
| 6 | **Phase 1 gate**: two-feed (or one-feed) recording test, disconnect one source, restart Edge, checksums verified — synthetic first, real kit when available | FP-02, FP-03 | 1 | 1–2 d | 1–5, hardware |
| 7 | Local auth: Caddy TLS, signed bundle verification (with a dev signing key), PIN login, session cookie | FP-11 | 2 | 3–5 d | gate 4 |
| 8 | Time model: periods, calibrations, offsets, uncertainty, failure states | FP-05 | 2 | 3–5 d | 3 |
| 9 | Local console: shadow banner, health, live preview, replay player via the Edge proxy, jump −10/−30/−60, 0.5×/1×, source selector, incident list | FP-03, FP-04 | 2 | 6–10 d | 7, 8 |
| 10 | Incidents and reviews: state machine, versions, four outcomes, reopen-as-audited | FP-06, FP-07 | 2 | 3–5 d | 9 |
| 11 | Clip jobs: stream-copy window, re-encode only on request, derivative hash + lineage | FP-08 | 2 | 2–4 d | 3, 10 |
| 12 | Edge audit hash chain and outbox with backoff | FP-09, FP-10 | 3 | 3–4 d | 10 |
| 13 | Cloud: migration, `fairplay` module, device pairing, credential bundle, sync batch, receipts | FP-01, FP-10 | 3 | 5–8 d | gate 2 |
| 14 | Cloud: evidence presign/confirm/read-url on a separate bucket, audit | FP-11 | 3 | 2–4 d | 13, bucket approval |
| 15 | Web admin: FairPlay index, per-match page, devices, members, report view | FP-01, FP-15 | 3 | 4–6 d | 13 |
| 16 | **Phase 3 gate**: 30-minute WAN-off drill, 10× duplicate sync, wrong-device token refused, authorisation matrix | FP-09–11 | 3 | 2–3 d | 12–15 |
| 17 | Runbooks, matchday checklists, operator guide; three shadow matches | — | 4 | 5–10 d + matchdays | all, rights |

**Total P0**: roughly 47–80 engineer-days before the field pilot, wide because the
hardware and the Edge machine are unknown.

P1 after the pilot: side-by-side angles with alignment (FP-12), frame diagnostics (FP-13),
extended monitoring (FP-14), organiser report polish (FP-15), PDF.

## Prerequisites for Phase 1

- Gate decisions 1 and 3 made.
- An Edge development machine (or Fola's agreement to start on a developer laptop with
  synthetic feeds only, hardware acceptance marked pending).
- The equipment audit's Gate rows answered — or, if not yet, Phase 1 proceeds on synthetic
  feeds and **stops before claiming real-video success**, as the prompt pack requires.

## Blockers and escalations

| Blocker | Why it stops work | Who |
|---|---|---|
| Hardware outputs unknown (E1–E6) | Nothing may promise isolated camera recordings until proven; single-angle mode is the safe default | Matchday crew → Fola |
| Footage rights and consent for real fixtures | No real youth-player footage is recorded into FairPlay, or shown to anyone outside DTP, until the competition agreement covers it | Fola / organisers |
| R2 bucket creation | A Cloudflare account change; tiny cost but needs approval | Fola |
| Organiser access model | Decides whether external people get admin accounts | Fola |
| Retention period | PID suggests 7–30 days locally; needs the organiser's agreement before any automated deletion | Fola / organisers |
| Edge machine OS | Docker on Windows handles UDP/RTSP less well; may mean native services instead | Matchday crew |

Standing escalations (from the master prompt): any request to enable referee
intervention, any new recurring charge or EC2 change, any destructive migration, any
reduction in access control, any upload of real footage to a third-party AI service.

## Rollback

- **Phase 0**: delete `docs/fairplay/`. Nothing else changed.
- **Edge (Phases 1–2)**: separate service on a separate machine; stop it and the
  broadcast is unaffected by construction. Recordings stay on disk.
- **Cloud (Phase 3)**: the migration is additive. Rollback = deploy the previous image
  (CD already does this on a failed health check); the new tables stay, unused, and are
  dropped only by a later, approved migration. Turning FairPlay off is removing the role
  grants; no existing route depends on it.
