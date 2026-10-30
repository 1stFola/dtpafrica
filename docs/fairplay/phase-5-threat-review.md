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
| MediaMTX restarted during a match; originals not silently overwritten | **covered (synthetic), 5.2 D3** | Segment names carry microseconds (`mediamtx_config.py:25`), so a restart starts a new file. Finalised segments are made read-only (`manifest.py:201`) and re-hashed before any clip or upload (`evidence.verify_file`). Phase 2 observed that a restart breaks every recording and flags both cameras stale. | drilled in 5.2 (D3): about 3 s lost per camera, shown as a gap; no original rewritten |
| Edge API restart; SQLite recovery; outbox resumes | **covered (synthetic), 5.2 D4** | WAL with `synchronous=FULL` (`store.py:541-542`). Phase 1: restart keeps all hashes. Phase 3: SIGKILL then replay of the incident window, audit chain whole. Phase 4 e2e: a restarted sender catches up. | Phase 1 found that `restart: unless-stopped` does not bring back a container that was `docker kill`ed. A crash inside the process does restart. A kill during an active sync batch was drilled in 5.2 (D4): the batch was sent again and answered replayed. |
| SSD reaches soft and hard thresholds, with a conspicuous warning | **covered (synthetic), 5.3; F21, F22 and F23 fixed** | thresholds and alerts exist (`watchdog.py:160-167`, `test_disk_thresholds`) | F3 fixed in 5.5 part 1. 5.3 drilled both limits and a full disk: a full disk was shown as recording (F21), and a file torn in a fragment header was not repairable (F23). Both fixed in 5.3, and the drill passes 21/21 |
| R2 upload begins, fails, resumes without duplicate evidence records | **covered (synthetic), 5.3** | Unique `(evidenceId, kind)` in the cloud (`schema.prisma`, `FairPlayEvidenceObject`). Unit tests: a corrupted upload is sent again; a cloud not ready yet is asked again later. Phase 4 e2e: a corrupted object is refused, removed and uploaded properly; a duplicate upload sends nothing. | cut halfway in 5.3's e2e: nothing in the bucket, sent again whole, one object per kind |
| Invalid pairing token | **covered** | e2e: unknown token refused; the bootstrap token works once (`devices.service.ts:73-78`) | — |
| Unauthorised user | **covered** | cloud access matrix (`fairplay-access.spec.ts`); Edge role tests (`test_auth.py`, `test_phase3_api.py`) | — |
| Replay URL guessed | **covered** | Edge media and evidence need the session cookie. Organisers get a 404 for withheld evidence. Cloud evidence keys contain a UUID and are read only through a 5-minute audited URL. | — |
| Actor role changed during the match | **open: F1** | — | see F1 |
| Cross-match access blocked | **partly: F4, F5** | the cloud refuses a wrong-match or wrong-device sync (e2e; `sync.service.ts:186-215`) | see F4, F5 |
| Console laptop sleeps or refreshes; recorder carries on | **covered (synthetic), 5.2 D1** | recording is MediaMTX's alone and never waits on the console. Sessions time out after 30 idle minutes, so a laptop that slept longer signs in again. | drilled in 5.2 (D1): a refresh kept the sign-in; after 34 min asleep the console signed in again; no gap |
| No hardware time sync; gross drone offset | **partly: F11** | The console warns that clock sync is not confirmed. Clock steps over 1 s are raised (`timing.py:375`). Uncalibrated sources carry ±3 s and calibrations above 500 ms are flagged. | see F11 |
| Power interruption and recovery (UPS) | **partly** | WAL `synchronous=FULL`; MediaMTX's recovery point is one part (1 s; 0.29 s measured in Phase 1); container kill and restart tested | No host power cut has been simulated. Whether Docker starts on boot is host configuration. UPS capability is unknown: a **hardware assumption, escalated**, not designed around (5.2 D5 simulated it with every container killed at once; a real drill needs the kit). |

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

## 5.5, part 2: the recommended medium findings fixed

Branch `feat/fairplay-phase-5-mediums`, on top of part 1. None of the open decisions above
changes these fixes.

**F4, fixed: a competition's manager stays inside their competition.**
- A device serving an open session of a competition the caller cannot read is not in
  their device list. They cannot put a session on it, retire it or re-pair it; to them it
  looks absent (`DeviceUnavailable` or 404).
- Member candidates are asked for per match (`GET member-candidates?matchId=`). The caller
  must be able to read the match, and only accounts given its competition are offered.
- A member must be given the match's competition on their account (`MemberOutOfScope`).
  A member whose competition is taken away later drops out of the next bundle, as a
  removed permission does since part 1.

**F5, fixed: a person at the venue reads their own session.**
- The bundle's session binds every sign-in (`Principal.bundle_session`). Another session
  on the same machine answers 404 everywhere: the session, its incidents, evidence,
  jobs, rights and report. The session lists show only the bundle's session.
- Replay, spans, gaps, segment lists and segment manifests are limited to the time
  around that session: from 3 hours before it was opened to 1 hour after it ended (now,
  while it is open). Outside that, replay gets `403 outside_session`.
- An Edge admin may still read any session and any footage on the device. Each first
  read of another session in an hour is in the audit chain
  (`session.accessed_outside_bundle`); replay is audited as before (`media.accessed`).
- Not bound: the device token (the machine's own CLI), and DEV bundles that name no
  session.
- Left device-wide, on purpose: sources and live preview, alerts, events, holds, the
  outbox and health. These describe the machine, not a match.
- A limit to know: back-to-back matches on one machine. Once the cloud's bundle moves to
  the next match, a reviewer still finishing the first one needs an Edge admin.

**F6, fixed: retired devices come back, and tokens are rotated.**
- An Edge admin re-pairs a device on the FairPlay page (`POST devices/:id/re-pair`, with
  a reason). This issues a new bootstrap token, the current token stops at once, and a
  retired device is brought back. It is audited (`device.re_pair_started`, with
  `wasRetired`).
- Only the same Edge machine can complete a re-pair (`EdgeMismatch` otherwise). A retired
  machine registering as a new device is told to re-pair its old one, so its history
  stays on one device row.
- The Edge keeps the token's expiry at pairing (schema v5, `cloud_pairing`). It warns 30
  days ahead (`device_token_expiring`), then raises a critical alert once the token has
  expired (`device_token_expired`). The console shows both, and the FairPlay page has a
  "Token expires" column that flags the last 30 days.
- The token file is created owner-only (`os.open(…, 0o600)`), never written first and
  narrowed after.
- After `fairplay-edge pair`, the Edge service is restarted to use the new token. The
  page says so.

**F8, fixed: the acts that matter are in the hash chain.**
- New audit actions:
  - `hold.created` and `hold.released`, with the actor; an incident's own hold is
    chained under the person who flagged it;
  - `member.disabled`, for an offline disable;
  - `segment.repaired`;
  - `segment.deleted`, for a retention deletion by the system;
  - `evidence.manifest_accessed`, for every manifest download.
- The once-an-hour access record for replay and evidence files is kept in the database
  (`access_seen`), in the same transaction as its entry, so a restart neither forgets it
  nor drops an entry.

**Schema.** The Edge goes to v5, which adds two tables and changes nothing that exists.
The cloud needs no migration: the new audit action is a new value in an existing column.

**Checks run** (29 Oct 2026). Another session's Vision rehearsal was running on the same
machine throughout, and the Docker VM was short of memory. One full Edge run took 76
minutes and failed two real-ffmpeg evidence tests on timing. Run on their own, they pass.

| Check | Result |
|---|---|
| Edge pytest in the Edge image | 254 passed, 1 skipped (11 new: five for F5, four for F8, two for F6). Four older tests were updated for the new behaviour: a hold now comes first in the chain, `member.disabled` names the admin, and the schema is v5. |
| `fairplay:cloudcheck` on a fresh scratch DB (`fp55d_scratch`) | 85/85 (15 new: F4's device, candidate and member scope; a member whose competition is removed; F6's re-pair, rotation and refusals). Its first run, on `fp55c_scratch`, found a Prisma `include` that cannot name scalar fields, which tsc had passed; fixed. |
| `fairplay:e2echeck` on a fresh scratch DB (`fp55_e2e_scratch`) | 26/26 |
| `vitest src/fairplay` (API) | 25 passed |
| console `tsc`, `vitest`, `vite build` | clean; 20 passed; built |
| `tsc` for the API and the web app; `pnpm typecheck` | clean |

**Browser QA.**
- *Venue console:* the rebuilt Edge image ran the synthetic stack with the QA bundle,
  re-signed to name one of two sessions.
  - The operator's session picker listed only that session. The other answered 404.
    Yesterday's footage answered `403 outside_session`, and the last minutes played.
  - The admin saw both sessions. Two reads of the other gave one audit entry, naming the
    bundle's session.
  - A pairing expiring in 10 days showed the amber token line. An expired one showed the
    red line, and the header turned "Edge critical".
- *Web admin:* the API was pointed at the gate's scratch database, with a test admin
  scoped to its first competition.
  - The device list left out the device serving the other competition.
  - "Token expires" showed the date.
  - "Re-pair" asked for a reason. It showed the one-time token with the restart
    instruction, and the device went back to "awaiting pairing" with its Edge id.
  - The candidates for a match were only accounts given its competition, and a request
    without `matchId` got 400.
- Afterwards the QA bundle and `.claude/launch.json` were restored, the seed script
  deleted, and the stack removed with its volumes.

```text
DTP FAIRPLAY | PHASE 5.5 (PART 2) DELIVERY
STATUS: complete on synthetic data; F7, F9, F10, F12–F19 not started

REPOSITORY FACTS CONFIRMED
- Existing patterns used: part 1's bundle checks; the audit chain; Prisma account scope as admin sign-in reads it
- Hardware facts actually verified: none
- Unknowns remaining: as for part 1 (UPS, RTSPS or a closed camera network, host time sync)

IMPLEMENTED
- Code paths changed: cloud devices/sessions/access; Edge api, auth, audit, cloud, retention, repair, store; console; web admin
- APIs and migrations: POST devices/:id/re-pair; member-candidates needs matchId; Edge schema v5 (additive); no cloud migration
- Local/Cloud config: none

SECURITY + COST
- Auth and evidence changes: venue reads bound to the bundle's session; device and member scope by competition; token rotation; holds, disables, repairs, deletions and manifest reads chained
- New dependencies and license: none
- New recurring cost: $0

TEST EVIDENCE
- Commands actually run: see the table above
- Passed / failed / untested: re-pairing a real Edge against the deployed cloud is untested (no deploy)
- Measured replay/CPU/RAM/SSD outcomes: none new

RISKS, ROLLBACK, NEXT GATE
- Blocking defects: none known in these fixes; the decisions above are still open
- Steps to revert safely: revert the commit. An older Edge build refuses a v5 database rather than guess, so set `schema_version` back to 4 first; the two new tables are then ignored
- Human approvals required: the four open decisions; the R2 bucket, deploy and signing key as before
- Proposed next phase: 5.2 failure drills, or the F7/F9/F10/F12–F19 hardening group
```

---

## 5.2: the failure drills

Branch `feat/fairplay-phase-5-drills`. One fixture, `fixtures/run_drills.py`, runs the
Edge-side drills in sequence. It writes a drill log (`drills.md`, and `drills` in
`results.json`) with, for each drill:
- the fault, and when it was seen;
- when service came back, and the recovery time (RTO);
- what was lost (the recovery point, RPO);
- any step a person had to take.

Nothing in the Edge itself changed.

**How it runs.**
- The stack runs on the cut network of `compose.wan-outage.yaml`, with real MediaMTX, two
  synthetic cameras, the LAN relay and a stand-in cloud, `drill-cloud`
  (`compose.drills.yaml`, `fixtures/drill_cloud.py`, TEST ONLY).
- The stand-in cloud answers the sync endpoint as the real one does:
  - applied, the first time;
  - replayed, for the same key and hash;
  - a conflict, for another hash.
- It serves HTTPS with a certificate from a CA made for the run. The Edge trusts that CA
  through `SSL_CERT_FILE`, so the Edge's own rule (https only, except to loopback) is
  unchanged.
- It fsyncs every batch it takes to a file before it answers.
- The WAN goes off when the stand-in cloud is detached from the network, so the Edge sees
  "no route to host", as with a dead uplink.
- Each run makes its own PIN, device token, signing key and CA, and never reuses them.

**The drills.**
- **D1, WAN off for 30 minutes.** 30 incidents are flagged during the outage. A console
  that signed in and refreshed before the cut sleeps through it. Then the WAN returns.
- **D2, drone drop.** The drone's publisher is stopped for 60 s, then started.
- **D3, MediaMTX restarted.** `docker compose restart mediamtx` mid-match, which sends
  SIGTERM with a 15 s grace period.
- **D4, Edge killed mid-sync.** The stand-in cloud applies a 50-record batch and holds its
  answer for 8 s. The Edge is SIGKILLed while it waits.
- **D5, power cut.** Every venue container (MediaMTX, the Edge, the cameras and the relay)
  is SIGKILLed at once and left off for 15 s. Then the stack is started with
  `docker compose up -d`.

**The full run: 34 passed, 0 failed.**
- It ran on 29 Oct 2026 from 17:41 to 18:22 UTC (`drills-20261029T174120Z`), with nothing
  else loading the machine.
- A rehearsal with a 2-minute WAN cut, run just before it, also passed 34 of 34.

| Drill | RTO | RPO | A person had to |
|---|---|---|---|
| D1 WAN off, 30 min | 206 s, from the WAN's return to an empty outbox | no records lost: 212 waited, and all 233 in the outbox were applied once. No footage lost. | nothing |
| D2 drone drop, 60 s | 4.9 s, from the camera's return to recording | 59.4 s gap shown for a 60.0 s drop: nothing lost beyond the drop. The ground had no gap. | nothing |
| D3 MediaMTX restart | 7.3 s, to both cameras recording | 3.0 s (ground) and 3.1 s (drone), each shown as a gap | nothing |
| D4 Edge killed mid-sync | 11.2 s, to the Edge answering | no records lost, no footage lost | start the Edge (`docker compose start edge`) |
| D5 power cut, 15 s off | 32.3 s, from the cut to both cameras recording | 20.4 s (ground) and 21.0 s (drone): the 15 s off, plus 5.4 s and 6.0 s of start-up. No records lost. | start the stack (`docker compose up -d`) |

**What the checks showed.**
- **D1:**
  - Through the outage every record waited in the outbox, and none was marked sent.
  - Both cameras recorded with no gap.
  - Afterwards every record reached the cloud exactly once.
  - The console had been idle for 34 minutes, so it was signed out. It signed in again and
    saw both cameras recording.
- **D3:**
  - No original was lost, cut short or rewritten, and the restart started new files.
  - The segments open at the restart closed cleanly as final.
  - Every final segment re-hashed to its manifest.
- **D4:**
  - SQLite passed `integrity_check`, and the audit chain verified.
  - Every incident the Edge had confirmed was still there.
  - The 50-record batch the cloud took but never answered was sent again after the
    restart. It came back as replayed, and nothing was applied twice.
  - Recording carried on through the kill.
- **D5:**
  - Integrity, the audit chain, every confirmed incident and every queued record survived.
  - The segments open at the cut ended on a whole fragment, so they were final: under one
    1 s part was lost from each.
  - Each camera shows one gap.

**What the drills found.**
- **The outbox's back-off sets the WAN recovery time.** After a 30-minute outage, records
  waited 206 s after the WAN came back, because the sender backs off up to 5 minutes
  (±20%). That is acceptable for post-match evidence. If records must reach the cloud
  sooner after an outage, cap the back-off lower. It is not changed here.
- **No `outbox_stalled` warning appeared.**
  - The warning is raised at a failed attempt, once a record has waited more than 30
    minutes. An outage of exactly 30 minutes ends before that.
  - This is as designed, but it means a shorter outage shows only as the sync error in the
    health panel.
- **Restarting MediaMTX costs about 3 s per camera.** The loss is shown as a gap, never
  hidden.
- **A killed container stays down.**
  - `restart: unless-stopped` does not bring back a container stopped by `docker kill`, as
    Phase 1 found. A crash inside the process does restart.
  - The risk at a venue is a person or a script killing it. The operator runbook (Phase 7)
    should say to start it again.
- **After a power cut, Docker must start the stack itself.**
  - That is host configuration: Docker started at boot, and the containers' restart policy.
  - The drill stands in for it with `docker compose up -d`.

**Limits, stated plainly.**
- A docker kill is not a power cut. The host's page cache and the disk's write cache
  survive it. So D5 tests the software's recovery, not the file system's or the disk's.
- A UPS, and whether the host boots and starts Docker unattended, are still hardware
  questions for the venue kit (escalated in 5.1).
- The stand-in cloud is not the DTP API. The real API's replay behaviour was checked
  against a real database in Phase 4's e2e.

**Checks run** (29 Oct 2026):

| Check | Result |
|---|---|
| `python -I fixtures/run_drills.py` (30-minute WAN cut) | 34 passed, 0 failed |
| `python -I fixtures/run_drills.py --wan-minutes 2` | 34 passed, 0 failed |
| Edge pytest in the Edge image | 255 passed, 1 skipped (the cloud e2e, run by `fairplay:e2echeck`); 1 new |

```text
DTP FAIRPLAY | PHASE 5.2 DELIVERY
STATUS: complete on synthetic feeds; a real power cut and a UPS need the venue kit

REPOSITORY FACTS CONFIRMED
- Existing patterns used: the Phase 1–4 fixture runner (Run), the cut-network overlay and LAN relay, the Edge's own tlsgen CA
- Hardware facts actually verified: none
- Unknowns remaining: UPS; whether the host starts Docker and the stack at boot; RTSPS or a closed camera network

IMPLEMENTED
- Code paths changed: fixtures only (run_drills.py, drill_cloud.py, two hooks in run_fixture.py); compose.drills.yaml (TEST ONLY); one unit test; no Edge code
- APIs and migrations: none
- Local/Cloud config: none

SECURITY + COST
- Auth and evidence changes: none. The stand-in cloud is reached over HTTPS and checks the device token; per-run secrets stay under fixtures/out (git-ignored)
- New dependencies and license: none (standard library and the existing Edge image)
- New recurring cost: $0

TEST EVIDENCE
- Commands actually run: see the table above
- Passed / failed / untested: 34/34 on both runs. Untested: a real power cut, the disk's write cache, Docker at boot, the real cloud API in these drills
- Measured replay/CPU/RAM/SSD outcomes: RTO and RPO per drill as in the table; docker stats in results.json

RISKS, ROLLBACK, NEXT GATE
- Blocking defects: none. Found: the back-off sets a 3–6 minute WAN recovery time; a docker-killed container stays down
- Steps to revert safely: revert the commit (fixtures and docs only)
- Human approvals required: the four open decisions as before; whether to cap the outbox back-off lower
- Proposed next phase: 5.3 storage and upload failures, or 5.4 security tests
```

---

## 5.3: storage and upload failures

Branch `feat/fairplay-phase-5-storage`, on top of 5.2's branch (#317), whose drill harness it
extends. The drill found two defects (F21, F23) and one small one (F22). Fola chose to fix
them on this branch before pushing; the fixes and the passing re-run are under "Fixes".

**How it runs.**
- **The disk.** `python -I fixtures/run_drills.py storage` puts the recordings on a 1 GB
  tmpfs (`compose.storage.yaml`, TEST ONLY). The soft limit is 0.6 GB free and the hard
  limit 0.3 GB. A filler file beside the source folders steps the disk down: under the soft
  limit (S1), under the hard limit (S2), full (S3), then freed (S4).
- **The cameras.** Two synthetic cameras wrote 0.40 MB/s between them.
- **The console.** `--browser-pause` holds at each stage for a look at the console.
- **The upload.** It is cut in the Phase 4 end-to-end check (`fairplay:e2echeck`): the real
  API and S3 server, and the Edge's real uploader. For one clip, a relay in front of the S3
  server (TEST ONLY) forwards half the PUT's body and then drops both connections, as a WAN
  failing mid-upload would.

**Upload cut halfway: covered.** All 31 e2e checks passed (4 new), on a fresh scratch
database (`fp53_e2e_scratch`).
- The relay forwarded 528 of 1,056 bytes, then dropped the connection. The Edge recorded
  `RemoteProtocolError`, kept the clip pending (attempt 1), and stored its manifest
  normally.
- The half-sent object was not in the bucket (404).
- On the next pass the clip was sent again whole, and confirmed.
- In the cloud, that evidence has one object per kind, both stored, and no second record.
  The read URL serves the Edge's exact bytes.
- A cut upload is sent again from the start (one PUT, no multipart). For 30-second clips
  that is a few megabytes; the test clip is the test cutter's 1 KB.

**The disk's limits: covered.**

| Stage | What happened |
|---|---|
| S1, under the soft limit | `disk_soft_limit` (warning) 3.8 s after the fill. A new session was still allowed. Health gave the free space, the state and the minutes left. Both cameras kept recording. |
| S2, under the hard limit | `disk_hard_limit` (critical) 3.8 s after the fill. A new session and a new clip were refused with `507 disk_hard_limit`; an incident was still taken. Both cameras kept recording. |

Browser check (`storage-20261029T200933Z`, operator signed in through the LAN relay):
- **Soft limit.** A full-width amber banner: "Disk running low (0.4 GB free)", the time
  left, and "Plan to free space before the next match". The header said "Edge degraded".
- **Hard limit.** A full-width red banner: "Disk almost full (0.3 GB free). New sessions,
  clips and exports are refused…". The header said "Edge critical", with the disk chip red.
- The operator has no "New session" button at any stage; its disabled state for an admin
  was checked in 5.5 part 1.

**A full disk: two defects** (before the fixes). Run `storage-20261029T203139Z`: 16 passed,
3 failed. All three failures are F21 and F23. Every one of the four storage runs showed F21.

- **What went wrong.** Both cameras were reported as recording for the whole time the disk
  was full (80.8 s). Neither got a `recording_stalled` alert (F21). The ground camera's open
  file was marked `corrupt`, so about 7 s of whole fragments in it are not offered for
  repair (F23).
- **What held up.**
  - The Edge kept answering. Its database is on its own volume, and it still took an
    incident.
  - Once the filler was removed, both cameras recorded again 1.9 s later, without a
    restart, and every disk and recording alert resolved.
  - The drone's open file was `partial`, and was repaired into a whole derivative.
  - All 59 final segments re-hashed to their manifests.
  - Each camera showed one gap: ground 88.5 s (the full period plus F23's 7 s), drone
    80.0 s.
- **The console.** Browser check, at 0.0 GB free: both source cards said "● Recording".
  Beside them, the red banner said the disk was full and "recording then stops".

**F21 (high, new): a full disk is shown as recording.**
- On "no space left on device", MediaMTX's recorder starts a new file every 2–3 s, and
  each write fails.
- The watchdog counts a source as recording while its current segment grew within
  `record_stall_seconds` (6 s). Each new, empty file looks like growth.
- So `recording` stays true, and `recording_stalled` is never raised. The API showed
  `recording: true` with `currentSegmentBytes: 0`.
- The red disk banner is the only sign. This is the "recording silently fails" risk in the
  PID. The empty files also raise `segment_corrupt` warnings, one per file the scanner
  catches.
- Fixed below.

**F22 (low, new): the disk chip rounds to whole gigabytes.** At 0.4 GB free it said
"Disk 0 GB free", while the banner said 0.4 GB (`Console.tsx:413` uses `Math.round`). Fixed
below.

**F23 (medium, new): a file torn inside a fragment header is called corrupt, not partial.**
- The ground file open when the disk filled was 2.5 MB, torn 57 bytes into a `moof` box.
  ffprobe could not read it at all, and the scanner calls any file ffprobe cannot read
  `corrupt` (`manifest.py:133`).
- Repair only accepts `partial` files, so 7 s of whole fragments, with their init, are not
  offered for repair.
- Reproduced in the Edge image with an ffmpeg-made file: a `moof` cut 1, 8 or 57 bytes short
  of its end gives ffprobe's "error reading header", the same error as the drill. A cut early
  in the `moof` does not.
- Fixed below.

**Fixes.**
- **F21: recording is judged by media written.**
  - The scanner sets `last_growth_utc` only when media is written. A file holding nothing,
    or only its init, is no longer growth (`manifest.media_written`).
  - The watchdog takes the latest media write across the source's last five segments. So
    a normal segment switch, whose new file is empty for a moment, stays recording.
  - Below `FAIRPLAY_DISK_FULL_FREE_MB` (64 MB by default) free, the Edge raises
    `disk_full` (critical) and shows every source as not recording. The disk's state is
    `full`, and refusals carry on as at the hard limit.
  - The console says "Disk full (0.0 GB free). Nothing is being recorded on any camera…".
    Each camera card says "Connected, NOT recording".
- **F22.** The chip and the banner share one label, to one decimal place (`disk.freeLabel`).
- **F23.** When ffprobe cannot read a file with whole fragments and a torn tail, the Edge
  probes just the whole fragments, through ffmpeg's `subfile` byte range. Nothing is
  copied, so this works on a full disk. If they probe, the file is `partial` and its
  problems say so; if not, it stays `corrupt`.

**The re-run after the fixes:** `storage-20261030T000447Z`, 21 passed, 0 failed, with the
console checked at each stage.
- **S1, S2.**
  - Unchanged, and both cameras kept recording.
  - The chip said "Disk 0.6 GB free", the same as the banner.
- **S3, the disk full for about 93 s.**
  - `disk_full` (critical) was raised. The disk's state was `full`.
  - Neither camera was shown as recording in any of six samples, and `recording_stalled`
    (critical) was open on both.
  - The console showed the red "Disk full" banner, "Edge critical", a red "Disk 0.0 GB
    free" chip, and "Connected, NOT recording" with "recording stalled" on both cards.
  - The Edge still took an incident.
- **S4, recovery.**
  - Both cameras recorded again 8.2 s after the filler was removed, with no restart. That
    is slower than the 1.9 s before the fixes, because a new file must now hold media to
    count.
  - Every disk and recording alert resolved.
- **F23 recurred, and was handled.**
  - The ground file open at the fault gave "error reading header" again. The Edge probed
    its first 8,510,949 bytes, called it `partial`, and repaired it into a 26.4 s
    derivative.
  - The drone's open file was `partial` too, and repaired into 26.0 s.
- **What it kept.** All 82 final segments re-hashed to their manifests. The gaps were
  ground 93.4 s and drone 98.9 s.
- **Drill artefacts.**
  - Ground also had a 4.7 s gap at the S2 fill burst.
  - The detect times (S1 6.8 s, S2 16.6 s, S3 19.3 s) are counted from the start of each
    fill, so they include writing the filler, up to 279 MB.
- **Still noisy.** The empty files a full disk leaves still raise `segment_corrupt`
  warnings, one per file the scanner catches. That is correct, but noisy.

**Notes and limits.**
- The filler writes hundreds of MB in a few seconds. In one run that burst cost the ground
  camera a 4.2 s gap. That is a drill artefact: a real disk fills at the cameras' pace.
- The drill's recordings are on their own tmpfs. At a venue the recordings and the data
  volume normally share one disk, so a full disk would stop the database as well. The hard
  limit (5 GB free by default) is what keeps that from happening.
- A tmpfs is not an SSD. Write speed and wear are not tested.

**Checks run** (29 and 30 Oct 2026):

| Check | Result |
|---|---|
| `fairplay:e2echeck` on a fresh scratch DB (`fp53_e2e_scratch`) | 31/31 (4 new: the cut, nothing in the bucket, the resend, one object per kind) |
| `python -I fixtures/run_drills.py storage`, before the fixes | 16 passed, 3 failed: F21 (2 checks) and F23 (1) |
| the same with `--browser-pause` (console checked) | soft and hard banners as described; F21 seen in the console |
| Edge pytest in the Edge image; API `tsc` (incl. scripts), before the fixes | 255 passed, 1 skipped (the cloud e2e, run by `fairplay:e2echeck`); clean |
| Edge pytest in the Edge image, after the fixes | 262 passed, 1 skipped (7 new: empty files, a segment switch, a full disk, the API's `full` state, F23 with a fake and with real ffmpeg) |
| `fairplay:e2echeck` after the fixes, on a fresh scratch DB (`fp53b_e2e_scratch`) | 31/31 |
| console `vitest run`, `tsc --noEmit`, `build` | 22 passed (2 new); clean; built |
| `python -I fixtures/run_drills.py storage --browser-pause 900`, after the fixes | 21 passed, 0 failed; console checked at the soft limit and at full |

```text
DTP FAIRPLAY | PHASE 5.3 DELIVERY
STATUS: complete on synthetic data; found F21 (high), F22 (low) and F23 (medium), and fixed all three

REPOSITORY FACTS CONFIRMED
- Existing patterns used: 5.2's drill harness; Phase 4's e2e check (real API, s3mock, the Edge's uploader); F3's banners and 507 refusals
- Hardware facts actually verified: none
- Unknowns remaining: the Edge's SSD (size, speed, whether recordings and data share it); UPS

IMPLEMENTED
- Code paths changed: fixtures (run_drills.py storage, compose.storage.yaml TEST ONLY); test_cloud_e2e.py (a cutting relay); fairplay-e2e-check.ts (cloud-side count). Fixes: watchdog.py (recording by media written, disk_full), manifest.py (media_written, F23's prefix probe), probe.py (byte-range probe), api.py (disk state "full"), console disk.ts and Console.tsx
- APIs and migrations: no migration. Health and /edge/v1/disk can report disk state "full", with fullFreeBytes; sources gain diskFull; lastGrowthUtc is now the last media write
- Local/Cloud config: FAIRPLAY_DISK_FULL_FREE_MB (default 64) in .env.example

SECURITY + COST
- Auth and evidence changes: none
- New dependencies and license: none
- New recurring cost: $0

TEST EVIDENCE
- Commands actually run: see the table above
- Passed / failed / untested: e2e 31/31, before and after the fixes; storage 21/21 after the fixes (16 passed, 3 failed before them); Edge 262 passed, 1 skipped; console 22 passed. Untested: a real SSD, a shared disk, an upload of a full-size clip to R2
- Measured replay/CPU/RAM/SSD outcomes: fill 0.40 MB/s for two synthetic cameras; disk_full and recording_stalled on both cameras at a full disk; recording back 8.2 s after space was freed

RISKS, ROLLBACK, NEXT GATE
- Blocking defects: none found on synthetic data
- Steps to revert safely: revert the fix commit (no migration, no data change); the test commit is tests and docs only
- Human approvals required: the open decisions as before
- Proposed next phase: 5.4 security tests
```

---

## Handover for 5.1 (prompt pack section K)

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
