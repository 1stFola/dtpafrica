# 41 — Phase 5 Increment 4: which whistle was kick-off

> Substitutions and kit changes mean identity has `validFromMs` and `validToMs`.
> A number is not a permanent key.
> — [09-ML-PIPELINE](./09-ML-PIPELINE.md), § Tracking and identity

Three increments deferred to this one. [35](./35-PHASE-4-INCREMENT-4.md) listed a
track's candidates from the whole match squad because substitutions, recorded
against the match clock, could not be applied to a window in file time;
[38](./38-PHASE-5-INCREMENT-1.md) and [39](./39-PHASE-5-INCREMENT-2.md) each ended
with the clock still unanchored. Nothing in a file says which millisecond is
kick-off. Now a person says so, once per half, and from then on any source
millisecond has a match minute, any match minute has a source millisecond, and
the roster is told the time.

---

## An anchor is a whistle with a name on it

A `VisionClockAnchor` is the source millisecond a person marked as a half's
kick-off, and, when they marked it, the whistle that ended the half. One current
row per half per asset; a new anchor supersedes the old one; the operator key is
refused, as everywhere a judgement about the footage is filed. Halves are 1 and
2, with 3 and 4 for extra time, and they are kept in order both ways: the second
half cannot kick off before the first ended, and the first cannot run past the
second's kick-off. A clock that runs backwards is not a clock.

The editor does the marking: pause on the whistle, pick the half, *Kick-off is
here*; later, *Half ends here*. Both workstation screens now show the match
clock beside the two file clocks they already showed, which [08](./08-FRONTEND.md)
asks for because `47:12` on the match clock is not `47:12` in the file.

## Reading the clock

Minutes are the broadcast kind: the second half starts at 45, extra time at 90
and 105, and added time runs past the base — `47:12` is two minutes into the
second half, `91:00` is a minute of second-half stoppage. Before the first
anchor is *before kick-off*; after a half's end and before the next kick-off is
*between halves*; after the last marked end is *after the final whistle*. A
track's window reads the same way (`10:00–15:00`), and reads as nothing when
either end is off the clock: a window across the break is nobody's minute.

The browser carries a small mirror of the reading for the playhead; the API is
the authority, and the mirror's test is that it agrees.

## The roster told the time

With the clock anchored, a track's candidates are the players who were on the
pitch for its window, substitutions applied from the match record: a starter
from kick-off until taken off, a substitute from the minute they came on, either
until taken off again. A player taken off before the window, or brought on after
it, is not listed; one whose change falls inside the window is listed as
*partly*. The candidates response says what the clock removed and why, and the
caveat from [35](./35-PHASE-4-INCREMENT-4.md) is replaced by its opposite. The
side narrowing and the clock narrowing are independent: overruling the kit
lifts the first and not the second.

ScoreBoard records a substitution with the outgoing player's id and the
incoming player's number — in the recorder's metadata, or in the detail text
`#19 off, #14 on` for rows entered by hand — and the reader takes both forms.
Numbers are what the record has, and youth squads reuse them: a side with two
number sevens cannot say which one came on. That is the record's limitation,
read faithfully rather than guessed around, and the gate picks uniquely
numbered players for exactly that reason.

## Verification

```
api tests              1,272 passed   (was 1,236)
  match clock              9
  anchoring                3
  identity on the clock    2 more
web tests                161 passed   (was 158)
  clock mirror             3
typecheck               api and web clean
migration               both shadow diffs empty
vision:clockcheck       34/34 against the real API and Postgres, on a real match
                        roster with a substitution written for the run and a
                        signed-in person; run twice; no litter, no rows left
```

Twenty-three mutations, each caught: file minutes instead of broadcast minutes;
the break ignored; the final whistle taken for a break; a minute before its half
accepted; a window with one end off the clock accepted; the outgoing and the
incoming number not read from the detail text; a substitute on from kick-off; a
player never taken off; nobody ever off the pitch; everyone fully on; a fifth
half; a half ending before it starts; halves out of order either way; an anchor
not superseding; the person requirement removed; off-pitch players kept; the
other side's substitutions applied to this one; the caveat kept when the clock
was anchored; and the browser mirror's minutes, break and next half.

The editor was driven in the browser as a signed-in reviewer on the demo proxy:
kick-off anchored at the playhead, the clock reading `0:01 · 1st half` a second
later, the half's end marked, and `after the final whistle` past it; the identity
screen reading `before kick-off` at its start. One screen fault caught there: after
a kick-off was filed the half picker advanced itself to the next half, so *Half
ends here* targeted a half with no anchor and stayed disabled. The picker is now
set once and stays where the reviewer put it.

Two fixture lessons from the gate, both about real data: the dev match carried
eight substitutions of its own, so the gate now takes a match with none and
writes the one change it needs; and the gate keyed its lookups by jersey number
until two home number ones showed why the record cannot either.

## What is not done

| | |
|---|---|
| **Kit changes** | [09](./09-ML-PIPELINE.md) names them beside substitutions; the record has no event for one. When it does, the same window logic applies. |
| **Minutes on the identity rows** | An identity assignment's window stays in source milliseconds, the footage's own unit; it reads on the clock through the review view. Storing match minutes on the row would freeze a reading that re-anchoring could change. |
| **Automatic anchoring** | A whistle is audible and a kick-off is visible; a model for either is not in the licence register. The editor is the floor. |
| **Camera segments on the clock** | A segment reads on the clock like a track does, but nothing yet asks. Game-state chunks will. |
