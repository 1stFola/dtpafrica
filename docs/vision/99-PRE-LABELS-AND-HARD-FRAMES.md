# 99 — Pre-labels and hard-frame mining

18 October 2026. Step 2 of the training plan (doc 98). People should **correct** the
detector's boxes, not draw them from scratch, and their time should go to the frames the
detector gets wrong. This adds a CPU stage that picks those frames, and a deliberate step
that puts them in front of people with the detector's boxes already drawn.

## What it does

1. **`hard_frames` (worker, `cpu_small`, contract 1.22.0).** It reads a pinned detect run
   and the ball trajectory built over it, both checked against their checksums. It loads
   no model and reads no video. It picks up to `maxFrames` frames (default 200, at most
   500) and writes `hard-frames.json` (role `hard_frames`, `hard-frames/v1`): each frame,
   why it was picked, and the detector's boxes on it, normalised to 0–1 and ball first.
2. **Queueing (API, a person's action).** `POST /vision/annotation/queue/hard-frames/:jobId`
   (`vision.datasets.manage`) turns each picked frame into a one-frame active-learning
   window. The window remembers the job and the detector. Queueing the same job twice adds
   nothing. Each queueing is audited as `annotation.queue.hard_frames`.
3. **Pre-labelled tasks.** A window converted into a task carries `preLabelJobId` and
   `preLabelModelVersionId`. The task opens on the detector's boxes,
   `GET /vision/annotation/tasks/:id/prelabels`, each marked as the model's. The page
   already says "Pre-labelled by a model — check, do not assume". Once a person saves an
   attempt, their boxes are what the task shows.

On the Annotation page, **Frames picked for labelling** lists succeeded runs with a
**Queue N frames** button.

## Which frames

Only live play: frames the ball trajectory marks `non_play`, `camera_cut` or
`camera_unknown` are skipped.

| Cause | Meaning | Queue reason | Rank |
|---|---|---|---|
| `ball_missed_between_sightings` | No ball detected, but the ball is seen within 8 frames before and after, in the same camera | `stage_disagreement` | 0.9 |
| `ball_low_confidence` | The best ball is under 0.5 | `low_confidence` | 0.7 |
| `tile_only_ball` | Only the tiled pass found the ball, the full-frame pass did not | `stage_disagreement` | 0.6 |
| `random_live_play` | Ordinary play, a seeded random draw (doc 09's sampling mix) | `uniform_random` | 0.1 |

Picks are at least `minGapMs` apart (default 1 s), so one moment is not labelled ten
times. Random play takes `randomShare` (default a third) of the frames, so the model also
sees ordinary play.

The share is taken of the frames the clip can actually give at that gap, not of
`maxFrames`. The stage first places every hard frame to measure that room. It then keeps
the best-ranked hard frames for their share and gives random play the rest. If random play
runs short, hard frames fill the gap. A random pick never displaces a better-ranked hard
frame. The draw is seeded by the footage checksum, so a rerun picks the same frames.

## Held-out footage is refused

A match under an event answer key can never be trained on (doc 98). Labelling its frames
would waste a person's time. So both enqueueing `hard_frames` and queueing its frames are
refused with `FootageHeldOut` when an event gold set exists on the asset or on its
ScoreBoard match. That covers both pilot clips. A live run waits for training footage.

## Dry run on the 1XCup clip

A read-only check, with nothing enqueued or queued. It used the stored detections
(`3fd77a8d…`, attempt 2) and ball trajectory (`6e16e3fa…`), run locally through the
stage's own picking code:
- The ball index's `detectionsChecksum` matched the detections file.
- **105 frames** were picked: 70 balls missed between sightings, and 35 of random play,
  exactly a third.
- 2,812 pre-label boxes, of which 20 are balls; the artifact is about 330 kB (the limit is
  4 MB).
- No low-confidence or tile-only frames were picked. With 1 s gaps on a short clip, the
  misses (rank 0.9) fill the hard share. On a full match the gap is not binding, and every
  cause gets frames.

The dry run caught a flaw in the first version. That version gave random play a third of
`maxFrames`, after the hard frames had taken the clip's room, so random play got only 11
of 105. The two-step placement above replaced it, and a test now covers it.

## What it does not do

- It writes nothing to Postgres when the stage completes. The picks stay in the artifact
  until a person queues them, so picking is the machine's but putting frames in front of
  people is not.
- It does not label anything. Pre-labels are the detector's guesses, marked as such. Only
  a person's saved and reviewed attempt can enter a dataset.
- It does not train. Training is Step 4 of doc 98.

## Files

- Contracts: `packages/vision-contracts/src/hard-frames.ts`; `jobs.ts` (1.22.0,
  `hard_frames` after `ball_trajectory`).
- Worker: `dtp_vision_worker/hard_frames.py` (`choose`, `attach_boxes`, `boxes_of`);
  `stages/hard_frames.py`; `tests/test_hard_frames.py`.
- API:
  - `jobs/vision-jobs.service.ts` (`hardFramesInputs`);
  - `jobs/stage-results.service.ts` (`applyHardFrames`, which checks the completion and
    writes nothing);
  - `annotation/hard-frames-artifact.ts` (a bounded read, checked against the
    completion's checksum, with every frame and box validated);
  - `annotation/annotation.service.ts` (`queueHardFrames`, `preLabels`, `hardFrameRuns`);
  - `annotation/hard-frames.spec.ts`.
- Schema (migration `20261018000000_hard_frames_prelabels`):
  - `vision_active_learning_items.source_job_id` and `.pre_label_model_version_id`;
  - `vision_annotation_tasks.pre_label_job_id`.
- Web: `AdminVisionAnnotationPage` (the picked-frames panel) and `AdminVisionTaskPage`
  (opens on the pre-labels).
