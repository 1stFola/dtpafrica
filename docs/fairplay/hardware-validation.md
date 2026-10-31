# FairPlay — hardware validation checklist

Increment 6.4 of the plan ([phase-plan.md](./phase-plan.md)): what to measure on the matchday kit,
how, and what counts as a pass. **None of this has been run.** The kit has not been chosen, and every
measurement so far is from synthetic feeds on a development laptop.

Allow two days: a day to set up and run sections A to E, and a day for the soak, the failures and
anything that failed the first time. The results go in the [sheet at the end](#results-sheet), and
6.6's storage and cost worksheet takes its bitrates from them.

## Before you start

- **No footage of people without rights.** Point the cameras at an empty pitch, or at staff who have
  agreed in writing. Recordings of a real match wait for B2 ([blockers.md](./blockers.md)). Never
  use a youth match to test this.
- **Not during a real match, and away from the real broadcast,** unless section G says otherwise.
- **Measure, don't copy the box.** "Unknown" is an honest result. A number from a spec sheet is not.
- **Keep what you measured:** each run of `deploy/measure.sh` leaves a folder. Attach it to the sheet.

### Stop and call Fola

- The switcher cannot give a separate feed for each camera, and someone still wants two angles.
- A camera delivers H.265 or anything other than H.264. Nothing here has been tested with it.
- The kit needs something bought, or any new monthly charge.
- The only way to test is on a real match, or with real youth players.
- Anyone asks for a link to the referee, walkie-talkies included. V1 never does that.

## The targets

Four come from the product document. They decide the pilot.

| Target | From | Best synthetic result so far |
|---|---|---|
| At least **99.5%** of the intended recording time, across a shadow match | PID | 100% over 6 minutes, not a match |
| **p95 time to a playable replay at or under 15 s**, on the reference laptop and LAN | PID | 1.5 s (Phase 2, same machine as the Edge) |
| A 30-second clip usually ready **within 30 s**; record the actual distribution | PID | 2.6 s p95 over 2 clips |
| Camera alignment **within 500 ms** on a common visible event after calibration, or the uncertainty flagged | PID | offset steady to 25 ms (standard deviation) over 9 markers in 13 minutes, range 80 ms |

**Every other threshold below is a proposal,** marked *(proposed)*. They are my reading of what is safe,
with no venue measurement behind them. Change them if the first run shows they are wrong, and say so on
the sheet.

## The measuring tool

From `services/fairplay-edge`, with the stack running:

```bash
sudo deploy/measure.sh /mnt/results --load-minutes 90 --since-minutes 90
```

It changes no setting. It takes only the release tag from `.env`, and never opens `publish.env` or `auth/`.

| It writes | Holds |
|---|---|
| `machine.txt` | OS, CPU, memory, disks and encryption, Docker, time sync, boot units, addresses |
| `load.tsv`, `load-peak.txt` | each container's CPU and memory every 10 s. 100% is one core. |
| `edge.json` | each camera's rate, codec, resolution, keyframes, recorded share and gaps; replay and clip times; alerts; calibrations |
| `disk.json` | only with `--disk-seconds`: the sustained write test |

The write test is refused while a session is open, because it would compete with the recording.
On a bench, `fairplay-edge measure-disk --force` overrides that. It writes one temporary file beside the
recordings and removes it, and stops well above the Edge's hard limit.

## A. Answer the audit

Fill in the [equipment audit](./equipment-audit.md), with the evidence it asks for: a photo of the
back panel, a model number, a screenshot of the output settings.

| # | Check | Pass |
|---|---|---|
| A1 | Gate rows E1–E8, E10, E14 answered | each has evidence, not memory |
| A2 | E16, the recording mode of each camera | written down. It decides single or two angles ([ADR-0008](./adr/0008-single-angle-mode.md)) |
| A3 | Which [ingest topology](./equipment-audit.md#ingest-topologies-by-what-the-answers-turn-out-to-be), T1 to T4 | chosen. T2 and T3 add load to test in sections D and G |

## B. The Edge machine

Install it ([edge-install.md](./edge-install.md)) with the `--lan-ip`, `--ingest-ip` and `--cameras` it will use at the venue.

| # | Check | How | Pass |
|---|---|---|---|
| B1 | OS, CPU, memory | `machine.txt` | written down. Ubuntu 24.04 is what the scripts assume |
| B2 | Not the broadcast machine | look | a separate machine, or section G passed |
| B3 | Disk encrypted (D12, R19) | `machine.txt` shows a `crypt` row under the data disk | encrypted, with a named custodian |
| B4 | The data disk is an SSD, internal or known USB | `machine.txt`; the model | `ROTA` 0, the model noted |
| B5 | Sustained write | `sudo deploy/measure.sh /mnt/results --load-minutes 0 --disk-seconds 300`, with no session open | slowest window at least **3×** all cameras' combined rate *(proposed)*. Note the mean as well |
| B6 | Free space | `df`, and C's `gbPerHour` | enough for 14 days of matches, plus the 20 GB soft limit *(proposed)* |
| B7 | Clock has a time source (R21, B5) | `machine.txt`, and on the console | "synchronized: yes", or a recorded decision. Compare with the match console: within 1 s (R14) |
| B8 | The stack starts at boot (R10, R11) | reboot with no one touching it | every card reads **● Recording** without a command. Note how long |
| B9 | The watchdog brings a stopped service back | `docker kill` the Edge, then MediaMTX; don't touch anything | each is back within 2 minutes *(proposed)* |
| B10 | The units are enabled | `machine.txt`, "Boot units" | `enabled` three times |

## C. Each camera and encoder

With the real cameras, on an empty pitch, for at least 10 minutes. `--since-minutes 10` limits the report.

| # | Check | Read from `edge.json` | Pass |
|---|---|---|---|
| C1 | Codec | `codec`, `profile` | `h264`. Anything else: stop |
| C2 | Resolution and frame rate | `width`, `height`, `fps` | what the audit said was used on matchday |
| C3 | The real bitrate, per camera | `mbitPerSecond`, `gbPerHour` | written down. This replaces the 1.1 GB per camera-hour from synthetic feeds |
| C4 | Keyframe interval | `keyframeIntervalS` | at most **2 s** *(proposed)*. Seeking lands on keyframes, so a longer interval means coarser review |
| C5 | Audio and video stay aligned (E17) | `alertsOpened`, no `segment_video_gap` | none. MediaMTX discards video at segment switches when audio leads by more than 1 s |
| C6 | Audio (E15) | `hasAudio` | written down, with whose voices it could catch. That is a privacy question for the rights checklist |
| C7 | Each publish address and password work; no other does | publish from another address or with a wrong password | refused. The Edge's card does not change |
| C8 | A camera dropped and returned | pull its cable for 60 s | "Unavailable — no feed", then **● Recording** again within 10 s of its return *(proposed)*; a gap shown of about that length |
| C9 | The drone, if used (E3) | fly it, or run its link at full range | the same checks. Note its real delay; a large one needs the offset confirmed |

## D. The soak

**Run this as one match: 2 hours 30 minutes** *(proposed)*, all cameras, with the operator guide's
[matchday clock](./operator-guide.md#the-matchday-clock) and a clip every 10 minutes. Reviewers replay
throughout. Start `measure.sh` with `--load-minutes 150 --since-minutes 150` at kick-off.

| # | Check | Read from | Pass |
|---|---|---|---|
| D1 | Recorded share | `recordedPercent` | **at least 99.5%** on every required camera (PID) |
| D2 | Time to a playable replay | `replay.p95Ms`, at least 40 samples on the reviewer device | **at most 15 s** (PID); note p50 and max |
| D3 | Clip time | `clips.p50Ms`, `clips.p95Ms` | a 30 s clip usually **within 30 s** (PID); record the distribution |
| D4 | Alignment | calibrate at kick-off; **Synchronisation test at this moment** at three later events, a clap or a marker | **within 500 ms**, or the uncertainty flagged (PID) |
| D5 | CPU | `load-peak.txt`, against the number of cores | total peak under **70%** of all cores *(proposed)* |
| D6 | Memory (Phase 1's open question) | `load-peak.txt`, and `free -h` at start, middle and end | available memory never under **1 GB** *(proposed)*. MediaMTX reached 585 MiB in a 30-minute drill, unexplained: note whether it levels off |
| D7 | Recording while replaying and cutting | `gapCount`, `partial` | no gap beyond what you caused |
| D8 | Hashes | `docker compose exec -T edge fairplay-edge verify-all` after the match | every file `match` |
| D9 | Alerts | `alertsOpened` | each one explained on the sheet |
| D10 | Backup afterwards | `deploy/backup.sh` to the real backup disk | it completes, and its time is noted ([edge-backup.md](./edge-backup.md)) |
| D11 | A full match's backup restores | restore it to a second machine, or a clean install | the checks in edge-backup.md read sound |

## E. Failures, on the real kit

Do these on purpose, after the soak, following the guide's [recovery pages](./operator-guide.md#when-something-fails).
The drill figures in the [runbook](./runbook.md#recovery-time-and-recovery-point) are the comparison.

| # | Failure | Pass |
|---|---|---|
| E1 | Unplug the internet for 30 minutes during recording | recording and review carry on; everything arrives once afterwards |
| E2 | **Pull the mains from the Edge machine with no UPS,** under load (R11) | it starts by itself; no database damage; `verify-all` clean. Note the footage lost, against 1 s per part plus the time off |
| E3 | Run it from the UPS, if there is one (E12) | runtime written down, at least long enough to shut down or to outlast a usual cut. Note what else is on it |
| E4 | Fill the disk to below the hard limit | the banner appears, clips are refused, and recording carries on |
| E5 | Pull the camera network's switch | every card changes; recording returns by itself |
| E6 | The console device sleeps for 40 minutes | sign in again; nothing lost |
| E7 | The operator's device runs flat, and another takes over | a second device signs in and carries on |

## F. Reviewer devices and the network

On each device that will be used, on the venue's own network (B12, E14).

| # | Check | Pass |
|---|---|---|
| F1 | Install `venue-ca.pem`, and open the console by the address in the certificate | a padlock with no warning. Note the browser and version |
| F2 | Live preview and replay play | both play. Note the measured "behind live" |
| F3 | 0.25× speed | the console says offered or not offered. Either is fine: it measures |
| F4 | From a device on the **spectators'** network (R1) | cannot open the console or reach port 8554. If it can, stop: that blocks real footage |
| F5 | Wrong PIN five times, on a test account | refused for 5 minutes, as designed. Note who else that device's lockout stopped |
| F6 | Screen readable in the place it will be used | an operator can read the cards from where they sit, in daylight |

## G. The broadcast is untouched

Required if the Edge shares a machine with the broadcast, or takes a second output from its encoder
(topology T2). The product's promise is that FairPlay can fail with the livestream carrying on.

| # | Check | Pass |
|---|---|---|
| G1 | Stream 90 minutes to YouTube, **unlisted, no real match,** while recording, replaying and cutting | OBS's own stats show no more dropped or skipped frames than the same stream without FairPlay |
| G2 | Kill the Edge and MediaMTX during that stream | the stream carries on with no visible break |

## On this laptop, to show the tool works (31 Oct 2026)

**These are not results.** They come from Docker Desktop on a development laptop, with two synthetic feeds,
for 6 minutes.

| Measured | Value |
|---|---|
| `recordedPercent`, ground and drone | 100%, no gaps, 12 segments each |
| `mbitPerSecond` | ground 2.6, drone 0.6 |
| `gbPerHour` | ground 1.17, drone 0.27 |
| `keyframeIntervalS` | 2.0 |
| `clips` | 2 made: p50 1.7 s, p95 2.6 s |
| Mean CPU (100% = 1 core) | MediaMTX 3.3%, Edge 3.9%. The feeds use 38.5% and 24.1%: at a venue, cameras do that work |
| Peak memory, 1 minute | MediaMTX 108 MiB, Edge 92 MiB |
| Sustained write, 30 s through Docker Desktop's virtual disk | mean 46 MB/s, slowest 5 s window 21 MB/s |

Run through `deploy/measure.sh` on an installed stack. The disk test was refused with a session open, and
the rest of the results were kept; it ran once the session ended, and left no file. No alert was raised
and no secret was in any result. `machine.txt` printed "not available here" for what Git Bash lacks
(`lscpu`, `lsblk`, `timedatectl`, `systemctl`), which **means those lines have never been seen on Linux.**
`tests/test_measure.py` covers the tool, and `tests/test_hardware_validation.py` this page.

## Results sheet

Copy this into the results folder. A row left blank is a row not done.

```text
FAIRPLAY HARDWARE VALIDATION
Date(s): ____________  Venue: ____________  Release: ____________  Tested by: ____________
Edge machine: ____________  Reviewer devices: ____________  Results folder: ____________
Recording mode (E16), per camera: ____________  Topology: ____  Single or two angles: ______

 #    Check                               Target            Measured        P/F
 A1   audit Gate rows answered            with evidence     ____________    ___
 A2   recording mode written down         written           ____________    ___
 A3   topology chosen                     chosen            ____________    ___
 B1   OS, CPU, memory                     written           ____________    ___
 B2   not the broadcast machine           or G passed       ____________    ___
 B3   disk encrypted, custodian named     yes               ____________    ___
 B4   SSD and its model                   ROTA 0            ____________    ___
 B5   sustained write, slowest window     3x all cameras*   ____________    ___
 B6   free space                          14 days + 20 GB*  ____________    ___
 B7   clock source; difference            within 1 s        ____________    ___
 B8   starts at boot, unaided; time       recording         ____________    ___
 B9   watchdog restores each service      2 min*            ____________    ___
 B10  units enabled                       enabled           ____________    ___
 C1   codec                               h264              ____________    ___
 C2   resolution, frame rate              as audited        ____________    ___
 C3   bitrate per camera; GB per hour     written           ____________    ___
 C4   keyframe interval                   2 s or less*      ____________    ___
 C5   no segment_video_gap                none              ____________    ___
 C6   audio, and whose voices             written           ____________    ___
 C7   other publishers refused            refused           ____________    ___
 C8   camera drop: back within            10 s*             ____________    ___
 C9   drone, if used                      as C1-C8          ____________    ___
 D1   recorded share, required cameras    99.5% or more     ____________    ___
 D2   replay p95 (p50, max, samples)      15 s or less      ____________    ___
 D3   clip p50, p95                       usually 30 s      ____________    ___
 D4   alignment at three later events     500 ms, or flag   ____________    ___
 D5   peak CPU, of all cores              under 70%*        ____________    ___
 D6   lowest available memory             1 GB*             ____________    ___
 D7   gaps while replaying and cutting    none unexplained  ____________    ___
 D8   verify-all                          all match         ____________    ___
 D9   alerts explained                    all               ____________    ___
 D10  backup; time taken                  completes         ____________    ___
 D11  restore of a full match             sound             ____________    ___
 E1   internet out, 30 min                carries on        ____________    ___
 E2   mains pulled; footage lost          restarts, clean   ____________    ___
 E3   UPS runtime                         written           ____________    ___
 E4   disk below hard limit               as designed       ____________    ___
 E5   camera switch pulled                returns itself    ____________    ___
 E6   console device asleep 40 min        nothing lost      ____________    ___
 E7   operator device replaced            carries on        ____________    ___
 F1   venue CA; padlock; browser          no warning        ____________    ___
 F2   live and replay play; delay         plays             ____________    ___
 F3   0.25x offered or not                either            ____________    ___
 F4   spectators' network blocked         cannot reach      ____________    ___
 F5   lockout after wrong PINs            as designed       ____________    ___
 F6   readable where it will be used      yes               ____________    ___
 G1   broadcast dropped frames            no worse          ____________    ___
 G2   Edge killed, stream carries on      no break          ____________    ___
 * proposed: note any change, and why.

Failures and what was done: ______________________________________________________
Changes to this checklist: _______________________________________________________
Accepted by: ____________________   Date: __________
```

The people who ran it fill the sheet. Accepting it is Fola's, and it feeds the pilot go/no-go in 6.7.

## Handover for 6.4 (prompt pack section K)

```text
DTP FAIRPLAY | PHASE 6.4 DELIVERY
STATUS: the checklist and its measuring tool are complete; the checklist has not been run, because the kit is not chosen

REPOSITORY FACTS CONFIRMED
- Existing patterns used: the equipment audit's questions; the PID's four targets; the Edge's own replay metrics, jobs, segments and alerts; the runbook's recovery figures
- Hardware facts actually verified: none
- Unknowns remaining: all of the equipment audit; every threshold marked proposed

IMPLEMENTED
- Code paths changed: fairplay_edge/measure.py, deploy/measure.sh (new); CLI measure, measure-disk; the audit now names the write-test command it promised
- APIs and migrations: none
- Local/Cloud config: none

SECURITY + COST
- Auth and evidence changes: none; the tool reads the record and writes one temporary file; it reads no secrets
- New dependencies and license: none
- New recurring cost: $0

TEST EVIDENCE
- Commands actually run: tests/test_measure.py, tests/test_hardware_validation.py, the Edge suite; deploy/measure.sh on an installed synthetic stack
- Passed / failed / untested: as above; machine.txt's Linux lines and every venue check untested
- Measured replay/CPU/RAM/SSD outcomes: only the laptop's figures above, labelled as not results

RISKS, ROLLBACK, NEXT GATE
- Blocking defects: none found
- Steps to revert safely: revert the commit
- Human approvals required: choosing the venue machine and kit; rights for anything real the cameras see; accepting the sheet
- Proposed next phase: 6.5, licences, which needs Fola's B9 and B10 rulings
```
