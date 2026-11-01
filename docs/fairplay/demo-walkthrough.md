# FairPlay — the stakeholder demo

Phase 6.7. A scripted 8-minute walk-through for a stakeholder, on synthetic feeds, following the prompt
pack's demonstration script. **Everything shown is made up:** test patterns and pretend incidents, each
labelled DEMO. No real footage, no real person and no real data belongs in it.

The [draft organiser report](./demo-report-draft.md) is what this dataset produces.

## What it can and cannot prove

Say this first. A stakeholder should leave knowing the difference.

| It shows | It does not show |
|---|---|
| Recording, replay, incidents, findings, clips, hashes and sync, on the real software | that any of it works on the real cameras, pitch or venue network. No kit has been tested |
| Findings that change nothing, and a recorded gap when a feed stops | that the replay and clip times hold at a venue. These are one laptop's figures |
| A signed link to a clip, reached only through a signed-in, audited page | **that the bucket is private.** This demo uses a stand-in S3 server that checks no signature (an unsigned request to it also answered 200). A real R2 bucket does not exist yet (R20) |
| The Edge carrying on without its cloud | a real network failure. The demo stops two relays. The failure drills cut a real network ([runbook](./runbook.md#recovery-time-and-recovery-point)) |

Never call it VAR or FVS, and never suggest a finding could reach a referee. It cannot.

## Setting up, 15 minutes before

You need Docker Desktop, the local images `dtp-fairplay-edge:local` and `adobe/s3mock:5.2.3`, Postgres in `dtp-postgres`, and the built console.
**It pulls and builds nothing,** and refuses if an image is missing. It has only been run on Windows with Docker Desktop.

1. A new scratch database, each time. The name must contain `scratch`, `test` or `ci`, and the cloud script refuses anything else.

   ```bash
   docker exec dtp-postgres psql -U dtp -d postgres -c "CREATE DATABASE fp_demo_scratch"
   ```

   Then, from `services/api`, with `DATABASE_URL` pointed at it, run `npx prisma migrate deploy`.

2. **Start the cloud,** in its own terminal, with `FAIRPLAY_CHECK_DATABASE_URL` set to that database. It writes the one-time token and the sign-in details to the file you name. Keep that file outside the repository, and don't show it. It stays up until Ctrl-C.

   ```bash
   pnpm --filter @dtp/api fairplay:democloud -- <a file outside the repository>
   ```

3. **Start the web app,** in its own terminal, with `VITE_API_PROXY=http://127.0.0.1:3190` set. Open it at `http://localhost:5174`.

   ```bash
   pnpm --filter @dtp/web dev --port 5174 --strictPort
   ```

4. **Start the Edge and the dataset,** from `services/fairplay-edge`. This took under 5 minutes, and ends with the count of checks passed.

   ```bash
   python -I fixtures/run_demo.py up --cloud <that file>
   ```

5. Open the console at `http://127.0.0.1:8443` and sign in with the file's email and PIN. Open `http://localhost:5174/admin/login` and sign in with its email and password. Close everything else on the laptop.

**Order matters.** Do step 3 before step 4. Starting the web server during the rehearsal raised brief `recording_stalled` alerts.

### What is already there

| The dataset | Why |
|---|---|
| The session, opened on the cloud's own match, and rights recorded as synthetic | The session comes from the cloud, so **New session** has already been pressed. Say so at step 1 |
| A pretend foul, with a finding that the footage supports the decision, and both clips | a straightforward case |
| A pretend goal, with a finding that the footage supports a different outcome | that a finding is a record for afterwards, and changes no score |
| A pretend penalty, inconclusive, with the drone stopped for 50 s on purpose | a real gap in a real recording, with an alert that opened and cleared |

The demo records in 30-second files. An installed Edge uses 20 seconds.

## The 8 minutes

The times are a proposal: nobody has yet given this to an audience. **Rehearse it aloud once.** The right column is what the rehearsal on 1 November measured, driving the real console and admin in a browser.

| # | Time | Do | Say | Measured |
|---|---|---|---|---|
| 1 | 0:00 | Show the console. Point at the banner, and the session | "Shadow review only. Nothing here reaches a referee or changes a score. It is all synthetic, and this session was opened before you sat down." | banner on every screen |
| 2 | 0:30 | Show the two cards, **● Recording**, and **Live** on each | "Two feeds, recorded separately. If one stops, the other carries on." | live about 4 to 5 s behind |
| 3 | 1:15 | Press **Flag incident** | "A moment is marked in a second, and the recording it needs is protected." | about 1 s |
| 4 | 1:45 | Press **−30 s** | "Replay runs beside the live picture, and recording never stops." | loaded in 0.6 s |
| 5 | 2:30 | Press **Replay** on the drone's card | "Same moment, other camera. An uncalibrated camera says how uncertain its timing is." | loaded in 1.5 s; "uncertain by ±3000 ms" shown |
| 6 | 3:15 | Open the incident, **Make ground clip**, **Start review**, choose **Inconclusive**, write what is shown, **Record finding** | "Inconclusive is an honest answer, and so is 'footage unavailable'. Notes say what the footage shows, not what anyone thinks of the referee." | about 6 s of clicks; clip ready in about 8 s |
| 7 | 4:15 | In a terminal: `python -I fixtures/run_demo.py wan off`. **Approve** the clip | "The internet has gone. Recording, review and approval all carry on. The chip counts what is waiting." | about 4 to 9 s; "Cloud: 18 to send"; both cards still recording |
| 8 | 5:00 | `python -I fixtures/run_demo.py wan on`. Watch the chip | "It catches up on its own, once and in order." | all sent and both uploads stored within 24 s |
| 9 | 5:30 | Show the clip's SHA-256, then **Audit trail** | "Each clip has a hash and names the original recordings. Changes are appended, never edited." | audit chain ok; every recording re-hashed clean |
| 10 | 6:15 | In the admin: **ScoreBoard → Match center**, choose the match, **FairPlay**, then **Report** | "It sits beside the fixture, but changes nothing in the match record." | link present; report shows all four incidents |
| 11 | 7:00 | **Open clip** on one incident, and give a reason | "Only signed-in people with the right role get a link, it lasts 5 minutes, and the read is audited." **Don't claim the bucket is private** (above) | a link lasting 300 s, serving the clip |
| 12 | 7:30 | `python -I fixtures/run_demo.py estimate` | "This is the storage for one match. These bitrates are a test pattern, and the page says so." | "NOT A VENUE FIGURE"; 4.25 GB a match |

### If something goes wrong on stage

Say what it is: the product's point is that it does not hide problems.

| You see | What it is |
|---|---|
| A brief `recording_stalled`, or a gap on a card | the laptop is short of power. It is also encoding both test feeds, which cameras would do at a venue. Say so. **The gap is real and stays on the record.** See below |
| "not uploaded yet" on a clip in the report | its approval has not synced. It retries within 2 minutes (F27) |
| A sign-in refused | the operator list comes from the cloud. Check the cloud's terminal |

## Afterwards

Press Ctrl-C in the cloud's terminal, stop the web app, and run this from `services/fairplay-edge`. It deletes only the demo's recordings and records:

```bash
python -I fixtures/run_demo.py down
```

Then delete the sign-in file and drop the scratch database. If the cloud's S3 container is still there, `docker stop` the one named `fp-demo-s3-*`.

## Checks

| Check | Result |
|---|---|
| `run_demo.py up`, from clean, twice, against the real API, Postgres and the stand-in S3 server | 29 of 29 each, in under 5 minutes |
| All 12 steps, in a browser, on the real console and web admin | ran. Clicks were driven by a script and the real controls, with no audience and no talking |
| The Edge suite, in the Edge test image | 446 passed, 1 skipped (the one run by the cloud e2e check) |
| `npx vitest run src/fairplay` in the API | 27 passed |
| API typecheck | no errors. It does not cover `scripts/`, but the demo's cloud script ran |

The Edge ran from a local copy of its image with the new code copied in, so **nothing was downloaded**.
The copy, the stack, the database and the sign-in file were all removed afterwards.

**Not tested:** a real audience or a presenter's timing; Ctrl-C in an interactive terminal (the rehearsal stopped the cloud another way, and its API and S3 server were then stopped by hand); any host but Windows with Docker Desktop; real footage.

## What the rehearsal found

**F27 (low, fixed): a clip could wait 15 minutes to upload.** When an upload ran before the outbox had
delivered the clip's approval, the cloud refused it and the Edge waited 15 minutes. Nothing was lost, and
the report showed "not uploaded yet". The wait is now 2 minutes, and `tests/test_cloud.py` holds it. The
second rehearsal did not hit the race, so **the fix is proved by the test, not by that run.**

**F28 (low, not fixed): a report can say "single angle" with two cameras.** The session's angle mode
defaults to `single`, and the provisioning page does not offer it. The demo's cloud sets `multi`. This
waits for gate 1, the single or two-angle decision, which waits for the equipment audit.

**Unexplained, and for the hardware checks: 12 s lost on the ground camera.** In the second of two
rehearsals, the ground camera recorded 97.17% and the drone had a further 4 s gap beyond the deliberate
one, at 05:03:02 to 05:03:19 UTC. Alerts opened and closed by themselves. It came with both live previews
and a replay open, with two software encoders running, in Docker Desktop's 3.65 GB VM. **It was not the
WAN toggle:** two more cuts with no browser left both cameras at 100%. The first rehearsal had no such
gap. That points to the laptop, but it is not proved, so hardware validation D1 and D7 must answer it on the
real kit. The recording showed the loss rather than hiding it.
