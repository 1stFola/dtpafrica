# FairPlay V1 — Phase 7 acceptance review

Independent review under Prompt 8 of the prompt pack, 1 November 2026, of `origin/main` at `497d3c6`. The
reviewer did not build FairPlay. Every claim in `docs/fairplay/` was treated as something to test. The review itself
signed and deployed nothing.

Sections 2 to 7 describe `497d3c6`, as reviewed. On Fola's word, the same reviewer then fixed H1 to H5 on local
branches, and a separate Claude agent read them. They merged to `main` on 2 November 2026 and deployed; "Where the
fixes stand", below, is the current position. **GitHub records no review of them.**

## 1. Executive release recommendation

# NO GO

**Do not record a real match and do not activate FairPlay in production on this build.** The fixes below do not
change that: reasons 1 to 5 are numbered as first found, and reason 6, FP-12, FP-13 and FP-15 stand whether or
not they merge. The decision is Fola's; explicit release sign-off is requested in section 10.

The engineering underneath is good. Every suite the builder ran gave the count the builder reported, on fresh
scratch databases, and the 30-minute WAN cut, the crash recovery and the audit chain held up. The docs are
candid about many limits. The verdict rests on these:

1. **Production is not off, though the release documents say it is.** CD deployed FairPlay's API to the box
   serving the live site, and its logs show both FairPlay migrations applied there. `release-notes.md` says
   "Not deployed anywhere. No production migration has run" (C1).
2. **A double-header locks operators out mid-match.** The cloud's nearest-kickoff rule swaps the operator list
   during the first match (H1).
3. **Player references and note text are in the insert-only audit chain, on the Edge and in the cloud.** That
   breaches D13, and `privacy.md` says the opposite (H2).
4. **Three P0 or P1 acceptance rows fail outright on behaviour, and two P1 rows are not built.** FP-08: an
   export names no reviewer or finding. FP-11: `view_original` gates nothing. FP-15: organisers read findings
   before any approval or rights check. FP-12 and FP-13 do not exist.
5. **A live clip takes minutes, not 30 seconds, at the shipped settings:** 167, 245 and 262 s (H5).
6. **The prerequisites the builder already records are still open:** rights and legal advice, no matchday kit,
   no real bucket, no field pilot, footage around incidents never deleted (R25), licence rulings.

**Showing the synthetic demo** to a stakeholder is not a release, and nothing here blocks it: `run_demo.py up`
passed 29 of 29. Fola should know C1 first, and should not repeat "not deployed" in that room.

### Where the fixes stand, 1 November 2026

| Finding | Status | Branch | What changed |
|---|---|---|---|
| C1 | Decided: it stands. Documents corrected | `review/fairplay-phase-7-acceptance` | Docs only. FairPlay's API stays on the live box |
| H1 | Merged, #335 | `fix/fairplay-h1-bundle-hold` `3748119` | The cloud keeps serving the session in progress, and the Edge refuses another session's bundle and raises `bundle_held_back`. The hold ends when the next match kicks off, or 4 hours after its own kickoff, or 12 hours after opening if it has none. The sign-in page says when a list is waiting |
| H2 | Merged, #336 | `fix/fairplay-h2-audit-minimised` `58acc06` | The chain holds a salted fingerprint of a player reference, note, reason or consent reference. Applies only to new rows, so it must land before any real incident |
| H3 | Merged, #337 | `fix/fairplay-h3-view-original` `a469cb2` | `/media`, `/live`, any clip not yet released, and approving a clip need `view_original`. Operator and assessor roles gain it, which Fola should confirm, by a new additive migration, because seeding leaves existing roles alone. **The migration runs on live with this merge. Places already given in an open session need Watch originals ticked** |
| H4 | Merged, #338 | `fix/fairplay-h4-export-finding` `2bd8995` | A package holds `finding.json`, listed in `SHA256SUMS`: result, reviewer, approver and whether that approval came after the current finding, earlier findings, this clip's custody. The clip's manifest is unchanged |
| FP-15, M4 | Merged, #340 | `fix/fairplay-fp15-findings-held` `6f34980` | An organiser's report leaves out an incident with no released evidence, on the Edge and in the cloud. Staff still read every finding |
| H5 | Merged, #339. Edge code, synthetic only | `fix/fairplay-h5-segment-length` `16b2dd7` | Files of 20 s: p50 22 to 24 s, p95 34 to 36 s, 68 of 92 clips within 30 s. See H5 in section 3 |
| M1, M2, M10 | Merged, #345. Edge code, synthetic only | `fix/fairplay-m1-m2-m10-footage` | Retention deletes nothing while the clock is in doubt, or for a retention period after a jump of an hour or more (`retention_paused`). A window touching withdrawn footage of that camera is refused, with no override. The replay cache empties whenever footage goes. A clock set wrong while the Edge is off and marked synchronised after restart is not caught |
| M3, M6 | Merged, #347. Edge and cloud code, synthetic only | `fix/fairplay-m3-m6-evidence` | A job keeps the calibration, offset and pre-roll it was asked for with, and the manifest uses those. A clip skips the rights check only if it was cut as synthetic and the session is still called synthetic, on the Edge and in the cloud; an Edge takes the label only with `FAIRPLAY_ALLOW_SYNTHETIC_FOOTAGE=1` or DEV bundles. On an Edge with that set, nothing tells real pictures from test ones. The cloud trusts the kind on the Edge's clip row |
| M11 | Merged, #349. Edge code, synthetic only | `fix/fairplay-m11-calibration-audit` | Every calibration and period mark is in the audit chain, with a calibration's note as a fingerprint. A correction must name the latest record of the same session, and the same camera, or the same period and edge. Records made before this have no chain entry |
| M8, M9 | Merged, #350. Edge and cloud code | `fix/fairplay-m8-m9-sync` | The cloud answers an item holding a NUL character `rejected`, so it is parked and nothing behind it waits, and the Edge refuses such text when it is typed. A rejected key sent again is tried again, never reported `replayed`, and applies once its cause is fixed. An item that fails for any other unexpected reason still gets no answer and still holds back its rank |
| M7 | Merged, #351. Edge code | `fix/fairplay-m7-pairing` | `pair` checks both folders are writable and the trusted keys readable before it spends the bootstrap token, and records the pairing only after both files are written. A failure after the cloud's answer says to re-pair for a new token; running `pair` again then works. The README gives `./auth` to uid 10001 first. Tried on a root-owned Docker volume, not on a Linux host |
| M5, M12 | Merged, #352. Cloud, Edge and console code | `fix/fairplay-m5-m12-operator-list` | With no open session on a device, the cloud keeps issuing the list of the one that ended last, for 7 days after it ended (Fola's decision), so its reviews can be finished. `operator_list_expiring` warns 12 hours before the list lapses and turns critical at 2, with a banner in the console. Offline, the list still lapses: the alert says to connect |
| M13 | Investigated, not reproduced; open until the venue kit is measured | `docs/fairplay-m13-finding` | The 30-minute drills on `main` at `e9c90f8` passed 34 of 34 on 5 November 2026: no camera lost footage in D4 or the outage. Every container's log and the load every 10 s were kept. Four `recording_stalled` alerts of 2 to 4 s opened on both cameras at once during the outage, each straight after the Edge's 2-second poll of MediaMTX went silent for 7 to 19 s, while every container's CPU rose together and MediaMTX logged nothing but INF. That is the Docker Desktop VM freezing on a 4-thread laptop already about 60% busy, not FairPlay's code. The synthetic cameras run inside the same VM, so they froze too and nothing was lost; a real camera outside it keeps sending, so a freeze there loses pictures. The 833 ms and the 7 to 15 s losses in loaded runs fit this, but it is an inference, not a reproduction |
| Review R1 | Fixed, not merged | `fix/fairplay-retention-after-restart` | An independent review of #335 to #352 (two separate agents, 5 November 2026) found that retention ran at the Edge's start, before the clock check could pause it, so a box that came back with its clock 40 days fast deleted day-old recordings (confirmed by test). Retention now deletes nothing until the kernel has said, since that start, that the clock is synchronised, and a clock alert left open before a restart stays open while the clock settles. A clock wrong but marked synchronised is still not caught |
| Review H1, M5 | Fixed, not merged | `fix/fairplay-h1-m5-sessions` | The third read of #335 to #354 (6 November 2026) found two gaps in the cloud's choice of list. H1: a running session with no kickoff time (`SbMatch.kickoffAt` is nullable) lost its hold to any other open session whose kickoff was past, even a stale one from days earlier that nobody ended. Now only a match that kicked off after the running one did, or after it was opened when it has no kickoff, ends the hold. M5: the ended match's list was served only while no other session was open, so a venue that provisions next week's match early lost the 7-day review window at once. Now an ended match keeps its list until the next one is due, within 12 hours of its kickoff or with none; a session the cloud ended that the Edge still calls running no longer holds. Cloud code and the cloud check only; the Edge is unchanged |

These reached `main` as #334 to #340 between 02:53 and 02:56 UTC on 2 November 2026, merged by Fola with no
review recorded. FairPlay's code on `main` at `db13f96` is the same as the merge tested in section 9. CD run 41381143259
deployed it to the box serving the live site: restore point taken, health check 200. The next deploy, run 41384509995 for #341, records the live schema as
`20261101000000_fairplay_view_original_roles`, so H3's migration has applied.
FairPlay is still not switched on for anyone: this review did not change the storage backend, signing key or role grants
beyond that migration. **Merging anything to `main` deploys it (C1).**

**The read of the fixes.** A separate Claude agent, given the code and not my conclusions, read the merged diff. I
checked its main findings against the code before acting. It is not independent the way a person is, and nobody read
the follow-ups after they were written.

| Found | Now |
|---|---|
| Seeding skips existing roles, so operators and assessors could never gain `view_original`. My earlier note that a seed run would do it was wrong | Fixed: migration, tested on a scratch database |
| H1's hold counted 12 hours from opening: forget End session and the next match's people could not sign in; open a session a day early and it lost the hold mid-match | Fixed: the rule above. **Until the next match kicks off, its people still can't sign in if the last session was not ended**, so the sign-in page says so and the runbook gives the way out |
| Each file's outbox lookup scanned the whole table, about 2.5 s at 500,000 rows | Fixed: an index. Sent rows are still never pruned: about 2 GB over 18 months, by its estimate, not measured |
| Retention of 200 files an hour could not keep up on an Edge that is on for part of a day, and ran inside the pass | Fixed: 600 an hour, in its own loop |
| The window lookups' index relied on the query planner's choice | Fixed: they name it |
| Another clip changed a package's bytes; an old approval looked current; the reopening reason reached organisers | Fixed: H4 above |
| A deleted file put back was retried on every pass | Fixed: logged once, and still not removed |

**Decided by Fola, 1 and 2 November 2026, and built on those branches:**

- A clip not yet released, and approving one, take `view_original`. Once released, any member or organiser can open it.
- Organisers see a finding only once its evidence is released. **A finding with no clip stays with staff:** no way to approve a finding on its own was built.
- A consent reference is only a hash in the chain. A rights record's Basis is still there as text.
- The event log says a hold was released or a member disabled, not why. The reason stays on its own row, which staff can still read.
- 20-second files, and `view_original` for operators and assessors, confirmed.
- An ended session keeps its operator list for 7 days (M5).
- FP-12 and FP-13 stay deferred past the pilot (4 November 2026). They are not built, and the pilot runs without them.
- Retention stays paused on an Edge with no time source. Its recordings stay past D9 until it has one, with the alert showing.

**What still stands in the way:** FP-12 and FP-13, not built; the other
medium defect M13, open until the venue kit is measured on Linux without Docker Desktop (C5, D7 on the hardware sheet); and everything in reason 6.

### Evaluation against Prompt 8

| Area | Finding |
|---|---|
| A. Core correctness | Two feeds, gaps, recording spans, clip lineage and hashes all hold on synthetic feeds. Against that: the manifest can name the wrong calibration (M3), a real 833 ms recording gap is unexplained (M13), and retention can delete too early after a clock step (M2) |
| B. Integration | Additive migrations, no schema drift, no writes to ScoreBoard tables found, ScoreBoard suites green apart from one known CRLF failure. Admin API routes guarded and scoped. But deployed without the recorded approval (C1) |
| C. Resilience | 30-minute WAN cut, camera reconnect, Edge SIGKILL, MediaMTX restart, retries and idempotency hold on synthetic feeds. Two drill checks failed; one looks like a harness race, the other is M13. A real R2 restore cannot be tested |
| D. Security | Anonymous, cross-session and organiser boundaries hold (53/53 plus the Edge route walk). `view_original` is decorative (H3); operators are enumerable by timing (L1); RTSP is plaintext until a closed network exists (R1, open) |
| E. Licensing | Pinned and inventoried; `licences --check` exits 0; MediaMTX's digest matches the local image. FFmpeg is a GPL build (`--enable-gpl`, libx264, libx265). Every Edge row is still `REVIEW REQUIRED`: B9, B10, B10a are Fola's. Video.js and rclone are not used, so nothing needs distributing for them |
| F. Cloud cost | No FairPlay resource in `infra/`, no GPU or video service, whole-match upload does not exist. No bill was read. FairPlay's code does run on the live box (C1), at an unmeasured memory cost |
| G. Operational validity | Shadow mode is enforced at the API, in the sync receiver and by database check constraints (`fairplay_sessions_mode_check`, `fairplay_reviews_authority_mode_check`). No decision-changing control; the report wording alleges nothing about referees. PASS |
| H. Usability | Banner, keyboard map and offline chip are present in code, and the signed-out page was seen in a browser. **The signed-in console was NOT walked** (section 9) |

## 2. Requirement-to-evidence table

Commands and full results are in section 9. "Synthetic" means no real camera, venue or bucket was involved.

| ID | Pri | Result | Evidence |
|---|---|---|---|
| FP-01 Session linked to fixture | P0 | **PASS** | `fairplay:cloudcheck` 108/108; `grep` finds no write to any `sb*` model in `services/api/src/fairplay`; the only FK onto ScoreBoard is `ON DELETE SET NULL` |
| FP-02 Independent ingest | P0 | **PASS, synthetic** | `run_fixture.py core` 28/28: one source dropped while the other carried on. Real kit NOT TESTED |
| FP-03 Replay does not touch the stream | P0 | **NOT TESTED** | No YouTube encoder here. On synthetic feeds a burst of 20 replays left both sources publishing and recording (`review_defaults.py`) |
| FP-04 Jump-back and speed | P0 | **NOT TESTED** in a browser | Replay windows served 20/20; console unit tests 28/28 cover keys and time. Playback rates and jumps need the signed-in console (section 9) |
| FP-05 Calibration | P0 | **PASS, synthetic** | `tests/test_timing.py`, `run_fixture.py evidence` 30/30. Offsets are per source. Caveats M3, M11 |
| FP-06 Incident state machine | P0 | **PASS** | `tests/test_incidents.py`, `test_phase3_api.py`; versions enforced; reopening keeps the old review |
| FP-07 Four outcomes | P0 | **PASS** | Same tests; the sync receiver and a database check constraint refuse any other value |
| FP-08 Audit and lineage on export | P0 | **FAIL** at `497d3c6`; passes on `main` | Segments and hashes are there, but the export names **no reviewer, no finding and no approver** (H4) |
| FP-09 Offline 30 minutes | P0 | **PASS, synthetic** | `run_drills.py` D1: a real 30-minute cut, 5/5, nothing lost, outbox drained in 194.8 s |
| FP-10 Sync idempotency | P0 | **PASS** with a defect | The same batch 10 times on real Postgres: `applied` once, then `replayed` nine times; one incident, one review. Drill D4: 50 in flight, 50 replayed, 0 doubled. See M9 |
| FP-11 Access controls | P0 | **FAIL** at `497d3c6`; passes on `main` | Anonymous, organiser and cross-session access is refused (53/53). But anyone with any staff permission can watch originals (H3). Real bucket privacy NOT TESTED |
| FP-12 Side-by-side angles | P1 | **FAIL: not built** | No such view in the console. `phase-plan.md:111` defers it past the pilot; the sync test only tabulates windows |
| FP-13 Frame diagnostics | P1 | **FAIL: not built** | No route exists. Same deferral |
| FP-14 Monitoring | P1 | **PASS at the API**, console NOT TESTED | Health and alerts verified in drills; storage drill 21/21 |
| FP-15 Organiser report | P1 | **FAIL** at `497d3c6`; passes on `main` | Unreleased evidence is excluded, but findings are not held back (M4) |

### PID section 14 targets

| KPI | Target | Measured here | Result |
|---|---|---|---|
| Replay availability | ≥99.5% across a shadow match | No match. An 833 ms hole in a drill, most likely the test VM freezing (M13) | NOT TESTED |
| Retrieve an incident | p95 ≤15 s on the reference laptop | p95 3.7 s, inside the Edge container, not a browser and not the reference laptop | synthetic only |
| 30 s clip | usually ≤30 s | **167, 245, 262 s** at the shipped 5-minute segment (H5). On `main`: 68 of 92 within 30 s, p50 22 to 24 s | **FAIL** at `497d3c6`; synthetic only on `main` |
| Two-angle sync | ≤500 ms or flagged | Flagging works; the 500 ms itself needs real cameras | NOT TESTED |
| Offline | 30 minutes, no corruption | D1 passed; every segment re-hashed clean | synthetic only |
| Data fidelity | 100% hashed | `146/146`, `150/150` in drills | synthetic only |
| Idempotency | same batch 10x | Passed on real Postgres | PASS |
| Broadcast independence | kill the Edge; stream continues | No encoder | NOT TESTED |
| Security | no private access; no public control API | API and playback are not published by Compose; 53/53 | PASS except H3, R1; bucket NOT TESTED |
| Field pilot | 3 full matches | None | NOT TESTED |

## 3. Defects

Status: **new** was found by this review; **known** is already in the docs, regraded if stated. Everything marked
"run" was reproduced; "read" was established from the code only.

### Critical

**C1. FairPlay is already on the box serving the live site, and the release documents say otherwise.** new, run against CD logs.

- *Where:* `.github/workflows/cd.yml:17-20` runs on every successful CI on `main` and its header says that box
  "serves the live site"; `infra/ansible/roles/deploy/tasks/main.yml:389-393` runs `prisma migrate deploy`.
  `FairPlayModule` is imported unconditionally at `services/api/src/app.module.ts:18,40`.
- *Evidence:* CD logs on GitHub, host `54.225.155.75`. Run 41152231271 (31 Oct) reports
  `pre-deploy restore point … schema=20261028000000_fairplay_cloud`. The run for `497d3c6` (1 Nov, 05:42 UTC)
  reports `schema=20261030000000_fairplay_re…`, `tables=95`, then logs `FairPlayAdminController` and every
  `/api/v1/fairplay/...` route mapped. Run 40772086086 is the deploy of #310.
- *Contradicts:* `release-notes.md:5` ("Not deployed anywhere. No production migration has run"), `go-no-go.md:62-63`
  (D2, D3 shown waiting), `residual-risks.md` R20, `phase-4-cloud.md:5,10`, `decisions.md` D3 ("deployed only on a
  separate approval"), and the master prompt's stop condition. `edge-install.md:9` is accurate, but only
  because it speaks of the Edge.
- *What it is not:* no real footage or personal data is implied. From `fairplay.config.ts` the storage backend
  defaults to `off`, and `bundleFor` refuses without a signing key. `infra/` names no FairPlay setting, so those
  defaults should hold, and the migrations are additive. Unauthenticated routes such as `device/register` are
  on the public API, behind token guards and a throttle. **I could not read the live database or environment,**
  so the applied state rests on the CD logs. I found no record of the approval; Fola may have known.
- *Decided, 1 November 2026:* Fola: "It stands, fix docs". The documents are corrected, so this no longer blocks on its own; the flag below remains a suggestion. The verdict rests on the other reasons in section 1.
- *Fix as first proposed:* Fola decides whether this stands. Correct the four documents. Either put `FairPlayModule` behind an
  off-by-default flag, or accept that merging to `main` is the production decision and say so in `go-no-go.md`.

### High

**H1. A second session on the same Edge takes the operator list away mid-match.** new, run.
- *Where:* `services/api/src/fairplay/sessions.service.ts:185-196` picks the open session with the nearest
  kickoff. `fairplay_edge/cloud.py:211-243` installs it within 5 minutes; `auth.py:315-318,330` then signs out
  anyone not listed and rebinds everyone else.
- *Observed:* match 1 kicked off 65 minutes ago, match 2 kicks off in 60, neither ended: the bundle is for match 2.
  On the Edge, a person in both lists gets 404 on match 1's incidents and cannot flag in it; a person only on
  match 1 gets 401. No alert opens. Recording is unaffected. With a two-hour gap between kickoffs the flip comes
  about 60 minutes into the first match, and only while the WAN is up. The same swap ends post-match review of
  the first match.
- *Merged:* see section 1.
- *Fix as first proposed:* never replace the list for a session in progress: prefer a session the Edge has started and not ended,
  have the Edge refuse a bundle for a different session while one is open, and raise an alert either way.

**H2. The audit chain holds player references and note text, against D13.** new, run.
- *Where:* `incidents.py:168-171` (`player_ref` in `incident.created`), `incidents.py:205-206` (`note` and
  `player_ref`, old and new, in `incident.edited`). Rows sync into `fairplay_edge_audit_entries`.
- *Observed:* both values appear in `GET /edge/v1/audit` and in the outbox items bound for the cloud. Both stores
  are insert-only by trigger, so a player's request cannot remove them. `privacy.md:104-105` says references are
  "never in audit entries (D13)". The cloud check's D13 assertion covers the cloud's own audit rows only, and
  the `held` document does not report these copies.
- *Merged:* see section 1.
- *Fix as first proposed:* chain hashes of `note` and `player_ref`, as `review.completed` already does for notes. Do this before
  any real incident exists, because existing rows cannot be rewritten.

**H3. `fairplay.evidence.view_original` gates nothing.** new, run.
- *Where:* `api.py:332` (`staff`), `api.py:727,753` (`/media`, `/live`), `auth.py:53`, `access.ts:20-30`. The
  permission appears only in lists. The catalogue describes it as "Watch original venue recordings".
- *Observed:* `GET /edge/v1/media/ground` returned 200 for members holding only `incident.operate`,
  `evidence.export` or `session.manage`. Only `report.view` gets 403. The PID asks for these to be separate
  (section 3), and no test holds them apart.
- *Merged:* see section 1. The window route stays with venue staff, unlike the proposal below: it gives
  times and hashes, not pictures.
- *Fix as first proposed:* require `view_original` on `/media`, `/live` and the window routes, grant it in the operator and
  assessor roles, and add the row to the guard table in `tests/test_security.py`. Fola should confirm who gets it.

**H4. An exported evidence package names no reviewer and no finding.** new, run.
- *Where:* `evidence.py:412-457` writes the manifest when the clip is cut; `CLIP_STATES` (`evidence.py:49`) means
  that is before the finding; `evidence.py:733-746` zips that manifest as it stands.
- *Observed:* the export of a reviewed, approved clip holds `clip.mp4`, `manifest.json`, `SHA256SUMS`. Custody lists
  only `incident.created` and `evidence.requested`. The reviewer's name, the result, the notes and the approver
  are all absent. FP-08 says each export lists the reviewer; PID 5.3 says a package includes the review report.
- *Merged:* see section 1.
- *Fix as first proposed:* keep the clip's manifest immutable, and add a generated `finding.json` to the package with the result,
  reviewer, approver, audit head and its own line in `SHA256SUMS`.

**H5. A clip flagged live takes minutes at the shipped settings.** new, run.
- *Where:* `evidence.py:244-245` waits while any segment in the window is recording; `.env.example:39` sets 5 minutes.
- *Observed:* three clips flagged live at shipped `5m`, with real MediaMTX and ffmpeg: **167, 245, 262 s**.
  `go-no-go.md:77` reports "p50 2.0 s, p95 11 s", measured at 30 s segments. `demo-walkthrough.md:66` does say the
  demo uses 30-second files; the go/no-go row, which is what gets read, does not.
- *Fix as first proposed:* decide with evidence: shorter segments, measured for disk and recovery, or cutting from
  finalised parts, or restate the KPI. Correct the row either way. Replay is unaffected and is the live tool.
- *Merged:* Fola asked to try 1 minute. It misses the target, so `main` uses 20 seconds, which Fola confirmed. From the flag
  to the finished clip, flagging at random moments, on one laptop with synthetic feeds:

  | Files | Clips | p50 | p95 | Within 30 s | Recording holes |
  |---|---|---|---|---|---|
  | 5 minutes | 3 | 105 s | 243 s | 0 | 0 |
  | 1 minute | 12 | 60 s | 76 s | 2 | 0 |
  | 20 seconds | 92, in three runs | 22 to 24 s | 34 to 36 s | 68 | 0 |

  The same branch retries a waiting clip every 2 s instead of 15, stops a waiting clip holding back a ready one, makes
  the scan and window lookups skip deleted rows, and lets retention delete 600 files an hour instead of 50, in its
  own loop. Footage kept around incidents falls from about 30% of a match to about 5%. R25 still stands: it has no end.
- *New risk:* a feed that fails E17 loses up to 2 s at every file switch, about 10% of the footage at 20 s where 5-minute
  files lost 0.7%. These runs used aligned synthetic feeds. Hardware validation C5 must pass before 20 s is relied on.
- *Still unexplained:* `recording_stalled` opened twice in each of two runs, one at 20 s and one at 1 minute, with no
  hole in the recording. It did not recur in the two later 20-second runs or the 5-minute run. It may share a cause with L7.
  Disk and recovery at 20 s were not measured on real kit.

**Known and still open, confirmed at high:** R25 (`evidence_refs.synced` is never set; holds never end), R1/B16
(plaintext RTSP), R16/B2 (lawful basis). These are accurately written up by the builder.

### Medium

| # | Defect | Where | Observed (run unless stated) | Suggested fix |
|---|---|---|---|---|
| M1 | Withdrawn footage can be cut again through a new incident, against the docstring's "never … cut again". Byte-identical clip | `evidence.py:204-207` | Withdraw, flag the same moment, clip: 202 and a new row with the same SHA-256 (with the fake cutter, so same bytes by construction) | Refuse a window overlapping a withdrawn clip on that source, with an audited override |
| M2 | Retention runs through a clock step | `retention.py:87-100`, `service.py:99-103` | Clock +30 days, `clock_stepped` open: 6 of 6 recordings deleted | Skip retention while `clock_stepped` or `clock_not_synced` is open; compare with the file's age too |
| M3 | Manifest can name the wrong calibration | `evidence.py:531,436-437` | Cut used offset 800 ms; recalibrated while queued; manifest says the later calibration, offset 4500 ms. The job's own start is right. H5 makes this window minutes long. `eventAtMs` has the same weakness (read) | Store calibration id, offset and pre-roll on the job at request; build from those |
| M4 | Organisers read findings with nothing approved and no rights recorded | `api.py:1244-1250`, `report.service.ts:64-90` | Edge and cloud both return result, factual notes, on-field decision and reviewer. The cloud also lists flagged incidents | Fola decides. Proposed: hold a finding from organisers until it has released evidence or an explicit approval |
| M5 | Reviews on an ended session have a hard stop | `sessions.service.ts:186,190` | Both sessions ended: `bundle: null`. The list on the Edge then lapses within its remaining life (at most 36 h, and possibly about 18), and reviews exist only on the Edge | Keep issuing for recently ended sessions for an agreed window |
| M6 | "Synthetic" label opens the rights gate for footage cut as real | `incidents.py:348-349`, `evidence.service.ts:88` | Clip row `footage_kind: real`; session relabelled synthetic, minors `yes`, no basis: approved, organiser reads it. Known (`rights-checklist.md:43`, F13), regraded from low | Require the evidence row's own kind too; allow "synthetic" only with DEV bundles or a configured synthetic device |
| M7 | Failed pairing burns the token and leaves a half-paired Edge | `cloud.py:128-153`, `README.md:95` | Unwritable keys file: cloud consumed the token, device token and pairing row saved, key not written, `PermissionError`. The README's bind mount `./auth` is likely unwritable by uid 10001 on Linux (not run; no Linux host) | Check the path is writable before registering; have `pair` retry-safe; run the README path on Linux |
| M8 | A NUL byte stalls sync | `sync.service.ts:103-107`, `outbox.py:150-155` | Postgres refuses it, the item gets no answer. By reading, retries then hold back everything of its rank and above: incidents, reviews, evidence, audit and **withdrawal confirmations**. Known F12, regraded from low; hold-back not run end to end | Reject NUL in `shape()`, refuse it in the Edge's models |
| M9 | A rejected item is later reported as `replayed` | `sync.service.ts:123-125` | Same key twice: `rejected`, then `replayed`, not applied. The Edge marks it `sent`. So any developer re-send of a parked item (R12's only route), or a restore, loses it silently | Return the stored status for a receipt that was rejected |
| M10 | Replay cache outlives retention and withdrawal | `api.py:694,712-718,749` | Originals deleted by retention; `/media` still served the cached window with no fetch. No age limit, and it is written below the hard disk limit (read). Known F18, marked "not re-checked"; regraded from low because this is footage of players | Sweep the cache in `retention.apply`, and on withdrawal |
| M11 | Calibrations and period marks are outside the audit chain; `supersedes` is unchecked | `audit.py:32-59`, `timing.py:176-216,134-159` | A drone calibration in another session superseding ground's: 201, and ground became uncalibrated. No `calibration.*` or `period.*` entry exists unless the offset is large | Validate same session and source; add them to the chain |
| M12 | No warning before the operator list expires | `service.py:69-88`, `App.tsx:81-84` | One hour before expiry: no alert. The console shows expiry only on the sign-in page (read). Everyone is then signed out mid-session | Alert at 12 h and 2 h, in the console |
| M13 | An unexplained recording gap | `run_drills.py` D4 | Ground lost 833 ms at 06:39:12, about 21 s after the Edge was killed, while MediaMTX was never touched; drone none. **Cause not established.** The rehearsal's 12 s gap (`demo-walkthrough.md`) is also unexplained, and could share it. It is shown as a gap, not hidden | Log it at the next run with MediaMTX's output kept; hardware validation must close it before the 99.5% target means anything |

### Low

| # | Defect | Where | Observed |
|---|---|---|---|
| L1 | Sign-in timing reveals who is on the list, though `auth.py:281` says it does not | `auth.py:275` | Wrong PIN: listed email 133–169 ms, unknown email 15–18 ms. Run a dummy scrypt |
| L2 | A clip is not re-hashed when read | `api.py:1170-1184` | Tampered clip served to an organiser, 200, no alert; `/manifest` correctly refused with 409 |
| L3 | A new finding re-releases old approval | `evidence.py:615-625` | Reopened, withheld, then a *different* result: organiser reads the clip with no new approval |
| L4 | `payloadHash` is never checked against the payload | `sync.service.ts:160` | All-zero hash: `applied`. Conflict detection relies on the sender's own word |
| L5 | A person bound to a session sees other sessions' records | `api.py:839-850` | Other sessions' holds, and emails and addresses in `/events`, for a bound operator |
| L6 | Compose publishes only 8554, yet `srt` and `rtmp` are valid protocols | `compose.yaml:59`, `config.py:18` | Read. Such a source could not reach MediaMTX |
| L7 | False critical after an Edge restart | `watchdog.py:172-181` | `recording_stalled` opened critical for about 3 s at each restart in D4 and D5 |
| L8 | Idle sign-out probably never fires with the console open | `Console.tsx:73`, `auth.py:321-323` | Read, not run: each poll refreshes `last_seen_utc` |
| L9 | Stale text | `outbox.py:16-17` (receiver "not built yet"), `docs/fairplay/README.md:4,11-37` (status stops at Phase 4; index omits `runbook.md`, `residual-risks.md`, `edge-install.md`), `auth.py:14`, `auth.py:64` against `:72` | Read |
| L10 | Fixtures cannot run offline as written | `run_fixture.py:224`, `run_drills.py:193,195` | `--build`, `compose build`, and a hard-coded `:local` image, which here lacks `licences.py`, `measure.py`, `worksheet.py` and is older than the code |
| L11 | Drill harness race | `run_drills.py:403-404` | D3 reported one "rewritten" file, started 1.8 s before the restart. It is probably the open segment not yet indexed: 146/146 re-hashed clean. Inferred, not proven. Take the open list after a scan |

## 4. Measurements and test environment

**This is not the matchday machine. CPU, RAM and disk from real kit: NOT TESTED.**

Environment: Windows 11 Home laptop, Docker Desktop 29.8.0, 4 CPUs and 3.65 GiB given to Docker. MediaMTX 1.21.3,
FFmpeg 7.1.5, Python 3.12.15. Synthetic feeds at about 2.6 and 0.6 Mbit/s, encoded on the same machine, which real
cameras would not do. Edge code from `497d3c6`, copied into a local image with nothing downloaded.

| Measure | Result | Notes |
|---|---|---|
| Replay, 30 s window | **p50 227 ms, p95 3,723 ms, max 4,550 ms**; 20/20 | From inside the Edge to its own `/media`, shipped segment length. Not a browser and not `canplay`, so not the PID's definition |
| Clip, flagged live, `5m` segments | **167, 245, 262 s** | 3 samples, too few for a p95 |
| Edge | 0.2–25.9% CPU, 57–86 MiB | `docker stats` samples, highest while hashing and catching up |
| MediaMTX | 2.0–6.4% CPU, 31–120 MiB | |
| Synthetic encoders | 17–40% CPU, 67–96 MiB | Test only |
| Recovery | MediaMTX restart 4.7 s; Edge kill 12.3 s with a manual start; all containers killed 23.2 s including 15 s off; WAN return to empty outbox 194.8 s | Docker kills, not a power cut |
| Footage lost | MediaMTX restart 1.5–1.7 s per camera; simulated power cut 19–21 s | Each shown as a gap |
| Disk | No drive measured | Worksheet below |

## 5. Cloud and storage cost

`fairplay-edge worksheet` from this run's measured bitrates, headed "NOT A VENUE FIGURE". Assumes 3 h a match, 10
matches a month, 10 incidents a match.

| Item | Estimate |
|---|---|
| R2, a month, gross | **$0.056** (3.62 GB; prices the worksheet records as checked 1 Nov, not rechecked here). Above D1's about $0.12 at higher bitrates, by the builder's figure |
| AWS | $0 new resource. Added memory on the live box unmeasured (C1). **No bill read** |
| GPU, video compute, third-party AI | None found |
| Edge disk | 65.6 GB if holds end; **304.7 GB as built, growing 13.3 GB a month** (R25). With H5's branch, at the worksheet's synthetic rates: 101.3 GB as built, growing 2 GB a month |

**Observed usage: none available.** No bucket exists, and I had no AWS or Cloudflare access. Whole-match upload is not
built: `KINDS` is clip and manifest only (`evidence.service.ts:35`).

## 6. Reproducing the unresolved failures

Use a throwaway database and synthetic feeds. To avoid downloads, copy `fairplay_edge` into a committed local image
and set `FAIRPLAY_EDGE_TAG`, removing `--build` as in L10. "Edge rig" means the signed-in clients and fake MediaMTX of
`tests/test_phase3_api.py`, in `fp-edge-test`. "Cloud rig" means the service set-up in `fairplay-cloud-check.ts`.

| Defect | Steps |
|---|---|
| C1 | `gh run view 41152231271 --log`, and the CD run for `497d3c6`. Search for `restore point` and `FairPlayAdminController` |
| H1 | Cloud rig: two sessions on one device, kickoffs now −65 min and +60 min, each with a member and a PIN; `sessions.bundleFor(device)`. Edge rig: sign in on a bundle for session A, write one for B, `reload_bundle()`, `GET /incidents?sessionId=A` |
| H2 | Edge rig: POST an incident with `playerRef` and `note`, PATCH both, `GET /edge/v1/audit`, then read the `outbox` rows |
| H3 | Edge rig: member with only `evidence.export`; `GET /edge/v1/media/ground?...` with `app.state.fetch_window` stubbed |
| H4 | Edge rig: review, approve and POST `/export`; read `manifest.json` in the zip |
| H5 | Compose stack with `FAIRPLAY_RECORD_SEGMENT_DURATION=5m`; after 2.5 minutes flag `operator_now`, POST a clip, poll the job |
| M1 | Edge rig: withdraw a clip, flag the same `eventUtc`, POST a clip |
| M2 | `ClockWatch.sample` twice, 30 days apart; `retention.apply(settings, store, scanner, now=T0+30d)` with `FAIRPLAY_RETENTION_DAYS=14` |
| M3 | `request_clip`, `calibrate` again, `run_jobs_once`; compare `manifest.window` with the `evidence.requested` entry |
| M4 | Edge rig: a completed review, no rights; `GET /report/sessions/{id}` as the organiser. Cloud rig: `reports.report` with a `report.view` context |
| M5 | Cloud rig: sync `ended_utc` for every session on the device; `bundleFor` |
| M6 | Edge rig: POST rights `synthetic`, `not_recorded`, minors `yes`; approve; organiser GET `/file` |
| M7 | `cloud.pair` with a client stub and a read-only folder for the keys file |
| M8, M9 | Cloud rig: `sync.receive` with `note: "a\u0000b"`; with an unassigned `session_id`, twice |
| M10 | Edge rig: GET `/media`, `retention.apply` 30 days on, GET again and count fetches |
| M11 | Edge rig: POST a calibration in another session with `supersedes` set to the first's id |
| M12 | Edge rig: a bundle expiring in 1 h, `run_once`, `GET /alerts` |
| M13 | `python -I fixtures/run_drills.py`; see the D4 check. May not recur |
| L1–L5 | Edge rig, as each row states; L4 with the cloud rig |
| L7 | `run_drills.py`, then read `alerts` in `results.json` |
| L11 | As M13; may not recur |

## 7. Migration, rollout and rollback

**State today, from CD logs:** `20261028000000_fairplay_cloud` and `20261030000000_fairplay_requests` are applied on
live, and the API routes are mounted. **Any merge to `main` that passes CI deploys and migrates, including this
report's branch.**

**Migrations.** Both are additive: new tables, constraints and triggers, plus an FK to `sb_matches` with `SET NULL`.
Fresh `prisma migrate deploy` succeeds, and `prisma migrate diff --from-url … --to-schema-datamodel … --exit-code`
reports no difference. H3's branch adds a third, `20261101000000_fairplay_view_original_roles`, which only grants a permission to two existing roles and does nothing where they do not exist.

**Rollout, if Fola signs, in this order. Each step is a separate approval, and I have done none:**

1. Done, without a recorded review: the fixes for H1 to H5 and FP-15 are merged and deployed. Tick Watch originals on
   any place already given in an open session.
2. Settle rights, the lawful basis and RC1 to RC8, and B9, B10, B10a.
3. Create the private R2 bucket and scoped token; verify its checksum refusal, `HEAD` checksum and anonymous refusal,
   none of which the stand-in S3 can prove. Set `FAIRPLAY_STORAGE_BACKEND=r2` and its values.
4. Generate `FAIRPLAY_BUNDLE_SIGNING_KEY` on the server, kept in its secrets.
5. Install an Edge with `deploy/install.sh` on the real machine, with disk encryption and a custodian, and pair it. Run
   the README's pairing path on that OS first (M7).
6. Run `hardware-validation.md`, then a rehearsal with no real players.
7. Assign FairPlay roles for one session only. Then the three shadow matches the PID asks for.

**Rollback.**

| What | How |
|---|---|
| Turn FairPlay off for people | Remove role grants. Set `FAIRPLAY_STORAGE_BACKEND=off`; unset the signing key to stop bundles |
| Remove the routes | Needs code: a flag or a revert of the module's import (C1), then a normal deploy. Deploying an old image alone is undone by the next merge |
| Schema | Forward only: CD's rollback passes `run_migrations=false`. The tables stay until a later, approved migration drops them. The triggers do not block `DROP TABLE`. Restore point: `/var/backups/dtp-db/pre-deploy-*.dump` on the box |
| Edge | `deploy/update.sh` with the previous tag, plus its backup after a schema change. Unset `FAIRPLAY_CLOUD_SYNC_URL`: nothing leaves and the outbox keeps everything. Stopping it leaves the broadcast alone by design (hardware validation G not run) |

## 8. Pilot acceptance checklist and outstanding approvals

**Operator acceptance, on the real kit.** `operator-guide.md` has the procedure; none of this has happened.

- [ ] Equipment audit answered; gate 1 decided (one angle or two)
- [ ] Hardware validation sheet accepted; recording gaps explained (M13)
- [ ] Named person for each job, and a watcher for each match (R7)
- [ ] Each operator trained and signed in with their own PIN; sign-in tried from a real reviewer device over HTTPS (B12)
- [ ] 90/60/30/15-minute checks run from the guide
- [ ] Kickoff and halftime marked; each camera calibrated; recalibrated after a deliberate reconnect
- [ ] Incident flagged; replay within 15 s on the venue LAN; camera changed; each of the four findings recorded once
- [ ] Clip made and its real wait recorded against the agreed target (H5)
- [ ] WAN pulled for 30 minutes, then restored; outbox drained; nothing doubled
- [ ] Camera, power and disk failures walked from the recovery pages, including a real power cut (R11)
- [ ] Broadcast seen to carry on with the Edge killed
- [ ] Report read by Fola before it leaves; export checked for the finding (H4)
- [ ] Three full shadow matches logged, with p50 and p95 and every failure

**Outstanding approvals.**

| From | What |
|---|---|
| Fola | Release sign-off; residual-risk signature (R23 to R26 undecided); B9, B10, B10a; RC1 to RC8; R2 bucket; signing key; any purchase |
| Organisers, with legal advice | Competition agreement, lawful basis and consent under the NDPA 2023, no minors until settled (R16); who may see findings; retention periods; people in shot who are not players (RC7); footage ownership (RC8) |
| Matchday crew | Equipment audit, hardware validation, cost sheet from measured bitrates |

## 9. Files changed and full test results

**Files changed:** this file only, for the review. No code, no signature, no licence status. On Fola's later word about C1, a separate commit corrected the deployment statements in `README.md`, `blockers.md`, `decisions.md`, `go-no-go.md`, `phase-4-cloud.md`, `phase-plan.md`, `release-notes.md` and `residual-risks.md`, and the one line of `tests/test_demo_and_gonogo.py` that held the old wording. The fixes for H1 to H5 are on their own branches, listed in section 1; this report was then updated to say so.

Run from an LF export of `497d3c6`. Cloud checks each used a new `fpreview_scratch_*` database in `dtp-postgres`, dropped
afterwards. API and web suites ran in the shared checkout, whose tree matches `497d3c6` apart from uncommitted
`.claude/launch.json` and `SQUAD_MANAGEMENT_SUMMARY.md`. All stacks, scratch databases and the temporary image tag were removed.

| Command | Result |
|---|---|
| `python -m pytest -q -rs -p no:cacheprovider` (in `fp-edge-test`) | 446 passed, 1 skipped (run by e2e) |
| `pnpm --filter @dtp/api fairplay:cloudcheck` | 108/108 |
| `fairplay:securitycheck` | 53/53 |
| `fairplay:e2echeck` | 42/42, real API, real Edge code, S3 stand-in |
| `fairplay:restorecheck` | First run **21 passed, 9 failed**, my error: the database was empty and the script needs one `cloudcheck` has filled. Re-run correctly: 30/30 |
| `pnpm --filter @dtp/fairplay-console test`, `typecheck` | 28 passed; clean |
| `pnpm --filter @dtp/api test`, `typecheck` | **1 failed**, 2294 passed, 1 skipped; clean. The failure is `scripts/gates.spec.ts`, on CRLF line ends in a Vision file in a Windows checkout, already recorded in `phase-4-cloud.md:255`; not FairPlay. CI on `main` was green for `497d3c6` |
| `pnpm --filter @dtp/web test`, `typecheck` | 348 passed; clean |
| `prisma migrate deploy`; `prisma migrate diff` | applied; no difference |
| `fairplay-edge licences --check` | exit 0 |
| `run_fixture.py core` * | 28/28 |
| `run_fixture.py evidence` * | 30/30 |
| `run_drills.py`, 30-minute WAN * | **32 passed, 2 failed**: D3 (L11), D4 (M13) |
| `run_drills.py storage` * | 21/21 |
| `run_demo.py up`, `wan off`, `wan on`, `check`, `estimate`, `down` ** | 29/29; audit chain ok, 40 entries; outbox empty after WAN return |
| Reviewer's probes, `fixtures/review_defaults.py` | As reported in section 3; 5 of 6 checks, the failure being H5 |

\* Copies patched only to avoid downloads: `--build` removed, image tag changed. `wan --minutes 30` was not run separately, because
drill D1 is the same cut with more going on.
\*\* The `wan` steps stopped the demo's relays at once, so this proves less than D1.

Reviewer's scripts and logs: session notes folder `phase-7-review/`, outside the repository.

**After the fixes:** the final merge is `d86c88d`, of H1 to H5, FP-15, their follow-ups and this branch. Cloud checks each
used a new `fpmerge_scratch_*` database, dropped afterwards. Stacks and temporary image tags were removed.

| Command | Result |
|---|---|
| `python -m pytest -q -p no:cacheprovider` (in `fp-edge-test`) | 471 passed, 1 skipped |
| `run_fixture.py evidence` * | 30/30 |
| 20 s for 20 minutes on the real stack, then with 190,000 deleted rows * | 31 clips, 23 within 30 s, p50 23 s, p95 34 s; no holes or alerts; window lookup p50 45 ms, replay p50 416 ms |
| H3's migration on a scratch database, empty, then with the roles, then again | no error; the two roles granted, a third not |
| `fairplay:cloudcheck` | 115/115 |
| `fairplay:restorecheck` | 30/30 |
| `fairplay:securitycheck` | 53/53 |
| `fairplay:e2echeck` | 44/44 |
| `vitest run src/fairplay` in `services/api`; `tsc` | 28 passed; clean |
| `pnpm --filter @dtp/fairplay-console` tests; `tsc` | 30 passed; clean |
| `apps/web` tests | 348 passed |

The 20 s run and the migration ran on `83e5f52`, before the last rules, which do not touch recording or roles. On the same code, `dba5e8b`, the last things to run: `run_fixture.py core` * 28/28, `run_drills.py` * 34/34 with the 30-minute WAN cut, `run_drills.py storage` * 21/21, and `run_demo.py up`, `wan off`, `wan on`, `check`, `estimate`, `down` 29/29, audit chain whole, outbox empty. These set 30-second files, as the fixtures do, and the drills did not exercise H1's hold.

The whole API suite last ran on `d831cfc`: **1 failed**, 2295 passed, 1 skipped, the same `scripts/gates.spec.ts` CRLF check on a Vision file as above. CI on `main` covers it since.

**NOT TESTED, and why:**

| What | Why |
|---|---|
| Real cameras, switcher, drone, venue LAN, matchday machine, CPU, RAM and disk from it | No kit exists here |
| YouTube and broadcast independence | No encoder |
| A real power cut, UPS, SSD wear | No kit; a Docker kill is not one |
| Real R2: privacy, checksum refusal, `HEAD` checksum | No bucket, and not to be created. The stand-in checks no signature |
| Signed-in console and web admin in a browser: playback rates, jumps, keyboard, error states, printing the report | My rules stop me entering sign-in details on a request that did not come directly from Fola, so I saw only the signed-out page: banner present, sign-in form, one expected 401. The builder's own browser runs are unverified. **Have someone walk it** |
| HTTPS from a real second device | No device. `tests/test_tls.py` passed |
| `deploy/install.sh`, `compose build`, systemd units, any Linux host | Would download wheels, and no Linux host |
| Live database and environment | Not to be read; C1 rests on CD logs |
| Actual bills | No access |
| Real footage, real users | Not permitted, and none exists |

## 10. Sign-off requested

**FairPlay V1 is not recommended for release.** Fola, please decide:

1. ~~Does the production state in C1 stand, and who corrects the documents?~~ Decided 1 November 2026: it stands, and the documents are corrected.
2. ~~Which of C1 and H1 to H5 are fixed, in what order?~~ Fola asked for all of them, and they are merged (section 1).
3. Release sign-off stays open until then. Nothing here has activated production, and nothing here should be read as
   approval to do so. `residual-risks.md` and `go-no-go.md` remain unsigned by this review.
