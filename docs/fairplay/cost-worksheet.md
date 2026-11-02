# FairPlay — match storage and cost worksheet

Phase 6.6. What a match costs in disk, upload and money, worked out from measured bitrates. **No real
camera has been measured.** Every result on this page comes from synthetic feeds and from assumptions,
and it says so. Replace them with section C3 of the [hardware validation](./hardware-validation.md).

The rights and retention decisions are in [rights-checklist.md](./rights-checklist.md).

## What the worksheet found

**As built, the footage around every incident is never deleted.** D9 says recordings go after 14 days,
"held and unsynced-evidence footage never". Two things in the code turn that "never" into forever:

- **An incident's hold has no end.** Flagging an incident holds its window on every camera. Only an
  admin's manual release, or an edit of the window, ever ends a hold (`release_hold`'s callers).
  A finding, an archive or a sync does not.
- **A clip's sources are never marked as synced.** Cutting a clip writes `evidence_refs` with `synced = 0`,
  retention refuses any segment with such a row, and nothing in the Edge ever sets it to 1.

Retention deletes whole files, so each incident keeps about 50 s from every camera: its 30 s window and
the rest of the 20-second files at each end. At 10 incidents a match that is **about 5% of each match, kept
with no end** (it was about 30% with 5-minute files). It is the largest figure below, and it is not only a
cost: see R25 in [residual-risks.md](./residual-risks.md) and the
[rights checklist](./rights-checklist.md#decisions-for-fola). The rule is unchanged, because a rule that
deletes footage is Fola's decision.

`tests/test_cost_and_rights.py` holds this description to the code, and fails when a rule is built.

## How to run it

The worksheet is arithmetic: it opens no recording and changes nothing. Give it the `edge.json` that
[`deploy/measure.sh`](./hardware-validation.md#the-measuring-tool) left, through standard input,
because that folder is outside the container. From `services/fairplay-edge`:

```bash
docker compose exec -T edge fairplay-edge worksheet --from - --measured-at-venue --hours 3 --matches-per-month 10 --matches-in-retention 5 --incidents 10 < /mnt/results/fairplay-measure-<stamp>/edge.json
```

Or type the rates, once for each camera:

```bash
docker compose exec -T edge fairplay-edge worksheet --mbit ground=2.6 --mbit drone=0.6
```

**Pass `--measured-at-venue` only for the real cameras at the venue.** Without it the result is headed
"NOT A VENUE FIGURE". `--json` gives the same result as JSON, for the results folder.

## What is measured and what is assumed

| Input | Default | Where it comes from |
|---|---|---|
| Each camera's bitrate | none: you give it | measured. Hardware validation C3. **Synthetic until the kit is chosen** |
| Hours recorded for one match (`--hours`) | 3 | assumed. The [matchday clock](./operator-guide.md#the-matchday-clock) has cameras on 60 minutes before kick-off. Extra time and penalties need more. Measure it: recording starts when a camera publishes, not at kick-off |
| Matches a month (`--matches-per-month`) | 10 | assumed, as Phase 4's estimate |
| Most matches in 14 days (`--matches-in-retention`) | the month spread evenly: 5 | assumed. **Set it for a tournament**, where matches bunch together |
| Incidents a match (`--incidents`), with a clip from every camera | 10 | assumed, as Phase 4's estimate. No real match has given a number |
| Clip length (`--clip-seconds`) | 30 s | the default pre-roll and post-roll in `incidents.py` |
| Months clips stay on the Edge (`--evidence-months`) | 18 | D10 is end of season + 12 months. **The 6-month season is assumed** |
| Recordings kept | 14 days | D9; `FAIRPLAY_RETENTION_DAYS` in `.env.example` |
| Clips in R2 | 90 days | D10; `FAIRPLAY_EVIDENCE_RETENTION_DAYS` |
| Segment length | 20 seconds | `FAIRPLAY_RECORD_SEGMENT_DURATION` in `.env.example`. Not an option: a shorter one would keep less |
| Free space to keep | 20 GB | `FAIRPLAY_DISK_SOFT_FREE_GB`, whose alert is the first warning |
| R2 prices | $0.015 per GB-month, $4.50 and $0.36 per million operations | [Cloudflare's price page](https://developers.cloudflare.com/r2/pricing/), read 1 November 2026, and unchanged from `fairplay.config.ts` |

Sizes are decimal GB, as `measure` gives them.

### What it leaves out, and which way that errs

| Left out or simplified | Effect |
|---|---|
| Only approved clips upload, and the worksheet counts every clip, from every camera | R2 and upload are upper bounds |
| Two incidents in one segment are counted apart | kept footage is an upper bound, capped at the recording |
| Exported zips (`data/exports`) are never deleted (F18) | disk is understated by one clip for each export |
| A `before-restore-*` folder, after a restore with `--replace` | disk is understated until someone deletes it ([edge-backup.md](./edge-backup.md)) |
| The database and manifests | small beside video. Not measured for a full match |
| R2's free allowance (10 GB-month, 1 million class A, 10 million class B) | money is overstated, but Vision's buckets share that allowance, so it is not counted |

## A worked result: synthetic, not a forecast

This is the real output, on 1 November 2026, in the Edge image, from the `edge.json` the 6.4 run left. Those
rates are a test pattern. **A real pitch will not look like this.**

```text
FAIRPLAY COST WORKSHEET
Bitrates (NOT A VENUE FIGURE: synthetic, typed or unstated): drone 0.6, ground 2.6; all cameras 3.2 Mbit/s
Assumed: 3.0 h a match; 10 matches a month, at most 5 in 14 days; 10 incidents a match, 30 s clips from every camera; clips on the Edge 18 months, in R2 90 days

One match
  recordings                        4.32 GB
  clips (also the upload)           0.12 GB
  kept past retention, as built     0.2 GB (4.6% of the recording)

The Edge's disk
  recordings inside retention       21.6 GB
  clips                             21.6 GB
  replay cache, at most             2.1 GB
  free space to keep                20 GB
  NEEDED, if incident holds end     65.3 GB
  footage kept, as built            36.0 GB, growing 2.0 GB a month with no end
  NEEDED, as built                  101.3 GB
  sustained write: all cameras 0.4 MB/s; target at 3x 1.2 MB/s

Backup disk: at least 21.6 GB (clips and the record; recordings are not in a backup)

R2, a month (gross, prices checked 2026-11-01)
  3.6 GB held: $0.054; 400 class A and 400 class B: $0.002
  total $0.056. gross, before R2's account-wide free allowance, which Vision's buckets share; only approved clips upload, so this is an upper bound
Full matches in R2 are not built. If they were, these would cost $1.94 a month.
```

### How much the bitrate matters

The same assumptions, at rates typed in to show the scale. **The 8 Mbit/s is an illustration, not a
measurement or an expectation.**

| | Synthetic: 3.2 Mbit/s in all | Two cameras at 8 Mbit/s: 16 in all |
|---|---|---|
| One match's recordings | 4.32 GB | 21.6 GB |
| One match's upload | 0.12 GB | 0.6 GB |
| Kept past retention, each match | 0.2 GB | 1 GB |
| Disk needed, if incident holds end | 65.3 GB | 238.1 GB |
| Disk needed, as built, after 18 months | 101.3 GB | 418.1 GB |
| Backup disk | 21.6 GB | 108 GB |

The money is small either way. **The disk, and the venue's upload, are the real costs.**

## What it means for money

| Item | Cost | Status |
|---|---|---|
| AWS | **$0 new.** No new resource. Video never passes through the API | as Phase 4; not checked against a bill |
| R2, at these assumptions | **about $0.06 a month** at the synthetic rates, and about $0.27 at 16 Mbit/s, gross | inside D1's approval at the synthetic rates, **and above D1's $0.12 at 16 Mbit/s**. Recheck when the venue rates are known |
| Full matches in R2 | **not built.** No path uploads a recording, only approved clips (`cloud.py`) | would be a new decision |
| GPU, video compute, third-party AI | **$0.** None used | `tests/test_boundaries.py` |
| Venue internet | **unpriced.** Upload is the figure above, per match | depends on the venue and its data plan. Fill in below |
| The Edge machine, disks, UPS, backup disk | **unpriced.** The kit is not chosen | nothing here prices it. Buying anything goes to Fola |
| People on matchday | **unpriced.** Who fills each job is open (R7) | Fola |

## The sheet for each venue

Copy this into the results folder, with the worksheet's output beside it.

```text
FAIRPLAY MATCH COST SHEET
Date: ____________  Venue: ____________  Release: ____________  Filled in by: ____________
Results folder (edge.json, load-peak.txt): ____________

MEASURED, ON THE REAL KIT (hardware validation)
 Each camera, Mbit/s (C3):              ____________________
 Hours a camera recorded, one match:    ____________
 Peak CPU, of all cores (D5):           ____________
 Lowest available memory (D6):          ____________
 Sustained write, slowest window (B5):  ____________ MB/s
 Free disk on the data volume (B6):     ____________ GB
 Backup time for a full match (D10):    ____________

ASSUMED: CHECK WITH THE ORGANISER
 Matches a month / most in 14 days:     ______ / ______
 Incidents seen at the first matches:   ____________
 Season's end, and so the clips' end:   ____________

FROM THE WORKSHEET
 One match's recordings / upload:       ______ GB / ______ GB
 Disk needed, and which rule (R25):     ______ GB   ____________
 Does the machine have it?              ______
 Backup disk needed:                    ______ GB
 R2, a month, gross:                    $______   (D1 approved about $0.12)

NOT FROM THE WORKSHEET
 Venue data price; one match's upload:  ____________
 Kit bought, and its price:             ____________

Over D1's figure, or anything bought, or any new monthly charge: goes to Fola before the match.
Accepted by: ____________________   Date: __________
```

## Checks

| Check | Result |
|---|---|
| Edge suite, in the Edge test image | 431 passed, 1 skipped (the one run by the cloud e2e check); `test_cost_and_rights.py` is new |
| The worksheet, in a local copy of the Edge image, through `docker exec`, from the 6.4 run's `edge.json` | ran; its output is the worked result above, word for word |
| Both documented commands, `--json`, and missing arguments | ran as described |
| Against Phase 4's hand estimate, at its inputs | agrees: 5.6 GB held, $0.084 storage, 400 class A |
| A clip's sources and an incident's hold, against retention, on a real SQLite store with synthetic segments | kept 4,000 days on, and a manual hold release does not free what a clip was cut from |
| R2's prices, against Cloudflare's page, 1 November 2026 | unchanged |

The image was a two-line Dockerfile over the local Edge image, with the new code copied in, so **nothing
was downloaded**, and it was removed afterwards. The cloud, console and web checks were not rerun, because
this changes no code there.

**A slip the tests caught:** the page first gave 228.5 GB for the 16 Mbit/s disk figure, which I had added
up by hand. The tool says 238.1 GB, and a test now holds the page to the tool.

**Not tested:**

- `docker compose exec` on an installed stack: `docker exec` on a local copy of the image was used;
- any real camera or real match, so every result here is synthetic;
- the size of a real database and manifests for a full match;
- any legal question. This is not legal advice.

## Handover for 6.6 (prompt pack section K)

```text
DTP FAIRPLAY | PHASE 6.6 DELIVERY
STATUS: worksheet and checklist complete; every figure is synthetic until the kit is measured; R25 and the decisions RC1 to RC8 are Fola's and not made

REPOSITORY FACTS CONFIRMED
- Existing patterns used: measure's report and its units; the cloud's prices and usage count; Phase 4's estimate; the rights gate; the results sheet of 6.4
- Hardware facts actually verified: none
- Unknowns remaining: real bitrates, hours, incidents a match, season length, venue data price, the kit's price

IMPLEMENTED
- Code paths changed: fairplay_edge/worksheet.py (new); CLI worksheet. No behaviour of the Edge changed
- APIs and migrations: none
- Local/Cloud config: none

SECURITY + COST
- Auth and evidence changes: none. Found, not changed: incident footage is never deleted (R25); the request document's date is untrue of it; D10's Edge half, D13 and F18 have nothing enforcing them (R26)
- New dependencies and license: none
- New recurring cost: $0. R2 about $0.06 a month at synthetic rates, about $0.27 at an illustrative 16 Mbit/s, which is above D1's $0.12

TEST EVIDENCE
- Commands actually run: tests/test_cost_and_rights.py, the Edge suite; the worksheet in a local copy of the image, on a real measure report and on bad input
- Passed / failed / untested: as above; docker compose exec on a stack, and any real footage, untested
- Measured replay/CPU/RAM/SSD outcomes: none new; the bitrates are the 6.4 laptop run's, labelled as not a venue figure

RISKS, ROLLBACK, NEXT GATE
- Blocking defects: R25 blocks real footage: it needs Fola's rule, then code. Nothing blocks synthetic work
- Steps to revert safely: revert the commit
- Human approvals required: RC1 to RC8; the rights sheet; legal advice (B2, R16); anything above D1's figure; anything bought
- Proposed next phase: 6.7, demo and go/no-go, unless RC1 is decided first
```
