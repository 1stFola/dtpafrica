# FairPlay — integration map and API outline

Where FairPlay attaches to the existing code, how the PID's logical entities map onto this
schema, and the API surface in outline. Nothing here exists yet; names are proposals for
approval at the Phase 0 gate.

---

## 1. Extension points

| Area | File | Change | Risk to existing features |
|---|---|---|---|
| API module | `services/api/src/fairplay/` (new), `src/app.module.ts` | new `FairPlayModule` in `AppModule.imports`, importing `PrismaModule` and `AdminGuardsModule` (the documented way for a module outside admin to use `AdminAuthGuard` + `PermissionsGuard`). It does **not** import `ScoreboardModule`, `AdminModule` or `VisionModule`: it reads `SbMatch` and `SbMatchStatistics` through Prisma and calls no ScoreBoard service | none: new routes under `/api/v1/fairplay` |
| Permissions | `services/api/src/admin/rbac/permissions.catalog.ts` | new slugs and two roles (below); `super_admin` gets them | seeding adds rows only |
| Schema | `services/api/prisma/schema.prisma` + one migration | new `FairPlay*` models; `SbMatch` and `AdminUser` gain **back-relations only** | additive; no column on an existing table changes |
| Body limits | `services/api/src/shared/body-limits.ts` | sync batch route gets its own bound (≈1 MB) | none |
| Storage | `services/api/src/vision/storage/r2-object-store.ts` | a **second `R2ObjectStore` instance**, provided inside `FairPlayModule` from its own `FAIRPLAY_R2_*` settings and a token scoped to the evidence bucket only. Vision's `OBJECT_STORE` is not reused: it is built from Vision's config, switches to in-memory when Vision storage is off, and holds a key that reaches Vision's buckets ([ADR-0006](./adr/0006-evidence-storage.md)) | the adapter class is reused unchanged; how it learns a FairPlay bucket id without coupling Vision's contracts is the one design point left for Phase 3 |
| Web admin area | `apps/web/src/modules/admin/AdminApp.tsx` | `<Route element={<AdminRequirePermission permission={[...fairplay slugs]} />}><Route path="fairplay/*" element={<AdminFairPlayApp />} /></Route>` — the same shape as `vision/*` at `AdminApp.tsx:65-66` | none: a new path |
| Per-match page | `apps/web/src/modules/admin/fairplay/` (new) | `/admin/fairplay/matches/:matchId` (sessions, incidents, evidence, report) and `/admin/fairplay/devices` | — |
| Web admin nav | `AdminLayout.tsx` `links`, `admin-permissions.ts` `ADMIN_NAV_PERMISSIONS["/admin/fairplay"]` | "FairPlay" entry | hidden without a FairPlay permission |
| ScoreBoard → Match → FairPlay | `apps/web/src/modules/admin/scoreboard/pages/AdminScoreboardMatchCenterPage.tsx` | a "FairPlay" link on the selected match to `/admin/fairplay/matches/:matchId`, rendered only when `hasPermission` grants a FairPlay slug | additive; nothing changes for users without FairPlay permissions |

**Why not inside the match console or `/admin/scoreboard`** ([ADR-0010](./adr/0010-admin-placement.md)):
the console at `admin/match-stats/:matchId/*` is the recorder's full-viewport pitch-side
tool, and showing disputed-incident findings there would put them in front of the person
keeping the official sheet during the match. `/admin/scoreboard` requires `scoreboard.read`
(`ADMIN_NAV_PERMISSIONS`), which an organiser viewer should not need just to read a report.
| Edge service | `services/fairplay-edge/` (new, Python) | FastAPI app, MediaMTX config, Compose file, tests | none: does not run on EC2 |
| Local console | `apps/fairplay-console/` (new Vite app) reusing `@dtp/ui` | built static, served by the Edge | none: not in the `web` image |
| Contracts | `packages/fairplay-contracts/` (new, TS) + Python mirror with a parity test | sync payloads, enums, manifest schema | follows the vision-contracts precedent |
| CI | `.github/workflows/ci.yml` | add Edge pytest and console build to `verify` | longer CI run |

**Not touched**: `SbMatchEvent`, `SbMatchStatistics`, scores, the match console's sheet
workflow, `SbLiveStream`, nginx CSP, Vision's buckets, the EC2 instance. One exception is
proposed for Phase 3 and reviewed separately: sheet approval writing `sheetEventId` into
each event's `metadata` ([ADR-0009](./adr/0009-linking-incidents-to-scoreboard.md)).

## 2. Logical entities → proposed tables

Conventions taken from the schema: UUID ids, camelCase fields with `@map` to snake_case,
`createdAt`/`updatedAt`, flat actor ids and names on audit rows, supersede-not-edit for
anything evidential.

| PID entity | Cloud model (table) | Existing keys it references | Notes |
|---|---|---|---|
| fairplay_session | `FairPlaySession` (`fairplay_sessions`) | `SbMatch.id` → `matchId`; `FairPlayEdgeDevice.id` | `mode` is `shadow` or `post_match` — there is no other value ([ADR-0001](./adr/0001-shadow-mode-only.md)); `angleMode` `single` / `multi`; a `matchSnapshot` JSON (teams, kickoff, competition) so evidence survives a match edit |
| (new) edge device | `FairPlayEdgeDevice` (`fairplay_edge_devices`) | — | `tokenHash`, `tokenKind` (`bootstrap` / `device`), `publicKey`, `lastSeenAt`, `retiredAt`; mirrors `VisionWorker` |
| (new) assignment | `FairPlaySessionMember` (`fairplay_session_members`) | `AdminUser.id` | who may act in this session and as what; the source of the offline credential bundle |
| camera_source | `FairPlaySource` (`fairplay_sources`) | session | `label`, `path`, `role` (`ground`/`drone`/`programme`), codec, fps; offsets live in calibrations, not here |
| recording_segment | `FairPlaySegment` (`fairplay_segments`) | source | `startUtc`, `durationMs`, `bytes`, `sha256`, `finalized`, `partial`, `localPath` (Edge-relative), `remoteKey` null unless uploaded |
| calibration_event | `FairPlayCalibration` (`fairplay_calibrations`) | source | `period`, `observedUtc`, `sourceTime`, `offsetMs`, `uncertaintyMs`, `method`, `actorId`, `supersededBy` |
| incident | `FairPlayIncident` (`fairplay_incidents`) | session; **`sheetEventId` (string, the console sheet's event id)** | no FK to `SbMatchEvent`: re-approving a sheet recreates its events with new UUIDs, so the current event is looked up through its metadata at read time ([ADR-0009](./adr/0009-linking-incidents-to-scoreboard.md)). `state` FLAGGED → REVIEWING → REVIEWED → ARCHIVED, `version` for optimistic concurrency |
| review | `FairPlayReview` (`fairplay_reviews`) | incident; `AdminUser.id` as flat `reviewerId` + name | `result` ∈ supports_original, supports_alternative, inconclusive, footage_unavailable; `authorityMode` always `shadow` in V1 |
| evidence_asset | `FairPlayEvidence` (`fairplay_evidence`) | review; segments (`sourceSegmentIds`) | `windowStartUtc`, `windowDurationMs`, `derivation` (`copy` / `reencode` / `frame`), `sha256`, `bytes`, `remoteKey`, `accessClass`, `approvedBy` |
| audit_entry | `FairPlayAuditLog` (`fairplay_audit_logs`) | flat actor fields | Vision's shape plus `deviceId`, `seq`, `prevHash`, `entryHash` for a per-device hash chain; insert-only by code, and the migration adds a trigger that refuses UPDATE and DELETE |
| sync_outbox | Edge only (SQLite) | — | the cloud side is the idempotency record below |
| (new) sync receipt | `FairPlaySyncReceipt` (`fairplay_sync_receipts`) | device | `idempotencyKey` unique, `payloadHash`, `result`; a repeat with the same key and hash returns the stored result, the same key with a different hash is a 409 |

**Foreign-key behaviour.** `onDelete: Restrict` on `FairPlaySession.matchId` would block an
admin from deleting a match that has evidence, which changes an existing behaviour.
Proposed instead: `SetNull`, plus the `matchSnapshot`, matching how audit tables here
already outlive the rows they mention. Decision for the gate.

## 3. Permissions and roles

New permission slugs (PID §3 names in brackets):

| Slug | Grants |
|---|---|
| `fairplay.session.manage` | create/configure sessions, assign members |
| `fairplay.edge.admin` [can_admin_edge] | register, pair and retire Edge devices |
| `fairplay.incident.operate` | flag incidents, mark calibrations, request clips |
| `fairplay.incident.review` [can_review] | record findings, complete reviews |
| `fairplay.evidence.view_original` [can_view_original] | read original segments; reason required, audited |
| `fairplay.evidence.export` [can_export] | approve and export an evidence package |
| `fairplay.report.view` | read approved reports and approved evidence only |

New roles: `fairplay_operator` (operate), `fairplay_assessor` (operate + review),
`fairplay_admin` (all), `fairplay_organiser_viewer` (report.view, scoped by
`AdminUserCompetition`). Every check is competition-scoped through the existing
`canAccessCompetition`, and session-scoped through `FairPlaySessionMember`.

**Open question for the gate:** organisers do not have admin accounts today. Giving them
`AdminUser` rows with only `fairplay.report.view` reuses everything; it also puts external
people in the admin user table. The alternative is a time-limited share link per report,
which is new auth. Proposed: admin accounts with the viewer role.

## 4. API outline

All under `/api/v1`. Errors use the Vision `refusal()` shape. Prose contracts in the
repo's style (no Swagger exists); an OpenAPI file is generated for the Edge by FastAPI.

### Cloud (NestJS, existing API)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/fairplay/devices` | JWT + `fairplay.edge.admin` | register a device; returns a one-time bootstrap token |
| POST | `/fairplay/devices/register` | `x-fairplay-bootstrap-token` | exchange for a device token; records the device public key |
| POST | `/fairplay/devices/:id/retire` | JWT + `fairplay.edge.admin` | revoke |
| POST | `/fairplay/sessions` | JWT + `fairplay.session.manage` | create a session for an `SbMatch`, assign a device |
| GET | `/fairplay/sessions/:id` | JWT + scope | session, sources, sync state |
| PUT | `/fairplay/sessions/:id/members` | JWT + `fairplay.session.manage` | who may act |
| GET | `/fairplay/sessions/:id/credential-bundle` | `x-fairplay-device-token` | signed offline bundle for this device's session |
| POST | `/fairplay/sync/batch` | device token | idempotent upsert of sessions, sources, segments, calibrations, incidents, reviews, evidence metadata, audit entries |
| POST | `/fairplay/evidence/presign` | device token | presigned PUT (or multipart) for one evidence object under `sessions/{id}/` |
| POST | `/fairplay/evidence/:id/confirm` | device token | HEAD the object, check bytes, record the key |
| GET | `/fairplay/incidents?sessionId=&cursor=` | JWT + scope | index |
| GET | `/fairplay/incidents/:id` | JWT + scope | incident, reviews, lineage |
| POST | `/fairplay/evidence/:id/read-url` | JWT + `report.view` or `view_original` (+ reason) | presigned GET ≤ 5 min; audited |
| GET | `/fairplay/sessions/:id/report` | JWT + scope | JSON report; printable HTML in the web app |

### Edge (FastAPI, venue LAN, TLS terminated by Uvicorn)

| Method | Path | Purpose |
|---|---|---|
| POST | `/edge/auth/login` | email + PIN against the signed bundle → local session |
| POST | `/edge/sessions/:id/start`, `/stop` | begin/end recording for the configured sources |
| GET | `/edge/sessions/:id/sources` | sources with health |
| GET | `/edge/sessions/:id/health` | recorder state, disk, gaps, last finalised segment, outbox depth, clock state |
| POST | `/edge/sessions/:id/periods` | mark kick-off / half-time / full-time on the Edge clock |
| POST | `/edge/sessions/:id/calibrations` | append a calibration |
| GET | `/edge/sessions/:id/recordings?source=&start=&end=` | spans from MediaMTX `/list`, with gaps |
| GET | `/edge/media/window?source=&start=&duration=` | authorised proxy to MediaMTX `/get` (never exposed directly) |
| POST | `/edge/incidents` | flag |
| PATCH | `/edge/incidents/:id` | change with `If-Match: <version>` |
| POST | `/edge/incidents/:id/reviews` | finding |
| POST | `/edge/incidents/:id/clips` | clip job (stream copy first) |
| GET | `/edge/jobs/:id` | job state |

## 5. Sync contract (summary)

- Every entity has a client-generated UUID and an integer `version`. The idempotency key is
  `{entityType}:{id}:{version}`.
- The outbox is processed in dependency order: session → sources → segments →
  calibrations → incidents → reviews → evidence → audit.
- Same key + same payload hash → the stored result (`200`, `replayed: true`). Same key +
  different hash → `409` and the item is parked for a human, never overwritten.
- A higher version replaces a lower one; a lower version arriving late is recorded and
  ignored. Audit entries are insert-only and checked against the device's hash chain; a
  break is accepted and flagged.
- Retries back off exponentially to a cap (default 5 min) and never give up while the
  session is open; the console shows the outbox depth.
