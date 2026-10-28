# FairPlay Phase 1 — Edge media foundation

**DTP FAIRPLAY | PHASE 1 DELIVERY**
**STATUS: partial — complete on synthetic feeds; hardware acceptance PENDING.**

The venue-local recording foundation: pinned MediaMTX records each source on its own, and
a new Edge service (`services/fairplay-edge`) hashes every finalised segment into a durable
manifest, watches source, recorder, disk and media-server health, and serves a protected
local API. No real camera, drone, switcher or encoder has been connected: the equipment
audit is unanswered, so every test below ran on **synthetic test-pattern feeds**, and the
prompt's own rule applies — real-video acceptance is not claimed.

No central ScoreBoard API, schema, environment or cloud resource changed.

---

## Repository facts confirmed

- **Existing patterns used.** Python package layout, setuptools, pytest and the
  `python:3.12-slim` + Debian `ffmpeg` image shape from `services/vision-worker`; ffmpeg and
  ffprobe run as separate programs, never linked (the basis of the existing FFmpeg ruling);
  an unprivileged fixed-uid container user; the Vision `refusal()` error shape for the API;
  flat, append-only event rows; supersede-not-edit; RFC 3339 UTC with milliseconds.
- **Phase 0 decisions taken as approved for this phase.** The Phase 1 prompt names Python
  FastAPI + SQLite WAL as the default (ADR-0003, gate decision 3) and single-angle as the
  default until ISO feeds are proven (ADR-0008, gate decision 1). Neither has an explicit
  sign-off from Fola yet; both are recorded here as taken *for Phase 1 only*.
- **Hardware facts verified.** None.
- **Unknowns remaining.** Every row of the [equipment audit](./equipment-audit.md),
  including which protocols the real feeds use, their codecs and bitrates, and the Edge
  machine itself.

## Implemented

### Code paths

| Path | What |
|---|---|
| `services/fairplay-edge/fairplay_edge/config.py` | Settings from `FAIRPLAY_*` env, sources from TOML; refuses weak secrets, non-loopback without TLS, bad sources |
| `…/mediamtx_config.py` | Renders MediaMTX 1.21.3's config with every unsafe default overridden (below) |
| `…/naming.py`, `mp4.py` | Segment names → UTC; fMP4 box walk that tells whole from torn files without decoding |
| `…/probe.py` | ffprobe summary (codec, profile, size, fps, time base, start PTS, duration, audio) and SHA-256 |
| `…/manifest.py` | Discovery, finalisation rule, manifest row + JSON sidecar, verification |
| `…/watchdog.py` | Alerts and feed intervals; evidence-based `recording` |
| `…/retention.py`, `repair.py` | Holds, bounded retention (off by default), repair-as-derivative |
| `…/api.py`, `service.py`, `__main__.py` | `/edge/v1` API, background loop, CLI |
| `…/synth.py` | **Synthetic** feed generator (development only; the only encoder in the package) |
| `services/fairplay-edge/Dockerfile`, `compose.yaml`, `compose.wan-outage.yaml` | Image, venue stack, WAN-outage override |
| `services/fairplay-edge/.env.example`, `publish.env.example`, `config/sources.example.toml`, `constraints.txt` | Settings, credentials split, sources, exact dependency versions |
| `services/fairplay-edge/tests/` | 94 unit tests |
| `services/fairplay-edge/fixtures/run_fixture.py` | Recording fixtures: `core` and `wan` |
| `.github/workflows/ci.yml` | Edge unit tests added to `verify` |
| `docs/licenses/OSS_REGISTER.md` | New "FairPlay Edge" section; all rows REVIEW REQUIRED |
| `docs/fairplay/adr/0011-recording-independent-of-the-edge.md` | Recording and finalisation decisions |

### API routes (Edge only, `/edge/v1`)

`healthz` (liveness, no auth) · `health` · `disk` · `sources` · `sources/{name}` ·
`sources/{name}/spans` · `sources/{name}/gaps` · `sources/{name}/window` ·
`media/{name}` · `segments` · `segments/{id}` · `segments/{id}/verify` ·
`segments/{id}/repair` · `alerts` · `events` · `holds` · `holds/{id}/release` ·
`retention/plan` · `openapi.json` (authenticated). Details in the
[service README](../../services/fairplay-edge/README.md#using-the-api).

**No cloud route, no schema migration.** The Edge's SQLite schema is version 1, created on
first start.

### MediaMTX defaults overridden

Read from the 1.21.3 image's own `mediamtx.yml`:

| Upstream default | FairPlay |
|---|---|
| `any` user may publish, read and play back from any IP | no `any` user; one publish user per source limited to its own path and to `FAIRPLAY_PUBLISH_ALLOWED_CIDRS`; one Edge user (API + playback) limited to the Edge's container address |
| RTSP, RTMP, HLS, WebRTC, SRT and MoQ all on | only the protocols `sources.toml` uses (RTSP for the synthetic feeds); HLS, WebRTC, MoQ, metrics and pprof always off |
| `playbackAllowOrigins`, `hlsAllowOrigins`, `webrtcAllowOrigins`, `moqAllowOrigins`: `["*"]` | `[]` where the listener exists; the others are off |
| `overridePublisher: true` (a second client takes over a path) | `false` |
| `recordDeleteAfter: 1d` | `0s`; retention is the Edge's |
| `record: false` | `true` for configured paths only; any other path is refused |
| `rtspTransports: [udp, multicast, tcp]` | `[tcp]` |
| passwords in plain text | `sha256:` hashes; no plaintext in the rendered file |

API (9997) and playback (9996) are not published to the host at all.

### Environment settings

All in [`.env.example`](../../services/fairplay-edge/.env.example) and
[`publish.env.example`](../../services/fairplay-edge/publish.env.example). Secrets:
`FAIRPLAY_EDGE_API_TOKEN`, `FAIRPLAY_MEDIAMTX_PASSWORD`, `FAIRPLAY_PUBLISH_PASSWORD_<SOURCE>`.
Publish passwords are given only to the config renderer and the synthetic feeds; the Edge
API container never holds them.

### Human setup tasks

1. Answer the [equipment audit](./equipment-audit.md); until then nothing here is accepted on real hardware.
2. Decide the licence-register rows added for the Edge, in particular **FFmpeg 7.1 (Debian 13)**,
   a different build from the one the 4 Oct ruling cleared.
3. Choose the Edge machine (E7) and enable full-disk encryption on it (Phase 1 prerequisite P7).
4. Confirm gate decisions 1 and 3, taken as defaults for this phase.

## Test evidence

Environment: Windows 11, Docker Engine 29.8.0 (Docker Desktop, 3.65 GiB VM), images
`dtp-fairplay-edge:local` (python:3.12-slim, Debian 13, ffmpeg 7.1) and
`bluenviron/mediamtx:1.21.3@sha256:59e43552…`. Synthetic feeds: 1280×720, 25 fps, H.264
(libx264, 2-second GOP, 2.5 Mbit/s cap); the ground feed carries AAC audio, the drone none,
and the drone's burned clock runs 400 ms behind.

### Commands actually run

```bash
pip install -c constraints.txt ".[dev]" && python -m pytest -q -rs
```

**94 passed** (Python 3.12.15 in a clean `python:3.12-slim` container, at commit `6264f31`).

```bash
python -I fixtures/run_fixture.py core
```

**28 passed, 0 failed** (27 Oct 2026, 23:30–23:37 UTC; `fixtures/out/core-20261027T233058Z/`).

```bash
python -I fixtures/run_fixture.py wan --minutes 30 --keep
```

**15 passed, 0 failed** (27 Oct 2026 23:37 – 28 Oct 00:09 UTC; `fixtures/out/wan-20261027T233749Z/`).

### Against the prompt's required tests

| Required test | Result | Evidence |
|---|---|---|
| Ingest and record source A and B independently | **PASS** (synthetic) | both sources publishing and recording; finalised segments per source with their own codec facts (ground with audio, drone without) |
| Disconnect one source without stopping the other | **PASS** (synthetic) | drone stopped 28.6 s: one 27.8 s gap in the drone's recordings, a closed feed interval, a `source_disconnected` warning opened and resolved; the ground's segment kept growing and its recordings show no gap. In the WAN drill: a 63.7 s stop gave one 62.2 s drone gap and no ground gap |
| A recorded time-span playback URL is valid and references exact source windows | **PASS** (synthetic) | a 10 s window at a known instant: coverage `full`, the original segment(s) named with their SHA-256, and the playback URL returned a complete MP4 of 10.02 s that ffprobe reads |
| Restart the Edge; finalised recordings stay accessible | **PASS** (synthetic) | after `docker compose restart edge`: all 9 previously finalised segments listed with the same hashes, 10/10 re-hash, the same window still plays, MediaMTX was not restarted, and the ground has no gap across the restart |
| Verify health status and checksums | **PASS** | `verify-all`: 15/15 (core), 121/121 (WAN drill) |
| Zero use of AWS, GPU or video transcoding | **PASS** | no device or GPU reservation on either container; no `ffmpeg` process in the Edge container (recordings are only probed); no AWS/R2 credential in the Edge's environment; MediaMTX at 2–4 % CPU against 20–54 % for the synthetic encoders, i.e. it stores what it receives |
| 30-minute simulated WAN outage | **PASS** (synthetic) | stack on a Docker network with no route out (`internal: true`, nothing published); `check-egress` unreachable at start and end; ground recorded 30 min with no gap through a 60 s drone drop and an Edge restart; 61 + 60 final segments |
| Real camera, drone, switcher or encoder | **NOT TESTED — PENDING** | no hardware facts are verified (equipment audit) |

### Measurements

| What | Measured | Notes |
|---|---|---|
| Footage lost to SIGKILL of MediaMTX | **290 ms** | kill at 23:35:23.131; the open segment kept 8.854 s of 9.144 s elapsed. Within one part (1 s), as MediaMTX documents |
| State of the segment open at the SIGKILL | `finalized` (whole) | the file ended on a complete fragment. Torn-tail detection and repair were therefore exercised only by the unit tests in this run, not by a real crash |
| Docker restart after `docker kill` | **not restarted** | `restart: unless-stopped` treats a kill as a manual stop; the fixture started it by hand. A crash inside the process would restart it. The watchdog raised `media_server_down` within the poll interval, which is the protection that matters |
| Hash time per segment | median 3 ms (2.9 MB, core), 8 ms (9.8 MB, WAN); max 317 ms | read through the OS cache; a 5-minute segment at a camera's ~8 Mbit/s (~300 MB) would take well under a second at the observed ~800 MB/s |
| Probe + structure check per segment | median 103 ms, max 217 ms | ffprobe dominates |
| Edge API CPU / memory | 0.2 % / 56 MiB (core) → 7.3 % / 194 MiB at the end of the drill | the end-of-drill sample was taken during `verify-all` re-hashing 121 files |
| MediaMTX memory | 28 MiB (core) → **585 MiB** at the end of the 30-min drill | **not explained yet.** Likely the page cache of written recordings counted against the container, but unverified; a soak test on the real Edge machine must watch it |
| Recording rate (synthetic) | ~9.8 MB per 30 s segment ≈ 2.6 Mbit/s per source | a real camera's bitrate decides disk use |

### Segment and part durations chosen

- **Part 1 s** (MediaMTX's recovery point): the measured crash loss was 0.29 s.
- **Segment 5 minutes** (default, `FAIRPLAY_RECORD_SEGMENT_DURATION`). Hashing and probing
  are cheap, so the duration trades only the wait for a segment's hash against the number
  of files: about 22 files per source per match at 5 minutes. Replay does not wait for
  finalisation: the playback server served a window spanning a finalised segment and the
  one still being written (15 s in 260 ms). The fixtures use 30 s so a run finalises many
  segments; the drill's 121 segments behaved the same.

## Acceptance checklist

- [x] Reproducible install: Compose, `.env.example`, `publish.env.example`, sources file, persistent volumes, graceful stop.
- [x] Configurable source names → MediaMTX paths; ground required, drone and programme optional.
- [x] Synthetic feed generator, clearly labelled not for production.
- [x] Independent fMP4 recording per source; recording reported from evidence, not from a connection.
- [x] Protected Edge API: status, recording, spans, free disk, dropped intervals, last final segment, codec/fps, health.
- [x] Durable manifest (SQLite + JSON sidecar) with SHA-256, times, PTS data, size, codec, source, state; partial/corrupt flagged; repair as a separate derivative.
- [x] Watchdog: disconnect, disk thresholds, recording stalled, media server down.
- [x] Bounded retention that never deletes held, open or unsynced-evidence segments; off by default.
- [x] Media API and playback on the internal network only; no wildcard CORS; LAN exposure refused without TLS.
- [x] Fixtures: independent streams, reconnect, 30-minute WAN outage — run, with results above.
- [ ] **Real hardware acceptance — pending the equipment audit.**
- [ ] **Licence rows cleared, including FFmpeg 7.1** (B9, B10).

## Budget impact

**$0 recurring.** Nothing runs in the cloud; no AWS, R2 or GPU resource was created or
used. Downloads, approved for this phase: the MediaMTX image (28.8 MB), Debian's ffmpeg
packages and the pinned PyPI packages, all into local Docker images.

## Known blockers

B1 hardware unknown · B2 rights for real fixtures · B3 Edge machine not chosen · B9 FFmpeg
7.1 build not yet cleared · B10 Edge licence rows ([blockers.md](./blockers.md)). Plus the
unexplained MediaMTX memory growth above, to be measured on the real machine.

## Next phase prerequisites

Phase 2 (local replay console) can start on the synthetic recordings kept from the WAN drill
(`--keep`). It needs: an operator-bundle signing approach for development until the cloud
issues bundles (ADR-0005), and the `cryptography` package for signatures and the Edge's
own certificate authority (ADR-0004).

## Rollback

The Edge is a separate stack on a separate machine. `docker compose down` stops it without
touching the encoder or YouTube; `docker compose down -v` also deletes its recordings and
database. In the repository, reverting the Phase 1 commit removes `services/fairplay-edge`,
the CI step and the register rows; nothing else depends on them.
