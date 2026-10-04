# 59 — QA fix 9: the workstations

PR-9 of the fix plan in [50](./50-QA-PHASES-1-6.md) §3. It covers C6 and the workstation
findings in appendices D and F: the annotation, identity and calibration screens, and the
Events page. The contract version stays `1.12.0`.

The open question on this PR was whether existing gold boxes need re-checking. Fola's
ruling (3 October 2026): discard the dev gold boxes. The one annotation version in the dev
database was deleted and its tasks put back in the queue. **Live is a separate question;
see "After merge".**

---

## C6: a drawn box is a fraction of the picture

The annotation stage is as wide as its column and no taller than 62% of the window. On a
wide window the video is letterboxed, with a bar either side of the picture. A drag was
measured against the whole stage, bars included, so every stored `x` and `width` was wrong
by the width of the bars, and the benchmark scores models against those boxes.

The page now measures where the picture sits (`usePictureRect`, from the video's own pixel
size) and maps the pointer onto it (`pointOnPicture`). The boxes are laid out inside an
element that is exactly the picture. A drag that starts or ends on a bar is clamped to the
picture's edge.

Checked in a browser at 1500 px wide: the stage was 1,077 px, the picture 992 px with a
42 px bar each side. A drag from (304, 189) to (551, 330) drew a box at exactly those
pixels and stored `x` 0.2499, `width` 0.2490. The old arithmetic would have stored 0.269
and 0.229.

## The identity workstation

| Was | Now |
|---|---|
| The playback loop was keyed on the media alone. When the media arrived before the review rows there was no video element yet, the loop never attached, and the playhead and boxes stood still while the video played | Keyed on both being loaded. The calibration page had the same fault and the same fix |
| Positions were fetched one track at a time, in sequence, for up to 2,000 tracks, and the loop restarted after every action | One request: `GET /vision/review/:assetId/positions`. The tracks of a run share one artifact, so the API reads it once |
| After a track re-run the footage has two sets of tracks for the same players, and both were drawn and listed | The endpoint answers for the latest track run only. The page lists and draws those tracks and says "the latest of N track runs" |
| `U`, `1`–`9`, `A`, `R`, `M`, `S` and `?` did not exist. Docs 08 and 48 said the digits did | All built; see the map below |
| Every shortcut fired under Ctrl, Cmd and Alt, so Ctrl+E proposed an event | A modified key is the browser's |
| A held key repeated: holding `E` filed a candidate per repeat. `E` also ignored `busy`, so two quick presses filed two | Keys that write fire once per press and not while a request is running. Arrows and the walking keys still repeat |
| Space on a focused button pressed the button and toggled play as well | Space on a button, a link or a summary is that element's |
| Selecting was reset on every reload of the rows, which cleared the search box and the chosen candidate after each action; the note was never cleared, so it rode along to the next track | Reset when a different track is selected, and the note is cleared with the rest |
| A slow candidates answer for the previous track could land on the current one | A stale answer is dropped |
| The playback URL is signed and expires; after that the video failed silently | On a video error the page asks for a new URL once and returns to where the playhead was |
| A proxy with no recorded duration left the scrubber with nowhere to go | Falls back to the duration the video element reports |
| A proposal and a split were stored at the scrubber's fraction of a millisecond | Stored at the start of the frame shown, a whole millisecond (`snapSourceTimeMs`). The calibration page's segment marks and clock anchors do the same |
| A track's box said it was a button and took focus, and answered to no key | Enter and Space select it |

### The keyboard map, as built

`identity-shortcuts.ts` is the map as a function of the key event, with its own tests. The
`?` panel is printed from a list in the same file.

| Key | Does |
|---|---|
| `Space` | Play or pause |
| `←` `→` | One frame; with Shift, one second |
| `,` `.` | The previous or next thing waiting for this reviewer |
| `[` `]` | The previous or next event candidate |
| `E` | Propose an event at the playhead |
| `U` | Mark the selected track unknown, over the whole track |
| `1`–`9` | Assign the selected track to that candidate in the list as shown, over the whole track. The list shows the numbers |
| `A` | Accept the chosen event; else the selected track's waiting identity; else the event under the playhead |
| `R` | Reject the same. A reason is required, so with none typed `R` puts the cursor in the reason box |
| `S` | The chosen candidate gets the track up to the playhead |
| `M` | Open Merge and go to its first tick-box |
| `?` | Show or hide the list |

Two differences from doc 08's table, both already true before this PR and now written
down there: `[` and `]` walk candidates and do not set an event's start and end, and `M`
opens the merge list and does not merge by itself, because a merge needs the other tracks
named.

`A` on a track with several waiting windows takes the one under the playhead. If there is
none there it says so and does nothing.

## Events and the timeline

- The timeline dropped a candidate that starts after the clip and kept one that ended
  before it, clamped to the first pixel. A clip cut from the second half showed every
  first-half event stacked at its start. Both are now left out.
- `[` and `]` could get stuck: a candidate outside the clip cannot be reached, so the
  playhead did not move and the next press found the same candidate. They now use the
  rule `,` and `.` already had.
- The Events page had its own copy of the rule for which buttons a candidate allows. It
  offered Promote on a candidate that is not in play, which the API refuses. It now calls
  `allowedActions`, as the workstation does. The rejection reason is trimmed before it is
  sent.

## No state by colour alone

| Where | Was | Now |
|---|---|---|
| Timeline marks | review state was the mark's colour, with the words in a hover title | each mark carries `U`, `A`, `R` or `P`, with a key under the strip |
| Minimap dots | side and class were the dot's colour | the label reads `A`, `B`, `GK`, `ref` or `ball` before the name |
| Footage stage list | a stage's state was its label's colour | `✓`, `…`, `✕` or `–` beside the label, and the state in words for a screen reader |
| Calibration landmarks | removable by right-click only | Delete or Backspace with the landmark focused |

## Two smaller things

- **The overview's Annotation tile always read 0.** It counted tasks in states `open` and
  `claimed`, which no task ever has. It now uses the contract's
  `OPEN_ANNOTATION_TASK_STATES`. In the dev database it reads 5.
- **The match halves are in the contract** (`MATCH_HALVES`, `clock.ts`). The API's clock
  and the web's playhead minute read the same table; the web had its own copy of the
  numbers. This was carried over from [58](./58-QA-FIX-8-CONTRACT-PARITY.md).

## Tests and checks

| Check | Result |
|---|---|
| Contracts | 66 passed (was 65) |
| API suite | 1,450 passed (was 1,448); typecheck clean |
| Web | 209 passed (was 196); typecheck and build clean |
| Worker | not run: nothing in it changed |
| Mutation runner | MUTATION_RESULT |
| `vision:trackcheck`, run twice | 53/53 (was 48). Five new checks read the batched positions from a real artifact and real rows |
| `identitycheck` 65/65, `eventcheck` 89/89, `clockcheck` 34/34, `calibrationcheck` 41/41, each twice | pass |
| `jobcheck` 27/27, `gamestatecheck` 63/63 | pass |
| `db:purge:gate-litter` | nothing to delete |
| Browser, identity workstation | a scratch fixture with two track runs, two reviewers, a waiting identity and an event. Three boxes drawn, not six; the clock moved during play; `U`, `2`, `S`, `M`, `R`, `A`, `[`, `]`, `?` each did what the table says; Ctrl+E proposed nothing |
| Browser, annotation workstation | the drag above |
| Browser, calibration page | the kind selector offers the contract's six kinds (open from PR-8); the clip plays; Mark start at 00:07.012 stored 00:07.000 |
| Browser, footage, events, overview | the stage marks, the events table and the tile reading 5 |

The scratch users, tracks, jobs, event and stored objects were removed afterwards, and the
claimed task was put back in the queue.

## What is not done

| Item | Why | Where |
|---|---|---|
| The expired-URL refresh, shown end to end | It needs a URL to expire. The code path is read, not exercised | first time it happens on staging |
| The same refresh on the calibration and annotation pages | Only the identity page has it | PR-10 or a follow-up |
| Overlay toggles in doc 08 (detections, trails, segment boundaries, per-reviewer persistence) | Not in appendix D's findings; never built | not planned in this fix list |
| `[` and `]` setting an event's start and end, as doc 08's table first said | The inspector's buttons do this. Doc 08 now says what the keys do | not planned |
| A page-level test of the identity workstation | The web has no component test harness; the arithmetic and the key map are tested as functions, and the page was driven in a browser | PR-11, with the gates |

## After merge

1. Nothing to run by hand. There is no migration.
2. **Gold boxes on live.** Any annotation version drawn on live before this deploy, on a
   window wider than the picture, has wrong `x` and `width`. Dev had one version and it
   was discarded. If live has any, they need the same decision: discard, or redraw.
   `select count(*) from vision_annotation_versions` on live answers whether the question
   arises.
