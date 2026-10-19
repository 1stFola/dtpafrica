# 100 — The first hard frames on training footage

19 October 2026. This is the first real run of step 2 of the training plan (doc 98) on
footage we may train on. Hard-frame mining (doc 99) ran over three clips of a 1XCup match.
It picked 427 frames, now queued for labelling with the detector's boxes drawn. The run
also showed that a second `hard_frames` run over the same footage could be queued, which
would show people every frame twice. The API now refuses that.

## Footage

- **Source and rights.** Fola supplied 1XCup YouTube broadcasts (channel "1xCup
  Nigeria"). They fall under the 1XCup 2026 media rights agreement, already on file as
  partner-level evidence `bac9274d`. It allows analysis and training.
- **First match.** Emiloju FC v JP Young Stars FC, 1 October 2026, Group A (ScoreBoard
  match `da0addce`). It has no event answer key, so `FootageHeldOut` does not apply.
- **Download.** yt-dlp, YouTube format 137: 1080p30 H.264, video only, 1:41:27 long,
  SHA-256 `a66ec9bd…`.

## Clips

Four clips of 185.067 s each were stream-copied from keyframes, so nothing was
re-encoded. Each was uploaded as its own source and asset.

| Clip | Starts at (full match) | Asset |
|---|---|---|
| 1 | 1016.47 s (16:56) | `608da6fa` |
| 2 | 2576.47 s (42:56) | `51f5b418` |
| 3 | 3776.47 s (1:02:56) | `21520f51` |
| 4 | 4616.47 s (1:16:56) | `94798473` |

## CPU stages

A new worker image, `dtp-vision-engine:cpu-5fa7677` (contract 1.22.0), ran probe,
fingerprint, transcode (a 25 fps proxy) and `camera_motion`.

`camera_motion` proposed 82 shots. The machine account `claude-machine@vision.localhost`
declared all 82 `live_play`. Before doing so it checked that the broadcast match clock runs
on without a break through every shot, so none of them is a replay.

## Detect on the GPU

- **The pod.** One RunPod pod (RTX 4090, $0.60/h) reached the local API through a
  Cloudflare quick tunnel. Fola approved it, and the tunnel and the pod were closed
  afterwards.
- **The runs.** Detector v2 `9da0be9d` ran at 25 fps on clips 1–3, about 23 minutes per
  clip. That is about three times slower than the pilot.
- **Clip 4.** Its detect was cancelled to keep the run under $1.

**Image trap.** The GPU image must be `ghcr.io/1stfola/dtp-vision-worker:gpu-aa22684`.
`gpu-339d467` is only a local tag. A pod that named it was "Exited by Runpod" after 2 s.

**Cost.** $0.734 (RunPod balance $8.737 → $8.003). Phase 6 spend is now about $1.97.
Fola has raised the Phase 6 ceiling from $4 to $8.

## What hard_frames picked

| Run | Clip | Frames | Missed | Low-conf | Tile-only | Random |
|---|---|---|---|---|---|---|
| `e38bbf7e` | 1 | 143 | 94 | 1 | 0 | 48 |
| `75d858cb` | 2 | 142 | 73 | 21 | 1 | 47 |
| `e0eaa764` | 3 | 142 | 77 | 15 | 3 | 47 |

On full-length clips every cause got frames, as doc 99 expected. Random play is a third of
each run.

Fola approved queueing these three runs: **427 active-learning items**, each audited as
`annotation.queue.hard_frames`. The duplicate runs `8fc6c9a4` and `d4a30c9e` (clip 1) and
`8719ce05` (clip 2) were left unqueued. They pick the same frames from the same detect
runs.

## What the frames show

- **"Missed" balls are often plain.** In many of these frames the ball is plainly at a
  player's feet. The detector misses the easy cases, not only the hard ones.
- **Person boxes include people off the pitch.** Pre-label person boxes cover spectators
  and benches, so labellers will delete as well as correct.
- **Low-confidence balls are mostly far away.** They are mostly small balls near the far
  line.

## Duplicate runs are not queued

Before this change, `POST /vision/annotation/queue/hard-frames/:jobId` refused only to
queue the same job twice. A second succeeded run over the same footage could still be
queued, which would put every one of its frames in front of people again.

The queue now refuses that with **`409 HardFramesAlreadyQueued`**. The refusal applies when
frames are already queued from another `hard_frames` run over the same asset and the same
detect run. The message names the run that was queued, and `queuedJobId` carries its id.

Notes:
- **Which items count.** Items in any state count, so frames that were queued and then
  converted to tasks still block a rerun.
- **A new detect run is allowed.** A run over a new detect run of the same clip draws new
  boxes, so it can be queued.
- **The detect run is checked.** The detect run is read from the hard_frames artifact,
  which must now name it (`detectJobId`). For the run already queued, it is read from that
  job's completion summary.
- **The same job twice** still adds nothing and returns `alreadyQueued`.

`GET /vision/annotation/hard-frames` gives each unqueued run an `alreadyQueuedAs`: the run
over the same footage and detect run whose frames are queued, or null. On the Annotation
page, **Frames picked for labelling** shows such a run as "already queued as `<run>`"
instead of a **Queue N frames** button.

Checked in the browser against the local database:
- The three duplicate runs show "already queued as" `e38bbf7e`, `e38bbf7e` and `75d858cb`.
- A POST for `8fc6c9a4` was refused with `HardFramesAlreadyQueued`, naming `e38bbf7e`.
- The queue still held exactly 427 items afterwards.

## Still to do

- Detect on clip 4, then its `hard_frames`.
- Ten more 1XCup matches, being processed in another session.
- Labelling the queued frames.
- Then the `train` stage (step 4 of doc 98).

## Files

- API: `annotation/annotation.service.ts` (`queueHardFrames`, `hardFrameRuns`,
  `queuedHardFrameRuns`); `annotation/hard-frames-artifact.ts` (requires `detectJobId`);
  `annotation/hard-frames.spec.ts`.
- Web: `api/vision.ts` (`VisionHardFrameRun.alreadyQueuedAs`); `AdminVisionAnnotationPage`.
