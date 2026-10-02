# 37 — Phase 4 Increment 6: a number for identity, and for not guessing

> Identity accuracy **and unknown precision** measured.
> — [10-EVALUATION-AND-GATES](./10-EVALUATION-AND-GATES.md), Phase 4 gate

The phase gate asks for two numbers. The machine's whole contribution to identity
today is a side per track — no jersey model is licensed, so it proposes no names —
and so what can be measured honestly is **team accuracy** and, the metric
[10](./10-EVALUATION-AND-GATES.md) says is easy to skip and shouldn't be,
**unknown precision**: when the kit clustering said it could not tell, how often
was the side it was nearest to wrong? A version that gains accuracy by guessing
where it used to abstain shows it here, and nowhere else.

---

## The side it was nearest to

An abstention could not be judged, because nothing recorded what the clustering
would have said. The worker's row now carries `nearest` beside `team`: the side
the kit was nearer to, named even when the margin was too small to name a side.
The projection keeps it as `nearestTeam`, and keeps the nearest side's kit colour
on an abstention too, so a slice by kit can hold abstentions. Contract **1.6.0**,
one optional field.

## What is true

Truth is what two people accepted. An accepted, current identity names a roster
slot; the slot is on a team; that team is the track's side. A track nobody has
named carries no truth and is not scored — it is unmeasured, not uncovered. A
track accepted on both teams (a split across a substitution, say) is not evidence
either way and is dropped. Goalkeepers and referees are never clustered and are
out of scope. An unaccepted assignment is not truth; the gate checks that with
one.

## Four numbers, per kit

Over tracks with truth, on `all` and on a slice per kit colour, because two kits
both mostly white is the stated risk and must have its own number:

| Metric | What it is | Support |
|---|---|---|
| `tracks` | tracks with an accepted identity | the same |
| `team_coverage` | how many of them the kit sided | tracks with truth |
| `team_accuracy` | how many of the sided were sided rightly | the sided |
| `unknown_precision` | how many abstentions had a nearest side that was *wrong* — abstentions that avoided a mistake | abstentions with a nearest side |

An outlier's abstention has no nearest side and cannot be judged; it counts
against coverage and nowhere else. A metric with nothing to measure has no value,
not zero.

The worked example in the tests and the gate: six tracks, two sided rightly, one
sided wrongly, one abstention that was not needed, one that avoided a mistake,
one goalkeeper. Accuracy 2/3, coverage 3/5, unknown precision 1/2, five tracks;
red accuracy 1/2 and a red abstention that was not needed, blue accuracy 1/1 and a
blue abstention that was.

## Scored in the control plane

The evidence is rows — kit sides, decided sides, accepted identities — not
artifacts, so there is no worker, no job and no object to read. `POST
/vision/models/versions/:id/benchmark` for an identify version runs the scorer
there and then, creates the run already complete through the same `complete` as
every other run, and the ledger, the verdict (`unthresholded`, until a baseline),
`candidate → benchmarked` and the audit trail are what they are for a detector.
The run's summary says `unit: tracks` so its counts are read for what they are.

Refusals, in order: a gold member with no succeeded identify job by the version
(`TeamAssignmentsMissing`); an identify job whose sides nobody has decided
(`SidesNotDecided` — a side is a cluster until a person says which team it is);
no gold member with any accepted identity (`IdentitiesMissing`). The dataset
rules every run has — frozen, gold members, no revoked footage — come first; the
box-gold rules (two reviewers, an export) do not apply, because this gold is not
boxes.

Promotion compares a candidate identify version against production on
`team_accuracy:all` and `unknown_precision:all`, so a version that trades
abstentions for guesses regresses on the second even as it climbs on the first.

## Verification

```
api tests              1,205 passed   (was 1,193)
  identity metrics          6
  ledger, identify          6
vision-contracts          54 passed
vision-worker            211 passed
typecheck               api clean
migration               both shadow diffs empty
vision:identitymetricscheck 29/29 against the real API and Postgres, on a real
                        match roster with two signed-in people; run twice; no
                        litter, no rows left
```

Twenty mutations, each caught: goalkeepers brought into scope; unnamed tracks
scored; accuracy counting everything; an outlier's abstention judged; unknown
precision inverted; zero where there is no value; the kit slices collapsed;
coverage over the wrong denominator; identify refused as a task; a gold member
without a job accepted; one decided side taken for two; the identities check
removed; unaccepted rows taken as truth; conflicting truth kept; the nearest side
dropped by the ledger; the summary counting frames; the gold members not passed;
the projection dropping the nearest side; an abstention losing its kit; and in
the worker, the nearest side not recorded.

## What is not done

| | |
|---|---|
| **Player accuracy and jersey top-k** | The machine proposes no names. When a licensed digit model does, its proposals land as `method: jersey` rows and this scorer gains player accuracy and top-k under the same truth. |
| **Thresholds** | Still `2026.10.0-unset`. The first baseline on real footage sets the bar for all three tasks at once. |
| **Slices by situation** | [10](./10-EVALUATION-AND-GATES.md) names *duplicate jersey visible, back turned, goalkeeper kit, post-substitution*. Those are annotator flags on tracks that do not exist yet; the kit-colour slice is what the rows can support today. |
