# FairPlay — footage rights, release and retention checklist

Phase 6.6. What must be true before a camera records a real match, before a clip leaves, and when each
thing is deleted. It separates what the software enforces from what only people can do.

**This is an engineering record, not legal advice.** The lawful basis, children's data and retention under
the Nigeria Data Protection Act 2023, and the competition's own rules, need review by Fola, the organisers and
a legal adviser (B2, R16). Nothing here settles them, and **no real match has been recorded.**

No matches with minors until that is settled (R16). An adult match still needs a lawful basis and its rights.

## Decisions for Fola

| # | Question | Proposed answer | Why it matters |
|---|---|---|---|
| RC1 | **When does an incident's hold end?** As built, never, so the footage around every incident is kept with no end ([cost worksheet](./cost-worksheet.md#what-the-worksheet-found), R25). | 14 days after the incident's finding, the same period as D9, unless someone has placed a manual hold. Clips stay under D10. Build it, with sources released from `evidence_refs` at the same moment | D9 and the answer to a parent both say otherwise today. This footage is the part most likely to show a named player |
| RC2 | **What does a requester get told about recordings?** The request document says recordings are deleted by a date (`requests.service.ts`), which is untrue of the footage around an incident | fix it along with RC1, before any real request. If RC1 goes another way, say that footage is held, and until when | a false statement to a parent about their child's footage |
| RC3 | **Who deletes clips on the Edge at end of season + 12 months (D10)?** Nothing does: only a withdrawal removes a clip there | a sweep like R2's, audited, keeping hash and reason. Until it exists, the custodian does it by a dated reminder, recorded on the sheet | D10 is decided but not enforced |
| RC4 | **Exported zips and `before-restore-*` folders** have no age limit (F18). What is the rule? | the same end date as the clip, swept with RC3 | copies outlive the rule (R8, R26) |
| RC5 | **The audit log (D13):** kept while any evidence it describes is kept, plus 12 months. Nothing removes it, and it is append-only by design | keep it for the pilot, and decide at the first season's end. Removing entries would need a recorded exception | D13 is decided but not enforced (R26) |
| RC6 | **Audio.** Whether a camera catches players' and officials' voices is unanswered (E15) | record no audio unless the agreement names it: turn it off at the camera | voices are a separate privacy question, and may be a separate legal one |
| RC7 | **People in shot who are not players:** officials, staff, spectators. D8 covers the competition and player registration, not them | ask the legal adviser. Expect a notice at the venue, and in the officials' terms | D8 does not reach them |
| RC8 | **Who owns the source footage?** If a production company's cameras, or a programme feed, supply the video, their terms apply | written permission from whoever owns it, named in the basis. Programme footage has overlays and replays, which the [equipment audit](./equipment-audit.md) warns about | the Edge cannot tell whose footage it records |

## What the software enforces, and what it does not

| | Enforced by the Edge |
|---|---|
| Rights not recorded | treated as real, with rights unknown: no clip can be approved |
| `internal_review_only` | no clip can be approved or exported |
| `external_release_permitted` on real footage | refused with no basis |
| Players may be minors, `yes` or `unknown` | no release without a consent reference |
| Rights withdrawn later | clips approved earlier stop being visible at the next read |
| A finding reopened | its clips are withdrawn until the new finding |
| Who can record rights | Edge admin only, audited. A record is superseded, never edited |

**It does not enforce any of the following. Only people can.**

- **It records whether or not rights exist.** Rights control release, not recording. Recording starts when a
  camera publishes, with or without a session ([ADR-0011](./adr/0011-recording-independent-of-the-edge.md)).
  So Part B comes **before the cameras are switched on.**
- **It takes any words as a basis or a consent reference.** It checks they are there, not that they are true.
- **"Synthetic test feed" opens every gate on a test Edge,** with no basis and no consent, for clips cut after
  it was recorded. An Edge takes it only with `FAIRPLAY_ALLOW_SYNTHETIC_FOOTAGE=1` or DEV bundles set, so never
  set either on an Edge with real cameras: nothing else tells real pictures from test ones (F13, M6).
- **"Minors: no" removes the need for a consent reference.** It is the admin's word, not a check.
- **"Nothing leaves this Edge" means video.** With the cloud on, incident notes, player references,
  findings and operator names still sync to DTP's API ([privacy.md](./privacy.md#where-it-goes)).
- **After export, a package is out of reach.** Withdrawing a clip cannot recall a copy already sent.

## Part A: once for each competition, before any real footage

Whoever signs is the organiser or the competition's authorised officer. Each answer needs a document, not a memory.

| # | Check | Done when |
|---|---|---|
| A1 | A lawful basis under the NDPA 2023, reviewed by a legal adviser (B2, R16) | written advice, on file |
| A2 | The competition agreement allows recording for shadow review and dispute evidence (D8) | signed, with its reference |
| A3 | It says this is shadow review: no decision or score changes, and it is not VAR or FVS | in the agreement |
| A4 | It says who may see findings and clips, and that nothing is published | in the agreement |
| A5 | It states the periods: recordings, clips, audit log (D9, D10, D13, RC1) | in the agreement |
| A6 | Parental consent, if minors will ever appear: collected at registration, covering this use, and possible to withdraw (D8, R16) | the form is approved, and someone at the organiser holds the records |
| A7 | Whoever owns the footage has agreed (RC8) | written permission, named in the basis |
| A8 | Audio decided (RC6) | written down; cameras set to match |
| A9 | Officials, staff and spectators told (RC7) | as the adviser says |
| A10 | Who answers a player's or parent's request, and how identity is checked (D11, R16) | named |
| A11 | Organiser accounts hold only `fairplay.report.view`, for this competition (D4) | listed |
| A12 | The Edge's disk is encrypted and a custodian is named (D12, R19) | hardware validation B3 |
| A13 | Camera network closed to spectators (R1) | hardware validation F4 |

Footage does not go to a third-party AI service, or into Vision's training data ([ADR-0007](./adr/0007-no-vision-training-path.md)).
Using it for anything else needs a new agreement and a new decision.

## Part B: for each match, before the cameras are on

| # | Check | If not |
|---|---|---|
| B1 | This fixture falls under an agreement in Part A | no cameras |
| B2 | No minors, until R16 is settled (operator guide, rule 3) | no cameras; call the project lead |
| B3 | Disk has room for this match ([cost worksheet](./cost-worksheet.md)) | free it with the retention preview, or stop |
| B4 | A named watcher is here (R7) | no match |
| B5 | Cameras point only where the agreement allows. Keep a pre-match test off the crowd and dressing-room doors | re-aim |

## Part C: recording the rights in the console

**Record rights (admin)**, in the 60-minute check of the [matchday clock](./operator-guide.md#the-matchday-clock). Record what is already agreed:
this step is not where it gets agreed.

| Field | Value | Say this when |
|---|---|---|
| Footage | `real` | every match. `synthetic` only for the test feeds, on an Edge set up for them |
| Status | `not_recorded` | nothing is agreed: treat as a stop |
| | `internal_review_only` | staff may review; nothing goes outside. The right default for a first rehearsal |
| | `external_release_permitted` | the agreement allows clips to go to the organiser |
| Players may be minors | `no` | you know it, from the fixture's register |
| | `yes`, `unknown` | stop (R16) |
| Basis | the agreement's reference | required for release |
| Consent reference | where the consent records are held, as a batch or register reference | required if minors may appear |

**Never a person's name in Basis or Consent reference.** Both go into the audit log and to the cloud, and D13
keeps names of players out of the audit log. Nothing checks this.

Then read the sentence at the top of the panel. Changing a record later is audited and takes effect at the next read.

## Part D: before a clip is released

The Edge checks the first three. People check the rest. Whoever releases should not also have reviewed it alone.

| # | Check | Checked by |
|---|---|---|
| D1 | The incident's finding is complete and stands | the Edge |
| D2 | The session's rights permit release | the Edge |
| D3 | The clip was not withdrawn | the Edge |
| D4 | The recipient is named in the agreement, and has a reason to see it | the releaser |
| D5 | Only what that dispute needs: this clip, not "everything from the match" | the releaser |
| D6 | The finding and notes state what the footage shows. No opinion of a person, no allegation against a referee, nothing about age, health or conduct off the ball | the releaser |
| D7 | Players appear by shirt or register id, never by name | the releaser |
| D8 | Bystanders or anyone else in shot: is the clip still fair to send? | the releaser |
| D9 | If it is an export: the package's hash is noted, and the recipient is told it is **not for publication** | the releaser |
| D10 | Never public, never WhatsApp, no filming of the screen (operator guide, rule 4) | everyone |

An organiser with a report account sees approved clips in FairPlay, through short-lived links, each read
audited. **Prefer that to an export,** which is out of reach once sent.

## Part E: what is kept, and what deletes it

| What | Where | Period | Decided | What deletes it | Status |
|---|---|---|---|---|---|
| Recordings | Edge | 14 days | D9 | the hourly sweep, at most 600 files a run, and none while the clock is in doubt | **built**, on in the installer's `.env` |
| Recordings around an incident | Edge | **no end, as built** | RC1 | an admin's manual hold release, and then only if no clip was cut from them | **gap (R25)** |
| Clips | Edge | end of season + 12 months | D10 | nothing | **gap (R26)**: RC3 |
| Clips | R2 | 90 days after the finding | D10 | the cloud's sweep, with a 120-day bucket rule as backstop | built; **no bucket exists yet** |
| A withdrawn clip | both | removed at once; hash, reason and requester kept | D11 | the withdrawal | built |
| Exported zips | Edge | none | RC4 | a withdrawal only | **gap (R26, F18)** |
| Replay cache | Edge | none: by count and size, 2 GiB | RC4 | pruned by size | no age limit (F18) |
| `before-restore-*` folders | Edge | none | RC4 | a person | [edge-backup.md](./edge-backup.md) |
| Backups | backup disk | destroyed after each withdrawal, otherwise unset | R23 | the custodian | a rule for people, not decided (R23) |
| Audit log | Edge and cloud | evidence's life + 12 months | D13 | nothing: append-only | **gap (R26)**: RC5 |
| Manifests, and a record that a segment existed | Edge | kept | by design | nothing | a segment's record outlives it |

### Before any real match, fill this in

```text
FAIRPLAY RIGHTS AND RETENTION SHEET
Competition: ____________________   Date: __________   Filled in by: ____________
Agreement reference: ____________   Legal review, by and date: ____________
Footage owner's permission: ____________   Consent records held by: ____________
Audio: on / off, and why: ____________   Notice to others in shot: ____________
Who answers requests: ____________   Custodian of the Edge: ____________
Organiser accounts: ____________________
Periods told to the organiser: recordings ______  clips ______  audit log ______
Rule for incident footage (RC1): ____________   Who deletes Edge clips, and when (RC3): ____________
Season ends: __________   So Edge clips go by: __________

Approved for real footage by: ____________________ (Fola Sanni)   Date: __________
```

Approving it is Fola's, and it feeds the pilot go/no-go in 6.7.

## Stop and call Fola

- A real match, with no signed agreement or with the sheet blank.
- Minors in any match, until R16 is settled.
- Anyone asks for a clip to go public, onto social media or into a group chat.
- Anyone asks for a clip to reach a referee or official during a match, or calls this VAR.
- Footage is wanted for Vision, for training, or by a third-party AI service.
- A parent, player or lawyer asks anything you cannot answer from [privacy.md](./privacy.md).
