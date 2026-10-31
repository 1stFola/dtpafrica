# FairPlay — data privacy notes (Phase 3)

What the Edge holds about people, where it goes, who can see it, and the decisions it still
needs. Written for whoever signs off a real match. This describes what the code does, so
the facts can be checked. It is not legal advice: the lawful basis, children's data and
retention periods under the Nigeria Data Protection Act 2023, and the competition's own
rules, need review by Fola and the organisers before any real footage is recorded
([blockers](./blockers.md) B2, B6, B7).

## What is held

| Data | About whom | Where | Why |
|---|---|---|---|
| Video of the match | players (many of them minors), officials, spectators in shot | the Edge's recordings volume; evidence clips under `data/evidence/` | replay and evidence |
| Operator identities: name, email, user id, permissions, matchday PIN as a scrypt hash | DTP staff and assessors | the signed bundle, `operator_sessions`, the audit log | sign-in, and who-did-what |
| Sign-in attempts with IP address | operators | `login_attempts` | lock-out after repeated wrong PINs |
| Incident fields: time, period, minute, category, note, **player reference** | players, by shirt or register id | `incidents` | locating the moment |
| Findings: on-field decision, result, **factual notes** | players and officials, indirectly | `reviews` | the shadow review |
| Audit entries: actor id and name, action, time, what was touched | operators, assessors, organisers | `audit_log` (append-only) | accountability |
| Footage rights: status, basis, whether minors appear, consent reference | the match | `session_rights` | the release gate |

**Guidance for operators and assessors** (to go into the runbook): refer to players by shirt
number or register id, never by name. Write what the footage shows, not opinions about a
person. Write nothing about a player's age, health or conduct off the ball.

## Where it goes

- **Nothing leaves the Edge in Phase 3.** No sync destination is configured, and the cloud
  receiver is not built. The outbox keeps records, and only records: incidents, reviews,
  rights, segment and evidence *metadata* (hashes, times, sizes), audit entries. It never
  holds video.
- **When sync is switched on**, those records go to DTP's own API over HTTPS
  (`FAIRPLAY_CLOUD_SYNC_URL` refuses plain http except to this machine), under the Edge's
  device token. They include operator names, player references and factual notes.
- **Video goes nowhere automatically.** Evidence upload to a private R2 bucket is designed
  (ADR-0006) but not built, and is gated on the bucket (B5) and the rights rule below.
- **No third-party AI service** sees any of it. Nothing in the Edge calls one
  (`tests/test_boundaries.py` fails the build on a cloud or GPU SDK import).
- **Export packages** (clip, manifest, `SHA256SUMS`) are the one way video leaves today: an
  admin with `fairplay.evidence.export` downloads a zip. Each export is audited with the
  package's SHA-256. After that the package is outside FairPlay's control, so whoever
  receives it must be told it is not for publication.

## Who can see what

- **Venue staff** (any operate, review, admin or export permission) see the venue:
  recordings, replay, live preview, incidents and draft evidence. Every replay window,
  live preview and evidence view is audited (once an hour per person and item), and every
  export each time.
- **Organisers** (`fairplay.report.view` only) see completed findings and released evidence,
  and nothing else. They see no live view, no recordings, no draft evidence and no other
  incidents. Withheld evidence answers 404, not 403, so an organiser is not told it exists.
- **Released** means all three of these, checked each time it is read:
  1. an admin approved it;
  2. its incident's finding stands, so reopening an incident withdraws its evidence until
     the new finding;
  3. the session's rights permit release.
- **A member with no permission sees nothing.** Phase 2 let any signed-in member read
  everything; Phase 3 closed that.
- **There is no public path.** There are no share links, no anonymous access and no
  embedding (`frame-ancestors 'none'`). There is no CORS, and the console is same-origin only.

## The rights gate

A session's rights are appended and superseded, never edited. With no record, footage is
treated as **real, rights not recorded**: nothing can be approved for release. Release needs:

- synthetic test footage (no player is shown), **or**
- real footage with status `external_release_permitted`, a recorded **basis** (the agreement
  or licence), and, unless an admin has recorded that no minors appear, a **consent
  reference**.

Only `fairplay.edge.admin` records rights. Changing them later is audited, and takes effect
at the next read: evidence approved under rights that are later withdrawn stops being
visible.

## Integrity, not secrecy

Hashes, read-only files and the audit chain make tampering detectable. They do not stop
someone with the Edge machine in hand from reading it. **The Edge's disks are not
encrypted by anything in this repository.** For a real match, the machine should use full
disk encryption and be kept by DTP staff. That is a decision for the hardware set-up
(equipment audit).

## Requests from a player or a parent (5.7)

An Edge admin handles them on the FairPlay page, `/admin/fairplay/requests`
([phase-5-threat-review.md](./phase-5-threat-review.md), "5.7").
- **The request** records who asked (the player, a parent or guardian, or a
  representative), how the request came and how the requester was checked. The player is
  named only by the reference incidents record, a shirt number or a register id.
- **What is held** is one document: every incident naming the player, its finding, each
  clip's hash and where it is held until when, and when the match's recordings are
  deleted. Clips are sent separately, each read through the audited link.
- **A withdrawn clip** is removed from the bucket at once and from the Edge when it next
  connects. It is never released again. Its hash, size, reason and requester are kept.
- **Backups:** a backup taken before a withdrawal still holds the clip until that backup is
  destroyed. After each withdrawal, take a new backup and destroy the older ones
  ([edge-backup.md](./edge-backup.md)). A restored Edge asks the cloud what was withdrawn
  before any clip can leave it.
- **Not erased on request:** the full-match recordings. They are kept 14 days (D9), and
  the document says when they go.
- **Names stay out of the audit log.** Requester names and player references are kept on
  the request and withdrawal rows, never in audit entries (D13).

## Decisions still needed

**Decided 28 Oct 2026** ([decisions.md](./decisions.md)): consent model direction (D8), recordings 14 days (D9), evidence on the Edge end of season + 12 months and in R2 90 days after the finding (D10), an audited request tool before the first real match (D11), disk encryption and a named custodian (D12), the audit log kept and minimised (D13), organiser admin accounts (D4). The list below is kept for the reasoning.

1. **Lawful basis and consent model** for recording youth matches, and who holds the
   consent records the `consent_reference` points to (B2).
2. **Retention periods**: for recordings (B7; retention is off by default and never
   deletes held or unsynced-evidence footage), for evidence clips (no deletion path exists
   yet), and for the audit log (append-only by design; a retention rule for it would
   have to be a deliberate, recorded exception).
3. **Requests from a player or parent** to see or erase footage: there is no tool for this
   yet. Erasing evidence would have to be an audited action that keeps the hash and the
   reason, never a silent delete.
4. **Organiser accounts** (B6): admin accounts with only `fairplay.report.view`, or a new
   share-link mechanism. The Edge supports the first.
5. **Disk encryption** and physical custody of the Edge machine.
