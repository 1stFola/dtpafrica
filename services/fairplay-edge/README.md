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

## The operator console (Phase 2)

The console (`apps/fairplay-console`) is served by the Edge at `/`, on the Edge's own origin,
under a Content-Security-Policy that allows that origin only: it needs no internet and loads
nothing from anywhere else. Build it before starting the stack:

```bash
pnpm --filter @dtp/fairplay-console build
```

Compose mounts `apps/fairplay-console/dist` read-only (`FAIRPLAY_CONSOLE_PATH` to change it).

**Who can sign in** comes from a signed operator bundle (ADR-0005), mounted read-only from
`./auth` (`FAIRPLAY_AUTH_DIR`): `trusted-keys.json` (public keys only) and `bundle.json`.
**Pairing with the DTP cloud** (Phase 4, `docs/fairplay/phase-4-cloud.md`). An admin adds the
device under `/admin/fairplay` and is shown a one-time bootstrap token. Save it to a file next
to `compose.yaml`, then, once:

```bash
docker compose run --rm -v "$PWD/auth:/pair-auth" -v "$PWD/bootstrap-token:/pair-token:ro" edge pair --url https://www.dtp.africa --bootstrap-token-file /pair-token --token-file /var/lib/fairplay/data/cloud-device-token --trusted-keys /pair-auth/trusted-keys.json
```

and delete the bootstrap token file. Then in `.env` set `FAIRPLAY_CLOUD_SYNC_URL`,
`FAIRPLAY_CLOUD_DEVICE_TOKEN_FILE=/var/lib/fairplay/data/cloud-device-token` and
`FAIRPLAY_BUNDLE_PATH=/var/lib/fairplay/data/bundle.json`, and restart. While online the Edge
fetches the signed bundle for the session the cloud assigned to it every five minutes (only a
bundle that verifies against `./auth/trusted-keys.json` is installed), syncs its outbox, and
uploads released evidence by presigned URL. A session opened while a cloud bundle is loaded
takes the cloud's session id, match and mode.

For development without the cloud, a **development** key and bundle can be made with
`fairplay-edge dev-keygen` and `fairplay-edge dev-bundle`; the Edge refuses them unless
`FAIRPLAY_ALLOW_DEV_BUNDLES=1`, and the console then shows *DEV CREDENTIALS — NOT FOR A REAL
MATCH* on every screen. Keep the dev signing key off the Edge: only the public key belongs in
`./auth`. Operators sign in with email and an 8-digit-or-longer matchday PIN (6 minimum).

**HTTPS on the venue LAN** (ADR-0004): `docker compose run --rm edge tls-init --host <edge-lan-ip>`
writes the Edge's own CA and server certificate under the data volume; set
`FAIRPLAY_EDGE_TLS_CERT`/`_KEY`, set `FAIRPLAY_EDGE_HOST_BIND` to the LAN address, and install
`ca.pem` once on each DTP-owned reviewer device. Without TLS the Edge only listens on this
machine (`127.0.0.1`, which browsers treat as secure).

What the console does: shadow banner on every screen; Edge clock, session, cloud/disk/clock
state; each source recording / not recording / unavailable; live preview (HLS through the
Edge, ≈ 3–7 s behind, measured); replay of any recorded window with ±10/30/60 s, ±0.1 s
nudges, a position slider, 0.5×/1× and 0.25× only when measured; go to a UTC time; flag an
incident now or at the replay position, with pre/post roll; per-source windows for an
incident; period marks; calibration by "this frame is the reference" → "same event here";
a synchronisation test; warnings in words for no footage, gaps, uncalibrated, stale after a
reconnect and an unconfirmed clock. Keys: `Space` play/pause, `1 2 3` back 10/30/60 s,
`, .` nudge, `S` speed, `F` flag, `I` latest incident, `L` live, `G D P` replay source, `?` help.

Phase 3 adds, per incident: its state (flagged → under review → reviewed → archived), a
bookmark from a match minute or a ScoreBoard event id, the shadow review form (four
results, factual notes, the evidence relied on), reopening with a reason (the earlier
finding is kept), evidence clips per camera with their job state, SHA-256 and coverage,
approval and export for admins, and the incident's audit trail. Per session: the footage
rights panel. Someone holding only `fairplay.report.view` (an organiser) gets a separate,
read-only report of completed findings and released evidence, and nothing of the venue.

**Who may do what** (permissions in the operator bundle):

| | operate | review | edge.admin | evidence.export | report.view only |
|---|---|---|---|---|---|
| sources, recordings, replay, live, incidents | ✓ | ✓ | ✓ | ✓ | — |
| flag and edit incidents, request clips, mark periods, calibrate | ✓ | | | | — |
| start, complete, archive and reopen reviews | | ✓ | | | — |
| record footage rights, read the whole audit log | | | ✓ | | — |
| approve evidence for release, export a package | | | | ✓ | — |
| completed findings and released evidence | ✓ | ✓ | ✓ | ✓ | ✓ |

A member with no permission sees nothing (Phase 2 let any member look).

## Using the API

Every route but `/edge/v1/healthz`, `/edge/v1/auth/status` and `/edge/v1/auth/login` needs a
signed-in operator's session cookie or `Authorization: Bearer $FAIRPLAY_EDGE_API_TOKEN` (the
device token, for the fixtures and this command line). Cookie requests that change anything
must also send `X-FairPlay-Request: 1`. From the Edge machine:

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
| `GET /edge/v1/auth/status`, `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`, `POST /auth/disable` | sign-in state (no names), PIN sign-in, the signed-in person, sign-out, local disable (offline revocation) |
| `GET/POST /edge/v1/sessions`, `GET /sessions/{id}`, `POST /sessions/{id}/end` | match sessions (`shadow` or `post_match` only) |
| `POST /edge/v1/sessions/{id}/periods`, `GET/POST /sessions/{id}/calibrations`, `GET /sessions/{id}/sync-test?at=` | period marks, per-source calibrations, the synchronisation test |
| `GET/POST /edge/v1/incidents`, `PATCH /incidents/{id}` (`If-Match`), `GET /incidents/{id}/windows` | incidents (a retention hold each), versioned edits, per-source windows with their flags |
| `GET /edge/v1/live/{source}/{file}` | live preview (MediaMTX HLS, proxied after authorisation) |
| `POST /edge/v1/incidents` (`Idempotency-Key`), `GET /incidents/{id}` | flag (now, at a time, at a match minute or a ScoreBoard event); one incident with its reviews, evidence, jobs and rights |
| `POST /edge/v1/incidents/{id}/review/start\|complete`, `/archive`, `/reopen` (all `If-Match`) | the review state machine; a stale version is a 409 |
| `GET /edge/v1/incidents/{id}/audit` | every audit entry about the incident, its reviews, evidence and jobs |
| `POST /edge/v1/incidents/{id}/clips`, `GET /jobs/{id}` | ask for an evidence clip of one camera (202 new, 200 the existing job); the job's state |
| `GET /edge/v1/evidence?incidentId`, `/evidence/{id}`, `/evidence/{id}/file`, `/evidence/{id}/manifest` | evidence and its manifest; organisers see released evidence only (404 otherwise) |
| `POST /edge/v1/evidence/{id}/approve`, `/export` | approve for release (needs the finding and the rights); download a zip of clip, manifest and `SHA256SUMS` |
| `GET/POST /edge/v1/sessions/{id}/rights` | the session's footage rights, appended and superseded, never edited |
| `GET /edge/v1/report/sessions`, `/report/sessions/{id}` | the organiser's report: completed findings and released evidence |
| `GET /edge/v1/audit`, `/audit/verify`, `GET /edge/v1/outbox` | the audit log and a walk of its hash chain (admin); the sync queue |
| `GET /edge/v1/clock`, `POST/GET /edge/v1/metrics/replay` | the Edge clock; replay time-to-playable as measured in the browser, with p50/p95 |

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

```bash
python -I fixtures/run_fixture.py evidence --project fp3
```

Each writes `fixtures/out/<scenario>-<UTC>/results.json` and `log.md`, with freshly generated
secrets, under its own Compose project (`fpfix`), and removes its volumes afterwards unless
`--keep` is passed. Run one at a time: they share the fixed subnet `172.31.250.0/24`.

The failure drills (Phase 5.2) run in sequence on the cut network, with a stand-in cloud
(`compose.drills.yaml`, `fixtures/drill_cloud.py`, TEST ONLY): WAN off, a drone drop,
MediaMTX restarted, the Edge killed mid-sync, and every container killed as a power cut.
About 50 minutes; `--wan-minutes 3` rehearses it in about 12. Besides `results.json` it
writes `drills.md`, the drill log with each drill's recovery time and recovery point. It
uses the built console in `apps/fairplay-console/dist` when there is one.

```bash
python -I fixtures/run_drills.py
```

The storage drill (Phase 5.3) puts the recordings on a 1 GB tmpfs (`compose.storage.yaml`,
TEST ONLY) and takes the disk under its soft and hard limits, then to full, then frees it.
About 6 minutes; `--browser-pause 600` holds at each stage until `continue-<stage>` appears
in the run's folder, for a look at the console.

```bash
python -I fixtures/run_drills.py storage
```

## Native install (no Docker)

Possible where Docker is unsuitable (for example UDP ingest on Windows): run MediaMTX's
release binary and `fairplay-edge serve` as services, render the config with
`fairplay-edge render-mediamtx --mode native`, which binds MediaMTX's API and playback to
127.0.0.1. Not exercised in Phase 1; decided once the Edge machine is known (equipment audit E7).
