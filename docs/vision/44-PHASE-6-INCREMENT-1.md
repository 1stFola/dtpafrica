# 44 — Phase 6 Increment 1: a claim with a name on it, and one door into the match record

> The recorder's pitch-side `SbMatchEvent` stays canonical. Vision proposes
> candidates that enrich it — precise timestamps, actor confirmation, evidence
> links, clips — and does not overwrite it.
> — [13-OPEN-QUESTIONS](./13-OPEN-QUESTIONS.md), Q7

Phase 5 ended with every track on the pitch and a clock to read it by. Phase 6
is what happened: possession and events. This increment is the ledger those
will be written into, built before any model proposes anything, in the order
Phases 4 and 5 took — the row, the rules, the review, and the one bridge to
the public product — so that when a model does propose, it proposes into
something that already knows how to refuse.

---

## A candidate

A `VisionEventCandidate` is a claim: a type from the taxonomy of
[09](./09-ML-PIPELINE.md) (`pass`, `carry`, `shot`, `cross`, `header`,
`tackle`, `interception`, `recovery`, `clearance`, `throw_in`, `corner`,
`free_kick`, `save`, `goal_candidate`) under a taxonomy version, a window in
source time, an actor — a track, and a roster slot when a person named one —
and the evidence it rests on. A person with `vision.review` proposes it; the
operator key cannot, as nowhere a judgement about the footage is filed. The
window is inside the footage, the track is this asset's, the slot is this
match's, the team is one of the two playing.

The evidence is found, not typed. The service attaches what it can see: the
actor track, the identity assignment current on it at that moment, the camera
segment covering the start and the segment's current calibration, and the
clock anchor of the half. A caller may add links beside them — a detection
frame, say — but not replace them. That is the provenance drawer of
[08](./08-FRONTEND.md) in the data, and what Phase 7's staleness propagation
will walk the other way.

A candidate inside a `replay`, `intro` or `halftime` segment is filed with
`inPlay: false`. It is not refused — a reviewer may want it on the timeline —
but it is flagged, and the flag is checked again, against the segments as they
are then, before anything reaches the match record.

## Nothing is edited

A correction is a new row with the changes, superseding the old; the old row
says what superseded it, and a decision on it is refused. A corrected
candidate is unreviewed again, whoever corrected it. The proposer cannot
accept their own; a second person with `vision.review` accepts or rejects, and
a rejection says why. A promoted candidate is not corrected here: what the
public saw is Phase 7's staleness work, not a quiet rewrite.

## One door

`POST /vision/review/events/:id/promote` is the only way a candidate reaches
`SbMatchEvent`, it needs `vision.publish`, and it refuses in order: not
accepted; no match linked; no recorder type for this kind of event; not in
play; no publication rights on the footage; the clock not anchored at that
moment. Then it looks for the recorder's event of the same type within a
minute of the candidate's match minute, compatible on team and player where
both sides know them, and:

- **enriches** it — writes `metadata.vision`, a `VisionEventPromotionV1`
  stamp with the candidate, its window in milliseconds and its actor track,
  leaving the recorder's minute and the rest of their metadata untouched;
- **creates** one only when none matches, only with `create: true` from the
  publisher, only with the team known, at the candidate's match minute, by the
  player the slot names, stamped the same way;
- **refuses** when two recorder events are equally near, naming both, rather
  than picking.

Only `goal_candidate` has a recorder type today (`goal`). A shot or a tackle
has no row in the match record and is not invented one: an accepted candidate
of those types stays Vision evidence, which is what the metrics phase reads.
The recorder's vocabulary is six words; Vision's is fourteen; the bridge is
exactly as wide as the overlap.

The required test from [09](./09-ML-PIPELINE.md) — a replayed goal must not
become a second goal — is the gate's third claim: an accepted goal candidate
inside the replay segment is refused at the door, and the match record is
counted before and after.

## Verification

```
api tests              1,297 passed   (was 1,278)
  taxonomy                 8
  events service           8
  module wiring            2 more classes
migration               both shadow diffs empty
vision:eventcheck       48/48 against the real API and Postgres, on a real match
                        roster, with recorder goals written for the run and three
                        signed-in people; run twice; no litter, no events or rows left
```

Thirty-six mutations, each caught: every type promotable; a replay as play; no
segment as not play; type, team or player ignored when matching; the tolerance
doubled (a survivor on the first run, now a test); ties resolved by picking the
first; the nearest not named; a window ending before it starts, or past the
footage; the operator key proposing; an actor track of another asset, a slot
of another match, a team not in the match; identity, calibration or clock
evidence dropped; the segment ignored for play; a correction not superseding,
or keeping the review state; a promoted candidate corrected; self-acceptance;
a rejection without a reason; promotion without acceptance, of a shot, inside
a replay, without rights, off the clock; ambiguity resolved silently; creation
without instruction, or without a team; enrichment dropping the recorder's
metadata, or creating a second event; a created goal with no team; and a
promoted candidate promoted again.

One thing the suite caught rather than the gate: the module's dependency
injection is asserted against an explicit list of every controller and
provider, so a new service that is not named there fails the build. It is
named there now.

## What is not done

| | |
|---|---|
| **A model proposing** | `method: model` and `modelVersionId` exist on the row; no stage writes one. The ball detector that possession and most events need is not in the licence register. |
| **Possession segments** | `VisionPossessionSegment` waits on the ball. Next in this phase if a detector is approved; otherwise events a person files from the workstation are the phase's output. |
| **The event review screen** | Candidates are filed through the API. The workstation's timeline and inspector — boundary and actor correction with the video under it — is the next increment. |
| **Sub-minute precision on the recorder's row** | D10 plans a `secondInMinute` or millisecond column on `SbMatchEvent`. The stamp carries the milliseconds today; the widening is its own backwards-compatible migration, done when the public product reads it. |
| **Staleness** | Correcting what was promoted, and marking what depended on it stale, is Phase 7. The evidence links are written now so that walk is possible then. |
| **The review queue** | `GET /vision/review/queue` is still in the contract and still not built; it belongs with the screen. |
