# 48 — Phase 6 Increment 2: the event under the video

> `,` `.` Previous / next uncertainty (the main navigation verb).
> — [08-FRONTEND](./08-FRONTEND.md), § Keyboard map

[44](./44-PHASE-6-INCREMENT-1.md) built the ledger and [47](./47-THE-VISION-ENVIRONMENT.md)
gave it a page where a candidate is proposed by typing a source millisecond.
That is not how a reviewer works. A reviewer watches, stops where something
happened, and says what it was and who did it. This increment puts the event
review on the identity workstation, under the video, where the playhead, the
boxes, the roster and the minimap already are: a timeline of candidates, a
proposal at the playhead with the actor from context, and an inspector that
corrects, decides and promotes in place.

---

## The timeline

A strip under the player, one mark per current candidate at its place in the
clip, the playhead over them. Colour follows review state and a promoted
candidate has its own; a candidate inside a replay is hatched; the mark's
title and the inspector carry the words, so colour is never the only signal.
Clicking a mark seeks to the candidate and selects it. `[` and `]` walk to the
previous and the next candidate by start, the navigation verb the frontend
doc asks for, and `E` proposes at the playhead. The candidate under the
playhead is shown when none is chosen, so scrubbing through a match reads
the events as they pass.

## A proposal at the playhead

The Events panel beside the roster carries the type to propose and one
button, *Propose at 12:30.000*. The actor is the selected track, the same
selection a box click or a minimap dot makes, and the roster slot is the one
that track was said to be at that moment — its current identity assignment
covering the millisecond, when it names a player. The panel says what the
proposal will carry before the click: *Actor: track #4, the player it was
said to be*, or *nobody named yet*, or *select a track first*. The service
finds the rest of the evidence itself, as [44](./44-PHASE-6-INCREMENT-1.md)
built it.

## The inspector

The selected candidate's window on both clocks, its actor, its review state,
what it would be in the match record, and its evidence. Then the actions, each
present only when the service would allow it to this person, mirrored from the
service's rules so the buttons match the refusals:

- **Start here**, **End here**: the boundary moved to the playhead.
- **Actor: #4 Nine**: the actor set to the selected track and its slot.
- **Change type**.
- **Accept**, **Reject** with a reason: a second person's, never the proposer's.
- **Promote**, **Promote, creating**: a publisher's, on an accepted candidate
  the recorder has a type for, in play.

Every correction is a new row that supersedes the old and is unreviewed
again, and the inspector says so after each one. The URL carries the chosen
candidate, so the Events page of the environment hands one over to the screen
by link, and a second person's link lands on the candidate they were asked
to look at.

## Verification

```
web tests                184 passed   (was 177)
  event review             7
typecheck               web clean
```

Thirteen mutations of the browser module, each caught: superseded candidates
drawn; no minimum mark width; the playhead tolerance dropped; the farthest
candidate chosen; the next step including the current one; the previous step
going forward (a survivor on the first run, now a test); the slot ignoring its
window, or taking a superseded assignment; a window ending before it starts
allowed; self-acceptance offered; promotion inside a replay offered; a promoted
candidate still correctable; the not-play flag dropped from the description.

The screen was driven in the browser on the demo footage as two signed-in
reviewers. The first proposed a shot at the playhead from the panel: the
timeline showed one mark, the inspector read *yours; a second person decides*
with every correction available and no decision. The playhead moved two
seconds and *End here* made a new row — *End moved to 00:07.000. A new row
supersedes the old; review starts again* — with the window `00:05.000–00:07.000`
and still one mark, the old row gone from the strip. Clicking the mark put the
candidate in the URL. The second reviewer opened that URL, found the candidate
selected with *Accept* and *Reject* and no corrections of their own needed,
accepted, and the state read *accepted* with the mark recoloured. The two
reviewers and their candidates were removed.

One screen fact worth recording: in a browser tab that is not drawing, the
player's animation-frame clock does not tick, so the playhead stands still
whatever the video element's time says; the range input is the one control
that moves it there. On a visible tab both agree.

## What is not done

| | |
|---|---|
| **Dragging a boundary** | The boundary moves to the playhead, which is frame-accurate and keyboard-driven; dragging the mark's edge is a mouse nicety for later. |
| **Previous and next uncertainty** | `[` and `]` walk candidates by start; the frontend doc's `,` `.` over low-confidence objects of every kind waits on model-proposed candidates with a confidence to sort by. |
| **A number key for the actor** | The roster's `1`–`9` is the identity panel's; the event takes the selected track. (The identity panel had no digit keys when this was written. They were built in [59](./59-QA-FIX-9-WORKSTATION.md).) |
| **The gate** | Per-event precision and actor attribution need gold events on real footage; the screen is the tool that will produce them. |
