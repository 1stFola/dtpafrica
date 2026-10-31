# FairPlay Edge — install, update and keep running

Increment 6.1 of the plan ([phase-plan.md](./phase-plan.md)): installing the Edge on the
venue machine, the ports and volumes it uses, how it starts at boot and is kept running, and
how it is updated and rolled back. Every setting is in
[edge-configuration.md](./edge-configuration.md). What each alert means is in
[runbook.md](./runbook.md). Matchday procedures are 6.3.

Nothing here deploys anything to DTP's cloud. The Edge runs at the venue, on its own.

## Requirements

- **The machine.** A Linux laptop or small PC with systemd. The scripts assume Ubuntu 24.04
  LTS. The real hardware is still to be chosen (equipment-audit.md), and 6.4 checks it.
- **Docker Engine** 24 or later with **Compose v2.24** or later, and the person installing
  in the `docker` group or using `sudo`.
- **Disk.** About 1.1 GB per camera-hour at 2.5 Mbit/s (a real camera's bitrate decides
  this), plus about 1 GB of images. The installer warns below 50 GB free. The Edge warns at
  20 GB and refuses new work at 5 GB.
- **A release.** A checkout of the release tag, and the console built into
  `apps/fairplay-console/dist` (`pnpm --filter @dtp/fairplay-console build`, done on the
  build machine if the Edge has no Node).
- **Disk encryption and a named custodian** for the machine (D12; residual-risks.md R19).
  This is set up with the machine, not by these scripts.

## Install

From `services/fairplay-edge` in the release checkout:

```bash
sudo deploy/install.sh --label "Edge laptop 1" \
     --lan-ip 192.168.10.2 --host 192.168.10.2 --host edge.venue.lan \
     --ingest-ip 192.168.20.2 --cameras 192.168.20.0/24
```

| Option | What it sets |
|---|---|
| `--label` | the Edge's name on the sign-in page and in reports |
| `--lan-ip` | the address reviewers' devices reach the console on; turns on TLS |
| `--host` | each name and address in the Edge's certificate; repeatable |
| `--ingest-ip` | the address cameras publish to: the Edge's address on the camera network |
| `--cameras` | the camera network: MediaMTX refuses a publisher from anywhere else |
| `--no-systemd` | start with `docker compose` only, with no boot units (tests) |

**What it does:**
1. Checks Docker, Compose, systemd and the disk.
2. Writes `.env` and `publish.env` from the committed examples, generating every secret
   locally (43 URL-safe characters each). The files are 0600, and no secret is printed.
3. Writes `config/sources.toml` from the example, if there is none. Check the sources.
4. Builds `dtp-fairplay-edge:<version>-<commit>` and pins `FAIRPLAY_EDGE_TAG` to it.
5. With `--lan-ip`, issues the Edge's TLS certificate and writes `venue-ca.pem`. Install that
   on every reviewer device as a trusted CA.
6. Installs and enables `fairplay-edge.service` (the stack at boot) and
   `fairplay-edge-watchdog.timer` (every minute), and enables Docker at boot.
7. Starts the stack and waits until the Edge is healthy.

**Safe to run again.** Existing secrets, settings and sources are kept; only what is missing
is added. A source added to `sources.toml` gets its publish password on the next run.

**Then:**
- Pair the Edge with the cloud (`fairplay-edge pair`, on the FairPlay page's bootstrap token),
  or install a DEV bundle for a rehearsal.
- Give each camera its publish URL, `rtsp://pub-<source>:<password>@<ingest-ip>:8554/<source>`.
  The password is in `publish.env`.

## Ports

| Port | Bound to | Who reaches it | Notes |
|---|---|---|---|
| 8554/tcp (RTSP) | `--ingest-ip` | cameras and encoders on the camera network | publish only, with each source's password, from `--cameras` only |
| 8443/tcp (HTTPS) | `--lan-ip` | reviewers' devices on the venue LAN | the console and the API; TLS; only the certificate's host names answered |
| 9997, 9996, 8888 | not published | the Edge's container only | MediaMTX's API, playback and HLS, on the stack's own network |
| outbound 443 | — | the Edge to the DTP API and the R2 bucket | only when the cloud is configured; uploads only to `FAIRPLAY_UPLOAD_HOSTS` |
| outbound 123/udp | — | the host's time daemon | NTP; offline, the Edge warns (5.6) |

Nothing else listens. The camera network and the reviewers' LAN should be separate networks
(residual-risks.md R1).

## Volumes

| Volume | Holds | Notes |
|---|---|---|
| `recordings` | every camera's recordings, `<source>/<UTC time>.mp4` | kept 14 days when retention is on (D9) |
| `data` | `edge.sqlite3`, manifests, evidence clips, export packages, `tls/`, `backups/` | the Edge's record; 6.2 covers its backup and restore |
| `mtxconfig` | MediaMTX's rendered configuration | rebuilt from `sources.toml` at each start |

`docker compose down` keeps them. **`docker compose down -v` deletes every recording.**

## At boot, and kept running

- **At boot.** `fairplay-edge.service` runs `docker compose up -d` after Docker starts. At
  shutdown it runs `docker compose stop`, which gives MediaMTX 15 s to close the open file
  and the Edge 30 s to finish a hash.
- **Crashes.** Docker restarts a crashed container (`restart: unless-stopped`).
- **The watchdog** (`fairplay-edge-watchdog.timer`, every minute, `deploy/watchdog.sh`):
  - starts MediaMTX and the Edge again if either is not running. That covers a killed
    container, which Docker does not bring back (5.2 D4);
  - restarts an Edge that has been unhealthy for three passes in a row. It never restarts
    MediaMTX for that, because recording must not stop for the API.
- **Maintenance.** `deploy/maintenance on "<reason>"` before stopping anything on purpose, and
  `deploy/maintenance off` after. While it is on, the watchdog leaves the stack alone.

## Update

```bash
git fetch && git checkout <release tag>      # and build or ship its console
sudo deploy/update.sh
```

**What it does:**
1. Puts the stack in maintenance.
2. Refuses to go on if MediaMTX's pinned image changes while a session is open: a MediaMTX
   restart costs about 3 s of every camera. Update after the match, or pass `--force`.
3. Backs up the Edge's database (SQLite's online backup) to `data/backups/`.
4. Builds the new image and restarts the Edge on it. MediaMTX keeps recording throughout;
   it restarts only if its own image changed.
5. Waits up to 120 s (`UPDATE_HEALTH_SECONDS`) for the Edge to be healthy.
6. **If it is not:** puts the old image tag back, restores the database from the backup,
   restarts, and exits with 3. If even that is unhealthy, it leaves the stack in maintenance
   and exits with 1, for a person.
7. Ends maintenance.

**Rolling back by hand:** set `FAIRPLAY_EDGE_TAG` in `.env` to the previous tag, then
`docker compose up -d edge`. The database is restored only by `update.sh`, from its backup.
A newer database is refused by an older Edge ("database schema is newer"), so after a
schema change, a hand rollback needs the backup restored too.

## Tested (31 Oct 2026)

On this laptop's Docker, from a fresh copy of the release: no `.env`, no `publish.env`, no
`sources.toml`, no `auth/`. The synthetic cameras were on, and the stack ran as its own
Compose project.

| Check | Result |
|---|---|
| `deploy/install.sh --no-systemd` | installed in 67 s; the Edge healthy; both cameras recording; the image `dtp-fairplay-edge:0.1.0-local` |
| `docker kill` the Edge and MediaMTX, then one watchdog pass | both running again |
| maintenance on, `docker kill` the Edge, a watchdog pass | left stopped; after maintenance off, the next pass started it |
| `deploy/update.sh` to 0.1.1 | database backed up, the Edge on 0.1.1 and healthy, maintenance off (72 s) |
| `deploy/update.sh` to a 0.1.2 whose health check always fails | rolled back: 0.1.1 healthy, the database restored, exit 3 |
| `deploy/update.sh` changing MediaMTX's image with a session open | refused before changing anything, exit 1 |
| `deploy/install.sh --no-systemd --lan-ip 127.0.0.1 --host localhost --host edge.test.lan`, fresh copy | installed with TLS. A strict client trusting only `venue-ca.pem` reached the Edge; another host name got 400; a client without the CA was refused; `curl` reached it as `edge.test.lan` |
| `tests/test_install.py` (render only) | every secret generated, never printed, 0600; settings the Edge accepts; secrets kept on a second run; a placeholder refused; a new source gets its password |

**Found and fixed while testing:**
- **F26 (medium): the Edge's certificates had no key identifiers.** The server certificate
  lacked the Authority Key Identifier, which RFC 5280 requires, and both certificates lacked
  Subject Key Identifiers. Strict clients refused the chain: Python 3.13's default
  verification failed with "Missing Authority Key Identifier", so some reviewer devices or
  tools could have refused the console. `test_tls.py` had not caught it, because the Edge
  image's Python 3.12 does not verify strictly by default.
  - **Fix:** `tlsgen.py` now adds both identifiers, and the server's key usage.
  - **Test:** the TLS tests verify as a strict client does. Without the fix they fail.
  - **Existing installs:** an Edge with an older certificate gets the fixed one from
    `fairplay-edge tls-init` again. The CA, and so the devices' trust, is kept.
- **Windows' own `curl` (schannel)** also wants revocation data, which a private CA does not
  publish; `--ssl-no-revoke` skips it. Browsers treat a private CA's missing revocation data
  as a soft failure. Reviewer devices are B12.
- **Installer bugs:**
  - CRLF line ends from a Windows checkout ended up inside generated values, so publish
    passwords were never generated and the version tag broke;
  - a failed disk check stopped the install silently;
  - `docker compose build edge` built nothing, because the build belongs to `init`.

  All three are fixed, and the real install runs above passed with the fixes.
  `test_install.py` also checks that no generated file carries a carriage return.

**Not tested:**
- **The systemd units on a real Ubuntu host:** start at boot, stop at shutdown, the timer.
  They are rendered and checked for their paths, but not run under systemd here.
- **A real camera network,** and the venue's addresses.
- **Reviewer devices' browsers** with `venue-ca.pem` installed (B12).

These are on the 6.4 hardware checklist.

## Handover for 6.1 (prompt pack section K)

```text
DTP FAIRPLAY | PHASE 6.1 DELIVERY
STATUS: complete on this laptop's Docker; the systemd units untested on a real host; found and fixed F26 (medium)

REPOSITORY FACTS CONFIRMED
- Existing patterns used: compose.yaml's pinned MediaMTX digest, the base image digest and constraints.txt; the Edge's health check, store migrations and tls-init
- Hardware facts actually verified: none (the venue machine is not chosen)
- Unknowns remaining: the venue machine and its OS; the venue's addresses and names; reviewer devices (B12)

IMPLEMENTED
- Code paths changed: deploy/install.sh, update.sh, watchdog.sh, maintenance, systemd/ (new); tlsgen.py (key identifiers, F26); .env.example (FAIRPLAY_EDGE_TAG, FAIRPLAY_ALLOW_DEV_BUNDLES); .gitattributes (LF for deploy/); tests test_install.py and test_configuration_reference.py (new), test_tls.py (strict client); docs edge-install.md and edge-configuration.md (new)
- APIs and migrations: none
- Local/Cloud config: none new; every setting now documented and checked

SECURITY + COST
- Auth and evidence changes: secrets generated on the machine, 0600, never printed; certificates now RFC 5280-complete
- New dependencies and license: none (bash, Docker, systemd on the host)
- New recurring cost: $0

TEST EVIDENCE
- Commands actually run: see "Tested" above
- Passed / failed / untested: install (plain and TLS), watchdog, maintenance, update, rollback and the MediaMTX refusal all as expected on a fresh copy; the tests as in the PR. Untested: systemd on a real host, a real camera network, reviewer browsers
- Measured replay/CPU/RAM/SSD outcomes: install 67 s, update 72 s, a failed update rolled back in 157 s (with a 40 s health window)

RISKS, ROLLBACK, NEXT GATE
- Blocking defects: none found
- Steps to revert safely: revert the commit; installed hosts keep running (disable the units with systemctl if wanted)
- Human approvals required: the venue machine and OS (6.4); Fola's decisions on the residual risks
- Proposed next phase: 6.2, backup and restore
```
