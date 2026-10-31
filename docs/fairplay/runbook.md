# FairPlay — monitoring and alert runbook

Increment 5.8 of the plan ([phase-plan.md](./phase-plan.md)). This covers what FairPlay
watches, what each alert means and what to do about it, and how long each failure takes to
recover from and what it loses. The residual risks for sign-off are in
[residual-risks.md](./residual-risks.md). Matchday procedures and the full incident-recovery
SOP are Phase 6.

Every number here was measured on synthetic feeds and this laptop's Docker
([phase-5-threat-review.md](./phase-5-threat-review.md), 5.2, 5.3 and 5.6), not at a venue.
`tests/test_runbook.py` checks that every alert the Edge can raise is in the table below.

## Who looks where

| Who | Where | What they see |
|---|---|---|
| Operator or assessor at the venue | the venue console | the header chip (Edge ok, degraded, critical or starting), each camera's card ("● Recording", "Connected, NOT recording", "Unavailable — no feed", and its alerts), the disk and clock banners, the cloud chip ("in sync", "N to send", "N need attention") |
| Edge admin at the venue | the console, and `GET /edge/v1/health`, `/alerts`, `/events`, `/outbox` | every open alert with its detail; acknowledges the alerts that wait for a person |
| Edge admin without a browser | `docker compose exec edge fairplay-edge api GET /edge/v1/health` on the Edge machine | the same, with the device token; works with the network cut |
| DTP FairPlay admin | `/admin/fairplay` in the cloud | each Edge's last contact and token expiry; each session's last sync, refused items and audit chain; evidence storage; requests and their withdrawals |

**Nothing pages anyone.** Alerts are shown in the venue console and kept in the Edge's
database. The cloud keeps no alert of its own. Someone has to be looking
([residual-risks.md](./residual-risks.md), R7).

## The Edge's health

`GET /edge/v1/health` and the console's header chip:

| Status | Meaning |
|---|---|
| `starting` | the Edge has not finished its first pass since it started (a backlog of files to hash can take minutes) |
| `ok` | no open alert, or only informational ones |
| `degraded` | at least one open warning |
| `critical` | at least one open critical alert |

A healthy match reads `ok`. Clear `degraded` and `critical` before kick-off where you can.

## The Edge's alerts

There are two kinds. A **condition** (a feed, the disk, the clock, the sync) clears by itself
when its cause goes. An **event** (something happened to a file or a sync item) stays open
until an Edge admin has dealt with it and acknowledges it, with a reason: `POST
/edge/v1/alerts/{id}/acknowledge`, or the button on the camera card. The acknowledgement is
in the audit chain. While an event alert is open, the same kind for the same camera does not
open again, so acknowledge it once it is dealt with (F25, fixed in 5.8).

| Alert | Severity | What it means | What to do | Clears |
|---|---|---|---|---|
| `media_server_down` | critical | The Edge cannot reach MediaMTX's API. MediaMTX does the recording, so it may not be recording. | `docker compose ps`; if `mediamtx` is not running, `docker compose up -d mediamtx`. A restart costs about 3 s of footage per camera (5.2 D3). | by itself, when the API answers |
| `source_disconnected` | critical for a required camera, warning for an optional one | The camera is not publishing. The card says "Unavailable — no feed". | Check the camera's power and cable or link, and its encoder. The drone is optional: the ground camera carries on. | by itself, when it publishes again (D2: 4.9 s after the camera returns) |
| `recording_stalled` | critical | The camera is connected but nothing has been written for `FAIRPLAY_RECORD_STALL_SECONDS` (6 s), or the disk is full. The card says "Connected, NOT recording". | Look at the disk banner first. Otherwise read `docker compose logs mediamtx` and restart MediaMTX. | by itself, when media is written again |
| `publisher_address_changed` | warning | The feed now comes from another network address. It may be a new encoder, or someone else publishing in the camera's place. | Check the camera's encoder. If it is the venue's own, an Edge admin presses "Confirm address" with the reason. Until then, do not trust new footage from it. | an Edge admin confirms it |
| `disk_soft_limit` | warning | Free space is below `FAIRPLAY_DISK_SOFT_FREE_GB` (20 GB). The banner gives the time left before the hard limit. | Plan to free space before the next match: `fairplay-edge retention` (preview), then apply it, or export and move old evidence. | by itself, when there is room |
| `disk_hard_limit` | critical | Free space is below `FAIRPLAY_DISK_HARD_FREE_GB` (5 GB). New sessions, clips, repaired copies and exports are refused with 507, to keep the space for recording. | Free space now. Recording carries on. | by itself, when there is room |
| `disk_full` | critical | Free space is below `FAIRPLAY_DISK_FULL_FREE_MB` (64 MB): no part can be written. Nothing is recorded on any camera, and every card says "Connected, NOT recording". | Free space at once. Recording resumes by itself (5.3: 8.2 s after space was freed). The time the disk was full is lost. | by itself, when there is room |
| `clock_stepped` | warning | The Edge's wall clock jumped by more than 1 s (a time daemon's correction, or someone setting the clock). | Note it against any incident flagged around then. Camera offsets are measured on the Edge's clock and still hold. | by itself, at the next clock sample without a jump (a minute) |
| `clock_not_synced` | warning | For at least `FAIRPLAY_CLOCK_SETTLE_SECONDS` (120 s), the kernel has said the clock has no time source, or has drifted past `FAIRPLAY_CLOCK_MAX_ERROR_MS` (1 s). The console shows an amber banner. | At a venue with no internet this is expected: compare kick-off and incident times with the match console. Otherwise check the time daemon (`timedatectl`, `chronyc tracking`) on the host. | by itself, when the clock is synchronised |
| `segment_partial` | warning | A recording file ended in the middle of a write: a feed drop, a MediaMTX restart or a power cut. Its whole fragments are kept and probed. | `POST /edge/v1/segments/{id}/repair` makes a playable copy and keeps the original. Note the gap if it matters, then acknowledge. | an Edge admin acknowledges it |
| `segment_corrupt` | warning | A recording file has no readable media. On a full disk these are the empty files the recorder kept opening (5.3). | Check the camera's gaps around that time (`/edge/v1/sources/{name}/gaps`): that footage is lost. Then acknowledge. | an Edge admin acknowledges it |
| `segment_missing` | critical | A file the Edge recorded and hashed is no longer on the disk. | Something deleted it: retention set wrongly, a person with the machine, or a failing disk. Check `/edge/v1/events` and the retention settings, and record what happened. Acknowledge once it is recorded. | an Edge admin acknowledges it |
| `segment_mismatch` | critical | A recording file no longer matches the SHA-256 recorded when it was finalised: it was changed, or the disk is failing. | Do not use that segment as evidence. Keep the machine as it is, and tell DTP. Run `fairplay-edge verify-all` to see how far it goes. Acknowledge once it is reported. | an Edge admin acknowledges it |
| `segment_video_gap` | warning | Pictures are missing at the start of a file (the encoder's first keyframe came late). The file is whole; the loss is stated. | Nothing, unless it repeats: then check the encoder's keyframe interval. | by itself, at the next file with no loss |
| `evidence_mismatch` | critical | An evidence clip or its manifest no longer matches its recorded hash. It is found when it is approved, exported or verified. | It cannot be approved or exported. Cut it again from the recordings while they are still kept (14 days), and report it as for `segment_mismatch`. Then acknowledge. | an Edge admin acknowledges it |
| `outbox_parked` | critical | The cloud refused some sync items (a conflict, or not this device's to send). They are kept, and not sent again. The cloud chip says "N need attention". | `GET /edge/v1/outbox` lists each parked item with the cloud's answer. The cloud's session page lists them as refused. Usually it is a session paired to the wrong match or device. Fix the cause with DTP. There is no route that sends a parked item again yet (R12). Acknowledge once it is reported. | an Edge admin acknowledges it |
| `outbox_stalled` | warning | The oldest item waiting to sync is more than 30 minutes old: the cloud has not been reached. | At a venue with no internet this is expected. Everything waits and is sent when the link returns (D1: 206 s after a 30-minute outage). Otherwise check the link and the device token. | by itself, at the next successful send |
| `device_token_expiring` | warning | The Edge's cloud token expires within 30 days. | A DTP admin re-pairs the device on the FairPlay page; the Edge runs `fairplay-edge pair` with the new bootstrap token. | by itself, once re-paired |
| `device_token_expired` | critical | The token has expired: nothing reaches the cloud. Recording and review at the venue carry on. | As for `device_token_expiring`, now. | by itself, once re-paired |

The console's other warnings are not alerts. The bundle expiring (nobody can sign in when it
expires) and evidence withheld (by the release gate) are shown where they apply.

## Signals in the cloud

The cloud raises no alert; these are what a DTP FairPlay admin checks on `/admin/fairplay`:

- **Edge devices.**
  - "Last seen": the last time the Edge reached the cloud. A device that is paired but
    silent for days with a match coming up needs a call to the venue.
  - "Token expires": amber within 30 days, red when expired. Re-pair it.
- **Each session's sync state** (the session page).
  - Last sync.
  - Refused items, with the cloud's message: they match the Edge's `outbox_parked`.
  - The audit chain: `ok`, `unverified` (an entry is still to arrive), or `break`. A
    `break` means an Edge audit entry did not recompute, or did not follow the last. Keep
    the Edge as it is and investigate.
- **Evidence storage.** Objects held, deleted under the 90-day rule and withdrawn on
  request, and the month's estimated cost.
- **Requests.** A withdrawal marked "waiting for the Edge to connect" means that Edge
  still holds the file. Follow it up if the Edge has not connected within a few days.
- **The cloud audit log** (`fairplay_audit_logs`; there is no page for it yet). Entries
  to look for:
  - `sync.chain_break`: as above;
  - `upload.corrupt`: an object that arrived damaged and was removed;
  - `sync.conflict` and `sync.rejected`: refused items;
  - `evidence.deleted` and `evidence.withdrawn`: what left the bucket, and why.

## Recovery time and recovery point

The recovery time (RTO) is from the failure ending, or the fix being made, to normal
service. The recovery point (RPO) is what was lost. The drills are D1–D5 in 5.2 and the
storage drill in 5.3, on synthetic feeds.

| Failure | Recovery time | Recovery point (what is lost) | A person must | Measured in |
|---|---|---|---|---|
| WAN or cloud unreachable, 30 min | 206 s from the link's return to an empty outbox | nothing: every record waits and is applied once; no footage leaves the venue anyway | nothing | 5.2 D1 |
| Drone feed drops for 60 s | 4.9 s from the camera's return to recording | the drop itself (59.4 s gap shown for 60.0 s); the ground camera has no gap | nothing | 5.2 D2 |
| MediaMTX restarted mid-match | 7.3 s to both cameras recording | about 3 s per camera (3.0 s, 3.1 s), each shown as a gap; no file overwritten | nothing (a crash inside the process restarts by itself) | 5.2 D3 |
| Edge API killed mid-sync | 11.2 s to the Edge answering, once started | nothing: recording never stopped; the outbox resumed | start it: `docker compose start edge` (a killed container does not restart by itself) | 5.2 D4 |
| Power cut, 15 s, whole stack | 32.3 s from the cut to both cameras recording | 20.4 s and 21.0 s: the 15 s off plus start-up; no records lost | start the stack: `docker compose up -d`, unless the host starts Docker and the stack at boot | 5.2 D5 (containers killed; a real power cut and UPS untested) |
| Disk below the soft or hard limit | none needed: recording carries on | nothing | free space (the hard limit refuses new files) | 5.3 |
| Disk full | 8.2 s from space being freed to both cameras recording, with no restart | everything while it was full (93.4 s and 98.9 s in the drill) | free space | 5.3 |
| An evidence upload cut halfway | resent whole on the next pass | nothing: one object per kind, no second record | nothing | 5.3 |
| Console laptop asleep or refreshed | at once (a refresh keeps the sign-in; after 30 idle minutes, sign in again) | nothing: recording never depends on the console | sign in again after a long sleep | 5.2 |
| Clock without a time source | not a stop: the warning appears after 120 s | nothing; wall times may be off, camera offsets hold | compare times with the match console | 5.6 |
| A clip withdrawn on request | the cloud's copy at once; the Edge's at its next connection (the bundle cadence, 5 min) | the clip, on purpose; its hash, reason and requester are kept | nothing more | 5.7 |

**Recordings' recovery point.** MediaMTX writes 1 s parts, so at most one part is lost
when it stops abruptly (0.29 s measured in Phase 1). Finalised files are read-only and
hashed, and re-hashed before any clip is cut or uploaded.

**Not measured:**
- a real power cut with the disk's write cache;
- a UPS;
- the host starting Docker at boot;
- restoring the Edge's database, or the cloud's FairPlay tables, from a backup (Phase 6.2);
- the cloud's own outage beyond the Edge's view of it.
