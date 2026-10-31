# FairPlay — operator guide

Increment 6.3 of the plan ([phase-plan.md](./phase-plan.md)): how to run a match on FairPlay, what
to check and when, what to do when something fails, and how to train someone. Print the
[matchday card](#the-matchday-clock) and the [recovery pages](#when-something-fails).

**Status.** Every step was walked on the real console and Edge with synthetic feeds. It has not
been used at a venue or with real cameras, so expect corrections after the first rehearsal.
Real footage waits for the [go/no-go checklist](./phase-plan.md) and for risks R1, R4, R8, R16
and R19 ([residual-risks.md](./residual-risks.md)).

## The rules

1. **FairPlay never reaches the match.** Do not tell a referee, an official, a coach or anyone on
   the touchline what the footage shows. No radio, no signal, no message. Findings are for
   afterwards, and they change no decision or score.
2. **It is not VAR.** It is not FIFA-authorised VAR or FVS. Do not call it that, or let anyone
   else call it that.
3. **No matches with minors,** until this is settled with the organisers and legal advice (R16).
   An adult match still needs a lawful basis and its rights recorded before kick-off.
4. **Clips do not go to the public or to WhatsApp.** A clip leaves only through Approve, and only
   to the people it was approved for. Do not film the screen.
5. **Someone is watching.** Nothing pages anyone: alerts only appear on the console. Each match
   has one named person watching it from before kick-off to the end (R7).

## Who does what

Each person gets only what their job needs, on the match's FairPlay page.

| Job | Permission | What they do |
|---|---|---|
| Operator | Flag incidents | marks the periods, flags incidents, requests clips |
| Assessor | Record findings | reviews incidents and records what the footage shows |
| Session lead | Run the session | opens and ends the session |
| Releaser | Approve and export | approves clips for release and exports them |
| Edge admin | Edge admin | records rights, acknowledges alerts, withdraws clips, runs the machine's commands |
| Organiser | report only (`fairplay.report.view`) | reads the findings and approved clips of their own competitions |

One person can hold several jobs, but they should not review and release the same clip alone if a
second person is there.

## Before matchday

Do these at least two days before. They need the internet.

**Once for each machine (Edge admin).** Install it ([edge-install.md](./edge-install.md)). Then:

1. In `/admin/fairplay`, under **Edge devices**, enter a name and press **Add device**. The
   bootstrap token is shown once. Save it to a file on the Edge machine.
2. Pair it, using the command in [the Edge's README](../../services/fairplay-edge/README.md), then
   delete the token file and restart the Edge.
3. Install `venue-ca.pem` as a trusted CA on every reviewer device.
4. Give each camera its publish address (edge-install.md).

**Once for each match (session lead).**

1. In ScoreBoard → Match center, open the match and choose FairPlay.
2. Under **Provision a session**, choose the device and the mode, tick who may act and what they
   may do, and press **Provision session**.
3. Each member opens the same page and sets **Your matchday PIN**, 8 to 12 digits. Nobody can set
   it for them. A member marked "not set: cannot sign in" cannot sign in at the venue.
4. Bring the Edge online within 36 hours of the match, and for at least 5 minutes after the last
   PIN is set. It collects the operator list then, and the list lasts 36 hours.

**Rights (Edge admin).** Have the agreement or licence and any consent reference ready.

## The matchday clock

Times are before kick-off. Allow more time for the first few matches.

### 90 minutes
- [ ] Machine on mains power, on a UPS if there is one. The backup disk is with the custodian.
- [ ] The stack is up: `docker compose ps` shows `edge` as healthy.
- [ ] Open the console. It shows "Operator list valid until" a time **after** full time. If not,
      connect the Edge to the internet and wait 5 minutes.
- [ ] Every person who will act signs in once, on the device they will use.
- [ ] The named person watching this match is here.
- [ ] Remove nothing from the machine. Run nothing heavy on it during the match: load slows detection.

### 60 minutes
- [ ] Cameras on and publishing. Each card reads **● Recording**.
- [ ] The picture and resolution on each card are what you expect, using **Live**.
- [ ] Press **New session** and name it after the fixture. On a provisioned Edge this opens the
      match's own session.
- [ ] Open **Record rights (admin)** and record the rights. Read the sentence at the top of the
      panel. "Nothing leaves this Edge" is correct if release has not been agreed.
- [ ] **Players may be minors** is `no`. If it is `yes` or `unknown`, stop and call the project lead.

### 30 minutes
- [ ] The header chip reads **Edge ok**. Read and clear any warning, or write down why it stays.
- [ ] **Disk**: no disk banner. Budget about 1.1 GB per camera-hour, a figure from synthetic
      feeds only; replace it with the venue's own from 6.4.
- [ ] **Clock**: no clock banner. Compare the **Edge** time with the match console or a phone. If
      they differ by more than a second, write it down.
- [ ] **Cloud** reads "in sync", or "local only" if there is no internet, which is fine.
- [ ] Flag a test incident, wait a minute, press **Make ground clip**, and **View** it. Note in it
      that it is a test.

### 15 minutes
- [ ] Calibrate each camera against the same visible event ([below](#calibrate)). Use a clap or
      a whistle if the teams are not out yet.
- [ ] Press **Synchronisation test at this moment** and read its sentence.
- [ ] Everyone knows who presses what, and says the rules aloud once.
- [ ] Close everything else on the console device. Turn off its sleep timer.

## During the match

| When | Do | Then you see |
|---|---|---|
| The whistle for kick-off | **Kick-off** | "Period 1 start marked" and a **Match** clock in the header |
| Half-time | **Half-time** | "Period 1 end marked" |
| Before the second half | calibrate again | a new offset on each card |
| Second half starts | **2nd half** | "Period 2 start marked" |
| Full time | **Full time** | "Period 2 end marked" |

**A wrong press.** A mark cannot be taken back from the console. Pressing again adds a second mark,
and the **Match** clock counts from the latest start. Press it again at the right moment if you
can, and write down what happened. Both marks stay in the record.

**Flag an incident.** Press **Flag incident**, or the `F` key, the moment it happens. Don't stop to
think about it: a flag decides nothing, and the time can be reviewed later.
- For a moment you find in the replay, pause on it and press **Flag at replay position**.
- For a minute someone gives you, use **Flag at minute**.
- Add the category, the note and a **Player (shirt or register id)**, then **Save**. Staff always
  record a player reference: it is how a player's request later finds this incident (R18).

**Replay.** The recording and the live picture carry on while you replay.

| Key | Does | Key | Does |
|---|---|---|---|
| `Space` | play or pause | `F` | flag an incident |
| `1` `2` `3` | back 10, 30, 60 s | `I` | open the latest incident |
| `,` `.` | a tenth of a second | `L` | return to live |
| `S` | change speed | `G` `D` `P` | ground, drone, programme |
| `?` | list the keys | | |

A sign-in ends after 30 idle minutes, after 8 hours, or when the operator list expires. Sign in again
if the console asks: nothing is lost, and recording never depended on it.

Positions are approximate: seeking lands on keyframes. Read any warning under the replay, such as
"not calibrated" or "reconnected after it was calibrated". It is telling you how far to trust that
picture's timing.

### Calibrate

Needed at kick-off and half-time, and after a camera reconnects.

1. Replay one camera, and pause on a visible event: the whistle, the kick, the test marker.
2. Press **This frame is the reference**, or **Use the last period mark**.
3. Switch camera and pause on the same event.
4. Set the uncertainty and the method, and press **Same event here**.

If it asks you to confirm a large offset, you may have picked the wrong frame. Check before you
keep it.

## After the match

Do these in order. The cameras keep recording until you turn them off, so turn them off first.

1. **Turn off the cameras.** "No feed from this camera" is expected now.
2. **Flag anything you still mean to flag.** Once the session has ended, no incident or period
   mark can be added.
3. **Press End session** (session lead), and confirm. It cannot be undone. Reviews, clips, approval
   and export all carry on afterwards.
4. **Request clips.** Open each incident and press **Make ground clip** or **Make drone clip**. Read
   the coverage column: "partial" means part of that window was not recorded.
5. **Review (assessor).** Press **Start review**, enter the **On-field decision** as it was given,
   choose a **Finding**, write in **Factual notes** only what the footage shows, tick the evidence
   relied on, and press **Record finding**.
   - A finding is not a ruling. Don't say who was right.
   - If you were wrong, enter a reason and press **Reopen**. The earlier finding is kept.
6. **Release (releaser).** Press **Approve**, then **Export** if a package is needed. The Edge refuses
   until the finding is complete and the rights permit it, and says why. Note the package's
   SHA-256 and pass it on with the package.
7. **Archive (assessor).** Press **Archive** on each reviewed incident.
8. **Sync.** Connect the Edge to the internet and wait for **Cloud** to read "in sync". If it reads
   "need attention", tell the Edge admin (runbook, `outbox_parked`).
9. **Report (session lead).** In `/admin/fairplay`, open the session's **Report**. Check its incident
   list against your own notes, then use **Print** or **Download JSON**. "Not uploaded yet" means the
   clip has not arrived; check again before you send anything. Only organisers of this competition
   read it there.
10. **Back up (Edge admin).** `sudo deploy/backup.sh <folder on the encrypted disk>`
    ([edge-backup.md](./edge-backup.md)). Hand the disk to the custodian.
11. **A dispute?** Recordings go after 14 days. Before then, the Edge admin keeps that stretch:

    ```bash
    docker compose exec -T edge fairplay-edge api POST /edge/v1/holds --body '{"fromUtc":"<start>","toUtc":"<end>","reason":"manual","ref":"<why>"}'
    ```

    Times are UTC, such as `2026-11-01T15:00:00.000Z`. Don't put a name in `ref`.
12. **Shut down (Edge admin).** The Edge stays with its custodian. To stop it on purpose:

    ```bash
    bash deploy/maintenance on "after <fixture>"
    docker compose stop
    ```

    Otherwise the watchdog starts it again. Run `bash deploy/maintenance off` and
    `docker compose up -d` before the next use. **Never run `docker compose down -v`: it deletes every
    recording.**

## When something fails

**First, keep recording, and don't go near the match.** Write down what happened and when. Most
failures need no action or one command, and recording does not depend on the console or the internet.

The numbers below come from drills on synthetic feeds ([runbook](./runbook.md#recovery-time-and-recovery-point)).
They are not venue measurements. What each alert means is in [the runbook](./runbook.md#the-edges-alerts).

### Network

| You see | It means | Do |
|---|---|---|
| **Cloud** reads "N to send", or the last error on hover | the internet is down | nothing. Records wait, and are sent once when it returns (206 s after a 30-minute cut). |
| The console cannot reach the Edge; recording is unknown | the venue network or the console device | check the cable and Wi-Fi, then reload. Sign in again if needed. The Edge records regardless. Look at the machine: `docker compose ps`. |
| "Nobody can sign in" | the operator list expired or never arrived | get the Edge online for 5 minutes. With no internet at all, everyone is signed out when the list expires, and nobody can review until it is renewed: call the project lead. Recording carries on. |
| "This Edge's cloud token has expired" | nothing reaches the cloud | a DTP admin re-pairs it on the FairPlay page. Not urgent during a match. |

### Camera

| You see | It means | Do |
|---|---|---|
| "Unavailable — no feed" on a card | the camera stopped publishing | check its power, cable and encoder. It records again about 5 s after it returns; the gap is shown, and nothing else is lost. |
| "Connected, NOT recording" | the recorder is not writing | wait 30 s. If it stays, the Edge admin runs `docker compose restart mediamtx`, which costs about 3 s of **every** camera. |
| "Recorder unreachable" | MediaMTX is down | the same command. |
| "Publishing from a new address" | it may be a replacement, or someone else | check the camera before you trust new footage. Then the Edge admin presses **Confirm address**. If you can't explain it, say so in the reason and treat the footage as doubtful. |
| "reconnected after it was calibrated" | the camera's timing may have moved | [calibrate](#calibrate) that camera again. |
| The drone is gone for good | single-angle from here | carry on. The drone is optional, so its alert is only a warning. |

### Power

1. Power cut: when it returns, wait 2 minutes. The machine should start the stack by itself. This is
   not yet proved on a real machine (R11).
2. If `docker compose ps` shows nothing running: `docker compose up -d`.
3. Check that each card reads **● Recording**. In the drill, a 15 s cut cost about 21 s of footage on
   each camera and no records.
4. [Calibrate](#calibrate) again. Write down the gap.
5. The Edge admin reads and acknowledges "A recording file ended mid-write".

If only the Edge's own service stopped: `docker compose start edge`. Recording did not stop.

### Storage

| Banner or chip | It means | Do |
|---|---|---|
| "Disk running low" (below 20 GB) | recording carries on, and the banner estimates the time left | plan to free space at half-time, not now. |
| Below the hard limit (5 GB) | new sessions and clips are refused; recording carries on | the Edge admin frees space now. |
| Below 64 MB | nothing can be written, and footage is being lost | the Edge admin frees space at once. It records again about 8 s after, with no restart. The time it was full is gone. |

**Freeing space (Edge admin).** Preview first: `docker compose exec -T edge fairplay-edge retention`.
Then add `--apply` to delete what the rule allows. It never deletes held footage, or footage behind
evidence not yet synced. Move other files off the machine if that isn't enough.

**Never delete anything from the recordings folder by hand.** It raises a critical alert, and the
footage cannot be proved afterwards.

A disk that is failing, or a machine lost altogether: stop, keep the disk, and call the project
lead. The way back is [edge-backup.md](./edge-backup.md). It loses everything since the last backup,
and all recordings.

### Other warnings

| You see | Do |
|---|---|
| A clock banner | carry on. Camera offsets hold, but wall times may be off. Compare with the match console and write the difference down. |
| "An evidence clip no longer matches its hash" | do not release it. Cut it again, report it, and have the Edge admin acknowledge it. |
| "A recording file no longer matches its hash" | do not use it as evidence. Report it, and have the Edge admin acknowledge it. |
| "This Edge was restored from a backup" | clips are held back until it has spoken to the cloud ([edge-backup.md](./edge-backup.md)). |
| A request from a player or parent | don't handle it at the venue. Pass it to DTP, who record it in `/admin/fairplay/requests`. |

## Rehearsal

Do one before every first match at a venue, and after any change of kit. Allow 90 minutes, and use
a real pitch if you can, with no real match on it.

**With no real cameras.** Start the synthetic feeds with `COMPOSE_PROFILES=synthetic docker compose up -d`.
They are marked `SYNTHETIC ... NOT REAL FOOTAGE` in the picture.

**With DEV credentials,** where no cloud session exists, the banner reads *DEV CREDENTIALS — NOT FOR A
REAL MATCH* on every screen. See [the Edge's README](../../services/fairplay-edge/README.md). A DEV
signing key stays off the Edge, and a real match never runs on one.

**Run the whole of this guide:** the 90/60/30/15 checks, all four period marks, at least three
incidents (one by `F`, one at the replay position, one by minute), every step after the match, and
one failure from each recovery table: pull a camera's cable for a minute, unplug the internet, restart
MediaMTX. Record the rights as `synthetic test feed`.

**Write down** anything in this guide that was wrong. Measure what 6.4 asks for while you are there.

## Training

An operator is ready when they have done all of this, unaided, with synthetic feeds, in front of
someone who has already passed. Keep the signed page.

| # | Exercise | Passes when |
|---|---|---|
| 1 | State the rules, and answer: "the coach asks you what the replay showed" | they refuse, and say why |
| 2 | Sign in, and read the header from left to right | they can say what each chip means |
| 3 | Mark the four periods from a called whistle | the marks are within a second or two of the call |
| 4 | Flag three incidents, by `F`, at replay position and by minute | all three are in the list, each with a category and a player reference |
| 5 | Find a moment given as a UTC time and a match minute | under 30 seconds, without using the mouse for the jump back |
| 6 | Calibrate two cameras, then run the synchronisation test | they can read the sentence aloud and explain "±" |
| 7 | Pull a camera's cable and put it back | they see the card change, recalibrate, and write it down |
| 8 | Restart MediaMTX (Edge admin only) | every card returns to **● Recording** |

**Assessors,** as well as the above:

| # | Exercise | Passes when |
|---|---|---|
| 9 | Review an incident with two clips | the notes say what is seen and not who was right |
| 10 | Review one where the footage does not settle it | they choose **Inconclusive** |
| 11 | Reopen a finding | they give a reason, and can show the earlier finding kept |

**Edge admins and releasers,** as well as the above:

| # | Exercise | Passes when |
|---|---|---|
| 12 | Try to approve a clip with no rights recorded | they read the refusal and record the rights properly, or stop |
| 13 | Approve and export a clip, and check its hash | the hash matches the one in the package |
| 14 | Withdraw a clip on a pretend request | the file is gone and the record remains; no name is put in a reason |
| 15 | Run a backup, then restore it to a second machine | [edge-backup.md](./edge-backup.md)'s checks all read sound |
| 16 | Free space using the retention preview, then `--apply` | nothing was deleted by hand |

```text
Name: ______________________   Role: __________________   Exercises passed: ________
Trained by: ________________   Date: __________   Version of this guide: ___________
```

## Tested (31 Oct 2026)

Walked on the real console in a browser, against an Edge from this commit with two synthetic feeds and
the WAN cut, using a throwaway DEV bundle:

- New session; **Kick-off** twice (two marks; the clock counts from the later one); **Flag incident**;
  **Make ground clip**; **Start review**, **Record finding**.
- **Approve** refused before the finding, then refused again until rights were recorded; **Record** with
  a synthetic feed; **Approve**; **Export**, with its SHA-256.
- **End session**: confirmed; **Flag incident** and **Half-time** then refused with "the session has
  ended"; **Make ground clip** and **Start review** still accepted.
- The restore banner, with the alert raised by hand.
- The hold command (201), and the retention preview.

`tests/test_operator_guide.py` checks that every button named here is in the console or admin source,
that every `fairplay-edge` command exists, and that the alert words quoted here are the console's own.

**Not walked:** pairing and a provisioned session against a real cloud in this run (Phase 4's
`fairplay:e2echeck` covers them by API); `Download JSON` and **Print** on the report; a real camera; a
printed copy in anyone's hands. The training exercises have not been tried on a person, so the pass marks
are proposals.

## Handover for 6.3 (prompt pack section K)

```text
DTP FAIRPLAY | PHASE 6.3 DELIVERY
STATUS: complete as documents and three small fixes; walked on synthetic feeds; not yet used at a venue

REPOSITORY FACTS CONFIRMED
- Existing patterns used: the runbook's alert and recovery tables; the console's and admin's real labels; edge-install.md and edge-backup.md
- Hardware facts actually verified: none
- Unknowns remaining: the venue's kit and layout; who fills each job; real bitrates (6.4, 6.6)

IMPLEMENTED
- Code paths changed: Console.tsx (an End session button, which the API had and the console did not; the restore banner), alerts.ts, AdminFairPlayMatchPage.tsx (Set PIN enabled from 8 digits, left at 6 after R5), the Edge README's PIN length
- APIs and migrations: none
- Local/Cloud config: none

SECURITY + COST
- Auth and evidence changes: none; End session is the existing route under its existing permission
- New dependencies and license: none
- New recurring cost: $0

TEST EVIDENCE
- Commands actually run: see "Tested" above; console tests and typecheck; Edge suite with tests/test_operator_guide.py
- Passed / failed / untested: as listed; pairing against a real cloud, the report's print and download, and the training on a person untested
- Measured replay/CPU/RAM/SSD outcomes: none new

RISKS, ROLLBACK, NEXT GATE
- Blocking defects: none found
- Steps to revert safely: revert the commit
- Human approvals required: who fills each job, and the named person watching each match (R7); R23 and R24 still undecided
- Proposed next phase: 6.4, the hardware validation checklist
```
