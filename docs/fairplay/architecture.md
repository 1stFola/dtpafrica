# FairPlay — architecture (Phase 0 design)

The design FairPlay V1 is built to, pending Fola's approval at the Phase 0 gate. It
follows the PID (v1.0, 23 Oct 2026) and the repository as it is
([inventory.md](./inventory.md)); where they disagree, the difference and the choice are in
an [ADR](./adr/).

**V1 is shadow review and post-match evidence only.** Nothing in it talks to a referee,
changes a score, writes a ScoreBoard event or claims VAR/FVS status
([ADR-0001](./adr/0001-shadow-mode-only.md)).

---

## 1. Current state

```
 cameras ──► switcher / OBS ──► YouTube Live ──► public (SbLiveStream.youtubeUrl)
 (UNVERIFIED outputs)            (the only recording today is YouTube's)

 recorder's phone ──► match console (apps/web) ──► /api/v1/admin/match-stats ──► Postgres
                       localStorage drafts           sheet JSON → SbMatchEvent on approval

 Vision (separate): uploaded footage ──► R2 (master/derived) ──► worker (ffmpeg) ──► review
```

There is no venue-side recording under DTP control and no replay during a match.

## 2. Target state

```
 VENUE LAN (works with the internet down)
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │ ground cam ─┐                                                                 │
 │ drone ──────┼─(RTSP/SRT/RTMP, per-source publish credentials)─► MediaMTX      │
 │ programme ──┘   (whatever the equipment audit proves exists)    │ record fMP4 │
 │                                                                  │ playback   │
 │                                              127.0.0.1 only ──► │ API        │
 │                                                                  ▼            │
 │  switcher/OBS ──► YouTube (unchanged, independent)    fairplay-edge (FastAPI) │
 │                                                       ├ SQLite WAL: sessions, │
 │                                                       │ segments+SHA-256,     │
 │                                                       │ calibrations,         │
 │                                                       │ incidents, reviews,   │
 │                                                       │ audit chain, outbox   │
 │                                                       ├ ffprobe / ffmpeg clips│
 │                                                       └ serves local console  │
 │                                                                  ▲            │
 │   operator / assessor laptop ──── HTTPS (Caddy, local CA) ───────┘            │
 └───────────────────────────────────────────────┬──────────────────────────────┘
                                                 │ when online: device token
                                                 ▼
 CLOUD (existing, unchanged in size)
   /api/v1/fairplay/*  (NestJS module, same Postgres)
     ├ sync/batch     ← metadata only, idempotent
     ├ evidence/presign → short-lived presigned PUT ──► R2 fairplay-evidence (private)
     │                                                   ▲ Edge uploads bytes directly
     └ admin views, reports, presigned GET for authorised viewers
```

What crosses the WAN: kilobytes of JSON per incident, and the bytes of **approved evidence
clips only**, straight from Edge to R2. No video passes through EC2; no full match is
uploaded unless an admin turns it on for that session with a budget acknowledgement.

## 3. Components

| Component | Choice | Why this and not something smaller or homemade |
|---|---|---|
| Ingest, recording, recorded playback | **MediaMTX**, pinned (latest is v1.21.3 at the time of writing; pin chosen in Phase 1 after reading its release notes) | It already does multi-protocol ingest, per-path fMP4 recording with a stated recovery point (`recordPartDuration` = the RPO), a segment-complete hook, and a `/list` + `/get?start=&duration=` playback server that cuts a time window out of recordings without re-encoding. A homemade server would have to reimplement all of that and would fail in ways we have not met yet. MIT. |
| Edge API | **Python 3.12 + FastAPI + SQLite (WAL)** in `services/fairplay-edge` | PID baseline, and the repo already runs Python with ffmpeg subprocesses and pytest in CI. [ADR-0003](./adr/0003-edge-stack.md) records the Node alternative and why it lost. |
| Local console | Separate Vite/React build reusing `@dtp/ui`, served by the Edge | Same design language, no cloud dependency, no mixed content. [ADR-0004](./adr/0004-local-console-and-tls.md) |
| Local HTTPS | **Caddy** with its internal CA, root installed on DTP-owned operator devices | A browser treats `http://192.168.x.x` as insecure; a local CA avoids touching public DNS. Apache-2.0. |
| Clip / probe | `ffprobe`, `ffmpeg -c copy` first; re-encode only for slowed/zoomed derivatives | Stream copy keeps a clip byte-faithful to the camera's encode and costs almost no CPU. |
| Player | Native `<video>` on the MediaMTX `format=mp4` window, proxied through the Edge | Already the pattern in Vision's admin pages; add Video.js only if a measured need appears. |
| Cloud | New `fairplay` module in the existing NestJS API and Postgres | No second backend. [ADR-0002](./adr/0002-central-metadata-in-existing-api.md) |
| Evidence storage | Existing `R2ObjectStore`, new private bucket `fairplay-evidence`, presigned operations only | [ADR-0006](./adr/0006-evidence-storage.md) |
| Orchestration | Docker Compose on Linux; native binaries as services on Windows if the Edge machine is Windows | Decided when E7 in the equipment audit is answered. |

### MediaMTX settings that must not be left at their defaults

Read from the upstream `mediamtx.yml` and docs on 27 Oct 2026; re-check against the pinned
version.

| Setting | Upstream default | FairPlay | Why |
|---|---|---|---|
| `authInternalUsers` | an `any` user with **publish, read and playback from any IP** | no `any` user; one publish user per source (hashed, LAN-range `ips`), one `playback`+`api` user bound to `127.0.0.1` for the Edge API | The default lets anyone on the venue Wi-Fi publish into or watch any path. |
| `playbackAllowOrigins` | `["*"]` | `[]` and `playbackAddress: 127.0.0.1:9996` | Browsers never talk to MediaMTX; the Edge proxies with auth. |
| `api` / `metrics` | off | on, loopback only | Health comes from here. |
| `recordDeleteAfter` | **`1d`** | `0s` | The default deletes recordings after a day. Retention is the Edge's job, because only it knows which segments an incident protects. |
| `recordFormat` / `recordPartDuration` / `recordSegmentDuration` | fmp4 / 1s / 1h | fmp4 / 1s (measure) / 5–15 min (measure) | Shorter segments finalise and get hashed sooner. |
| `useAbsoluteTimestamp` | false | false unless the audit proves the source sends trustworthy absolute time | With `false`, recording time is MediaMTX's receive time; the time model treats that as `ingest_utc` and calibrates the camera offset on top. |
| Unused listeners (HLS, WebRTC, …) | on | off unless used | Fewer open ports on a shared venue network. |
| `runOnRecordSegmentComplete` | unset | calls the Edge with `MTX_SEGMENT_PATH` and `MTX_SEGMENT_DURATION` | Triggers hashing and the manifest row. A sweep on start-up catches anything finalised while the Edge was down. |

## 4. Browser security, pairing and offline identity

- **The cloud admin never loads LAN media.** `https://www.dtp.africa` shows FairPlay
  metadata, reports and presigned R2 evidence; for live work it shows a "open the venue
  console" link and the pairing state. No iframe, no `http://` media, no CSP change needed
  beyond what already allows R2.
- **The local console** is served from the Edge on its own HTTPS origin (Caddy, internal
  CA). On the Edge machine itself `https://localhost` is already a secure context. A
  second device needs the root certificate installed once, which is acceptable only on
  DTP-owned devices (E14). The alternative — a public certificate for a DTP subdomain
  pointing at a private IP — needs a DNS change and is out of scope without approval
  ([ADR-0004](./adr/0004-local-console-and-tls.md)).
- **Device pairing** copies Vision's worker identity: an admin registers an Edge device in
  the cloud and is shown a one-time bootstrap token; the Edge exchanges it for a device
  token, stored hashed in Postgres and in the OS keyring on the Edge. A device token can
  only sync and presign for sessions assigned to that device.
- **Offline operators.** Before the match, while online, the Edge downloads a **session
  credential bundle**: for each assigned person, their user id, name, FairPlay permissions,
  the session and match ids, an expiry (default 36 h) and a hash of a PIN they set, signed
  by the cloud's Ed25519 key. The Edge verifies the signature offline with the public key it
  was paired with. Operators sign in to the local console with email + PIN; the Edge issues
  a short local session cookie (`Secure`, `HttpOnly`, `SameSite=Strict`).
- **Revocation offline is limited, and that is stated, not hidden.** A user revoked in the
  cloud while the venue is offline keeps working at the venue until the bundle expires or
  a local FairPlay admin disables them on the Edge. Every action carries the actor and the
  bundle id; on reconnect the cloud **accepts and flags** actions by a then-revoked actor
  rather than dropping them, because dropping evidence is worse than flagging it.
- **The super-admin API key cannot act at the venue.** It has no user id, and every
  FairPlay act needs a named person (the `personFor()` rule).

## 5. Time model and contracts

Four clocks, never conflated:

| Clock | Meaning | Stored as |
|---|---|---|
| `edge_utc` | Edge wall clock (NTP when online; free-running offline) | `timestamptz` / ISO-8601 with ms |
| `edge_mono_ns` | Edge monotonic clock, for intervals that must survive a wall-clock step | integer ns |
| `ingest_utc` | When MediaMTX received a frame of a source (its recording timestamp) | from segment start + PTS |
| `source_pts` | The media timestamp inside a segment, in its time base | integer + time base |
| `match_clock` | Period + minute + second as the referee's game runs | `{period, minute, second}` |

Plus `cloud_offset_ms`: Edge clock minus `GET /api/v1/time`, measured whenever online,
which is what lets an Edge timestamp be compared with the match console's anchors.

**Mapping chain** (one direction, every step stored):

```
match_clock (period P, mm:ss)
  → event_utc       = period_start_utc[P] + elapsed      (period starts marked on the Edge;
                                                            console anchors used as a cross-check)
  → source window   = event_utc − camera_offset_ms[source]  ± uncertainty_ms[source]
  → MediaMTX /get?path=…&start=<window start>&duration=<pre+post roll>
```

**Calibration event** (append-only, supersede not edit): `{source_id, period, observed
edge_utc of a visible event (kick-off whistle, ball strike), the source time it appears at,
offset_ms, uncertainty_ms, method, actor_id, evidence frame ref}`. Required at kick-off and
half-time; prompted after any source reconnect.

**Failure states** the console must show, and the data must record:

| State | Trigger | Effect |
|---|---|---|
| `uncalibrated` | no calibration for this source and period | windows shown with a ±30 s default and a warning |
| `stale_after_reconnect` | source dropped and returned since last calibration | warning; recalibration prompt |
| `uncertainty_high` | `uncertainty_ms` > 500 | side-by-side alignment disabled; each angle on its own timeline |
| `clock_unsynced` | Edge has not seen NTP or the cloud clock this session | badge; every timestamp carries the flag |
| `clock_stepped` | wall clock jumped (monotonic vs wall disagree) | session marked; affected window recorded |
| `gap` | no segment covers part of a requested window | the gap is drawn; `footage_unavailable` offered |

Browser seeking lands on keyframes; nothing claims frame accuracy. Frame-exact extraction
is FP-13 (P1), done by ffmpeg on the Edge and returned with its source timestamp.

## 6. Threat model (V1)

| Threat | Example | Control |
|---|---|---|
| Unauthorised footage access at the venue | spectator on the same Wi-Fi opens a playback URL | MediaMTX playback on loopback only; console behind TLS + session; no `any` user; ingest ports accept per-source credentials from a LAN range only |
| Unauthorised footage access in the cloud | guessed R2 key; organiser sees another match | private bucket, random keys, presigned GET ≤ 5 min issued only after a permission + competition-scope check; every evidence read audited |
| Minors | a contested clip of a 15-year-old shared to social media | no public path at all in V1; external release blocked until rights/consent for the match is recorded (reuses Vision's rights policy, deny-beats-allow); clips watermarked with the viewer's id on export (P1) |
| Spoofed API requests | someone replays a sync batch, or posts as another device | device token per Edge, hashed at rest; batches signed by idempotency key and payload hash; a device may write only sessions assigned to it |
| Upload exfiltration | a stolen Edge laptop used to write into, or read out of, the bucket | the Edge holds **no R2 credentials**; presigned PUTs are per object, short-lived and limited to `sessions/{id}/` keys; device token revocable from the cloud |
| Source tampering | an original segment edited after the fact | SHA-256 on finalisation, recorded in the manifest and synced; derivatives carry their originals' hashes; audit entries hash-chained per device |
| Rogue LAN client | a laptop publishes a fake "ground" stream | per-source publish credentials; the console shows the publisher's IP and codec; unexpected codec/resolution change raises a health alert |
| Insider over-reach | an operator edits a finding after review | state machine with optimistic versions; reopen is an audited action; no update path for audit rows |
| Secrets leak | R2 key in a browser bundle or a livestream overlay | no R2 credentials on the Edge or in the browser; `.env.example` only; logs scrubbed |
| Footage to third-party AI | clip pasted into an external model | V1 has no AI path; FairPlay footage is excluded from the Vision corpus ([ADR-0007](./adr/0007-no-vision-training-path.md)) |

## 7. Cost impact

| Item | V1 | Monthly |
|---|---|---|
| EC2 | unchanged `t3.small`; FairPlay adds a few tables and light JSON routes | **+$0** |
| Postgres | KB per incident; a busy season is single-digit MB | +$0 |
| R2 storage, evidence only | e.g. 20 incidents × 40 s × 8 Mbps ≈ 0.8 GB/match; 10 matches ≈ 8 GB. Vision already uses part of the 10 GB free allowance, so assume it is paid: 8 GB × $0.015 | **≈ $0.12** |
| R2 operations | a few hundred Class A per match | ≈ $0 |
| Full-match upload | off by default. If enabled: ≈ 5.4 GB per camera per match at 8 Mbps | ≈ $0.08 per camera-match-month |
| GPU / managed video | none | $0 |
| Hardware | possibly an SSD after the write test; possibly capture hardware if E4 says programme only | one-off, decided after the audit |

R2 prices are the PID's figures (checked 23 Oct 2026) and must be rechecked before rollout.
A new bucket is free in itself, but creating it is a change to the Cloudflare account and
waits for approval.

## 8. Licence notice plan

Every new dependency gets a row in [`docs/licenses/OSS_REGISTER.md`](../licenses/OSS_REGISTER.md)
before it is used, in the register's existing format and status values:

| Component | Licence | Note |
|---|---|---|
| MediaMTX | MIT | pin by version and checksum of the release archive |
| FFmpeg / ffprobe | build-dependent | Edge uses the distribution's package as subprocesses, like the worker. Covered by the 4 Oct 2026 ruling **only while the Edge stays a DTP-owned machine**; an image or appliance handed to an organiser reopens it ([71](../vision/71-FFMPEG-LICENCE.md)) |
| Caddy | Apache-2.0 | |
| FastAPI, Starlette, Uvicorn, Pydantic | MIT / BSD-3 | |
| SQLite | public domain | |
| Video.js, rclone | Apache-2.0, MIT | only if adopted; neither is needed by this design |

The Edge build generates an SBOM (CycloneDX) and ships a `NOTICES` file in Phase 1.
