# 101 — Labelling set-up and the review queue

20 October 2026. Ten more 1XCup matches went through hard-frame mining (doc 100's
recipe), all the picked frames became labelling tasks, and the Annotation page gained
the list a reviewer was missing.

## Round 2 of training footage

- **Footage.** Fola supplied ten 1XCup 2026 group matches from the 1xCup Nigeria channel,
  all covered by the 1XCup media rights agreement already on file. Two 3-minute live-play
  clips were cut from each match, one per half, by stream copy. The exception is Collins
  Edwin v Elite Stars, whose video holds only the first half, so both its clips come from
  that half. Each clip is its own source and asset, linked to its ScoreBoard match.
- **Shots.** camera_motion proposed 234 shots. The machine account declared a shot
  `live_play` only when the broadcast score bug was on screen at both its start and end:
  a template match on the 1XCUP crest, which scores about 0.2 on full-screen graphics and
  0.72 or more on all 82 shots checked by eye in doc 100. All 234 passed.
- **Detect.** RTX 4090 pods only: the default GPU list starts with the L4, which ran
  doc 100's detect about 2.6 times slower per frame. Two pods ran in parallel, and the
  CPU workers kept a separate local API, so nothing restarted under them. The 21 clips
  (the 20 new ones plus doc 100's fourth clip) cost **$2.31**, about $0.11 a clip.
  Phase 6 spend is about $4.28 of the $8 ceiling Fola set on 19 October.
- **Picks.** 3,010 frames: 1,743 balls missed between sightings, 246 low-confidence
  balls, 17 tile-only balls and 1,004 frames of random play. With doc 100's 427, that is
  3,437, past doc 98's first target of about 3,000.

## Ready for labelling

On Fola's go-ahead:

1. All 24 runs were queued.
2. Fola's account became `vision_admin`, since reviewing needs both `vision.annotate`
   and `vision.review`. The freelancer's account became `vision_annotator`.
3. Label schema **ball-2026.1** was published. Its definitions match the labeller's
   manual, which its `handbookKey` names.
4. **3,436 tasks** were created, each opening on the detector's boxes. One frame, the
   last of a clip, was refused with `WindowPastAsset`.
5. The freelancer reaches a **built copy** of the site, never the development server.
   Vite 5.4.21's dev server has GHSA-fx2h-pf6j-xcff and can serve `services/api/.env`
   through a shared link. The built copy returns only its own files. A launcher outside
   the repo starts it with `VITE_ALLOWED_HOSTS=.trycloudflare.com` and opens the link.

## The review queue

Before this, nothing listed submitted work: a reviewer had to be handed task links.

- `GET /vision/annotation/review-queue` (`vision.review`) lists submitted tasks, oldest
  submission first. Each row carries the labeller, the footage title, the window and the
  sampling reason.
- Work whose latest attempt is the caller's own is counted (`yours`) but not listed,
  because self-review is refused.
- On the Annotation page, **Waiting for your review** shows the list to anyone with
  `vision.review`. **Review** opens the frame page with its Approve and Send back buttons.

**Deliberately not added: a "corrected" button.** The API accepts a `corrected` verdict,
but a reviewer who fixes the boxes becomes their author. Under the two-person rule
someone else would then have to approve the fix. So a wrong frame is sent back to its
labeller.

**QA.** The specs cover ordering, the reviewer's own work, the page cap and the operator
key. In the browser, a scratch labeller submitted a scratch task. A scratch reviewer saw
it under "Waiting for your review", with the labeller's name and the footage title.
**Review** opened its frame page, with **Approve** shown. The labeller's own request for
the list was refused (403). The task was then abandoned, not approved, so it cannot reach
a training set, and both scratch accounts were deleted.

## Files

- API: `annotation/annotation.service.ts` (`reviewQueue`), `annotation.controller.ts`,
  `annotation/review-queue.spec.ts`.
- Web: `api/vision.ts` (`fetchVisionAnnotationReviewQueue`), `AdminVisionAnnotationPage`.
