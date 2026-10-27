# FairPlay — repository inventory

Phase 0 deliverable. What exists today that FairPlay will sit on, read from the code on
27 October 2026 and rechecked against `main` at `37b31f7`. **FairPlay itself does not exist**: no file, table, route or doc
mentions it before this folder.

Facts marked *(Terraform)* come from `infra/terraform/`, not from an invoice or the AWS
console, and need checking against the real bill.

---

## Stack

| Layer | What it is | Where |
|---|---|---|
| Monorepo | pnpm 9.15 workspaces, Node ≥ 20 | `package.json`, `pnpm-workspace.yaml` |
| Web | React 18.3, Vite 5.4, react-router-dom 7 (JSX `<Routes>`), vitest | `apps/web` |
| API | NestJS 10, `@nestjs/jwt`, `@nestjs/throttler`, class-validator, global prefix `/api/v1` | `services/api/src/main.ts` |
| Database | PostgreSQL 16 (`postgres:16-alpine`), Prisma 6, 44 migrations, forward-only `prisma migrate deploy` on every deploy | `services/api/prisma/` |
| Object storage | Cloudflare R2 through `@aws-sdk/client-s3`, behind an `ObjectStore` port with an in-memory test double | `services/api/src/vision/storage/` |
| Python | `services/vision-worker`: Python ≥ 3.11 (image 3.12-slim-bookworm), httpx, setuptools, pytest; a polling CLI, **not** a web server; runs `ffmpeg`/`ffprobe` as subprocesses | `services/vision-worker` |
| Shared contracts | `@dtp/vision-contracts` (TS), mirrored in Python with a parity check | `packages/vision-contracts` |
| CI | GitHub Actions: install, prisma validate, unit tests (API, web, engines, contracts), worker pytest, typecheck, builds, migration check, vision gates on a real DB, image builds | `.github/workflows/ci.yml` |
| CD | On green `main`: build → ECR (tag = commit SHA) → Ansible pull → `migrate deploy` → health check → automatic rollback on failure | `.github/workflows/cd.yml`, `infra/ansible/` |
| Lint | No-op in API and web (`echo ok`) | `package.json` scripts |
| OpenAPI | None. Vision documents contracts in `docs/vision/07-API-CONTRACTS.md` | — |

## Production

| Fact | Value | Source |
|---|---|---|
| Hosting | One EC2 `t3.small` (2 vCPU, 2 GB), `us-east-1`, Ubuntu 22.04, 100 GiB root | `infra/terraform/variables.tf` *(Terraform)* |
| Containers | `postgres`, `api` (127.0.0.1:3000), `web` (nginx 1.27 serving the Vite build, proxying `/api/`), optional `worker` (768 MB, 1 CPU cap) | `infra/docker-compose.staging.yml` |
| Edge | Namecheap Supersonic CDN → Elastic IP. **Not CloudFront**: the Terraform's CloudFront blocks were never live | `infra/TERRAFORM_STATE_AUDIT.md` |
| TLS | At the CDN. Origin nginx listens on 80 only | `infra/nginx.staging.conf` |
| CSP | `media-src 'self' blob: https:`, `connect-src` includes `https://*.r2.cloudflarestorage.com`, `frame-src` YouTube and Drive only | `infra/nginx.staging.conf:146-184` |
| Cost | ~$21/month estimated, ~$28 after the EBS growth | `docs/vision/12-COST-MODEL.md` *(Terraform)* |
| R2 today | Vision's `master`, `derived`, `models`, `clips` buckets, plus `dtp-db-backups`. So **R2's 10 GB free allowance is already partly used**, and the PID's "evidence within the free allowance" line does not hold as written | `infra/.env.example`, `infra/backup/` |
| Monitoring | Built-in Nest `Logger` (no structured logger); `/api/v1/health` and `/health/ready`; healthchecks.io heartbeats for backups and disk; CloudWatch alarms written but **not applied** (Terraform on hold since 17 Oct) | `health.controller.ts`, `infra/ansible/roles/monitoring/` |
| Secrets | AWS Secrets Manager (`dtp/{env}/app`, `dtp/{env}/vision`) → env | `cd.yml`, `deploy.sh` |

## Auth and permissions

- **Admin sign-in**: email + bcrypt password → JWT signed with `ADMIN_JWT_SECRET`, 7-day
  life, stored in `sessionStorage`, sent as `Authorization: Bearer`
  (`admin/auth/admin-auth.service.ts`, `apps/web/src/api/admin.ts`).
- **Super-admin key**: `x-admin-api-key` = `ADMIN_API_KEY`, compared in constant time. Has
  no user id, so acts that need a named person refuse it (`vision/shared/refusals.ts`
  `personFor()`).
- **Guards**: `AdminAuthGuard` → `req.adminAuth`; `PermissionsGuard` +
  `@RequirePermissions(...)` (any one slug); `@AdminAuth()` param decorator.
- **RBAC**: roles and permissions are rows, not enums, seeded from
  `admin/rbac/permissions.catalog.ts` (~45 permission slugs; 12 roles incl. `match_recorder`,
  `match_supervisor`, `vision_reviewer`).
- **Scope**: per **competition**, not per match — `AdminUserCompetition`, plus an explicit
  `allCompetitions` flag; helpers `canAccessCompetition`, `competitionScopeWhere`. No model
  assigns an official or reviewer to a single match.
- **Machine identity** (the pattern FairPlay's Edge pairing copies):
  provision key → 1-hour bootstrap token → `register` exchanges it for a worker token;
  tokens stored as SHA-256 hashes with a `tokenKind`; each guard accepts exactly one kind
  (`vision/worker/`).
- **CORS**: `https://dtp.africa`, `https://www.dtp.africa` in production; Vite's localhost
  ports outside it (`shared/cors.ts`). No wildcard.
- **Rate limits**: per-route throttles only (`shared/throttle.ts`).

## Match, events and the clock

- **`SbMatch`** (`sb_matches`): `id` (UUID), `competitionId`, `status`, `minute`, scores,
  `kickoffAt`, `venue`. No video field.
- **During a match, events live in the console's sheet, not in `SbMatchEvent`.**
  `SbMatchStatistics.events` is a JSON array of `{id, type, minute, addedMinute, side,
  playerNumber, half}` with **client-generated string ids**; approving the sheet writes
  `SbMatchEvent` rows (UUIDs). **Re-approval deletes and recreates every `match_recorder`
  event with new UUIDs**, and the event metadata keeps `sheetId` and `recorderSequence`
  but not the sheet event's id. So an incident must link by sheet event id
  ([ADR-0009](./adr/0009-linking-incidents-to-scoreboard.md)).
- **`SbMatchEvent`** has `minute` and `secondInMinute`, but no `half` column.
- **Match clock**: `SbMatchStatistics.clock` holds wall-clock ISO anchors
  (`firstHalfStartedAt`, `secondHalfStartedAt`, added time). Browsers correct their own
  clock against `GET /api/v1/time` (`scoreboard/time.controller.ts`) before stamping. This
  is the bridge from "minute 67" to a UTC instant — when the recorder was online.
- **Offline**: the match console drafts to `localStorage` and retries saves; there is no
  outbox, no service worker and no idempotency-key header. Event idempotency is "client id
  + server merge by id" (`admin/sheet-event-merge.ts`).
- **Video on the public site**: YouTube only — `SbLiveStream.youtubeUrl`,
  `SbHighlight.youtubeUrl`; PR #296 picks an unpublished live stream as "Watch Recorded
  Video". No player beyond YouTube iframes and plain `<video>` on presigned proxies in the
  Vision admin pages.

## What Vision already built that FairPlay must reuse, not copy

| Need | Existing piece | Reuse plan |
|---|---|---|
| Private R2, presigned PUT/GET, resumable multipart, write-once guard, protected delete | `ObjectStore`, `R2ObjectStore`, `VisionUploadSession` | Same adapter, **separate bucket and token** (ADR-0006) |
| Uploader holds no storage credentials | Worker asks the API for a presigned URL per object, checked against the job's `outputPrefix` | Edge does the same (ADR-0006) |
| Machine identity with hashed, kind-checked tokens | `VisionWorker`, bootstrap → worker exchange | Edge device pairing (ADR-0005) |
| Append-only audit with flat actor fields, closed action list, reason-required actions | `VisionAuditLog`, `VisionAuditService` | Same shape, FairPlay's own table (ADR-0002) |
| Consent and rights, deny-beats-allow, player-level withdrawal | `VisionRightsScope`, `rights-policy.service.ts` | Read it before any external release; FairPlay adds no training path (ADR-0007) |
| Clock anchored to footage | `VisionClockAnchor` (`half`, `sourceMs`), supersede not edit | Same supersede pattern for calibrations |
| FFmpeg licence ruling | `docs/vision/71-FFMPEG-LICENCE.md`: GPL build, cleared **only inside DTP's own images, never given to anyone outside DTP** | Edge on a DTP-owned machine is inside that ruling; an appliance handed to an organiser is not |
| Typed refusals | `refusal()` → `{statusCode, error, message, remediation}` | Same for FairPlay routes |

## Extension points (summary; detail in [integration-map.md](./integration-map.md))

- **API**: a new `services/api/src/fairplay/` module registered in `app.module.ts`,
  importing `AdminGuardsModule`; new permission slugs and roles in
  `admin/rbac/permissions.catalog.ts`.
- **Schema**: new `FairPlay*` models mapped to `fairplay_*` tables; `SbMatch` gains only a
  Prisma back-relation (no column change).
- **Web admin**: per-match view as a sub-route `admin/match-stats/:matchId/fairplay` in
  `MatchConsoleApp.tsx`, or a link from the ScoreBoard match list; sidebar entry via
  `AdminLayout.tsx` + `ADMIN_NAV_PERMISSIONS` + `AdminApp.tsx`. A FairPlay tab must not
  extend the shared `SheetSection` union.
- **Edge**: new `services/fairplay-edge` (Python) and a separately built local console.
