# FairPlay — Phase 5.1: threat and failure review

**Status: complete (review only; no code changed).** Increment 5.1 of the plan in
[phase-plan.md](./phase-plan.md#prompts-68-in-increments): every scenario and security
requirement of Prompt 6 ("PHASE 5: SYSTEM RESILIENCE + DEFENSE IN DEPTH") checked against
the PID (§4.1, §11, §13, §14, §16) and the code merged up to #310. Three high findings,
no critical ones. The fixes are increment 5.5. Which mediums go into it is for Fola to
decide (see "Proposed scope for 5.5").

---

## Method

- **Two independent reads.** One reviewer covered the Edge and the venue console, the
  other the cloud module and web admin. Neither built the code, and each got the Prompt 6
  requirements and no findings. I then checked every finding below against the code
  myself and re-graded it. Where the two reads disagreed with the code, the code wins.
  Items marked *(not re-checked)* come from a review and were not confirmed line by line.
- **Failure scenarios.** Mapped to the tests and drills already on record in the
  Phase 1–4 reports, and to the code paths that handle each failure.
- **Tests run for this review** (28 Oct 2026, on `main` at 3ccbd18):

  | Command | Result |
  |---|---|
  | Edge pytest in the Edge image (`fp-edge-test`) | 236 passed, 1 skipped (`test_cloud_e2e.py`, run only by the end-to-end driver) |
  | `npx vitest run src/fairplay` (services/api) | 3 files, 25 tests passed |

  Nothing else was run. In particular, no failure drill was run again. Every drill result
  quoted below is from the earlier phase report it names, on synthetic feeds.

## Failure scenarios

| Scenario (Prompt 6) | State | Evidence | What is missing |
|---|---|---|---|
| WAN down mid-match for ≥ 30 min (no AWS, YouTube or R2) | **covered (synthetic)** | Phase 1: 30-minute drill on a Docker network with no route out, `verify-all` 121/121. Phase 3: full run under the WAN cut. Phase 4 e2e: an incident reviewed and approved during the outage, then a restarted sender catching up with nothing lost. Uploads wait out the outage (`test_an_outage_keeps_every_upload_and_they_go_when_it_ends`). Nothing on the Edge depends on YouTube. | hardware |
| Drone feed drops and reconnects; ground continues | **covered (synthetic)** | Phase 1: drone stopped 28.6 s, ground unaffected, feed interval closed, alert raised. Phase 2: the drone's calibration is flagged `stale_after_reconnect` until recalibrated. | hardware |
| MediaMTX restarted during a match; originals not silently overwritten | **partly** | Segment names carry microseconds (`mediamtx_config.py:25`), so a restart starts a new file. Finalised segments are made read-only (`manifest.py:201`) and re-hashed before any clip or upload (`evidence.verify_file`). Phase 2 observed that a restart breaks every recording and flags both cameras stale. | a drill that restarts MediaMTX mid-recording and measures the loss and the gap shown (5.2) |
| Edge API restart; SQLite recovery; outbox resumes | **covered (synthetic), one gap** | WAL with `synchronous=FULL` (`store.py:541-542`). Phase 1: restart keeps all hashes. Phase 3: SIGKILL then replay of the incident window, audit chain whole. Phase 4 e2e: a restarted sender catches up. | Phase 1 found that `restart: unless-stopped` does not bring back a container that was `docker kill`ed. A crash inside the process does restart. A kill during an active sync batch is not drilled (5.2). |
| SSD reaches soft and hard thresholds, with a conspicuous warning | **open: F3** | thresholds and alerts exist (`watchdog.py:160-167`, `test_disk_thresholds`) | see F3: the warning is a chip, and the hard limit stops nothing |
| R2 upload begins, fails, resumes without duplicate evidence records | **mostly covered** | Unique `(evidenceId, kind)` in the cloud (`schema.prisma`, `FairPlayEvidenceObject`). Unit tests: a corrupted upload is sent again; a cloud not ready yet is asked again later. Phase 4 e2e: a corrupted object is refused, removed and uploaded properly; a duplicate upload sends nothing. | a PUT cut halfway through the transfer (5.3) |
| Invalid pairing token | **covered** | e2e: unknown token refused; the bootstrap token works once (`devices.service.ts:73-78`) | — |
| Unauthorised user | **covered** | cloud access matrix (`fairplay-access.spec.ts`); Edge role tests (`test_auth.py`, `test_phase3_api.py`) | — |
| Replay URL guessed | **covered** | Edge media and evidence need the session cookie. Organisers get a 404 for withheld evidence. Cloud evidence keys contain a UUID and are read only through a 5-minute audited URL. | — |
| Actor role changed during the match | **open: F1** | — | see F1 |
| Cross-match access blocked | **partly: F4, F5** | the cloud refuses a wrong-match or wrong-device sync (e2e; `sync.service.ts:186-215`) | see F4, F5 |
| Console laptop sleeps or refreshes; recorder carries on | **covered by design, not drilled** | recording is MediaMTX's alone and never waits on the console. Sessions time out after 30 idle minutes, so a laptop that slept longer signs in again. | a drill: sleep or refresh during recording, check nothing is lost (5.2) |
| No hardware time sync; gross drone offset | **partly: F11** | The console warns that clock sync is not confirmed. Clock steps over 1 s are raised (`timing.py:375`). Uncalibrated sources carry ±3 s and calibrations above 500 ms are flagged. | see F11 |
| Power interruption and recovery (UPS) | **partly** | WAL `synchronous=FULL`; MediaMTX's recovery point is one part (1 s; 0.29 s measured in Phase 1); container kill and restart tested | No host power cut has been simulated. Whether Docker starts on boot is host configuration. UPS capability is unknown: a **hardware assumption, escalated**, not designed around (5.2 simulates; a real drill needs the kit). |

## Security requirements

| Requirement (Prompt 6) | State | Evidence |
|---|---|---|
| No unauthenticated recordings, admin APIs, presign endpoints or event mutation | **met, except camera ingest (F2)** | Every Edge route except `healthz`, `auth/status` and `auth/login` needs a principal (`api.py`). MediaMTX has no anonymous user, and its API, playback and read user is limited to the Edge's own IP (`mediamtx_config.py:73-91`). Metrics, pprof and WebRTC are off. Cloud admin routes are guarded at class level, each with a named permission (`fairplay-admin.controller.ts:24`). Device routes have their own guard (`device.guard.ts`). FairPlay writes no ScoreBoard table. |
| Secrets via secure local storage and environment, never committed, rendered or logged | **met, with F6 and F19** | Placeholder and length checks (`config.py:149-157`). Keys written 0600 (`tlsgen.py`). Edge sessions and cloud tokens stored as SHA-256, PINs as scrypt. Nothing secret is tracked in git. The console holds no token (HttpOnly cookie). Cloud list responses carry no hashes. |
| Secure local origin / HTTPS, or a documented pilot mitigation | **met in code; real reviewer device pending (B12); F10** | Binding beyond loopback requires TLS (`config.py:224-228`). Cookie HttpOnly, SameSite=Strict, Secure. CSRF header plus Origin check. CSP, HSTS. |
| Minimal network exposure, rate limiting, input validation, every export audited | **partly: F7, F8, F19** | Compose publishes 8554 (cameras) and 8443 (console) only. SQL is parameterised. ffmpeg runs from an argv list. Source names are allowlisted. Sync batches are capped at 200 items and 2 MB. |
| Authenticated machine-to-cloud sync, token rotation, least-privilege R2 | **partly: F6, F9, F17** | Device-token guard. The presigned PUT signs length, type and SHA-256. Confirm by HEAD checksum. Read URL ≤ 300 s, as an attachment. A bucket-scoped R2 token waits for the bucket. |
| No camera or video feed to external AI or third-party analytics | **met** | CSP `connect-src 'self'`, no CDN. The only egress is cloud sync and the presigned PUT, and only released evidence is uploaded (`cloud.py:184-216`). |

## Findings

Severity is the effect on Prompt 6's goals at a real youth match. Where both reads
found the same issue, it is merged into one finding.

### High

**F1. A role removed or reduced mid-match keeps working at the venue.**
Two gaps, one in each half:
- `sessions.service.ts:192-196`: `bundleFor` signs each member's stored venue
  permissions. It drops only accounts that are inactive or have no PIN, and never
  re-checks the account's role. The rule that the venue gets no more than the account
  holds is checked only when members are set (`checkMembers`, :248-253).
- `auth.py:269-284`: an Edge sign-in keeps the permissions it started with for its full
  8 hours. It is not checked against the bundle the Edge loads next, even when the
  person is no longer in it.

A member removed in the cloud also keeps access until the bundle the Edge already holds
expires (36 h), if the Edge is offline (`fairplay.config.ts:86`).
*Fix:*
- intersect stored permissions with the role's in `bundleFor`;
- in `resolve()`, use the current bundle's entry for the member and end the session if
  they are gone;
- for the offline case, document it and consider a shorter matchday TTL.

**F2. Camera ingest is plaintext RTSP with Basic auth on a LAN shared with spectators.**
- Where: `mediamtx_config.py:131-134` (`rtspEncryption: "no"`, `rtspAuthMethods:
  ["basic"]`). `config.py:5` itself says the LAN is shared with spectators.
- Anyone sniffing the LAN gets the publish passwords and the footage of minors.
- Publishing is limited to allowed CIDRs, and a live publisher cannot be taken over.
  But someone with the password and an address in that range can publish whenever the
  camera drops, and what they send is recorded and hashed as original.

*Fix:* depends on the hardware, so it is a **hardware assumption, escalated**:
- RTSPS (`rtspEncryption: strict`) if the encoders support it, otherwise a camera VLAN
  the public cannot join;
- in software regardless: an alert when a path's publisher comes from a new address,
  shown on the source card.

**F3. The disk hard limit stops nothing, and neither limit is conspicuous.**
- The watchdog opens `disk_soft_limit` (warning) and `disk_hard_limit` (critical), with
  no source attached (`watchdog.py:160-167`).
- The console shows disk only as a header chip, with the same amber style for both
  limits (`Console.tsx:397`). Its alert strip shows only clock warnings and "recorder
  unreachable" (`:403-408`). Per-source cards show only alerts tied to a source (`:431`).
- Nothing changes at the hard limit: recording carries on until the disk is full,
  writes then fail, and retention is off by default.

This is the PID's "recording silently fails" risk (§16, High).
*Fix:*
- a red banner across the console at the hard limit and an amber one at the soft limit,
  each saying how many minutes of recording are left at the current rate;
- at the hard limit, stop cutting new clips and refuse new sessions, and tell the
  operator what to free up. Never delete anything without being told to.

### Medium

**F4. A competition-scoped manager can take over another competition's Edge.**
- `sessions.service.ts:70-71` checks only that the device exists and is not retired.
  `bundleFor` (:181-191) serves the open session whose kickoff is nearest.
- So a manager scoped to competition A can open an A session on the device serving a
  B match, with a nearer kickoff time, and their own members get PIN access at B's
  venue.
- The device list (`devices.service.ts:46`) and member candidates (:219-228) are not
  scoped either. Candidates expose every eligible account's email.

*Fix:*
- refuse a session on a device that has an open session in a competition the caller
  cannot read;
- scope both lists.

**F5. On the Edge, a signed-in member can see every match the device holds.**
- `GET /edge/v1/sessions` returns all sessions (`api.py:753-755`), and replay windows
  are bounded only by what is on disk (14-day retention).
- An organiser can list reports for every session on the device.

*Fix:* bind reads to the bundle's session and match, and replay to that session's time
span, with an audited override for admins.

**F6. A retired Edge can never be paired again, and no token is rotated.**
- Retiring keeps `edge_device_id` (`devices.service.ts:98-104`, unique index), so
  registering the same machine as a new device gets a 409, "Retire the other device
  first", although it already is retired.
- There is no re-pair or rotate path for an expired (365-day) or leaked token.
- The Edge drops `deviceTokenExpiresAt` after pairing and gives no warning before expiry.
- It writes the token file and only then sets it to 0600 (`cloud.py:118-119`), so the
  file is briefly readable by others.

*Fix:*
- ignore retired rows in the uniqueness check;
- an audited re-pair route;
- store the expiry and alert 30 days ahead;
- create the file with `os.open(..., 0o600)`.

**F7. Brute-force and load protections are missing.**
- Cloud: `POST device/register` (unauthenticated) and the PIN route are not throttled.
  The ThrottlerGuard applies only to routes marked `@LoginThrottle` or
  `@PublicFormThrottle` (`shared/throttle.ts`).
- Cloud: PIN hashing is a synchronous 32 MB scrypt on the request thread
  (`credentials.ts:39`). A member looping the PIN route stalls every route, live
  ScoreBoard included.
- Edge: no request-body limit, and concurrent sign-ins each run a 32 MiB scrypt
  check (*not re-checked:* the concurrency).
- Edge: the per-email lockout lets anyone on the LAN lock a known operator out
  repeatedly.

*Fix:*
- `@LoginThrottle()` on register and on the PIN route;
- async `scrypt`;
- an Edge body limit and a semaphore around scrypt;
- backoff instead of a hard lock.

**F8. Some exports and destructive acts are missing from the hash-chained audit.**
- The evidence manifest download (incident, custody, player reference) writes no audit
  entry (`api.py:959-964`).
- File and media reads are audited once per person, item and hour, using an in-memory
  map cleared at 5,000 entries and on restart (`api.py:580-594`).
- Hold release records no actor and goes only to the mutable `events` table
  (`api.py:718-723`, `retention.py:65-77`). So an admin can release a hold, let
  retention delete the footage, and leave no attributable, tamper-evident trace.
- Local disable and retention deletion are also only in `events`.

*Fix:*
- audit every manifest and file download;
- persist the dedupe;
- move hold create and release, disable, repair and retention deletion into
  `audit.append` with the actor.

**F9. The "https only" check for cloud URLs can be bypassed.**
- `url_allowed` (`config.py:189-192`) takes the host from a split string, so
  `http://127.0.0.1:1@evil.example/` passes as loopback and is sent in plain HTTP to
  `evil.example`.
- Any `https://` host is accepted for presigned uploads.

The URLs come from the operator's configuration and from the authenticated cloud, so
this is defence in depth.
*Fix:*
- parse with `httpx.URL`, refuse userinfo, compare the host;
- allowlist the sync host and the R2 endpoint.

**F10. The venue CA can sign for any name, and its key stays on the Edge**
(`tlsgen.py:57-72`, no `NameConstraints`). A compromised Edge can then mint a
certificate for any site that reviewer devices will trust.
*Fix:*
- name constraints limited to the Edge's own names and addresses;
- move the CA key off the Edge after issuing.

**F11. Timing warnings are honest but blunt.**
- `ClockWatch` is built with `ntp_state="unknown"` and nothing ever sets it
  (`service.py:46`). The "clock sync is not confirmed" warning is therefore always on,
  and operators will learn to ignore it.
- `calibrate()` accepts any offset size without a plausibility check
  (`timing.py:156-175`). A 20-second slip of the hand is stored like any other.
- The uncalibrated uncertainty is ±3 s (`timing.py:42`), but Phase 3 measured
  uncalibrated offsets up to 2.87 s, and more on a starved machine.

*Fix* (increment 5.6):
- read the host's time-sync state (`timedatectl`, `chronyc`) where available;
- ask for confirmation on an offset above a configurable bound;
- raise the uncalibrated uncertainty, or derive it from measurements.

### Low

| # | Finding | Where | Fix |
|---|---|---|---|
| F12 | A payload containing `\u0000` is refused by Postgres, not rejected, so the item never gets an answer. The Edge retries it forever, and it holds back the items that depend on it. A non-string `label` on create-session throws a 500. | `sync.service.ts:99-103`, `sessions.service.ts:78` | reject NUL in the shape check; type-check `label` |
| F13 | The cloud's release gate trusts the latest rights record. "Synthetic" passes before the minors check, and "latest" is ordered by the device's `created_utc` string. A compromised Edge controls rights anyway, so this is a consistency fix. | `evidence.service.ts:81-91` | also require the evidence row's own `footageKind`; order by the version received; refuse a rights record with no `created_utc` |
| F14 | The sync-state screen lists refused receipts, segment counts and the audit chain by device, not session, so scoped staff see other competitions' refusal messages. Storage usage is global. | `fairplay-admin.controller.ts:126-132`, `report.service.ts:105-128` | filter by session; limit usage to unscoped `edge.admin` |
| F15 | The audit tables are protected by triggers, which the app's own database role could drop. Retire and PIN-set write their audit entry after the change, in a separate transaction. | migration lines 321-328, `devices.service.ts:103-105`, `sessions.service.ts:166-167` | audit inside the transaction; a separate owner role (a wider DTP change) |
| F16 | A 6-digit PIN under scrypt N=2^15 can be recovered offline by anyone holding a bundle (device token or Edge disk). | `credentials.ts:33-35` | accept as a known limit, or require 8 digits |
| F17 | Nothing stops FairPlay from being configured with Vision's R2 key; only the bucket name is checked. | `fairplay.config.ts:75` | refuse to boot when the key ids match |
| F18 | Copies outlive retention: the replay cache is pruned by count and size only, and exported zips are never deleted. *(not re-checked)* | `api.py:552-576`, `evidence.py:660` | prune both by age, in `retention.apply` |
| F19 | `/edge/v1/auth/status` (unauthenticated) shows the session label, the device label and the bundle error text to anyone on the LAN. The Origin check reads the Host header, and there is no Host allowlist. | `api.py:343-349`, `api.py:235` | trim the status to what sign-in needs; `TrustedHostMiddleware` |
| F20 | Hardening for the `init` and `synth-*` containers (`cap_drop`, `no-new-privileges`, `read_only`). apt `ffmpeg` not version-pinned; pip without `--require-hashes`. *(not re-checked; the FFmpeg part is B9)* | `compose.yaml:26-41, 118-146`, `Dockerfile:13-21` | pin, hash and harden; settle B9 |

## Proposed scope for 5.5

| Group | Findings | Why |
|---|---|---|
| Must (high) | F1, F3, and the software half of F2 (alert on a new publisher address; document the VLAN or RTSPS requirement in the hardware checklist) | Prompt 6 scenarios ("actor role changed", "SSD thresholds with a conspicuous warning") and the PID's "recording silently fails" risk |
| Recommended | F4, F5, F6, F8 | Prompt 6's "cross-match access blocked", "token rotation" and "audit all exports"; each is small |
| Then | F7, F9, F10, F12–F19 | cheap hardening, in one PR |
| Separate | F11 → 5.6; F20 → with B9 (FFmpeg) | already planned elsewhere |

**Needs Fola:**
- which group goes into 5.5;
- whether a 36 h offline window for removed members is acceptable (F1), or matchday
  bundles should be shorter;
- 6 or 8-digit PINs (F16);
- for F2, whether the venue has, or can have, a camera network the public cannot join.

---

## 5.5, part 1: the high findings fixed

Branch `feat/fairplay-phase-5-highs`. The decisions listed above are still open, and
none of these fixes depends on them.

**F1, fixed in both halves.**
- Cloud: `bundleFor` signs only the venue permissions the member's role still holds.
  A member left with none is dropped. The bundle's content hash changes, so the Edge's
  next five-minute fetch installs the new bundle.
- Edge: every request checks the sign-in against the bundle loaded now (`auth.py`,
  `Sessions.resolve`):
  - someone the bundle no longer lists is signed out (`not_in_current_bundle`);
  - with no valid bundle, everyone is signed out (`no_current_bundle`);
  - a permission the bundle dropped is gone at once, with an `auth.session.narrowed`
    event;
  - a permission it adds needs a fresh sign-in.
- Still open: the 36 h offline window, which is the decision above.

**F3, fixed.**
- The console shows a full-width banner: amber below the soft limit, red below the hard
  limit. It gives the free space and, once the Edge has a minute of samples, the time
  left at the current fill rate.
- The disk chip turns red at the hard limit.
- Below the hard limit the Edge refuses new sessions, clips, exports and repaired copies
  with `507 disk_hard_limit`, and the console's "New session" button is disabled.
  Recording carries on until the disk is full, and nothing is deleted to make room.

**F2, software half done; the network half needs the venue.**
- The watchdog asks MediaMTX where each publisher connects from, once per connection.
  It checks the RTSP session's `remoteAddr`; the API was confirmed on MediaMTX 1.21.3.
- A source's first address is its baseline. Any other address opens a
  `publisher_address_changed` warning on that source's card: "someone else may be
  sending this feed".
- It stays open until an Edge admin confirms the address with a reason
  (`POST /edge/v1/alerts/{id}/acknowledge`). The confirmation goes into the
  hash-chained audit log (`alert.acknowledged`), and the address becomes known.
- Encrypted ingest or a closed camera network still depends on the kit (blocker B16).

**Checks run** (29 Oct 2026):

| Check | Result |
|---|---|
| Edge pytest in the Edge image | 243 passed, 1 skipped (7 new: three bundle-change sign-in tests, disk outlook, publisher address, hard-limit refusals, admin confirmation) |
| `fairplay:cloudcheck` on a fresh scratch DB (`fp5_scratch`) | 70/70 (2 new: a permission taken off the role; a member left with none) |
| The same check run again on the same DB | 69/70. The usage check counts every row in the database, so the gate needs a fresh database each run. This was already true; it is not caused by these changes. |
| `fairplay:e2echeck` on a fresh scratch DB (`fp5_e2e_scratch`) | 26/26, including the venue sign-in with the cloud PIN |
| `vitest src/fairplay` (API) | 25 passed |
| console `tsc`, `vitest`, `vite build` | clean; 20 passed (3 new); built |
| `pnpm typecheck` (repository) | clean |

**Browser QA** of the venue console. The rebuilt Edge image ran a synthetic stack
(project `fp5`, WAN cut, LAN relay) with real MediaMTX and the Phase 3 QA bundle:
- *Soft limit:* the amber banner showed free space and "about 29 days" left. The first
  build printed "38863 min", so long times are now rounded down to hours or days.
- *Hard limit:* the red banner showed, the Edge was reported critical, and recording
  carried on. A new session request got 507 with its remediation. "New session" was
  disabled with an explanation.
- *New address:* the ground feed was stopped and republished from another container
  (172.31.250.2, then .6). Real MediaMTX reported the new address, and the card showed
  the warning with "Confirm address". The admin confirmed it with a reason, the alert
  closed, and the audit entry carries the admin, the address and the reason.
- *Role removed:* a bundle without the admin was installed while they were signed in.
  The Edge loaded it, and the admin's next request got 401, which put the console back
  on the sign-in page. The QA bundle was restored afterwards.

---

## Handover (prompt pack section K)

```text
DTP FAIRPLAY | PHASE 5.1 DELIVERY
STATUS: complete (review); fixes are 5.5

REPOSITORY FACTS CONFIRMED
- Existing patterns used: phase reports 1–4 as evidence; code at 3ccbd18
- Hardware facts actually verified: none
- Unknowns remaining: UPS, camera RTSPS support and venue network separation, host time sync

IMPLEMENTED
- Code paths changed: none (this document; the phase-plan increment list)
- APIs and migrations: none
- Local/Cloud config: none

SECURITY + COST
- Auth and evidence changes: none yet; 3 high and 8 medium findings to fix
- New dependencies and license: none
- New recurring cost: $0

TEST EVIDENCE
- Commands actually run: Edge pytest (236 passed, 1 skipped); API vitest src/fairplay (25 passed)
- Passed / failed / untested: failure drills not re-run; quoted from Phase 1–4 reports
- Measured replay/CPU/RAM/SSD outcomes: none new

RISKS, ROLLBACK, NEXT GATE
- Blocking defects: F1, F2, F3 before any real match
- Steps to revert safely: delete this document
- Human approvals required: 5.5 scope; F1 offline window; F16 PIN length; F2 venue network
- Proposed next phase: 5.2 drills, or 5.5 fixes first if Fola prefers
```
