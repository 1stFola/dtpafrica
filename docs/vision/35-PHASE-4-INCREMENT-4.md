# 35 — Phase 4 Increment 4: who a track is

> Roster-assisted, time-aware identity. Review UI for split, merge, reassign, and
> mark unknown. Unknown preserved; public attribution blocked until approved.
> — [11-PHASE-PLAN](./11-PHASE-PLAN.md), Phase 4

[34](./34-PHASE-4-INCREMENT-3.md) gave every track a side, or an honest none. This
increment is the rest of identity's chain of evidence as
[09-ML-PIPELINE](./09-ML-PIPELINE.md) orders it, with one step still missing and
said so: a person decides which team each side is, the roster narrows who a track
could be, a person says who it is for a window of it, and a second person accepts
before anything is attributed in public. The machine's contribution stops at the
side. Nothing here lets it name a child.

---

## Which team a side is

The kit clustering produces clusters, `A` and `B`, and clusters are per identify
job: a re-run may swap them. So the decision that `A` is the home team is made per
job, both sides at once, by a signed-in person, and only for the match's own two
teams, one each (`SidesSame`, `SidesNotTheMatch`, `NotAnIdentifyJob`). The operator
key is refused everywhere in this increment, for the reason the promotion gate gave
in [31](./31-PHASE-3-INCREMENT-4.md): it cannot tell two people apart, and this
whole surface is a two-person control.

## Who a track could be

A track's candidates are the match squad of its side's team — `SbMatchSquadPlayer`
rows for this match and that team, starters first — or the whole match squad when
the kit could not side the track or nobody has yet said which team the side is.
The list says which it is (`narrowedBy: side | match`).

**What is not time-aware yet, and why.** The plan says a number maps to at most
one player *in a given time window*, and substitutions are recorded in ScoreBoard
against the match clock. The footage has no anchor to that clock: nothing yet says
which source millisecond is kick-off, let alone the second half. Applying a
sixtieth-minute substitution to a track at 3,412,000ms would be a guess dressed as a
constraint. So the candidate list is the whole match squad, starters marked, and
the response says so in a `clock` field a reviewer can read. The anchor is
calibration's business, in Phase 5.

## An identity is a person's word for a window of a track

`POST /vision/review/tracks/:trackId/identity` writes one `VisionIdentityAssignment`:
a roster slot of this match, or `null` for *unknown*; a window in source
milliseconds that defaults to the whole track and must lie inside it and be
non-empty; the person who said so. The slot must be on this match's squad, and on
the track's side when the side is known. If the kit was read wrongly the person
says so (`acceptSideMismatch`), the identity stands, and the kit's row is marked
`corrected` — its own answer is kept beside the correction, as every prediction's
is, so the wrong reading is still evidence of how the clustering behaves.

**Split, merge, reassign and mark-unknown are one verb.** A new assignment
supersedes every current assignment on the track whose window it overlaps, and
nothing is edited:

| The reviewer wants | What is written |
|---|---|
| Reassign | one assignment over the same window; the old one is superseded |
| Split | two assignments with adjoining windows; the whole-track one is superseded |
| Merge | one assignment with `propagateTo`: the same person on other tracks of the asset, as `propagated` rows over each track's own window |
| Mark unknown | one assignment with a `null` slot |

Tracks themselves are never merged or split. They are what the tracker said, with
the tracker's name on them, and identity is a time-windowed layer over them. This
is what the data model in [04](./04-DATA-MODEL.md) meant by `validFromMs` and
`validToMs`, and it turns out to need no second mechanism.

Two rules follow from taking *unknown* seriously. Unknown is never propagated: two
unknown tracks are not the same person (`PropagateUnknownRefused`). And the roster
rule holds on every track the person is written onto, not only the one named in
the URL (`SideDisagrees` names the offending track), so a merge cannot smuggle a
home player onto an away-sided track.

## A second person

An assignment lands `unreviewed`. A second person accepts it; the person who
assigned cannot (`SelfAcceptanceRefused`), the operator key cannot, and a
superseded assignment cannot be accepted at all (`AssignmentSuperseded`). A
rejection keeps its reason on the row.

`GET /vision/assets/:id/identity?public=1` is the only read anything public may
make: accepted, naming a player, not superseded. Everything else — unreviewed,
propagated-and-unreviewed, rejected, unknown — is visible to a reviewer and to no
one else. That is the phase gate's *public attribution blocked until approved*,
as a query filter rather than a policy document.

Every decision is in the audit trail with the person's id: `identity.sides.decided`,
`identity.assigned` (with the window and what it propagated to), `identity.accepted`,
`identity.rejected`.

## Verification

```
api tests              1,187 passed   (was 1,164)
  identity                20
typecheck               api clean
migration               both shadow diffs empty
vision:identitycheck    53/53 against the real API and Postgres, on a real
                        ScoreBoard match with 28 and 26 squad slots, two signed-in
                        people; run twice; no litter, no rows left
```

Twenty-three mutations, each caught: the person requirement removed; the same
team on both sides allowed; a team not in the match allowed; a track job's sides
accepted; candidates not narrowed by side; a slot from another match accepted; the
side rule removed; the override always allowed; the side not marked corrected;
unknown propagated; propagation targets unchecked; the roster rule skipped on
propagated tracks; a propagated row given the source track's window; overlap made
inclusive; overlaps not superseded; self-acceptance allowed; a superseded row
reviewable; the public view without the player requirement; without the acceptance
requirement; listing empty tracks; the window unbounded; the empty window allowed;
the default window shortened.

## What is not done

| | |
|---|---|
| **Jersey candidates** | Still the licence decision from [34](./34-PHASE-4-INCREMENT-3.md). When a digit model exists, its proposals land as `method: jersey` rows with a confidence below one, under exactly the rules above, and a person still accepts. |
| **The match clock** | Substitutions cannot narrow a window until the footage is anchored to the match clock. That is calibration's, in Phase 5; the `clock` field says so until then. |
| **The review workstation** | This is the review *model* and its API. The screen that shows a track's crops beside its candidates — `GET /vision/review/tracks/:trackId/crops` in [07](./07-API-CONTRACTS.md) — needs frames from the proxy, which needs the pod. It is the next increment of this phase. |
| **Identity metrics** | The ledger has no identity task. Accuracy and unknown precision against gold identities need gold identities first, which need the workstation. |
