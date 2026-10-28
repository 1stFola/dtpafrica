# FairPlay — blockers and assumption register

The acceptance line for Phase 0 is "no undocumented assumption about an existing route, DB
schema or ISO feed". This is where each one is written down: either verified, with the
file it was read from, or marked **UNVERIFIED** with who can settle it.

---

## Blockers

| # | Blocker | Blocks | Why | Who settles it |
|---|---|---|---|---|
| B1 | Matchday hardware outputs unknown (equipment audit E1–E6) | any claim of real-video success; multi-angle mode | no isolated-recording promise without evidence; Phase 1 may proceed on synthetic feeds only | matchday crew → Fola |
| B2 | Footage rights and consent for the pilot fixtures | recording real matches into FairPlay; any external release | youth players; competition agreements; Nigerian data-protection duties | Fola / organisers |
| B3 | Edge machine not identified (E7, E8, E14) | Phase 1 bench test; OS packaging choice | Docker on Windows handles UDP/RTSP less well; disk speed unknown | matchday crew |
| B4 | Gate decisions 1–7 ([phase-plan](./phase-plan.md)) | Phase 1 code | stack, TLS, roles, storage, delete behaviour | Fola |
| B5 | Private R2 bucket and a bucket-scoped token | Phase 3 evidence upload | a Cloudflare account change, however cheap | Fola |
| B6 | Organiser access model | Phase 3 report sharing | admin accounts for external people, or new share-link auth | Fola |
| B7 | Retention period | any automated deletion | needs the organiser's agreement; PID proposes 7–30 days locally | Fola / organisers |
| B8 | Sheet approval does not record the sheet event id on `SbMatchEvent.metadata` | automatic incident → current event lookup | a one-line ScoreBoard change, reviewed on its own ([ADR-0009](./adr/0009-linking-incidents-to-scoreboard.md)) | Fola (review) |
| B9 | The Edge image's FFmpeg is Debian 13's 7.1.x, not the Debian 12 build the 4 Oct 2026 ruling cleared | shipping the Edge image beyond development | the register's FFmpeg row says a different build reopens the question ([OSS register](../licenses/OSS_REGISTER.md#fairplay-edge-venue-service)) | Fola |
| B10 | Edge licence-register rows (MediaMTX, FastAPI, `cryptography` and the rest) are REVIEW REQUIRED | shipping the Edge beyond development | nothing enters without a cleared row | Fola |
| B11 | Operator bundles are DEV-signed until the cloud signs them | any real match | a DEV key on a developer's machine is not a control anyone else can audit | the cloud `fairplay` module (backlog 13), not built in Phase 3 |
| B12 | HTTPS not yet used from a real reviewer device with the Edge's root installed | a second device at a venue | proven by unit tests and a handshake test only | matchday crew |
| B13 | No cloud receiver for the outbox (`POST /api/v1/fairplay/sync/batch`), no device pairing | any record reaching the cloud; the cloud's check of the audit chain | the Edge side is built and tested against a test double; the cloud module, its additive migration and its audit-table trigger are backlog 13 | Fola (approve building it) |
| B14 | The Edge's disks are not encrypted by anything here; physical custody unplanned | real footage of minors on the Edge | hashes and the audit chain detect tampering, they do not stop reading ([privacy](./privacy.md)) | matchday crew → Fola |
| B15 | No tool for a player's or parent's request to see or erase footage; no evidence retention rule | real matches | erasing evidence must be an audited action keeping hash and reason ([privacy](./privacy.md)) | Fola / organisers |

**Standing escalations** (master prompt): any request to enable referee intervention or
VAR/FVS functions; any new recurring charge or EC2 change; any destructive or incompatible
migration; missing rights for real footage; any hardware assumption needed to promise
isolated recordings; any reduction in access control; any upload of real youth-player
video to a third-party AI service.

## Assumption register

### Repository — verified

| Assumption the design makes | Evidence |
|---|---|
| API is NestJS 10 under `/api/v1`, with `ValidationPipe({whitelist, transform, forbidNonWhitelisted})` | `services/api/src/main.ts`, `services/api/package.json` |
| Postgres 16 + Prisma 6; migrations applied by `prisma migrate deploy` on deploy | `infra/docker-compose.staging.yml`, `infra/ansible/roles/deploy/tasks/main.yml`, `services/api/package.json` (`db:migrate:deploy`) |
| `SbMatch.id` is a UUID string; table `sb_matches` | `services/api/prisma/schema.prisma` (`model SbMatch`) |
| Live events are in `SbMatchStatistics.events` (JSON); `clock` is JSON | `schema.prisma` (`model SbMatchStatistics`: `events Json`, `clock Json?`) |
| Approval deletes and recreates `match_recorder` events | `services/api/src/admin/admin-match-stats.service.ts` (`sbMatchEvent.deleteMany` then `createMany`) |
| Event metadata holds `sheetId` and `recorderSequence`, not the sheet event id | same file, the `metadata` object in approval |
| Recorder console API is `/api/v1/admin/scoreboard/match-stats` | `services/api/src/admin/admin-match-stats.controller.ts` (`@Controller("admin/scoreboard/match-stats")`) |
| Server time at `/api/v1/time`, `Cache-Control: no-store` | `services/api/src/scoreboard/time.controller.ts` |
| Health at `/api/v1/health` and `/api/v1/health/ready` | `services/api/src/health.controller.ts` |
| A module outside admin uses guards by importing `AdminGuardsModule` | `services/api/src/admin/admin-guards.module.ts` (its doc comment) |
| Permissions are rows seeded from a catalog; scope is per competition | `services/api/src/admin/rbac/permissions.catalog.ts`, `schema.prisma` (`AdminUserCompetition`) |
| The super-admin key has no user id and is refused for named-person acts | `services/api/src/vision/shared/refusals.ts` (`personFor`) |
| Machine identity: bootstrap → worker token, hashed, kind-checked | `services/api/src/vision/worker/`, `schema.prisma` (`VisionWorker.tokenKind`) |
| R2 adapter supports presigned PUT/GET and multipart, with write-once guards | `services/api/src/vision/storage/object-store.ts`, `r2-object-store.ts` |
| Vision's `OBJECT_STORE` is built from Vision config and falls back to memory | `services/api/src/vision/vision.module.ts` (provider for `OBJECT_STORE`) |
| Web admin areas are mounted in `AdminApp.tsx` behind `AdminRequirePermission`, e.g. `vision/*` | `apps/web/src/modules/admin/AdminApp.tsx` |
| Nav visibility comes from `ADMIN_NAV_PERMISSIONS`; `/admin/scoreboard` needs `scoreboard.read` | `apps/web/src/modules/admin/admin-permissions.ts` |
| The recorder console is mounted outside the site shell at `admin/match-stats/:matchId/*` | `apps/web/src/App.tsx`, `apps/web/src/modules/admin/MatchConsoleApp.tsx` |
| CORS allows only `dtp.africa` and `www.dtp.africa` in production | `services/api/src/shared/cors.ts` |
| CSP allows `media-src https:` and R2 in `connect-src` | `infra/nginx.staging.conf` |
| FFmpeg is GPL-built, cleared only inside DTP's own images | `docs/licenses/OSS_REGISTER.md`, `docs/vision/71-FFMPEG-LICENCE.md` |
| No FairPlay code, table or route exists | repository search for `FairPlay`, `fairplay`, `shadow review`: no hits outside this folder |

### Repository — not yet checked, needed later

| Assumption | When it matters | Check |
|---|---|---|
| `R2ObjectStore` can be constructed with a bucket map outside Vision's `BucketId` without breaking `vision-boundaries.spec.ts` | Phase 3 | read the constructor and the spec |
| Sheet event ids are unique within a match and stable across edits | Phase 3 (B8) | read `sheet-event-merge.ts` and the console's id generation |
| A Postgres trigger refusing UPDATE/DELETE on the audit table works with the migration check in CI | Phase 3 | try it in the `schema-migrations` CI job |

### Production and cost — from Terraform or docs, not from an invoice

| Assumption | Status |
|---|---|
| EC2 is a `t3.small` (2 GB) in `us-east-1` | from `infra/terraform/variables.tf`; **UNVERIFIED against the AWS console** |
| Monthly AWS cost ≈ $21–28 | from `docs/vision/12-COST-MODEL.md`; **UNVERIFIED against the bill** |
| R2 prices as quoted in the PID (23 Oct 2026) | **UNVERIFIED at build time**; recheck before Phase 3 |
| R2 usage already exceeds part of the free allowance | likely (Vision buckets + DB backups); **UNVERIFIED** — read the Cloudflare dashboard |

### Upstream software — read from source, recheck at the pinned version

| Assumption | Source |
|---|---|
| MediaMTX defaults allow anonymous publish/read/playback from any IP | `mediamtx.yml` on `main`, read 27 Oct 2026 |
| `playbackAllowOrigins` defaults to `["*"]`; `recordDeleteAfter` to `1d`; `useAbsoluteTimestamp` to `false` | same |
| Playback `/list?path&start&end` and `/get?path&start&duration&format=fmp4\|mp4` | `docs/2-features/09-playback.md` |
| `runOnRecordSegmentComplete` receives `MTX_SEGMENT_PATH` and `MTX_SEGMENT_DURATION` | `mediamtx.yml` comments |
| `recordPartDuration` is the recovery point: the last part is lost on a crash | `docs/2-features/08-record.md` |
| Latest MediaMTX release is v1.21.3 | GitHub releases page, read 27 Oct 2026 |

### Hardware and venue — all UNVERIFIED

Every row of the [equipment audit](./equipment-audit.md). In particular: **the switcher
exposing isolated (ISO) camera feeds is UNVERIFIED**, and the design defaults to
single-angle mode until it is proven ([ADR-0008](./adr/0008-single-angle-mode.md)). No
matchday hardware sheet was supplied with the PID bundle.
