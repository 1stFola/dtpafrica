# FairPlay — residual risks for sign-off

Increment 5.8 of the plan ([phase-plan.md](./phase-plan.md)): what remains after Phase 5,
for Fola to accept, or to send back to be fixed, before the pilot. It is gathered from:
- the threat review ([phase-5-threat-review.md](./phase-5-threat-review.md), 5.1 to 5.7);
- the blockers ([blockers.md](./blockers.md));
- the decisions still open ([decisions.md](./decisions.md)).

Every high finding is fixed: F1, F2's software half, F3 and F21. Nothing below is
critical.

**What Phase 5 established, on synthetic feeds:**
- The failure scenarios and their recovery: [runbook.md](./runbook.md).
- The security requirements, tested route by route on the Edge and over HTTP in the cloud:
  5.4.
- The time-sync warnings: 5.6.
- The request and erasure tool: 5.7.

**What it did not:** real cameras, a real venue network, real footage, real hardware or a
real R2 bucket. Those are Phase 6, and the pilot's go/no-go.

Proposed decisions:
- **Accept for the pilot:** a known limit, stated to the venue and the organisers.
- **Fix before the pilot:** before any match, even a test one, at a venue.
- **Fix before real footage:** before a match with real players, minors among them.

## Security

| # | Risk | Severity | In place now | Proposed |
|---|---|---|---|---|
| R1 | **Camera ingest is plaintext RTSP on a LAN shared with spectators** (F2's network half, B16). Someone on the LAN could watch or publish a feed. | high | Publish passwords; publish only from allowed addresses; a feed from a new address raises `publisher_address_changed`, which an admin must confirm. | fix before real footage: a closed camera network (VLAN or a separate switch), decided with the venue |
| R2 | **No brute-force or load protection** (F7). The cloud's pairing and PIN routes are not throttled. The PIN check is a synchronous 32 MB scrypt that a member could loop to stall the API. Anyone on the venue LAN can lock a known operator out. | medium | Five-failure lock per account on the Edge; long random tokens; PINs as scrypt. | **fixed in 5.5 part 3**: both routes throttled, scrypt off the request thread, an Edge body limit, the lock keyed by email and address, PIN checks bounded |
| R3 | **The "https only" check for cloud URLs can be bypassed** (F9) by a crafted URL in the Edge's configuration. | medium | The URLs come from the operator's configuration and the authenticated cloud. | **fixed in 5.5 part 3**: parsed by httpx, user parts refused, uploads only to `FAIRPLAY_UPLOAD_HOSTS` |
| R4 | **The venue CA can sign for any name, and its key stays on the Edge** (F10). A stolen Edge could mint certificates that reviewer devices trust. | medium | The Edge is kept by DTP staff (D12). | fix before real footage: name constraints; move the key off the Edge |
| R5 | **A short PIN can be recovered offline** from a bundle or the Edge's disk (F16). | low | scrypt N=2^15; bundles last 36 h; disk encryption (D12). | **fixed**: PINs are 8 to 12 digits, in the cloud and on the Edge |
| R6 | **The sign-in status page shows labels to anyone on the LAN** (F19): the session label, the device label, the bundle error. There is no Host allowlist. | low | It shows no names, PINs or tokens (5.4 checked this). | **fixed in 5.5 part 3**: the status trimmed; with TLS, only the Edge's own host names answered |
| R7 | **Nothing pages anyone.** Alerts show in the venue console and stay on the Edge. The cloud keeps no alerts and has no page for its audit log. | medium | The runbook says who looks where; the console's banners and chip are conspicuous. | accept for the pilot with a named person watching each match; build cloud alerting before a season |
| R8 | **Other lows** (F12–F15, F17, F18, F20): sync edge cases (NUL bytes, a non-string label), the release gate's ordering, scoped staff seeing other competitions' refusal messages, audit triggers the app's role could drop, Vision's R2 key not refused, copies outliving retention, unhardened helper containers. | low | Each is listed in the threat review with its fix. | fix before real footage, in one or two small PRs |
| R9 | **Viewing the live preview was not audited.** Every replay, clip, manifest and export was. | low | Only signed-in venue staff see it. | **fixed**: audited once per person and camera an hour (`media.live_viewed`) |

## Operations

| # | Risk | Severity | In place now | Proposed |
|---|---|---|---|---|
| R10 | **A killed container does not restart by itself, and the stack's start at boot is host configuration** (Phase 1, 5.2 D4 and D5). | medium | `restart: unless-stopped`; a crash inside a process restarts. | **addressed in 6.1**: the installer enables Docker and the stack at boot, and a watchdog brings back a killed container every minute ([edge-install.md](./edge-install.md)); still to be run under systemd on the venue machine |
| R11 | **Power and disk untested on hardware.** No real power cut, UPS, SSD wear or disk shared with the database has been tested. | medium | WAL with full sync; 1 s recording parts; the full-disk path fixed (F21). | test before the pilot, on the venue kit (Phase 6 hardware checklist) |
| R12 | **Parked sync items cannot be sent again from the console or the CLI.** It needs a developer. | low | They are kept, alerted, and listed with the cloud's answer. | accept for the pilot; add a re-send route if one happens |
| R13 | **The offline window and the outbox back-off are untuned.** Bundles last 36 h. After a 30-minute outage the outbox takes 206 s to drain, and `outbox_stalled` does not fire within 30 minutes. | low | Nothing is lost; the console's cloud chip shows what waits. | decide: the 36 h window; whether to cap the back-off lower |
| R14 | **The 5.6 timing defaults are mine, not measured at a venue:** 1 s maximum clock error, 120 s to settle, 5 s to confirm an offset. | low | All three are settings. | accept, and revisit after the first rehearsal |
| R15 | **A full disk leaves noise:** one `segment_corrupt` warning per empty file. | low | They are now acknowledged once dealt with (F25). | accept |

## Privacy and rights

| # | Risk | Severity | In place now | Proposed |
|---|---|---|---|---|
| R16 | **Lawful basis, consent model and request handling under the NDPA 2023 are not settled** (B2, B7). That covers who may make a request, and how their identity is checked. | high (for real footage) | Nothing is released without recorded rights, and a consent reference wherever minors may appear. The request tool (5.7) records what was done. | fix before real footage: Fola and the organisers decide; FairPlay records the decision |
| R17 | **Full-match recordings cannot be erased on request.** They are kept 14 days (D9). | medium | The request export says when they go. Clips can be withdrawn. | decide: accept, or allow an audited early deletion that keeps held evidence |
| R18 | **A player is found only by the reference staff record.** An incident with no reference, or another player's incident they appear in, is not found automatically. | low | Any clip in the competition can be withdrawn; staff are told to always record a reference. | accept, with the runbook's guidance for staff |
| R19 | **Disk encryption and custody of the Edge are not done by this software** (D12). | medium | A decision; no code. | fix before real footage: full-disk encryption and a named custodian, in the Phase 6 hardware set-up |

## Not yet done, and waiting for approval

| # | Item | Waiting for |
|---|---|---|
| R20 | The R2 bucket, the production migrations (Phase 4 and 5.7), the production deploy, and `FAIRPLAY_BUNDLE_SIGNING_KEY` | Fola's explicit approval, each |
| R21 | A hardware time source (B5), a real reviewer device and browser (B12), FFmpeg's licence review (B9) | the venue kit and Phase 6 |
| R22 | Every test and drill used synthetic footage; nothing has been tested with real cameras or real matches | the pilot rehearsal |

## Sign-off

For each risk, Fola's decision: accept, fix before the pilot, or fix before real footage.

Fola gave these decisions in the session of 31 Oct 2026. The signature below is still Fola's to add.

| # | Decision | Note |
|---|---|---|
| R1 | fix before real footage | a closed camera network, with the venue |
| R2 | | fixed in 5.5 part 3; no decision needed |
| R3 | | fixed in 5.5 part 3; no decision needed |
| R4 | fix before real footage | name constraints; the CA key off the Edge |
| R5 | fix now | done: PINs are now 8 to 12 digits |
| R6 | | fixed in 5.5 part 3; no decision needed |
| R7 | accept for the pilot | a named person watches each match; cloud alerting before a full season |
| R8 | fix before real footage | one or two small PRs |
| R9 | fix now | done: audited once per person and camera an hour |
| R10 | | addressed in 6.1; confirm on the venue machine |
| R11 | test before the pilot | on the venue kit, with the 6.4 checklist; includes the systemd units |
| R12 | accept for the pilot | revisit after the first rehearsal |
| R13 | keep both for now | 36 h window and back-off unchanged; retune after the first rehearsal |
| R14 | accept for the pilot | revisit after the first rehearsal |
| R15 | accept for the pilot | revisit after the first rehearsal |
| R16 | block minors only | nothing with minors until settled with the organisers and legal advice. Adult matches may go first, but still need a lawful basis and recorded rights; this decision does not settle those |
| R17 | accept for the pilot | revisit with the legal advice in R16 |
| R18 | accept for the pilot | staff always record a player reference |
| R19 | fix before real footage | disk encryption and a named custodian, with the venue machine |

Signed: ______________________ (Fola Sanni)  Date: ____________
