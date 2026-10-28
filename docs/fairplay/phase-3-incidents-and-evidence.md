# FairPlay Phase 3 — Incident logging and evidence

**DTP FAIRPLAY | PHASE 3 DELIVERY**
**STATUS: partial — the Edge side is built and tested on synthetic feeds with the WAN cut;
the cloud receiver, device pairing and evidence upload are not built; hardware acceptance
PENDING. Found in this phase: MediaMTX discards video at segment switches on a feed whose
audio leads its video by more than a second (below), which affects Phases 1 and 2 as well.**

The durable local record of a shadow review: incidents bookmarked from a moment, a match
minute or a ScoreBoard event; a review state machine with four results and audited
reopening; evidence clips cut on request from verified originals, each with a manifest that
names every source byte; an append-only, hash-chained audit log; a transactional outbox
that waits out any WAN outage; permissions by role; and a rights gate in front of anything
leaving the Edge.

No central ScoreBoard API, Postgres schema, environment, cloud resource or DNS record
changed.

---

## Repository facts confirmed

- **Existing patterns used.** The Phase 2 incident model (versions, holds), extended rather
  than replaced; the Vision `refusal()` error shape; supersede-not-edit (rights, reviews);
  the Phase 1 manifest and `evidence_refs`, which retention already honoured; the repair
  module's approach to derivatives (a separate file, the original untouched).
- **MediaMTX 1.21.3 recorder, read at source** (`internal/recorder/format_fmp4_track.go`):
  a new segment starts at the oldest pending sample still within 1 s (`maxBasetime`) of the
  newest. Any older sample of another track is logged *"received too late, discarding"*
  and dropped.
- **Hardware facts verified.** None.
- **New dependencies.** None. No download was needed.

## Implemented

| Area | What |
|---|---|
| Store (`store.py`) | schema v3, one transaction; `incidents` rebuilt (SQLite cannot widen a CHECK) with every row copied, the count checked before the old table goes, and states unchanged; new tables `reviews`, `jobs`, `evidence`, `session_rights`, `audit_log` (with UPDATE/DELETE triggers), `outbox`, `request_keys`, `edge_identity` |
| Incidents (`incidents.py`) | FLAGGED → REVIEWING → REVIEWED → ARCHIVED; reopen (reviewed or archived → reviewing) needs a reason, supersedes the finding and keeps it; every change needs `If-Match`; fields: match id, ScoreBoard event id, period, match minute and second, Edge-clock event time and its basis, category, player reference, the per-camera window at flagging, creator, state and version |
| Bookmarks | now; at the replay position; at a match minute (from the period's start mark: `FAIRPLAY_PERIOD_MINUTES`, default 45); at a ScoreBoard event id with its minute |
| Reviews | `supports_original`, `supports_alternative`, `inconclusive`, `footage_unavailable`; factual notes required; on-field decision; evidence relied on; what each camera showed when the finding was made, judged by the Edge; `authority_mode` can only be `shadow` (CHECK); no finding but `footage_unavailable` when no camera recorded the moment |
| Evidence (`evidence.py`, [ADR-0013](./adr/0013-evidence-clips-by-stream-copy.md)) | clip jobs on request, one per incident, camera and window (a second request returns the first job); originals must be final and re-hash to their manifest SHA-256; planned on each segment's video span; ffmpeg stream copy only, piece by piece from keyframes, then joined; the clip's coverage read from its own video frames; read-only clip and manifest; interrupted jobs re-run after a restart; no footage, no file |
| Manifest | `fairplay.evidence-manifest/v1`, [JSON Schema](../../services/fairplay-edge/fairplay_edge/schemas/evidence-manifest.v1.schema.json), validated in the tests and the fixture |
| Audit (`audit.py`, [ADR-0014](./adr/0014-audit-chain-and-sync-outbox.md)) | create, edit, review start/complete, archive, reopen, clip requested/created/failed, approve, export, evidence and replay access, rights; in the same transaction as the change; hash-chained per device; triggers refuse UPDATE/DELETE; `/audit/verify` |
| Outbox (`outbox.py`, ADR-0014) | queued in the change's transaction; key `{type}:{id}:{version}`; dependency order; applied / replayed / stale / conflict; conflicts parked with an alert; backoff 2 s → 5 min cap, never giving up; **no destination configured** |
| Idempotency | `Idempotency-Key` on incident creation; the console sends one per flag and holds one flag request at a time |
| Permissions | operator: flag, edit, clip; assessor: review; admin: rights, audit; `fairplay.evidence.export`: approve and export; `fairplay.report.view` only (organiser): completed findings and released evidence, nothing else. A member with no permission now sees nothing |
| Rights gate | per session, appended and superseded; default *real footage, rights not recorded*; release needs synthetic footage, or permission with a basis and, unless no minors appear, a consent reference; checked again at every read |
| Lost video (`manifest.py`) | a segment whose first decodable picture comes more than 250 ms after the previous segment's last one raises `segment_video_gap` and records the loss in its manifest; it resolves when a later segment is continuous |
| Time model | an uncalibrated camera's uncertainty is now 3 s (was 2 s): the fixture measured uncalibrated delays of up to 2.9 s |
| `dev-bundle` | refuses unknown permissions, and strips whitespace, instead of signing a bundle the Edge then reads as "no permission" |
| Console | incident state, the review form, reopen with a reason, earlier findings, evidence per camera (request, job state, SHA-256, coverage, view, approve, export), the audit trail, the rights panel, the match-minute bookmark, the outbox depth in the header, a separate organiser view, and a plain "no permission" screen for a member with none |

**API routes added** (Edge only): `incidents/{id}` (GET), `incidents/{id}/review/start|complete`,
`/archive`, `/reopen`, `/audit`, `/clips`; `jobs/{id}`; `evidence`, `evidence/{id}`,
`evidence/{id}/file|manifest`, `evidence/{id}/approve|export`; `sessions/{id}/rights`;
`report/sessions`, `report/sessions/{id}`; `audit`, `audit/verify`; `outbox`. The full schema
is served at `/edge/v1/openapi.json` (signed in).

**Environment added:** `FAIRPLAY_PERIOD_MINUTES`, `FAIRPLAY_EXTRA_PERIOD_MINUTES`,
`FAIRPLAY_CLIP_MAX_ATTEMPTS`, `FAIRPLAY_CLOUD_SYNC_URL` (https only), `FAIRPLAY_CLOUD_DEVICE_TOKEN`.

**Not built in this phase** (the backlog's cloud items 13–15): the cloud `fairplay` module,
its additive migration and receipts table, device pairing, cloud-signed bundles, evidence
presign and upload, and the web admin pages. Until they are, nothing leaves the Edge, and
bundles stay DEV-signed (B11, B13).

## Lost video at segment switches (found in this phase)

**What.** In runs 1, 2, 3 and 6 of the seven fixture runs, the synthetic ground feed
(audio and video) lost up to one GOP, 2 s of pictures, at each switch to the next segment.
MediaMTX's discard warnings were counted in runs 1 and 6: 431 and 267. Read from the burned-in frame
counter: segment one ends on frame 2349 (11:53:02.960) and segment two opens on frame 2400
(11:53:05.000). The sound is continuous. MediaMTX logged 431 *"[path ground] [recorder]
sample of track 1 received too late, discarding"* warnings in 4.5 minutes, about 50 frames
per switch. The drone (video only) is continuous across its switches: frame 2249 → 2250.

**Why.** MediaMTX starts each segment at the oldest pending sample within 1 s of the
newest. When a feed's audio timestamps run more than a second ahead of its video, the video
is left out of that calculation, and every video sample older than the new segment's start
is discarded until the video catches up. The new segment then opens on frames whose
keyframe was discarded, which cannot be decoded. How far the audio leads is set as each
stream starts. In runs 4 and 5 it led by about 0.2–0.8 s, MediaMTX discarded nothing, and
the ground was continuous. In runs 1, 2, 3 and 6 it led by more than a second, and pictures
were lost at every switch. The generator (ffmpeg, x264 `zerolatency`, AAC) is the same
every time, so this is a property of how a feed starts, not of one encoder setting.

**What it affects.**

- **Recordings:** any Phase 1 or 2 run whose ground feed started this way was missing up
  to 2 s of ground video at every segment switch. With the production default of
  5-minute segments, that is up to 2 s every 5 minutes.
- **Earlier claims:** Phase 1's "no gap" checks and Phase 2's "no recording gaps" were
  measured from MediaMTX's recorded spans, which the audio keeps whole. They did not see it.
- **Replays:** a replay window crossing a switch shows a freeze.

**What Phase 3 does about it.**

- **Evidence states the loss.** Coverage is read from the clip's own video frames; the
  missing time is listed in the manifest as `video` or `undecodable` gaps; the clip is
  `partial`.
- **The Edge raises it.** Each affected segment raises `segment_video_gap` the moment it
  is finalised, with the milliseconds lost. Run 6 reported 1,969 ms; run 4, with a
  continuous ground, raised nothing.
- **The bench checks for it.** The equipment audit gains row E17: a feed's audio must not
  lead its video by more than a second.

**What it does not do: fix the cause.** That needs a decision (below, "Next").

## Test evidence

### Commands actually run

```bash
python -m pytest -q -rs -p no:cacheprovider
```

**220 passed, 0 skipped** (Python 3.12, inside the Edge image, so the real-ffmpeg tests ran:
`fp-edge-test` = `dtp-fairplay-edge:local` plus pytest from `constraints.txt`). In CI the
four real-ffmpeg tests skip when ffmpeg is absent; every other test needs neither ffmpeg
nor MediaMTX. The real-ffmpeg tests include a recreation of the defect: an audio-and-video
segment that opens half a GOP before its keyframe.

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

built.

**Migration on a real Phase 2 database.** A copy of the Phase 2 acceptance database
(`fpfix_data`, schema 2, 279 segments, 1 incident, 2 calibrations, 453 events) upgraded to
schema 3. Every table had the same row count afterwards, plus one `store.migrated` event.
The incident was still `flagged` at version 1, and `PRAGMA integrity_check` returned `ok`.
The original volume was mounted read-only, and the copy was deleted afterwards.

### The fixture, run seven times

```bash
python -I fixtures/run_fixture.py evidence --project fp3
```

The run is under the WAN cut, with real MediaMTX, real ffmpeg, synthetic feeds and the
device token. It was run eight times. Each run found something, and each finding was fixed
before the next run:

| Run | Result | What it found | What changed |
|---|---|---|---|
| 1 | 27 / 28 | **A short clip labelled `full`.** The ground clip was 25.1 s for a 30 s window. The concat demuxer refused an in-point before the second segment's first keyframe (EPERM), stopped, and exited 0. The plan said `full`. | coverage read from the clip's own frames; anything ffmpeg prints fails the job |
| 2 | 26 / 30 | **The lost-video defect** (above), confirmed from burned-in frame numbers and MediaMTX's source code; the fixture's missing-source step deleted the segment a later replay check needed; an assumed 400 ms drone offset that calibration, not the painted clock, decides | new alert; fixture fixed |
| 3 | 22 / 27 | segments overlapping where audio outran video, so the plan cut a moment twice (ffmpeg rightly refused the list) | plan on each segment's video span, never overlapping |
| 4 | 29 / 30 | the one failure was the new alert, a **false positive** (it compared video to the container); a 0.5 s hole in the ground clip made by the concat demuxer, not the recording | alert measures the gap between segments' pictures; out-points always set |
| 5 | 28 / 30 | the concat demuxer stopped 0.85 s early on a segment whose audio starts after its video, with no error; the drone's uncalibrated delay was 2.27 s, outside the assumed 2 s | pieces cut by input seeking from keyframes, then joined whole; uncalibrated uncertainty 3 s |
| 6 | **29 / 30** | the one failure is the real defect: `segment_video_gap` 1,969 ms on the ground; the ground clip honestly `partial` (1.9 s missing), the drone clip `full` | — |
| 7 | 27 / 30 | start-up turbulence: MediaMTX reset the ground recorder twice (*detected drift between recording duration and absolute time, resetting*), and two drone segments' recorded starts overlapped by 5.6 s, so a drone clip held 1.7 s of footage twice. The Edge called that clip `full`; the fixture's independent frame count did not. Both cameras raised `segment_video_gap` for the start-up (8.0 s and 4.0 s), correctly | excess check: a clip with more pictures than its lead-in and window is never `full`, and the manifest records `excessMs` (unit-tested; not yet seen on the real stack) |
| 8 | 17 / 27 | **invalid: the machine was starved.** 86 recorder resets and 190 discards, neither feed publishing when the run began, the drone losing 60–79 s at a time; the test suite run just before took 237 s instead of ~100 s. The kept stack's encoders were at 244 % and 115 % CPU afterwards, and OneDrive's sync service was the busiest process (the repository is in a OneDrive folder). The Edge's own reports stayed truthful throughout (the drone clip `partial`, 9.1 s missing; a gap alert for every loss) | none; to repeat on an idle machine |

Measured in the runs (synthetic feeds, 720p25, ~2.5 Mbit/s):

- **Cut time**, job start to finish, including re-hashing every original: 2.2 s for a 30 s
  window, and 2.2 s for a 310 s window (run 4).
- **Uncalibrated offset**, from the incident's Edge-clock time to where the clip shows the
  marker (runs 2–6): ground +0.79, +1.16, +0.86 and **−2.87 s**; drone +0.28, +1.45, +0.54,
  +2.27 and +0.83 s. The −2.87 s is run 6, where the ground's audio led its video: MediaMTX
  timed that segment by its audio, so the video's clock was off by the lead. This spread is
  why calibration exists, and why the uncalibrated uncertainty is now 3 s.
- **Clip lead-in** before the requested start: 0.13 to 1.86 s, always under one GOP (2 s).
- **Outbox** after each run: 47 to 62 records waiting, 0 sent, 0 parked.

### Browser QA

The console was driven in the desktop app's built-in browser, at `http://127.0.0.1:8443`
through `lan-relay`, with the Edge cut off from the internet and a DEV bundle of four
test members:

| Who | What was done | Result |
|---|---|---|
| Operator | flagged an incident with the button; asked for both clips | both jobs showed *queued (a segment in this window is still being recorded)*, then finished within 20 s; drone 31.1 s `full`; ground 29.5 s *"partial: 28 of 30 s"*; the drone clip played and was seekable over 31.1 s; no Approve button |
| Assessor | started the review; recorded *Inconclusive* with an on-field decision, factual notes and one clip cited | incident v3 *Reviewed*, the finding shown with Archive and Reopen |
| Admin | approved the drone clip | *approved by Admin*; Export offered (not clicked: it downloads a file in the browser; export was exercised through the API by the fixture) |
| Organiser | opened the report | two completed findings, each with only its approved clip, and the shadow-review notice; health, sources, incidents, media and audit all **403** |

Found and fixed during the browser QA:

- **Routed to the organiser view.** A member whose permissions were all unrecognised
  landed in the organiser view. The cause was CRLF line endings in the QA bundle's member
  list, a mistake in my setup. Two fixes: `dev-bundle` now refuses unknown permissions,
  and the console shows a plain "no permission" screen.
- **The page scrolled sideways.** The evidence table overflowed the incidents column; it
  now scrolls inside the column. Checked at 1,600 px and at 375 px.
- **Windows from the wrong incident.** After flagging, the per-camera table showed the
  previous incident's windows (from Phase 2). It now shows only the selected incident's.

### Required tests

| Test the prompt names | Where | Result |
|---|---|---|
| Synthetic incident at a known timestamp | fixture: an incident flagged at a whole-minute marker, located in each clip by decoding it | **PASS** in runs 2, 4 and 6 for both cameras; in run 5 the drone's marker was 2.27 s out, beyond the 2 s then assumed, which is why it is now 3 s (offsets above; calibration removes them) |
| Derived 30-second clip | fixture (both cameras); unit test with real ffmpeg (red frame at `eventAtMs`, blue 2 s before) | **PASS**: drone clips `full` (30 s plus lead-in); ground clips `full` when the recording is whole, `partial` with the gap listed when it is not, and the clip's own frame count, taken independently, matches its manifest in every run |
| Exact source ids and hashes | fixture: the evidence names exactly the segments its window overlaps, each SHA-256 equal to the manifest's and re-computed at the cut; the clip re-hashed with `sha256sum` | **PASS** both cameras |
| Incident edit collision | fixture (two edits from version 1: 200 then 409, the first edit kept); unit and API tests (edits, transitions, two assessors completing) | **PASS** |
| Replay after an Edge restart | fixture: SIGKILL, start, the incident's window fetched and probed (10.0 s), evidence re-verified, audit chain whole | **PASS** |
| Interrupted clip job | unit test (job `running`, half-written `.part`, recover → queued, `.part` gone → succeeded); fixture (SIGKILL straight after the request) | **PASS**. In runs 2, 3 and 4 the kill landed mid-job: the job was recovered and succeeded on attempt 2, with no `.part` left. In runs 1, 5 and 6 it had already finished before the kill landed |
| Duplicate sync submission | unit tests against the test double: one batch ten times → 1 applied, 9 replayed; a lost reply resent → `replayed`; same key, different content → parked + alert | **PASS** (no real receiver exists) |
| Missing source | fixture: one ground original deleted → job `failed` / `source_missing`, no evidence row, no file; unit tests for missing, changed (`source_mismatch`) and no footage | **PASS** |

## After the merge (28 Oct 2026, branch `fix/fairplay-synth-av-alignment`)

**D2, the lost video.** The synthetic feed now makes its audio and video from one `lavfi`
input, so `-re` paces both off one clock (`--separate-audio-input` keeps the old form for
reproducing the defect). Results:

| | Old form (two inputs) | New form (one input) |
|---|---|---|
| Fixture runs with MediaMTX "too late" discards | runs 1, 2, 3, 6 (431 and 267 counted in runs 1 and 6) | **none** in runs 9 and 10 |
| Isolated test: ground feed only, 4 fresh starts, 10 s segments | 0 discards | 0 discards |
| The same with 4 busy CPU processes in Docker's VM (3 starts each) | 0 discards | 0 discards |

So the defect could not be produced on demand with either form. It appeared with the full
stack starting at once, on a loaded machine. Two clean runs with the new form are
encouraging, not proof. The `segment_video_gap` alert and equipment-audit row E17 remain
the guard for real encoders.

**A cutting bug in the merged code, fixed.** MediaMTX writes each sample to exactly one
segment, in order, so consecutive segments never hold the same footage, even where their
recorded times overlap (a clock artefact). Phase 3 trimmed such overlaps as if they were
duplicates, and so **skipped real footage**; copy-seeking then snapped back to a keyframe,
which is what showed as "excess" pictures in runs 7 and 9. Run 7's drone clip did not hold
footage twice, as reported above: it had a hidden jump, and was rightly not called `full`.
Now only the window's own edges are trimmed, every segment between is taken whole, and an
overlap is never counted as a gap.

**Run 9: 30 / 30.** No discards on either camera; both clips `partial` (they still had the
cutting bug above, which the excess check flagged).
**Run 10: 29 / 30, with both clips `full`**: the ground clip has 799 frames, matching the
window plus its lead-in to within 34 ms, and an independent count agrees. This is the
first `full` ground clip on the real stack with the current cutter. The one failure is a
5.0 s ground gap from two MediaMTX recorder resets (*detected drift … resetting*) at
16:52, while the Edge was cutting clips on a machine with OneDrive syncing: the synthetic
encoders share Docker's VM with the Edge, so a stall there stalls the "camera". At a venue
the cameras are separate hardware. The alert reported the gap correctly.

## Privacy

See [privacy.md](./privacy.md): what is held, where it goes, who sees what, the rights
gate, and five decisions still needed (lawful basis and consent, retention periods
including the audit log's, requests from players or parents, organiser accounts, disk
encryption).

## Acceptance checklist

- [x] FLAGGED → REVIEWING → REVIEWED → ARCHIVED; reopening audited, never a silent overwrite.
- [x] The prompt's fields, including ScoreBoard event id, match clock, approximate time, per-camera window, type, creator, status/version; review id, reviewer, the four results, factual notes, completed time; evidence links and the source hash manifest.
- [x] Bookmarks from now, the replay position, a match minute and a ScoreBoard event.
- [x] Replay needs no clip; clips are cut on request, in the background, from verified originals; no full-game encode.
- [x] Originals read-only once final and hashed; clips hashed; provenance and operator activity in the manifest.
- [x] Append-only audit of create, edit, reopen, export and access; optimistic concurrency; no double submission.
- [x] SQLite WAL outbox, stable keys, dependency order, bounded exponential retry with the WAN down.
- [x] No-footage and incomplete-recording handling; no empty or stand-in evidence; coverage from the clip's own frames.
- [x] Operator creates, assessor completes, admin exports, organiser sees approved assets only.
- [x] Rights and consent recorded before any real clip can be released.
- [ ] A receiver for the outbox, and evidence upload: not built (B13, B5).
- [ ] Video continuity of feeds with audio: lost at segment switches whenever the audio leads by more than a second (above). Detected and reported, not fixed.
- [ ] Real hardware and real feeds: pending.

## Budget impact

**$0 recurring.** Nothing in the cloud; no new package.

## Known blockers

B1 hardware · B2 rights · B5 evidence bucket · B6 organiser accounts · B7 retention ·
B9/B10 licence rows · B11 DEV bundles · **B13** no cloud receiver · **B14** disk
encryption and custody · **B15** player/parent requests ([blockers.md](./blockers.md)) ·
equipment audit **E17**: audio/video alignment.

## Next

0. **Repeat the fixture on an idle machine**, ideally outside OneDrive, until one run
   shows a ground feed without discards *and* the new cutter on the real stack. No run so
   far has had both: runs 4 and 5 had a continuous ground feed but an older cutter. Until
   then, a `full` ground clip on the real stack is proven only by the unit tests with real
   ffmpeg.

1. **Decide how to stop the lost video.** The options: make the synthetic feed start its
   audio and video together, so the fixtures model a well-behaved encoder, with the alert
   guarding real ones; record each feed's video without its audio; or raise it upstream
   with MediaMTX, whose 1 s tolerance is a constant. Then re-run Phases 1 and 2's fixtures
   with the new frame-level check.
2. **The cloud side** (backlog 13–15), when approved: the `fairplay` module, the sync
   receiver with receipts, pairing and cloud-signed bundles, evidence upload to the private
   bucket, and the admin pages.

## Rollback

Revert the Phase 3 commit. A v3 database is ahead of a v2 Edge, which refuses to open it
rather than guess, so roll the data volume back with the code or start it fresh. Evidence
files under `data/evidence/` can be kept or removed. The recordings are untouched either way.
