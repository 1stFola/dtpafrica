# 55 — QA fix 5: events and the clock

PR-5 of the fix plan in [50](./50-QA-PHASES-1-6.md) §3. It covers critical C1 and the event
findings in appendix B. Fola's two decisions (3 October 2026) are built as taken: promotion
uses the recorder's minute convention, and a created goal goes through ScoreBoard's score
and stats lifecycle.

---

## The record is in the recorder's minutes (C1)

Vision's clock is a stopwatch: 46:12 is forty-six minutes and twelve seconds after a
kick-off, and the second half starts at 45. The recorder's console writes the match record
differently (`apps/web/.../useMatchClock.ts`):

- the minute is the one being played, counted from one: `floor(elapsed / 60) + 1`;
- it stops at the match's own half length, and the second half starts there, so a youth
  game of 30-minute halves reads 31' a minute after the restart;
- added time is kept beside the minute, in `metadata.addedMinute`, with `metadata.half`.

Promotion compared a stopwatch minute with a recorder minute on `minute` alone. A goal at
45+2 never matched and was re-created as 47'. First-half added time collided with the second
half. Every second-half minute was wrong for a match with short halves.

`clock/recorder-minute.ts` now converts a clock reading to what the console would have
logged, and promotion reads and writes only that. The stopwatch is unchanged and is still
what the workstation shows (`47:12`).

| Footage | Half length | Old | Now |
|---|---|---|---|
| 20:15 into the first half | 45 | 20' | 21', second 15 |
| 47:12 into the first half | 45 | 47' | 45+2', second 12 |
| 1:12 into the second half | 45 | 46' | 47', second 12 |
| 1:12 into the second half | 30 | 46' | 32', second 12 |

**Half length** comes from the recorder's sheet once it has kicked off, else the
competition's `halfLengthMinutes`, else 45. Before kick-off the sheet holds a default that
says nothing about the match, so it is ignored.

**Matching** is now on half, minute and added minute. Two events are compared only within
one half, and added time counts on: 45+2 is two past 45 and one past 45+1. A recorder row
without `metadata.half` (entered through the match-event editor or a CSV) is placed by its
minute: at or under the half length is the first half. The tolerance is still one minute.

**The second** is written beside the recorder's minute only when the minute and the added
minute are both the recorder's, and the recorder entered none. That rule is unchanged; it
now fires in the ordinary case, because the minutes agree.

**Two refusals are new.** `ExtraTimeNotRecorded`: the recorder's record has two halves, so a
candidate in halves 3 or 4 has no minute to be written at. `HalfEndNotMarked`: a candidate
past the half's length, in a half whose end whistle nobody marked, has nothing saying it was
still play (the "half with no end" finding).

A row promotion creates carries `metadata.half` and `metadata.addedMinute` where the
recorder's rows carry them.

## A created goal counts

`create: true` inserted a goal and nothing else. The public timeline showed a goal that the
scoreline and the scorer's totals did not count.

It now does what the match-event editor does: the goal and the score change in one
transaction (an increment, so a concurrent one is not lost), then
`applyMatchEventToPlayerStats` credits the scorer and `refreshStandingsForFinishedMatch`
tells the table. If crediting fails after the commit, the promotion is still reported and
the failure is logged; `db:repair:player-stats` finds an uncredited goal.

The created row is marked `metadata.source = "vision"`. The recorder's console sets the
score from the sheet at four places, and each now counts goals with that mark
(`scoreboard/video-goals.ts`):

| Where | Before | Now |
|---|---|---|
| Approval | sheet's goals | sheet's goals plus video goals |
| Full-time sync | sheet's goals; a video row counted as "a timeline that is not ours" and held the score | sheet's goals plus video goals; video rows are not a reason to hold |
| Live feature switched on after full time | sheet's goals | sheet's goals plus video goals |
| Approved sheet sent back | 0–0 | the video goals, because that row is still on the timeline |

On a match Vision has added nothing to, which is every match today, each of these writes
exactly what it wrote before.

`TeamUnknown` now also refuses a team that is not one of the match's two.

## One promotion, one decision, one current row

Each step that moves a candidate on is now conditional on the state it was read in.

- **Promotion** claims the candidate first (`updateMany` where it is still accepted,
  current and unpromoted) and writes nothing if the claim finds no row. Two promotions at
  once leave one goal.
- **One recorder event is one candidate's.** A second candidate matching an event that
  already carries one is refused with `409 AlreadyEnriched`. It used to hit the unique
  constraint and return a 500. Two at once are caught by the same constraint and get the
  same refusal.
- **A decision is not flipped in place.** `decide` works only from `unreviewed`
  (`409 AlreadyDecided`). To change a decision, correct the candidate; the review starts
  again.
- **Two corrections at once** leave one current row; the other gets `EventSuperseded`.

## The minute that was accepted

One reviewer could re-anchor a half after a candidate was accepted, and move the minute
that promotion would write, with no second person. Acceptance now records the anchor the
candidate was read on (`VisionEventCandidate.acceptedAnchorId`). Promotion refuses under
any other anchor with `409 ClockChangedSinceAcceptance`. That includes a candidate accepted
before its half was anchored: nobody reviewed its minute. The way on is a correction, which
may change nothing; a second person then accepts it on the clock as it stands.

Migration `20261005100000_vision_event_accepted_anchor` adds the nullable column. Every
existing row keeps a null. **An accepted, unpromoted candidate on live must be corrected and
accepted again before it can be promoted.** There should be none: no real footage has been
reviewed yet.

The folder is dated after `20261005090000` on purpose. That migration and the one before it
are future-dated and already applied on live ([50](./50-QA-PHASES-1-6.md) §4), and the table
this one alters is created by the earlier of them. A real date would sort this file before
its own table on an empty database, and CI builds the schema from zero.

## When the recorder's sheet is rebuilt

The console deletes the rows it published when an approved sheet is sent back, and writes
them fresh when the sheet is approved again. A row Vision had enriched went with the rest.
The candidate's link was nulled by the foreign key, so it looked unpromoted and could be
promoted a second time; the stamp and the second were lost.

- **Stale is a state.** A candidate with `promotedAt` set and no `promotedEventId` was
  promoted into an event that has since left the record. The reads return
  `promotionStale: true`. `promote` and `decide` refuse it with `409 PromotionStale`. A
  correction starts it again. The web shows "left the match record" and offers only
  Correct.
- **Approval puts it back.** After approval rewrites the rows, each stale *enriched*
  candidate of that match goes through the rule that promoted it: read on the clock it was
  accepted on, in the recorder's minutes, against the rows as they now are
  (`events/reapply-enrichment.ts`). Where that names one recorder event, the stamp goes
  back on it, with the date the publisher promoted it, and the candidate is linked again.
  Where it names none or two, or the half was re-anchored since, the candidate stays stale.
  A failure here never fails the approval.
- A goal Vision *created* is not the console's row and is not deleted by a rebuild.

Rights are not re-checked when a stamp is put back. Putting it back restores a promotion a
publisher already made; withdrawing what was published is the staleness work of Phase 7.

## Tests and checks

| Check | Result |
|---|---|
| The conversion | Agrees with the console's own formula at every second of both halves, for half lengths 20 to 45 (a copy of `liveMinute` and `liveAdded` is in the spec). Extra time has no minute |
| Matching | 45+2 matches 45+2 and is one from 45+1; first-half added time never matches the second half's same number; `sameMinute` needs minute and added minute |
| The service | Enrich at the recorder's minute; added time; a 30-minute half; a clock changed or anchored after acceptance; an unmarked whistle; one candidate per event, before the write and at it; a lost race on promote, decide and correct; a stale candidate; a created goal on the scoreline, the totals and the table, home and away; a failed credit |
| Re-apply | Same event relinked with stamp, second and the row's own metadata; a goal moved a minute; removed, moved further or re-attributed stays stale; two rows equally near; one row per candidate; the accepted clock; a candidate corrected meanwhile |
| Score helpers | Video goals by side; full-time sync counts them and does not hold the score because of them; a hand-entered timeline still holds it |
| Mutation runner | 43 of 43 killed: each rule above removed in turn fails a test |
| API suite | 1,399 passed (Vision 823); typecheck clean |
| Web | typecheck clean; 188 passed |
| Migration | `prisma migrate diff` both ways against the shadow database: no difference |
| `vision:eventcheck`, run twice | 89/89 both times (was 64). New: the score and the scorer's totals after a created goal; `AlreadyDecided`; `AlreadyEnriched`; 45+2 against a second-half 47'; a sheet rebuilt three ways; `PromotionStale`; `ClockChangedSinceAcceptance`. It now takes a match of 45-minute halves, restores the score and the scorer's totals, and checks that it did |
| The recorder's real routes | A probe on a practice match (not committed): approve, send back, approve again, with a video goal and an enriched goal in place. 15/15: send-back left 0–1, re-approval gave 2–1, and the stamp returned to the rewritten 45+2 row, not the second half's 47' |
| `db:purge:gate-litter` | nothing to delete |

## What is not done

| Item | Why | Where |
|---|---|---|
| The public score while a sheet is still live | Before approval the public score is read from the sheet alone (`scoreboard.service.ts` `publicPresentationFor`). A goal added from video during that window is on the timeline and not in that score. Footage is reviewed after the match, so the window is normally closed | Phase 7, with highlights |
| Deleting a created goal | `deleteMatchEvent` takes back the scorer's credit and leaves the score, for any goal. Not changed here | ScoreBoard backlog |
| A recorder later adding the goal Vision created | The sheet's goal and the video goal would both count. A publisher deletes the video row; the candidate goes stale | Phase 7 staleness |
| Identity's on-pitch check | `onPitchFor` compares the recorder's substitution minutes with stopwatch minutes on a base of 45. Wrong by up to a minute, and by more for short halves | PR-6 |
| Half-open segments; `method: manual` on a correction; the proposer accepting after someone else's correction | Listed in appendix B as low | PR-6, PR-12 |
| Queue filters in SQL; indexes | Appendix B medium | PR-10 |
| The gate's own `SbMatch` | The gate still borrows a real dev match and restores it. A debounced standings refresh may run while the goal is there | PR-11 |
| Identity decisions flipped in place | Same fault as events, in `identity.service.ts` | PR-7 or its own batch |

## After merge

1. The deploy applies the migration through `migrate deploy` ([52](./52-QA-FIX-2-DEPLOY-SAFETY.md)). Nothing to run by hand.
2. On live, check for accepted, unpromoted candidates:
   `SELECT count(*) FROM vision_event_candidates WHERE review_state = 'accepted' AND promoted_at IS NULL AND superseded_by IS NULL;`
   Each needs a correction and a second acceptance before it can be promoted. None is expected.
