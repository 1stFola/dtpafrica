# 49 — Phase 6 Increment 3: the second, and the queue

> `SbMatchEvent.minute` is an `Int`. Vision produces millisecond-precision timestamps with
> confidence and evidence links. Truncating to a whole minute throws away exactly the precision
> that makes the evidence worth having.
> — [02-DECISIONS](./02-DECISIONS.md), D10

Two things Phase 6 promised and had not built. The sub-minute widening of the
recorder's event, planned in D10 as the one Vision migration allowed to touch a
ScoreBoard table, backwards-compatible and with its own review. And the review
queue, in the API contract since Phase 2 and the reason the frontend doc gives
`,` and `.` the most important line in its keyboard map: the reviewer's job is
to walk what the system is unsure of, not to scrub a timeline hunting for it.

---

## The second

`SbMatchEvent` gains `secondInMinute`, nullable, 0–59, beside the whole minute.
Every row the recorder entered keeps a null and reads as it always did. The
minute stays canonical and is never rewritten: that was Q7's ruling, and a
widening that quietly moved the recorder's goals would be the overwrite it
forbade.

Promotion writes the second under one rule, built as a function so the gate
could break it:

- on an event promotion **creates**, always — the row is Vision's and the
  candidate's moment on the match clock is all it has;
- on an event promotion **enriches**, only when the candidate's minute *is* the
  recorder's and the recorder entered no second. A candidate at 37:05 that
  enriches the recorder's 36' writes nothing: a second under a minute that is
  not its own would be a lie about the recorder's row. A second the recorder
  entered by hand is the recorder's word and stays.

The reply's `promotion` carries `second` beside `minute` and `minutesApart`:
what the row now holds, or null. The public timeline reads `47'12"` where a
second is set and `47'` where it is not, and sorts the two by minute first,
then second, a row with none at the minute's start. Nothing else that reads
the table changed shape, which is what backwards-compatible was supposed to
mean.

The migration is one `ALTER TABLE … ADD COLUMN`, checked against the shadow
database in both directions. It is the first Vision migration to touch a
ScoreBoard table, and [04](./04-DATA-MODEL.md) now says so.

## The queue

`GET /vision/review/queue` is what a signed-in reviewer should look at next:
every current, unreviewed identity assignment and event candidate that is
**not their own**, oldest first. The self-acceptance rule applied before the
round trip — the queue never shows a person something they cannot decide. Each
item says its footage and match, its moment on the match clock, who proposed
it and when, and, for an identity, the track and the roster slot named.
`waiting` counts the whole queue before `limit` cuts it; `?assetId` narrows it
to one piece of footage. The operator key has no queue: a queue is a person's.

The environment gets a **Review** section, under `vision.review` as deciding
is, grouped by footage in queue order, each item opening on the video at its
moment — `?event=` for a candidate, `?track=&at=` for an identity window — and
the overview a tile with the queue's depth. The identity workstation lands
where the link says: the track selected, the playhead at the window's start,
once the video can take the seek.

And `,` and `.` walk the same list for that footage, by source time, selecting
the track or the candidate and seeking to its start. One wrinkle the screen
found: on a proxy shorter than its source, the seek clamps to the clip's end,
the playhead never reaches the item, and a walk from the playhead returns to
the same item forever. So a walk remembers where it landed, and while the
playhead has not moved since, the next step is from the item, not the
playhead. Moving the playhead by any other means resets it. Until a model
proposes with a confidence, *unreviewed* is the only uncertainty the system
knows, and this walk is over exactly that.

## Verification

```
api tests                737 passed   (vision)
  review queue             4
  taxonomy + second        9
  events service          10   (+1 queue, +1 second)
web tests                188 passed   (was 184)
  uncertainty walk         2
  event clock              2
typecheck               api clean, web clean
migration               shadow diff empty, both directions
gate                    vision:eventcheck  64/64, twice   (was 48)
litter                  nothing to delete
```

Twenty-five mutations, each caught. The API's thirteen: the reader's own
candidates or identities kept in the queue; newest first; no limit; the
waiting count taken after the cut; an identity placed at its window's end;
ties unordered; the second written under another minute; the second
overwriting the recorder's; a created row without its second; the enriched
row ignoring the rule; the queue listing decided rows (a survivor on the first
run — the spec now asserts the event filter too); the asset filter ignored on
identities. The browser's twelve: my candidates or identities walked; decided
candidates walked; superseded identities walked; the identity placed at its
end; the list unsorted; the next step including the current item; the previous
going forward; the second never shown; unpadded; ignored in the order;
outranking the minute.

The gate grew by sixteen checks. The second: a created goal at 20:15 holds
`15` on the row and in the reply; the recorder's 33' enriched by a candidate
at 33:20 gains `20` with its minute untouched; the recorder's 36' enriched by
a candidate at 37:05 holds no second; a 25' the recorder gave the fortieth
second of keeps `40`. The queue: the operator key refused, an annotator
refused, the second person's queue on the gate's footage listing the identity,
the replayed goal and the corrected shot in the order they were made, the
superseded shot absent, the proposer's own queue empty, a limit cutting the
list but not the count, the queue without an asset spanning the footage, and
the shot leaving the queue the moment the second person accepts it.

The screens were driven in the browser as two scratch reviewers on the
45-minute demo record, whose proxy is a five-second clip of its sixth second
onward. The first proposed a shot and a tackle through the API on a track with
an unreviewed identity window. The second opened the Review section: three
items under the footage, oldest first, the identity window first, each with
its link. The identity link opened the workstation with track #7 selected and
the playhead at the clip's end, the furthest it could go; `.` showed the shot
in the inspector, `.` the tackle, `.` stayed, `,` the shot, `,` the identity
with the inspector closed. The candidate link landed on the shot; *Accept* read
*accepted* and the footnote fell from three to decide to two; the Review
section then listed two. The public match page showed a recorder row at `47'`
and a row with its second at `47'12"`, in that order. Two defects were found
by the browser and not by any test: the permission guard between the Vision
layout and its pages returned an outlet with no context, so the Review page
crashed on mount — it now hands the layout's context on — and the walk that
could not reach its item, above. The scratch reviewers, track, candidates and
recorder rows were removed.

## What is not done

| | |
|---|---|
| **`SbHighlight.mediaUrl`** | The other widening D10 planned, for Phase 7's clips. |
| **A confidence to sort by** | The walk and the queue are over *unreviewed*. When a model proposes, both should rank by its confidence, lowest first. |
| **The recorder entering a second** | The column accepts one; the recorder's console does not offer it. Pitch-side recording is to the minute, and nothing asked for more. |
| **Possession** | Still waits on a licensed ball detector in the OSS register. |
| **The gate on real footage** | Per-event precision and actor attribution need gold events; the screen that files them is built, the footage is not yet in. |
