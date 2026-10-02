# 36 — Phase 4 Increment 5: the room where a name is given

> `Unknown` is one keystroke. If marking unknown is harder than guessing, reviewers
> will guess. That is the single worst failure mode in the system.
> — [08-FRONTEND](./08-FRONTEND.md), § Non-negotiable behaviours

[35](./35-PHASE-4-INCREMENT-4.md) built the identity review model and its API and
said the screen would wait for the pod, because a reviewer needs to see the player
before naming them. That was wrong about what was needed. The annotation
workstation already plays the proxy in the browser, and a track's positions are
in its artifact: a box can be drawn on the frame the tracker saw it on without a
single server-side crop. So this increment is the screen — the roster-and-identity
panel of the review workstation in [08](./08-FRONTEND.md), with the video it
needs — and nothing about the review model changed to make it.

---

## What the reviewer sees

The proxy on the left, every track's box drawn on the frame being shown, the
selected one highlighted; click a box to select its track. Both clocks and the
frame number, a scrubber, and the same transport as the annotation workstation
(Space, arrows, Shift-arrows). A box is where the tracker saw the player: a track
that was hidden for a gap has no box in the gap, and nothing is interpolated.

On the right, in the order a review goes:

1. **Which team is which side.** Two selects over the match's two teams, one
   decision for both sides, refused by the API when they name the same team.
2. **The tracks**, each with its side and kit, the team a person said that side
   is, and who it is now — or *nobody has said*.
3. **The selected track.** Its current assignments with Accept and Reject for a
   second person (the person who assigned sees *yours; a second person accepts*
   instead); the candidates, narrowed to the side's match squad and searchable by
   number or name, with the clock caveat from [35](./35-PHASE-4-INCREMENT-4.md)
   stated in full; and the four verbs.

The four verbs are one verb. *Assign over the whole track* writes a window over
the track. *Up to the playhead* and *From the playhead* write the two halves of a
split, one at a time, from wherever the reviewer has paused. *Merge* is a list of
the asset's other tracks to tick, and writes the same person onto them as
propagated rows. *Mark unknown* is a button with no candidate picked, as near one
keystroke as a button gets, and it is never merged. The screen mirrors the API's
window rules before the round trip, so a window outside the track is refused by
the screen in the same words the API would use.

**Overruling the kit.** The candidates are the side's squad, which is the right
list until the kit was read wrongly — and then the player the reviewer needs is on
the other team and not in the list. Ticking *the kit side is wrong* asks the API
for the whole match squad (`candidates?all=1`), shows each candidate's team, and
sends `acceptSideMismatch` with the assignment; the track's side then reads
`(overruled)` beside the kit's own answer, which is kept.

**What the public would see** fetches the public view of the same asset and says
how many tracks and windows it holds. In the walkthrough below that number was one
track, one window, after seven assignments.

## Two things the browser taught

**A browser cannot read the bucket.** The first version presigned the track
artifact and let the screen fetch it, as the worker does. R2 refused the fetch:
its CORS policy allows a `<video>` source and not an `XMLHttpRequest` for JSON. So
positions come through the control plane — `GET /vision/review/tracks/:trackId/positions`
reads the artifact, caches it by key for the few tracks a reviewer clicks through
in a row, and returns the one track's positions. It refuses an artifact over 32 MB
rather than parse a match's worth on a 2 GB box. That refusal is a marker: a full
match's tracks need writing per track at the worker, and this is where that will
be felt first.

**An action must not move the playhead.** Reloading the media with the review
rows gave the video element a fresh presigned URL, and it went back to the start
after every assignment — which, for a split made at the playhead, is exactly the
wrong moment to lose your place. The media loads once.

## Verification

```
api tests              1,193 passed   (was 1,187)
  identity                26
web tests                149 passed   (was 135)
  identity review          14
typecheck               api and web clean
vision:identitycheck    53/53 against the real API and Postgres, after the
                        review-view changes; no litter
```

The screen was driven end to end in the browser against the local API, Postgres
and R2, on the demo proxy with four seeded tracks sided by a kit and a real
ScoreBoard match with 28 and 26 squad slots, as two signed-in people: sides
decided; candidates narrowed to 28 then searched to one; a whole-track assignment;
a split at 7.0s into two windows; a merge onto an unsided track; unknown; the kit
overruled with the whole squad of 54 in front of the reviewer; then, as the second
person, one window accepted and one rejected with a reason, and the public view
reporting one track and one window. The seeded fixture was removed afterwards and
the database checked empty of it.

Forty-one mutations, each caught: twenty-four in the review service (the
twenty-three from [35](./35-PHASE-4-INCREMENT-4.md) and the whole-squad request), and
seventeen in the screen's logic — a box found on a neighbouring frame; the no-rate
fallback widened; a box not clamped to the picture; a missing picture size
accepted; the window rules removed one by one; a split allowed at the ends; a
number matched as a substring; a name matched only as a prefix; the public test
without the player, then without currency; the assigner allowed to accept; the
overruled mark dropped; the summary reading superseded rows; the most-sided job
chosen wrongly; the merged mark dropped.

## What is not done

| | |
|---|---|
| **Per-track artifacts** | The positions route refuses an artifact over 32 MB. A match-length track artifact needs the worker to write positions per track; until then the screen serves clips and short matches. |
| **Crops** | [07](./07-API-CONTRACTS.md) once planned `GET /vision/review/tracks/:trackId/crops`; the proxy frame with the box drawn on it serves the same need and the route is dropped. A thumbnail strip of a track's best frames would still help a reviewer tell two similar players apart, and needs the pod. |
| **The rest of the workstation** | [08](./08-FRONTEND.md) draws a timeline, a minimap and an event inspector round this panel. They belong to the phases that produce events and calibration. |
| **Jersey candidates and the match clock** | Unchanged from [35](./35-PHASE-4-INCREMENT-4.md): a licence decision, and calibration's anchor. |
