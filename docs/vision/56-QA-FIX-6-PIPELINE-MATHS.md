# 56 — QA fix 6: pipeline maths

PR-6 of the fix plan in [50](./50-QA-PHASES-1-6.md) §3. It covers the pipeline-correctness
findings in appendices B and C, and one item carried over from
[55](./55-QA-FIX-5-EVENTS-CLOCK.md): identity's on-pitch check. Contract `1.12.0`.

---

## The assignment is optimal when pairs are forbidden

`hungarian` gave a forbidden pair the cost 1e18. Against that the potentials grew until
costs between 0 and 1 rounded away, and the result was an assignment but not the cheapest:
`[[inf, 0.268], [inf, 0.255]]` gave the box to track 0. The tracker uses it for crossing
players, and MOTA for matching.

A forbidden pair now costs one more than the sum of every allowed cost in the matrix. That
is finite, and still more than any rearrangement of allowed pairs can save. The answer is
the one with the most allowed pairs, and among those the cheapest. A new test holds it to
brute force over 6,000 random matrices at four shares of forbidden pairs, and over 500 with
negative costs, as IDF1 uses them.

## A segment covers its start and not its end

Cuts produce adjacent segments: one ends at the millisecond the next starts. Read
inclusively at both ends, that millisecond belonged to both, the earlier one won, and the
first frame after every cut was placed through the previous camera's homography.

`start <= t < end` is now the rule in all three readers:

| Reader | Where |
|---|---|
| The worker's game state | `gamestate.SegmentIndex` (a sorted index, so three million rows do not scan every segment) |
| The API's own placement of one track | `calibration.service.ts` `pitchPositions` |
| An event candidate's segment, which decides in-play | `events.service.ts` `segmentAt` |

Where two segments overlap, which they should not, the one that started latest covers the
moment. Each reader also takes the newest current calibration by `createdAt`, where it used
to take one without an order.

## A homography is oriented

A homography is defined only up to scale: `H` and `-H` send every pixel to the same point.
They differ in the sign of `w`, and that sign is how a reader tells a pixel the camera sees
from one beyond the horizon. The fit scaled its result so the last entry was +1, which is
`w` at the top-left pixel. For a camera with sky in the top-left corner, every pixel on the
pitch then had negative `w`, and the worker's `w <= 0` test suppressed the whole pitch as
`beyond_horizon`.

- **The fit orients its result** by the clicked points, which a person put on the picture:
  `w` is positive at them. A test camera with the horizon a quarter of the way down the
  picture now fits with `H[8] = -1` and places a point on the grass.
- **Clicks on both sides of the horizon** cannot all be in view. The sign goes with the
  majority, the fit reports `pointsAcrossHorizon`, and the calibration is `failed`
  whatever its error reads. It is filed, not refused, so the suppression rule fires and
  an older calibration does not stay current.
- **Stored rows are oriented when read.** `orientStored` signs a stored matrix by its own
  stored points. The job declaration and the API's placement both use it, so a row filed
  before this change needs no migration.
- **The worker cannot orient** because it is given no point known to be in view. Its
  `project` documents the contract: an oriented matrix.

## A point far off the pitch is not a position

Just under the horizon a pixel maps to hundreds of metres. Pitch dimensions were parsed and
never used. A placed point more than 5 m outside the lines (`OFF_PITCH_MARGIN_M`) is now
suppressed with the reason `off_pitch`, in the worker and in the API's placement. Five
metres covers a throw-in, a corner and a run past the goal line. The web minimap already
drops such points; it now has words for the reason.

## Coverage is over the frames the tracker was given

`validFrameCoverage` is the number the Phase 5 gate reads. Its denominator was the frames
that had at least one track row, so a frame where nothing was tracked did not count, and
the share was overstated.

The track artifact now carries `trackedFrames`: every frame the tracker was given, as
`[frameIndex, sourceTimeMs]`, with or without a track on it. Game state divides by those,
per chunk and in all, and reports `framesTracked` and `coverageBasis: "frames_tracked"`.
For a track artifact from before this change it falls back to the old share and says
`frames_with_tracks`; the minimap then reads "of frames with a track".

## Tracks age by the clock and end at cuts

- **By the clock.** `max_age` counted processed frames: thirty frames is 1.2 s at 25 fps
  and three seconds at ten. It is now `max_age_ms = 1200` on the proxy clock, and the
  artifact's params say `maxAgeMs`.
- **At cuts.** The tracker took no segments and linked across camera changes whenever two
  boxes happened to overlap. A `track` job is now declared `cuts`: the start of every
  camera segment on the asset but the first. Every live track ends at one, and the frame
  on the cut is the new camera's. `cuts` is a reserved input, so a caller cannot supply
  it. With no segments on the asset, only the clock ends a track.

Order matters: run `cuts` before `track`, or the tracker has nothing to end tracks at.
Nothing enforces that order, because `cuts` needs only the proxy and `track` only the
detections. The track summary reports `cuts` and `tracksEndedAtCuts`, so a run with none
declared shows as `cuts: 0`.

## Track and game state no longer hold a match

Both stages called `json.load` on an artifact with hundreds of thousands of elements and
then built a dict per row.

- `jsonstream.py` walks one large JSON object and hands over the elements of one top-level
  array one at a time, using the standard library's decoder on a refilled buffer. No new
  dependency. Its tests run at buffer sizes of 1, 2, 7 and 64 characters, and a random
  round-trip test found a real fault before it shipped: a float cut at the buffer's edge
  (`1.25` of `1.25e-05`) was read short.
- **Track** feeds a `Linker` frame by frame. Each track is written to a spill file as it
  ends, and the artifact is assembled from the spill in id order. Only live tracks are held.
- **Game state** places one track at a time and spills its rows to a file per chunk; each
  chunk is then sorted and written on its own. One track and one chunk are held.

Peak memory, measured in the worker image on synthetic detections, 25 fps and 23 players,
two minutes (3,000 frames, 69,000 boxes):

| Stage | Held (before) | Streamed (now) |
|---|---|---|
| Track | 92 MB | 47 MB |
| Game state | 155 MB | 104 MB |

Both figures include the interpreter, and for game state pyarrow, which is most of what
is left. The synthetic players never leave the picture, so every track lives the whole
clip. That is the worst case for the tracker, which must hold a live track's observations.
**A match-length run was not measured**: a 30-minute run was started and not finished
before this was committed. The held path grows with the clip; the streamed path's growth
is the live tracks only.

## Smaller fixes

- **IDF1 by asset.** Track ids are unique only inside one artifact. A benchmark over two
  assets merged gold "A" of one with gold "A" of the other. Ids are now `asset/track`. Two
  perfectly tracked assets scored 0.5 before and score 1.0 now.
- **A cut's score.** FFmpeg prints a frame's scene score before its `showinfo` line. The
  parser gave each score to the cut before it and dropped the first. It now holds the
  score for the cut that follows. The test fixture was hand-ordered the wrong way; its line
  order is now taken from a real run in the worker image (FFmpeg 5.1.9).
- **Transcode streams.** The proxy command now says `-map 0:v:0 -map 0:a:0? -sn -dn`. The
  audit said a broadcast capture's subtitles failed the mp4 mux. **I could not reproduce
  that**: on FFmpeg 5.1.9 the old command already left a subtitle stream out. The maps
  make the choice explicit across builds, and they do not change the settings hash, so
  existing proxies keep theirs.
- **A dead helper** (`covered_frames`, both branches `None`) is removed.

## Identity's on-pitch check, on the recorder's minutes

`candidates` narrows a track's roster to who was on the pitch, using substitutions from the
match record. It compared the record's minutes with stopwatch minutes that start the second
half at 45. That is off by one everywhere, and wrong by the difference for short halves: with
30-minute halves, five minutes into the second half read "50:00", after a substitution in
the 40th minute that had not happened yet. The starter was dropped from the list and the
substitute offered.

The track's window and each substitution now go onto one timeline
(`recorder-minute.ts`): minutes of play into a half, each half apart. A recorded minute is
the stretch of play it stands for, so a window inside the minute of a change is `partly`
for both players. A test checks that every moment of the footage falls inside the span of
the minute the console would have logged for it.

## Tests and checks

| Check | Result |
|---|---|
| Worker pytest | 324 passed (was 254) |
| API suite | 1,418 passed (Vision 842); typecheck and build clean |
| Web | 188 passed; typecheck clean |
| Contracts | 54 passed; the worker's mirror of the version agrees |
| Mutation runner | 51 of 51 killed, 29 in the worker and 22 in the API |
| `vision:trackcheck`, run twice | 48/48 (was 41): declared cuts and not the caller's, tracks ended at the cut, tracked frames, `maxAgeMs` |
| `vision:gamestatecheck`, run twice | 63/63: adjacent half-open segments, the frame on the cut, coverage against 150 tracked frames with 125 carrying a track |
| `trackmetricscheck`, `cutscheck`, `calibrationcheck`, `clockcheck`, `identitycheck`, `eventcheck`, `jobcheck` | all pass |
| `vision:e2echeck`, the real container built from this branch | 38/38 on both test clips: probe, transcode with the new maps, cuts with the new parser, under contract 1.12.0 |
| `db:purge:gate-litter` | nothing to delete |

## What is not done

| Item | Why | Where |
|---|---|---|
| Existing game state on live | A run from before this change keeps its old coverage share until `gamestate` is run again, and says `frames_with_tracks`. Existing track artifacts have no `trackedFrames`; run `track` again to get them and to end tracks at cuts. No real footage has been through either yet | on the next run |
| A hand-declared segment in the middle of a shot | Its start is declared a cut like any other, and splits a track there | a product decision |
| `decode_frame` per call; `_two_medoids` in pure Python | Appendix C medium, performance in `identify` | PR-10 |
| `-vsync cfr` is deprecated in FFmpeg 5.1 | The GPU image has 4.4, which has no `-fps_mode` | when the images agree |
| The FFmpeg licence row | A decision for Fola or legal | [50](./50-QA-PHASES-1-6.md) |
| The identity benchmark's side decision; `supersedeOverlaps` | Appendix B medium | PR-7 |
| `method: manual` on a correction; the proposer accepting after another's correction | Appendix B low | PR-12 |

## After merge

The deploy builds the worker image and the API from one commit, so both move to contract
`1.12.0` together. Nothing to run by hand. A GPU pod on an older image will be refused at
claim until it is rebuilt, as with every contract bump (the compatibility rule is PR-8).
