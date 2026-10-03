# 54 — QA fix 4: rights and governance

PR-4 of the fix plan in [50](./50-QA-PHASES-1-6.md) §3. It covers the rights and
governance findings in appendices A and B.

---

## A restriction the code does not understand denies

`hasBlockingRestriction` returned false for any object without a `deny` key. Its own
docstring's example, `{ noIdentifiableMinors: true }`, was ignored, and so was a
territory or any other flag. Doc 03 defines restrictions as "free text plus
structured flags", and the code now reads two keys:

- `deny` is a list of scopes this grant does not give, as before.
- `note` is free text for a person, informational only.

Any other key that says something denies every scope. A key whose value says
nothing (`null`, `false`, `""` or `[]`) is not a restriction.

**This changes the demo seed.** `vision:seed-demo` stored prose as `{ demo: "…" }`,
which now denies. It now writes `{ note: "…" }`. The one such row on the dev database
was moved to `note` (run twice; the second run changed nothing). **On live, check for
scopes whose `restrictions` carry a key other than `deny` or `note` before deploying:
each will stop analysis of the footage it covers.**

## The upload lifecycle

- **`acquisitionStatus`.** Training requires `acquired`, and nothing ever set it, so
  every real upload stayed short of it and only seed data could build a dataset.
  `begin` now moves the source from `authorized` to `acquiring`, and only from
  `authorized`. The fingerprint stage moves it to `acquired` when it records the
  checksum. The contract defines `acquired` as "an immutable DTP copy exists with a
  recorded checksum", which is exactly that moment.
- **Rights evidence that exists.** An evidence row is created before its document is
  uploaded, so an unused signed URL satisfied both the upload gate and the
  acquisition gate. Both now require the document to be in the store
  (`partnerHasUploadedEvidence`, a `head()` newest first).
- **One grant, one upload.** `usedAt` is set only at `complete`, so one link could
  open any number of billed multipart uploads. A second `begin` on a grant now
  resumes the grant's open session, and a grant whose upload completed is refused
  with `403 GrantUsed`.
- **The grant's size limit.** `maxBytes` was compared only with the client's advisory
  `expectedBytes`. `complete` now checks the stored size. Over the limit, the object
  is deleted through the write-once path with a justification, the session fails,
  and the grant is not consumed.

## Who annotates

`annotatorId` came from the request body, at claim and at submit. Anyone could claim
and submit as someone else, then review "their" work past the two-reviewer gold gate.
The annotator is now the signed-in person. A body naming someone else is refused with
`400 AnnotatorIsTheSignedInPerson`. Only the operator key, which has no person behind
it, may name one, and it must (`AnnotatorRequired`); the gates use it that way.

The web Annotation page asked "Who are you?" and stored a typed id in local storage.
That field is gone, and the claim and submit calls no longer send an id.

## Rights after enqueue

`canAnalyze` was checked only at enqueue. Doc 03's revocation step 1, "no new work on
footage whose consent is gone", is now enforced at every door:

- **Claim.** A claimed job whose grant was withdrawn while it waited fails for good
  (`rights_revoked`), and the worker gets no job this poll.
- **Retry.** Refused with `403 RightsDenied`.
- **Annotation media.** `getTask` and `claimNextTask` refuse the proxy URL. They also
  now take the newest proxy, as inference does.
- **Revocation.** `revokeScope` cancels every queued or running job on the assets the
  scope covered that can no longer be analysed under the remaining grants
  (most-specific-wins still decides). A running job's worker learns at its next
  heartbeat ([53](./53-QA-FIX-3-JOB-PROTOCOL.md)). The response lists
  `cancelledJobs`. A player-level scope still resolves to no assets, as for datasets.

## Reading the master

The worker's `source` role is now limited to `probe`, `fingerprint` and `transcode`,
and requires `canAnalyze`. Every read records `media.raw.read`, which was defined and
never written, with the job and worker as its reason.

## Promotion names the actor

Promotion's `canPublishHighlight` check omitted `playerId`. Player- and guardian-level
withdrawals apply only when the player is named, so a withdrawn minor could be named
in the match record. It now passes the candidate's `actorPlayerId`.

## Tests and checks

| Check | Result |
|---|---|
| Rights | flags it does not understand deny (5 shapes); a note, empty flags and `deny` with a note do not (4) |
| Upload | evidence row without a document refused; `acquiring` only from `authorized`; second begin on a grant resumes; used grant refused; over-size completion refused, deleted, failed, grant not consumed. A test that asserted inside `.catch`, and so passed vacuously, now asserts the rejection |
| Annotator | session person always; another name refused; operator key must name one |
| Rights after enqueue | claim fails a withdrawn job non-retryable; retry refused; annotation media refused; master refused to a proxy stage, refused after withdrawal, and audited when read |
| Promotion | the rights check is called with the actor's `playerId` |
| API vision suite | 788 passed; typecheck clean |
| Web | typecheck clean; 188 passed |
| `vision:uploadcheck`, run twice | 23/23 both times. Its fixture used to create an evidence row with no document; it now puts one in the store, removes it afterwards, and checks the source reads `acquiring` |
| `vision:e2echeck` (the real worker) | 38/38; the probe and transcode master reads each left a `media.raw.read` audit row, and cuts, which reads the proxy, left none |
| `catalogcheck`, `datasetcheck`, `boxcheck`, `eventcheck`, `jobcheck` | all pass (catalog uploads real evidence, then authorises) |
| `db:purge:gate-litter` | nothing to delete |

**One more stale gate, not caused by this PR.** `vision:annotationcheck` submits
`boxes: [{ x: 1, y: 2 }]`, which box validation has refused since doc 29 (1 October).
The gate was last edited on 25 September. Its claim race, run as the operator key
naming two annotators, passes. It is fixed in PR-11 with the three in
[53](./53-QA-FIX-3-JOB-PROTOCOL.md).
