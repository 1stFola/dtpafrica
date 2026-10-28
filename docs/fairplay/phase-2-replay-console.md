# FairPlay Phase 2 — Local replay console and synchronisation

**DTP FAIRPLAY | PHASE 2 DELIVERY**
**STATUS: partial — accepted on the synthetic 30-minute fixture with the WAN cut; hardware
acceptance PENDING; operator bundles are development-signed until the cloud issues them (Phase 3).**

The protected operator console the venue needs: a shadow banner on every screen, source
health, a live preview and an independent replay, incidents with per-source windows,
period marks, per-camera calibration with stated uncertainty, a synchronisation test, and
warnings in words. Served by the Edge on its own origin; it needs no internet.

No central ScoreBoard API, schema, environment or cloud resource changed.

---

## Repository facts confirmed

- **Existing patterns used.** The DTP design tokens of `apps/web` and its `DtpLogo`
  (`@dtp/ui`); React 18 and Vite 5 already in the workspace (no new npm dependency); the
  vision `refusal()` error shape; supersede-not-edit for period marks and calibrations;
  optimistic versions for incidents; the Phase 1 Edge, extended.
- **Hardware facts verified.** None.
- **New download, approved:** `cryptography` 50.0.2 (with cffi, pycparser) into the Edge image.

## Implemented

| Area | What |
|---|---|
| Sign-in (`auth.py`) | Ed25519-signed operator bundle checked offline against trusted public keys; DEV bundles refused unless `FAIRPLAY_ALLOW_DEV_BUNDLES=1` and labelled on every screen; email + PIN (scrypt); `HttpOnly; SameSite=Strict` session cookie (`Secure` under TLS), 8 h, 30 min idle, never past the bundle's expiry; five wrong PINs lock an email for five minutes; local disable (offline revocation); one refusal message for every cause |
| CSRF | cookie requests that change anything need `X-FairPlay-Request: 1` and a same-origin `Origin` |
| HTTPS (`tlsgen.py`) | `tls-init`: the Edge's own CA and a server certificate for localhost, 127.0.0.1 and the LAN address; Uvicorn terminates TLS; keys mode 0600 |
| Time model (`timing.py`) | match sessions (shadow / post-match only); period marks with the console-anchor delta; per-source calibrations (`offset = observed − reference`, uncertainty ≥ one frame); incidents with pre/post roll, a retention hold each, versioned edits; per-source windows with flags; synchronisation test; clock sampling with step detection |
| Staleness rule | a calibration holds for the unbroken stretch of recording it was measured in; a drop the watchdog saw **or** a gap in the recordings between that footage and a window makes the window `stale_after_reconnect` — judged in footage time |
| Live preview | MediaMTX HLS (fMP4) on the internal network only; the Edge proxies it after authorisation, holding MediaMTX's session cookie; the console plays it with MSE and measures its delay ([ADR-0012](./adr/0012-replay-and-live-preview-delivery.md)) |
| Replay | windows fetched whole into a bounded on-disk cache and served with byte ranges, because browsers cannot seek MediaMTX's streamed `/get` ([ADR-0012](./adr/0012-replay-and-live-preview-delivery.md)) |
| Console (`apps/fairplay-console`) | sign-in; header (Edge clock, session, health, "Cloud: local only", disk, sign-out); sources (recording / connected-not-recording / unavailable, codec, offset ± uncertainty, flags); live; replay with −60/−30/−10 s, ±0.1 s, slider, play/pause, 0.5×/1× and 0.25× only when measured, go to UTC time, return to live; flag now / flag at replay position; incidents with pre/post roll, category, note and a per-source table; period buttons; calibration steps; synchronisation test; keyboard shortcuts, each also a button; Content-Security-Policy `'self'` only |
| Store | schema v2, additive; the Phase 1 database upgraded in place (`store.migrated` event) |
| Fixtures | `compose.wan-outage.yaml` gains `lan-relay` (TEST ONLY): one forwarded port so a browser reaches an Edge that has no route out |

**API routes added** (Edge only): `auth/status|login|me|logout|disable`, `sessions`,
`sessions/{id}`, `sessions/{id}/end|periods|calibrations|sync-test`, `incidents`,
`incidents/{id}` (PATCH, `If-Match`), `incidents/{id}/windows`, `live/{source}/{file}`,
`clock`, `metrics/replay`. **No cloud route, no Postgres migration.**

**Environment added:** `FAIRPLAY_TRUSTED_KEYS_FILE`, `FAIRPLAY_BUNDLE_FILE`,
`FAIRPLAY_ALLOW_DEV_BUNDLES`, `FAIRPLAY_CONSOLE_DIR`, `FAIRPLAY_MEDIAMTX_HLS_URL`; Compose
`FAIRPLAY_CONSOLE_PATH`, `FAIRPLAY_AUTH_DIR`.

## Test evidence

### Commands actually run

```bash
pip install -c constraints.txt ".[dev]" && python -m pytest -q -rs
```

**150 passed** (Python 3.12.15, clean container).

```bash
pnpm --filter @dtp/fairplay-console typecheck
```

clean.

```bash
pnpm --filter @dtp/fairplay-console test
```

**16 passed**.

```bash
pnpm --filter @dtp/fairplay-console build
```

one 174 kB script, one 6 kB stylesheet; the only URLs in the output are two strings inside
React (`w3.org` SVG namespace, `reactjs.org` error link), never fetched, and blocked by CSP if
they were.

```bash
python -I fixtures/run_fixture.py core --project fpcore
```

Phase 1's core fixture against the Phase 2 code, run twice:

- **First run: 26 passed, 2 failed — invalid, and the cause was mine.** It ran while the
  image rebuilt and a workspace typecheck ran on the same machine. The synthetic encoders,
  starved of CPU, delivered frames late; MediaMTX logged "sample received too late,
  discarding" and cut many short segments, whose ffprobe frame rate came out as 50/1, which
  failed the codec check. The Edge did its job throughout: `recording_stalled` opened and
  resolved on both sources each time. Worth keeping as evidence that a starved encoder is
  caught, not as a regression signal.
- **Re-run on an otherwise idle machine: 28 passed, 0 failed**
  (`fixtures/out/core-20261028T010300Z`). The SIGKILL test lost 631 ms this time (290 ms in
  Phase 1), still within one 1-second part.

### The acceptance run

**Set-up.** The 30-minute WAN-drill stack from Phase 1, kept with its volumes
(`fixtures/out/wan-20261027T233749Z`, recordings 23:37:55 → 00:15:09 UTC), redeployed with
the Phase 2 image. Edge, MediaMTX and both synthetic feeds on a Docker network with no route
out; `check-egress` from the Edge after the redeploy: 1.1.1.1:443, 8.8.8.8:53 and
www.dtp.africa:443 all unreachable. The browser was the Claude desktop app's built-in
Chromium pane at `http://127.0.0.1:8443` through `lan-relay`. Sign-in used a DEV bundle with
two test members (operator, viewer) generated for this run. A **test harness** in the page
found marker frames by reading decoded pixels, standing in for an operator scrubbing by
eye; everything else went through the console's own buttons and keys.

The synthetic feeds flash a red marker at every whole minute of their burned-in clock — the
"known events". The drone's burned clock runs 400 ms behind the ground's.

| Acceptance item | Result | Evidence |
|---|---|---|
| WAN disconnected | **PASS** | no route out from the Edge (above); console requests to 127.0.0.1:8443 only; CSP `'self'` |
| Retrieve a known event from the 30-minute fixture | **PASS** | go-to 23:55:00 → ground window loaded, the 23:55 marker on screen; window seekable over its whole 40 s |
| Switch between two known source windows | **PASS** | incident flagged at the 23:57 marker ("Flag at replay position", 23:56:59.820): ground window, marker at 20.00 s vs predicted 20.04 s (−40 ms, one frame); `D` to the drone in the same incident, marker at 20.08 s vs predicted 20.08 s (0 ms) |
| See offset uncertainty | **PASS** | drone calibrated through the console at the 23:55 marker: **+280 ms ± 80 ms**; ground set as the session time base: 0 ± 40 ms; shown on the source cards, the replay line, the incident table and the sync test ("aligned within ±120 ms") |
| Continue while recording and live are unaffected | **PASS** | during the 40-retrieval run both sources stayed publishing and recording, with **no gap** in either; the live preview kept playing |
| Real p95 retrieval latency | **measured: 1,513 ms** | below |
| Return to live keeps the bookmarked incident | **PASS** | `L`: incident still selected, replay paused with its window loaded, focus on the live panel |
| Absent feed marked unavailable | **PASS** | drone publisher stopped: card "Unavailable — no feed", Live disabled, "source disconnected", Edge "degraded"; ground recording throughout |
| Reconnect requires recalibration | **PASS** | after the drone returned: its calibration flagged `stale_after_reconnect` for current footage, with "recalibrate before trusting its timing" in the replay; the 23:57 incident (before the drop) stays `ok` |
| Keyboard | **PASS** (shortcuts exercised: `D`, `L`; the rest by unit test) | every shortcut is also a button with `aria-keyshortcuts`; not audited with a screen reader |

### Measurements

**Time to playable** (browser: request sent → `canplay`, recorded by the console and stored
on the Edge): 40 retrievals at random moments across the fixture, alternating cameras, every
one a cold fetch.

| | n | p50 | p95 | max |
|---|---|---|---|---|
| all | 40 / 40 playable | **636 ms** | **1,513 ms** | 3,648 ms |
| ground (with audio) | 20 | 797 ms | 1,513 ms | 3,648 ms |
| drone | 20 | 326 ms | 572 ms | 1,623 ms |

Against the PID's target of p95 ≤ 15 s on a validated laptop and LAN. This laptop is a
development machine, the feeds are synthetic at ~2.6 Mbit/s, and the browser shares the
machine with the Edge, so the number says the design is not the bottleneck; it does not
replace the measurement on the venue machine with real feeds.

**Calibration holds across events.** The drone-to-ground offset measured at nine marker
events over 13 minutes of one unbroken drone run: mean **271 ms**, standard deviation
**25 ms**, range 240–320 ms (frame step 40 ms). Shifting a requested window 500 ms moved the
marker 520 ms (one frame). The 400 ms painted into the drone's clock is not the recording
offset: each feed also has its own start-up and transmission delay, which is what
calibration measures.

**Live preview delay**: 2.9–6.8 s behind live, measured from the playlist's wall-clock
stamps; cross-checked once against the burned-in clock (3.1 s measured, ≈ 2.7–3.6 s seen).

**0.25×**: measured 0.40 s of video per 2 s of wall time (0.5 expected, ±40 % accepted) —
offered on this device.

**Replay cache**: 60 files, 450 MB at the bound after the run.

### Found and fixed during the acceptance run

| Found | Fix |
|---|---|
| Replay windows unseekable in the browser (`seekable` `[0,0]`): MediaMTX's `/get` has no byte ranges | the on-disk replay cache with byte-range serving (ADR-0012); unit test for `206` |
| Live preview `302` then `401 session not found` | the Edge holds MediaMTX's HLS session cookie and passes the `session` parameter through |
| No position slider, nudges, go-to-time or flag-at-replay — operators could not land on an event | added, with `,` `.` shortcuts |
| A time of day typed after midnight UTC meant tonight, not last night | most recent past occurrence; unit test |
| Staleness judged against the calibration's creation time, flagging footage from before a later drop | judged in footage time, with recording gaps as evidence too; five unit tests |
| A negative "behind live" while the player settled | not shown until it is a real measurement |
| The synthetic drone's painted seconds read one low for part of each second (overlay only; markers and measurements unaffected) | seconds and milliseconds from one instant; checked on a rendered frame |

### Not tested

- **Real hardware**: pending the equipment audit.
- **HTTPS in a browser**: the CA, the certificate and a TLS handshake are unit-tested; the
  acceptance ran over loopback HTTP (a secure context), because the built-in browser cannot
  have the Edge's root installed.
- **Cloud-issued bundles**: DEV bundles only until Phase 3.
- **Screen-reader use**: controls are labelled; not audited.
- **The browser pane was reported hidden** during part of the run; the page itself reported
  `visibilityState: visible`, and timings showed no background throttling, but the figures
  should be repeated with an operator at the screen.

## Operational notes

- Changing MediaMTX's configuration means restarting it, which breaks every recording for a
  few seconds (9 s here at 00:15:09, when HLS was switched on). Do it before kick-off, never
  during a match.
- Both cameras are flagged stale for current footage after that restart — correctly: the
  recordings show the break.

## Acceptance checklist

- [x] SHADOW REVIEW — NOT VAR banner on every screen; no decision-changing control (console test guards it).
- [x] Session details, source health, live preview, independent replay.
- [x] Source selector; absent feeds marked unavailable.
- [x] Jump back 10/30/60 s, pause/play, 0.5× and 1×; 0.25× only when measured.
- [x] Return to live keeps the incident.
- [x] Incident window with adjustable pre/post roll.
- [x] Per-camera offset with uncertainty; kick-off/half-time marks; synchronisation test.
- [x] No-footage, gap, uncalibrated, stale and clock warnings in words; keyboard shortcuts, each also a button.
- [x] UTC wall clock, Edge monotonic clock, source PTS and match clock kept distinct; mappings persisted; nothing inferred from file names.
- [x] Reconnect visibly flags the offset as stale until recalibrated.
- [x] Seeks described as approximate; no frame-accuracy claim.
- [x] Same-origin console, operator sign-in, authorised media and live URLs, no mixed content, CSRF guard.
- [x] Measured p95 in the browser, WAN cut.
- [ ] Real hardware and real feeds — pending.
- [ ] Licence rows cleared (including `cryptography`, FFmpeg 7.1) — pending.

## Budget impact

**$0 recurring.** Nothing in the cloud. One new package (`cryptography`) in a local image.

## Known blockers

B1 hardware · B2 rights · B3 Edge machine · B9/B10 licence rows ([blockers.md](./blockers.md)) ·
operator bundles DEV-signed until Phase 3 · HTTPS to be exercised on real reviewer devices
with the root installed.

## Next phase prerequisites

Phase 3 (incidents, evidence and integrity) builds on the incident model here: it adds the
review state machine and findings, evidence clips with lineage, the audit hash chain and the
outbox. It needs nothing new to download.

## Rollback

Revert the Phase 2 commit: the console, the auth, timing and live code and the v2 tables go;
a v2 database is ahead of a v1 Edge, which refuses to open it rather than guess, so roll the
data volume back with the code or start it fresh. The recordings are untouched either way.
