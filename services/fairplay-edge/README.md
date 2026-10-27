# DTP FairPlay Edge

The venue-side service for DTP FairPlay: MediaMTX records each camera feed on its own, and
the Edge indexes, hashes and watches what it records, behind a protected local API. Runs on
a DTP-owned machine at the venue. **Never deployed to EC2**, never uploads video, never
encodes or transcodes a recording.

Design: [docs/fairplay](../../docs/fairplay/README.md). Phase 1 report and test log:
[docs/fairplay/phase-1-edge-foundation.md](../../docs/fairplay/phase-1-edge-foundation.md).

> **Status: Phase 1, tested on synthetic feeds only.** No real camera, drone, switcher or
> encoder has been connected. Hardware acceptance is **pending** the equipment audit.

---

## What runs

| Service | Image | Role | Reachable from |
|---|---|---|---|
| `init` | `dtp-fairplay-edge` | Renders MediaMTX's hardened config from `sources.toml`, then exits | — |
| `mediamtx` | `bluenviron/mediamtx:1.21.3` (pinned by digest) | Ingest, fMP4 recording of every configured source, playback | RTSP ingest on `FAIRPLAY_INGEST_BIND:8554`; its API and playback only from the Edge's container address, with the Edge's credentials |
| `edge` | `dtp-fairplay-edge` | Manifest scanner, watchdog, retention, `/edge/v1` API | `FAIRPLAY_EDGE_HOST_BIND:8443` (127.0.0.1 by default; anything else requires TLS) |
| `synth-ground`, `synth-drone` | `dtp-fairplay-edge` | **Synthetic** test feeds, `synthetic` profile only | — |

The YouTube broadcast is not part of this stack. The encoder must publish to YouTube
directly and to MediaMTX as a separate output, so nothing here can interrupt it.

## Install (Docker Compose)

Requirements: Docker with Compose v2.24+, about 1 GB of images, and disk for recordings
(about 1.1 GB per source-hour at 2.5 Mbit/s; a real camera's bitrate decides this).

```bash
cd services/fairplay-edge
cp .env.example .env                       # fill every CHANGE_ME
cp publish.env.example publish.env         # one password per source
cp config/sources.example.toml config/sources.toml
docker compose up -d --build
```

Generate each secret with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

The Edge and the renderer **refuse to start** on a missing, short (< 24 characters) or
placeholder secret, on an empty publish-network list, or on a non-loopback API bind without TLS.

**Cameras and encoders publish to** `rtsp://pub-<name>:<password>@<edge-lan-ip>:8554/<name>`,
after `FAIRPLAY_INGEST_BIND` is set to the Edge's venue-LAN address. Only protocols the
venue hardware is verified to send should be enabled in `sources.toml`.

**Stop safely:** `docker compose stop` gives MediaMTX 15 s to close the open segment and the
Edge 30 s to finish a hash and close SQLite. `docker compose down` keeps the volumes;
`down -v` **deletes every recording**.

### Volumes and folders

| Volume | Mounted at | Holds |
|---|---|---|
| `recordings` | `/recordings` (MediaMTX), `/var/lib/fairplay/recordings` (Edge) | `<source>/<YYYY-MM-DD_HH-MM-SS-ffffff_+0000>.mp4`, written by MediaMTX |
| `data` | `/var/lib/fairplay/data` | `edge.sqlite3` (WAL), `manifests/<source>/<segment>.json`, `repaired/<source>/<segment>.repaired.mp4` |
| `mtxconfig` | `/etc/mediamtx` | the rendered `mediamtx.yml` (passwords hashed) |

Names come from MediaMTX's receive time in UTC, and from source names only, never from a
match or team name, which get corrected.

## Using the API

Every route but `/edge/v1/healthz` needs `Authorization: Bearer $FAIRPLAY_EDGE_API_TOKEN`.
From the Edge machine:

```bash
docker compose exec edge fairplay-edge api GET /edge/v1/health
```

| Route | Answers |
|---|---|
| `GET /edge/v1/health` | overall status, media server, disk, per-source publishing/recording, last final segment, segment counts, open alerts |
| `GET /edge/v1/sources`, `/sources/{name}` | publishing, **recording (evidence-based)**, tracks and codec properties, bytes received, current and last final segment |
| `GET /edge/v1/sources/{name}/spans?start&end` | recorded time spans (MediaMTX playback index; the manifest if MediaMTX is down) |
| `GET /edge/v1/sources/{name}/gaps?start&end` | intervals with no recording, and drops the watchdog saw |
| `GET /edge/v1/sources/{name}/window?start&durationMs` | coverage of a window, the original segments it comes from with their SHA-256, and its playback path |
| `GET /edge/v1/media/{name}?start&durationMs` | the window as MP4, proxied from MediaMTX after the token check (≤ 10 minutes) |
| `GET /edge/v1/segments`, `/segments/{id}` | the manifest index; one segment's full manifest |
| `POST /edge/v1/segments/{id}/verify` | re-hash against the manifest |
| `POST /edge/v1/segments/{id}/repair` | partial segments only: a separate, whole derivative; the original is untouched |
| `GET /edge/v1/alerts?state=open\|all`, `/events` | watchdog alerts; the append-only event log |
| `GET/POST /edge/v1/holds`, `POST /holds/{id}/release` | protect a time range from retention; release with a reason |
| `GET /edge/v1/retention/plan?days=N` | what a rule would delete; retention itself is off by default |
| `GET /edge/v1/disk`, `/openapi.json` | free space and thresholds; the API schema (authenticated) |

## Tests

Unit tests (no Docker, ffmpeg or MediaMTX needed; Python 3.12 as in CI):

```bash
pip install -c constraints.txt -e ".[dev]"
```

```bash
pytest -v -rs
```

Recording fixtures (real MediaMTX and ffmpeg in Docker, synthetic feeds only):

```bash
python -I fixtures/run_fixture.py core
```

```bash
python -I fixtures/run_fixture.py wan --minutes 30
```

Each writes `fixtures/out/<scenario>-<UTC>/results.json` and `log.md`, with freshly generated
secrets, under its own Compose project (`fpfix`), and removes its volumes afterwards unless
`--keep` is passed. Run one at a time: they share the fixed subnet `172.31.250.0/24`.

## Native install (no Docker)

Possible where Docker is unsuitable (for example UDP ingest on Windows): run MediaMTX's
release binary and `fairplay-edge serve` as services, render the config with
`fairplay-edge render-mediamtx --mode native`, which binds MediaMTX's API and playback to
127.0.0.1. Not exercised in Phase 1; decided once the Edge machine is known (equipment audit E7).
