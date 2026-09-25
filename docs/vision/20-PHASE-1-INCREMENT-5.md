# 20 — Phase 1, Increment 5: the catalog, and partner upload links

**Gate: PASS** — `vision:catalogcheck` reports 30/30 against the live API, including
a real file uploaded by a partner **holding nothing but a link**.

Until this increment, nobody outside DTP could hand you a file.

---

## The whole operator workflow, end to end

```
Partner         partner registered · evidence URL issued · agreement stored ·
                signatory recorded (Team Manager)
Catalogue       registering a URL leaves it catalogued only
                bulk import created 2 rows, skipped the one with no locator
Rights          no analysis right yet (no_scope) · a grant with two targets refused
                analysis granted · publication still not granted
Acquisition     no upload link before acquisition is authorized
                a signatory from another partner refused
                acquisition authorized, recording who approved it
Partner upload  link issued, token shown once · forbidden media type refused
                session opened by the partner alone · uploaded straight to storage
                completed · ingestion queued · file in the master bucket
                the link cannot be used twice
                a partner token cannot reach a staff route
Impact          counts the acquired asset and live grants

30/30 checks passed
```

## The partner upload link

A grassroots club secretary has no DTP account, and creating one for every club is
neither realistic nor safe. So they get a token that does exactly one thing.

**What the grant fixes, so the request cannot:** the source record, the size
ceiling, and the accepted media types. A partner never names a source, so it cannot
upload against someone else's. Asking for a forbidden type or an oversized file is
refused against the grant, not against the request body.

**A third auth stack**, unrelated to admin sessions and worker tokens.
`PartnerUploadGuard` reads `x-vision-upload-token` and shares no code path with the
other two — asserted in both directions, including that an admin key and a worker
token in the same request satisfy nothing.

**Unknown, expired and revoked links read identically** to the caller. A partner
has no business learning which of the three it was; the distinctions live in the
audit log. An *already used* link says so plainly, because that one is actionable —
they need to ask for a new one.

**One grant, one upload.** Completion stamps `usedAt`, and re-use is refused.

## Cataloguing is not acquisition

The separation is the point of the screen, not an implementation detail:

- `POST /vision/sources` **always** lands `catalogued`, whatever the caller asks for.
- Bulk import fetches nothing. A URL is a reference, and 1,000 of them are still references.
- An upload link **cannot be issued** for a `catalogued` or `refused` source — issuing one would hand out exactly the permission the workflow withholds.
- Authorising acquisition **requires a named signatory** belonging to that partner, who is still active. "The partner agreed" is not a record anyone can defend later. A signatory from a different partner is refused.
- There are exactly **three** acquisition methods, and the error says so: *there is no fourth option, V1 ships no downloader.*

## Permissions are split

`vision.sources.write` catalogues. `vision.rights.manage` grants, revokes,
authorises and issues links. Someone typing in a spreadsheet of match URLs should
not thereby be able to authorise an acquisition.

## The screens

`/admin/vision/sources` — filter by partner, acquisition status and text. The
acquisition column is the one that carries meaning, and "Copies" makes the
important distinction visible: a source with none is a reference only and can never
enter a dataset.

`/admin/vision/sources/:id` — the rights position **as the engine decides it**, not
as the rows suggest. A live grant that is expired, restricted, or overridden by a
player-level withdrawal would otherwise look like permission. A denial shows its
`remediation` string, so the screen tells an operator what to fix rather than that
something is wrong.

Also there: authorise acquisition (with the signatory picker), issue a link, and
**"What breaks if this is revoked?"** — the blast radius answered before acting
rather than after.

Status pills carry their meaning in text; colour only reinforces it.

---

## Verification

```
api tests            319 passed  (was 299)
worker tests          21 passed
contract tests        22 passed
catalogcheck       30/30   live API + live R2, real partner upload
uploadcheck        21/21   live R2, real interruption
e2echeck           37/37   real container + live R2
jobcheck           23/23
selfcheck          27/27
r2check            11/11
typecheck          clean, 6 projects
```

Route wiring and the permission gate verified against the running app; the rendered
screens need an admin login, which is yours to do.

One migration: `VisionPartnerUploadGrant.objectKey` is now nullable. Nothing is
reserved at issue — a grant that is never used should leave no asset row behind.

---

## Phase 1 is functionally complete

Partner registered → evidence attached → source catalogued → rights granted →
acquisition authorized → partner uploads over a resumable link → probe →
fingerprint → transcode → proxy registered → asset ready. Every step verified
against live infrastructure.

## Not in this increment

| Deferred | Note |
|---|---|
| Second hosted compute provider | Still the largest unproven claim in the design: `ComputeProvider` has only mock and local implementations, so the abstraction is a guess until a second one exists. |
| `media.py` unit tests | Exercised end to end, still not in isolation. |
| A partner-facing upload *page* | The API is complete and testable; a partner currently needs a client that speaks it. A minimal drop-zone page keyed by the token is the obvious next thing. |
| Camera-segment entry | `VisionCameraSegment` exists and is unused. Needed before Phase 6 can tell live play from a replay. |
| Match-linking UI | `PATCH /vision/assets/:id/match-link` is specified but not built; an asset still needs linking before inference. |
