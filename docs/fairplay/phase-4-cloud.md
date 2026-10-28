# FairPlay — Phase 4: the cloud side

**Status: partial.** Built and tested end to end against the real API, Postgres and an S3
server, on synthetic data. Not done: a check against a real R2 bucket, because the bucket
does not exist yet, and any production migration or deploy. Both need Fola's approval
(see "Approvals needed").

Prompt 5 of the prompt pack ("PHASE 4: CLOUD INTEGRATION WITHOUT INCREASING EC2 VIDEO
LOAD"), under decision D3: an additive migration only, behind permissions nobody holds
until an admin assigns them, deployed only on a separate approval.

---

## Repository facts confirmed

- **Patterns reused, not copied by hand.**
  - Device tokens follow Vision's worker tokens (`vision/worker/worker-token.service.ts`):
    a one-time bootstrap token exchanged for a device token, stored only as SHA-256, each
    accepted by exactly one guard, rotated on retire.
  - Guards: `AdminAuthGuard` + `PermissionsGuard` through `AdminGuardsModule`.
  - Errors: Vision's `refusal()` shape.
  - Competition scope: `scopedCompetitions`.
  - JSON: Vision's `jsonSafe` for BigInt.
  - The global `ValidationPipe` is unchanged.
- **The R2 adapter is FairPlay's own small port** (`fairplay/storage/evidence-store.ts`),
  not Vision's `R2ObjectStore` with a new bucket id. Vision's port is keyed by Vision's
  closed `BucketId` list and built from Vision's config and key. ADR-0006 left that choice
  open; this settles it. FairPlay imports nothing from Vision except `refusals` and
  `json-safe`, and a test enforces that.
- **Competition scope has a hole that FairPlay closes for itself.** An admin account with
  no competition grants is unscoped everywhere in admin, meaning every competition. That
  is right for DTP staff and wrong for an organiser. FairPlay refuses an organiser account
  that is not limited to named competitions (`fairplay/access.ts`).
- **Segments belong to a device, not a session.** Recording runs whether a session is open
  or not (ADR-0011). The cloud therefore keeps segments against the device.
- **Unknowns remaining:**
  - whether R2 enforces a presigned PUT's signed `x-amz-checksum-sha256`, and returns the
    SHA-256 on `HEAD` with `ChecksumMode`, exactly as the S3 server here does. This needs
    the real bucket;
  - the hardware facts from Phases 1–3 (gate 1, equipment audit E17).

## Implemented

### Database

One migration, `services/api/prisma/migrations/20261028000000_fairplay_cloud/`. It is
purely additive: eleven new `fairplay_*` tables, plus back-relations on `SbMatch` and
`AdminUser`, which add no columns.

| Table | Holds |
|---|---|
| `fairplay_edge_devices` | Edge machines: token hash, token kind, the Edge's own id, retired |
| `fairplay_sessions` | a match under shadow review on one device. `match_id` is `SetNull` on match delete, plus a `match_snapshot` (D5). `mode` is CHECKed to `shadow`/`post_match` |
| `fairplay_session_members` | who may sign in at the venue, with which permissions, and their scrypt PIN hash |
| `fairplay_sync_receipts` | one per item a device sent: key, payload hash, answer |
| `fairplay_records` | the latest version of segments, periods, calibrations, rights records and clip jobs |
| `fairplay_incidents`, `fairplay_reviews`, `fairplay_evidence` | what the admin pages query. `authority_mode` is CHECKed to `shadow` |
| `fairplay_evidence_objects` | each clip and manifest in the bucket: key, SHA-256, size, state, `delete_after` |
| `fairplay_edge_audit_entries` | the Edge's hash-chained audit, with `chain_status` (`ok`, `break`, `unverified`) |
| `fairplay_audit_logs` | the cloud's own audit |

Both audit tables are insert-only. Triggers refuse UPDATE, DELETE and TRUNCATE.

### API module

`services/api/src/fairplay/`, mounted under `/api/v1/fairplay`. It imports neither the
ScoreBoard, admin nor Vision modules, and writes no ScoreBoard row (a test checks this).

**Routes for people** (admin JWT plus a permission, then competition scope on every read):

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/fairplay/me` | any FairPlay | staff or organiser, and their competitions |
| GET/POST | `/fairplay/devices` | `edge.admin` (GET also `session.manage`) | list devices; add one (the bootstrap token is shown once) |
| POST | `/fairplay/devices/:id/retire` | `edge.admin` | the token stops working at once |
| GET/POST | `/fairplay/sessions[?matchId=]` | any / `session.manage` | list; provision a session for a match on a device, with members |
| GET | `/fairplay/member-candidates` | `session.manage` | active accounts whose role holds a venue permission |
| GET | `/fairplay/sessions/:id` | any FairPlay | an organiser sees no members or device |
| PUT | `/fairplay/sessions/:id/members` | `session.manage` | a member is never given more than their account holds |
| PUT | `/fairplay/sessions/:id/members/me/pin` | venue staff | the member sets their own matchday PIN (6–12 digits, scrypt) |
| GET | `/fairplay/sessions/:id/report` | any FairPlay | JSON report; organisers see released evidence only |
| GET | `/fairplay/sessions/:id/sync` | venue staff | what has synced, audit chain status, refused items |
| POST | `/fairplay/evidence/:id/read-url` | `incident.review`, `evidence.export`, `session.manage` or `report.view` | presigned GET of at most 300 s; audited with an optional reason |
| GET | `/fairplay/usage` | `edge.admin`, `session.manage` | objects, bytes, operations this month, estimated cost |

**Routes for devices** (`x-fairplay-device-token`, never an admin token):

| Method | Path | Purpose |
|---|---|---|
| POST | `/fairplay/device/register` | bootstrap token (`x-fairplay-bootstrap-token`) → device token and the key to trust for bundles |
| GET | `/fairplay/device/bundle?have=&expires=` | the signed credential bundle for this device's session; `unchanged` if it already has it |
| POST | `/fairplay/sync/batch` | the outbox: up to 200 items, with a 2 MB body limit on this route only |
| POST | `/fairplay/device/evidence/:id/uploads` | a presigned PUT for a clip or its manifest, for exactly the declared size and SHA-256 |
| POST | `/fairplay/device/evidence/:id/uploads/:kind/confirm` | the cloud HEADs the object and checks size and SHA-256 |

### The sync receiver

Delivery is at least once; each item is applied exactly once. An item's key is
`{type}:{id}:{version}`, and it gets one of these answers:

| Answer | When |
|---|---|
| `applied` | stored now |
| `replayed` | the same key with the same hash was applied before |
| `stale` | an older version than the one held |
| `conflict` | the same key with another hash; nothing is overwritten |
| `rejected` | not this device's to send, or malformed |

How it behaves:

- Each item is applied in its own transaction. An unexpected failure gives the item no
  answer, so the Edge retries it.
- **Wrong match or wrong device.** A device may only send for sessions the cloud assigned
  to it, and only for the provisioned match and mode. A session the cloud never
  provisioned is rejected.
- **Shadow only.** A review claiming any authority but `shadow` is rejected.
- **Evidence files never change.** Evidence whose file hash changes between versions is
  rejected.
- **The audit chain is recomputed in the cloud.**
  - The Edge now sends the exact text it hashed (`detail_text`), because Python writes
    `1.0` and JavaScript parses it as `1`, so a re-encoded detail would not match.
  - An entry is `ok` when its hash recomputes and it links to the previous entry.
  - A break is kept and flagged (`sync.chain_break`), never dropped.

### Evidence

**What may go up.** Only what may be released, decided the way the Edge decides it:
- the clip is approved;
- the incident's finding stands (reviewed or archived);
- the session's latest rights record permits release (synthetic footage, or release
  permitted, with a consent reference wherever players may be minors).

Only clips and their manifests go up. Whole-match upload is not built.

**The Edge holds no storage credentials.**
- Each presigned PUT signs `content-length`, `content-type` and `x-amz-checksum-sha256`.
- The SDK's default CRC32 is turned off (`requestChecksumCalculation: WHEN_REQUIRED`); a
  presigned URL cannot carry a CRC32 for a body the SDK has not seen.
- The confirm step compares the size and the SHA-256 the store reports. It never uses the
  ETag.
- A mismatch deletes the object, writes `upload.corrupt` to the audit log, and the Edge
  uploads again.

**Reading.**
- A presigned GET of at most 300 s, served as an attachment.
- It is issued only after the permission, the competition scope and the release rule are
  checked again at that moment. Reopening an incident withholds its evidence at once.
- Every read is audited.

**Retention (D10).** Each object is deleted 90 days after the finding (the latest completed
review), by an hourly sweep. The row stays, with its hash, the date and the reason, and the
deletion is audited. No ACL is ever set; a test checks the module's code for one.

### The Edge

These changes are in `services/fairplay-edge/`.

- **`cloud.py`** (new):
  - `pair`: the bootstrap token gives the device token, written owner-only, and the cloud
    key is added to the trusted keys;
  - `refresh_bundle`: fetches the bundle every 5 minutes. A bundle that does not verify is
    never written;
  - `Uploader`: re-hashes both files first, then presign, PUT and confirm. Backoff as the
    outbox has it; longer waits for "not releasable yet" and "storage off"; nothing
    withheld is sent.
- **Store:** schema v4, which adds one table, `uploads`.
- **Sessions:** a session opened while a cloud bundle is loaded takes the cloud's session
  id, match and mode (`session.opened_from_bundle` in the audit log).
- **`fairplay-edge pair --url … --bootstrap-token-file … --token-file …`**, and the setting
  `FAIRPLAY_CLOUD_DEVICE_TOKEN_FILE`.
- **Health** shows upload status and the last bundle refresh.
- **Audit** payloads carry `detail_text`, and there are two new actions:
  `evidence.uploaded` and `session.opened_from_bundle`.

### The web admin

`apps/web/src/modules/admin/fairplay/`, under `/admin/fairplay` (ADR-0010):

- **Overview:** sessions, Edge devices (add, with the token shown once; retire) and storage
  use.
- **The match page,** reached from ScoreBoard → Match center → "FairPlay": provision a
  session, members and their venue permissions, your own matchday PIN, and what has
  synced, with the audit chain status.
- **The printable report:** Print and Download JSON, with Open clip and Manifest for staff
  and organisers.

The nav entry appears only with a FairPlay permission.

### Roles

| Role | Holds |
|---|---|
| `fairplay_admin` | all seven FairPlay permissions |
| `fairplay_assessor` | operate and review |
| `fairplay_operator` | operate |
| `fairplay_organiser_viewer` | `report.view` only, and must be scoped to competitions |

`super_admin` holds everything, as for every other permission. No other account holds a
FairPlay permission until an admin assigns a role. None of these roles holds a ScoreBoard
or Vision permission.

### Config

`services/api/.env.example` gains these settings; it holds placeholders only:

- `FAIRPLAY_STORAGE_BACKEND` (`off` by default) and `FAIRPLAY_R2_*`, with a token scoped to
  the evidence bucket only;
- `FAIRPLAY_BUNDLE_SIGNING_KEY` (Ed25519, PKCS#8 PEM);
- TTLs and the retention period.

## Security and cost

- **Auth.**
  - **Device tokens:** a device token never reaches an admin route, and an admin session
    never syncs. Unknown, expired, retired and wrong-kind tokens get one answer.
  - **Bundles:** signed with Ed25519 over the Edge's canonical JSON. The signature is
    byte-identical to the Edge's own for the same key, and a test checks this.
  - **PINs:** scrypt in the Edge's format; never logged or audited.
  - **Organisers:** they see no device, no members, no operator note, no player reference,
    nothing withheld, and nothing outside their competitions. Another competition's id
    answers "unknown".
- **Evidence.** Video goes from the Edge to R2 and from R2 to the reader. The API signs URLs
  and checks HEADs; no route accepts or serves video bytes.
- **New dependencies: none.**
  - API: `@aws-sdk/client-s3`, the presigner and `bcrypt` were already there.
  - Edge: `httpx` and `cryptography` were already there.
- **New recurring cost.**
  - AWS: **$0**. No new resource. The API handles a few KB of JSON per incident on the
    existing instance.
  - R2: **about $0.09–0.12 a month gross**, in line with D1's $0.12. Assumptions:
    - a 30 s clip at 2.5 Mbit/s is about 9.4 MB;
    - 10 matches a month × 10 incidents × 2 sources = 200 clips, about 1.9 GB a month;
    - each clip is held 90 days, so about 5.6 GB is held at steady state, which is about
      $0.084 a month at $0.015/GB-month;
    - about 400 Class A operations (PUT, HEAD) and a few hundred Class B (GET) a month
      cost under $0.01.

    This is before R2's free allowance, which is per account and already used by Vision's
    buckets, so FairPlay's share of it cannot be assumed. Recheck the prices when the
    bucket is created. The usage panel computes the same estimate from what was actually
    uploaded and read.

## Test evidence

Every command below was run on 28 October 2026 on this branch, with the results shown.

| Command | Result |
|---|---|
| `pnpm exec prisma migrate deploy` on a new empty database (all migrations, this one last) | applied |
| `prisma migrate diff --from-url <that db> --to-schema-datamodel prisma/schema.prisma --exit-code` | exit 0: no drift |
| `UPDATE fairplay_audit_logs …` on that database | refused by the trigger |
| `pnpm exec tsc -p tsconfig.typecheck.json --noEmit` (API) | no errors |
| `pnpm run build` (API) | ok |
| `pnpm exec vitest run src/fairplay` | 3 files, 25 tests passed. Covers: canonical JSON, audit hash, PIN hash and Ed25519 signature parity with vectors written by the Edge's Python; the authorization matrix read from the route metadata; config; presigned URL contents |
| `pnpm exec vitest run` (whole API) | 2279 passed, 1 skipped, **1 failed**: `scripts/gates.spec.ts` on CRLF line endings in the untouched `vision-annotation-check.ts`. This is the known local `core.autocrlf` failure; that file is unchanged (`git status`) |
| `FAIRPLAY_CHECK_DATABASE_URL=…/fp4_scratch pnpm --filter @dtp/api fairplay:cloudcheck` | **68/68 passed**, against Postgres with the in-memory bucket double: pairing; sessions and members; the bundle; idempotency, including a new item sent six times at once and applied once; conflict; stale; wrong match; wrong device; shadow-only; the audit chain, including a forged entry flagged; uploads, including bytes not as signed, corrupted object, duplicate upload; reads by permission, scope and release; report wording; reopen withholds; rights changing to internal-only; 90-day deletion; match deleted; device retired |
| `FAIRPLAY_CHECK_DATABASE_URL=…/fp4_e2e_scratch pnpm --filter @dtp/api fairplay:e2echeck` | **26/26 passed** (final run, after the fixes below; an earlier run was 27/27 with a weak log-grep check since removed). Run against the real API process, Postgres, `adobe/s3mock:5.2.3` and the Edge code in its image over HTTP. Covers: pairing; one-time bootstrap token; bundle installed and verified; the member signs in at the venue with the PIN set in the cloud; a match synced, every item applied; a **30-minute WAN outage** with an incident reviewed and approved during it, then a restarted sender catching up with nothing lost; clips and manifests stored and confirmed; duplicate upload sends nothing; a **corrupted object** refused, removed, then uploaded properly; this token refused for another device's session; an unknown token refused; the report; read URLs serving the Edge's exact bytes; reads audited; every Edge audit entry `ok` in the cloud |
| `fptest.sh` (Edge pytest in the Edge image) | 236 passed, 1 skipped (`test_cloud_e2e.py`, which only the driver runs) |
| `pnpm exec tsc -b --noEmit`, `pnpm exec vite build`, `pnpm exec vitest run` (web) | no errors; built; 41 files, 348 tests passed |

**Browser QA** (the web app on a local API over the end-to-end database):

- **Super admin:** overview, devices (add shows the token once), storage, match page
  (members, PIN status, sync summary with the chain "intact to 28"), report, a read URL
  (bucket host, 300 s, attachment) and the match-center link. Every page request returned
  200.
- **Organiser scoped to that competition:** sees only FairPlay in the menu; the report and
  released evidence work; devices, sync, usage, candidates, add device and ScoreBoard all
  returned 403; the device name is hidden.
- **Fixed during QA:** the sync summary left out segments, incidents, reviews and evidence;
  organisers were offered as venue members; an organiser's session list showed the device
  name; the heading read "foul · time" when there was no match-clock minute.
- **Fixed in review:** in Compose, `./auth` is read-only, so a paired Edge could not have
  written its cloud bundle. The bundle now goes to the data volume (`FAIRPLAY_BUNDLE_PATH`),
  `pair --trusted-keys` writes the cloud key into `./auth` from a one-off run, and a failed
  write is a logged refresh failure that no longer stops that pass's uploads.

**Not tested:** a real R2 bucket (none exists); real footage (none may be used);
performance under a real match's volume.

**What is synthetic:** in the end-to-end run, the clips are made by the test cutter from
synthetic segment files. The bytes are real and hashed, but they are not decodable video.
The cutter itself was tested with real ffmpeg in Phase 3.

## Approvals needed

1. **Create the R2 bucket.** D1 approved about $0.12 a month; recheck the price first.
   - A private bucket, `dtp-fairplay-evidence`, with no public access and no custom domain.
   - An R2 API token with Object Read & Write on **this bucket only**.
   - A bucket lifecycle rule deleting objects after 120 days, as a backstop behind the
     90-day sweep.

   Then set `FAIRPLAY_STORAGE_BACKEND=r2` and the `FAIRPLAY_R2_*` values in the API's
   secrets, and run the bucket checks the S3 server cannot prove: a PUT with the wrong
   body is refused, `HEAD` returns `ChecksumSHA256`, and anonymous GET is refused.
2. **The production migration and deploy.** The migration is additive. Deploying runs
   `prisma migrate deploy` as usual. Nothing changes for anyone until an admin assigns a
   FairPlay role.
3. **A bundle signing key** (`FAIRPLAY_BUNDLE_SIGNING_KEY`), generated on the server and
   kept in its secrets, never in the repo.

## Risks and rollback

- **Risks:**
  - R2 checksum behaviour (above);
  - an Edge created before pairing has local-only sessions, which the cloud rejects as
    unprovisioned. Start each real session from the cloud bundle;
  - a member removed in the cloud keeps venue access until the bundle expires (36 h), as
    ADR-0005 says.
- **Rollback:**
  - deploy the previous image. The new tables stay unused, and are dropped only by a
    later, approved migration;
  - on the Edge, unset `FAIRPLAY_CLOUD_SYNC_URL`: nothing leaves, and the outbox keeps
    everything.

## Next

- **This phase, after approval:** the bucket and its checks; deploy; then pair the matchday
  Edge.
- **Still open from earlier phases:**
  - D11, the player/parent request tool, before any real match;
  - D12, disk encryption and a custodian;
  - D8, rights and consent with the organisers, plus a legal check;
  - gate 1 and E17 from the equipment audit;
  - B8, sheet event ids on approval;
  - B9 and B10, the licence rows.
- **Prompt 6,** "System resilience and defence in depth", is the next phase in the pack.
