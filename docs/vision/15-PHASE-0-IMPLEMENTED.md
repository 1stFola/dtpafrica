# 15 — Phase 0 implemented

Foundation, rights and provider abstractions. **Gate: PASS** — evidence below.

Nothing here changes existing behaviour. Vision is off unless `VISION_ENABLED` is
set, and the module contributes no routes to the public site.

---

## What shipped

### `packages/vision-contracts` — shared contracts

Plain TypeScript types and `as const` enums for rights, media, storage keys, jobs
and the prediction envelope. `VISION_CONTRACT_VERSION` is carried on every job
spec so the worker handshake works from day one.

Deviation from [01-ARCHITECTURE.md](./01-ARCHITECTURE.md): **no Zod in Phase 0.**
There is no worker yet to consume generated JSON Schema, and the API validates
inbound payloads with `class-validator` like the rest of the codebase. Runtime
schemas and the JSON Schema emitter land in Phase 1, when a consumer exists.
Reasoning in [the package README](../../packages/vision-contracts/README.md).

### Schema — 22 models, one migration

`services/api/prisma/migrations/20260924230000_vision_phase_0/`

Sources and rights (`VisionSourcePartner`, `VisionSourceChannel`,
`VisionSourceVideoRecord`, `VisionRightsEvidence`, `VisionRightsScope`,
`VisionPartnerAuthorizedSignatory`, `VisionPartnerUploadGrant`,
`VisionDeletionRequest`), media (`VisionVideoAsset`, `VisionVideoVariant`,
`VisionDuplicateCluster`, `VisionCameraSegment`, `VisionUploadSession`), jobs
(`VisionJob`, `VisionJobEvent`, `VisionJobCost`, `VisionWorker`), dataset and
model skeletons, and `VisionAuditLog`.

Two facts worth recording:

- **No existing table is altered.** The generated migration contains zero
  `ALTER TABLE` statements against a non-Vision table. Back-relations were added
  to `Player`, `Academy`, `SbMatch` and `SbCompetition`, but Prisma relation
  fields are virtual — the foreign keys all live on the Vision side.
- **Actor ids are flat, not relations**, matching the convention
  `SbMatchStatistics` already uses: an audit trail has to outlive the admin user
  it refers to, and api-key auth has no user row at all.

### `ObjectStore` port + two implementations

`R2ObjectStore` (S3-compatible, path-style, `@aws-sdk/client-s3`) and
`InMemoryObjectStore`. Four logical buckets; the environment maps them to real
names.

The port exposes **only** presigned transfer plus explicitly-named small-object
helpers. There is no method that streams a large object through the API, which is
what keeps the `t3.small` out of the data path.

Write-once enforcement on `master` is implemented in both adapters: a second PUT,
a presigned PUT, or a copy onto an existing source or rights-evidence object is
refused.

### `ComputeProvider` port + registry

`MockComputeProvider` and `LocalComputeProvider`, behind a
`ComputeProviderRegistry` that resolves by id and **refuses experiment-only
capacity for durable work**. Phase 0 has no production-approved provider, which
is correct — hosted providers arrive in Phase 1, and the second one exists
specifically to prove the abstraction holds.

`DEFAULT_RESOURCE_CLASS` routes `transcode`, `clip`, `fingerprint` and `probe` to
`cpu_small`. Neither source document specified this, and it is one of the larger
avoidable costs in the pipeline.

### `RightsPolicyService` — the gate

Four independent scopes. Resolution is **most specific wins, deny beats allow**,
so a guardian's player-level withdrawal overrides a partner-wide grant.

- A denial is never a bare boolean: it carries a reason enum, a detail for the
  audit log, and remediation copy for the UI.
- `canTrain` additionally requires `corpus = dtp_owned`, `acquisitionStatus =
  acquired`, and a recorded checksum — the corpus firewall, checked before any
  grant is consulted.
- An unrecognised restriction shape **denies**, because a restriction the code
  does not understand is not a restriction that can be waived.

### RBAC — extended, not rebuilt

13 `vision.*` slugs added to the existing `ADMIN_PERMISSIONS` catalogue, and five
seeded roles alongside the existing ones. `seed-rbac.ts` needed no change: it is
additive by design and tops up `super_admin` on every run.

Two omissions are asserted by test, because they are exactly what a later
"let's just add it" would quietly undo:

- `vision_ml_engineer` has `models.train` but **not** `models.promote`.
- `vision_annotator` has `annotate` but **not** `media.raw.read`.

### Config, audit, status

`loadVisionConfig` validates at boot and reports **every** problem at once rather
than one per restart. Numeric settings parse strictly — deployment has been bitten
by string-vs-integer env binding before (`SMTP_PORT`, see `infra/DEPLOYMENT.md`).

`VisionAuditService` requires a stated reason for `media.raw.read`,
`rights.scope.revoked` and both deletion actions.

`GET /api/v1/vision/status` reports configuration and provider capabilities
behind `vision.read`. It reports whether credentials are configured, never what
they are.

---

## Gate evidence

| Gate criterion | Result |
|---|---|
| Existing app still works | `pnpm typecheck` clean across 6 projects; `pnpm build` clean; all 88 pre-existing API tests still pass |
| Object-store adapter covered against a mock | 13 assertions against the `ObjectStore` port, written so the same suite can be pointed at R2 in Phase 1 |
| No large-object upload endpoint proxies bytes through EC2 | Asserted in `vision-boundaries.spec.ts`: the port exposes only presigned transfer and small-object helpers |
| Rights gating covered by tests | 25 assertions, including deny-beats-allow, expiry, the corpus firewall and unrecognised restrictions |
| Job spec targets a mock provider with no provider-specific fields | Asserted: the serialised spec contains no vendor string, and launches on the mock provider unchanged |
| Migrations build from zero | Migration generated by schema diff and Prisma-validated. **See caveat below.** |

### Test totals

```
services/api            176 passed (was 88)   20 files
packages/vision-contracts 22 passed            1 file
```

### Architecture tests

`vision-boundaries.spec.ts` asserts, by scanning source:

- no vendor name outside `storage/` and `compute/`, and none at all in the shared contracts;
- no filesystem write, subprocess spawn, or `ffmpeg`/`ffprobe` reference anywhere in the Vision module;
- no streaming large-object method on the `ObjectStore` port.

These are assertions rather than review guidance because a rule that depends on
someone remembering to grep gets skipped under delivery pressure.

---

## Caveat: the migration has not been applied to a database

Docker was not running in this environment, so there was no Postgres to migrate
against. The migration SQL was generated with `prisma migrate diff` against the
committed schema and validated with `prisma validate`, but **`migrate deploy` has
not been executed and the SQL has not been applied anywhere.**

Before Phase 1, run:

```bash
pnpm db:up && pnpm --filter @dtp/api prisma migrate deploy && pnpm --filter @dtp/api prisma migrate status
```

Confirm it applies from zero on a clean database, and that the existing seeds
still run. Until that has been done once, treat the migration as unverified.

---

## Not in Phase 0, by design

| Deferred to | What |
|---|---|
| Phase 1 | Hosted compute providers, the worker API, the job queue implementation, upload endpoints, catalog screens, Zod runtime schemas and JSON Schema emission |
| Phase 1 | Growing the root EBS volume 20 → 100 GiB before Vision metadata accumulates ([Q9](./13-OPEN-QUESTIONS.md)) |
| Phase 2 | Annotation, review workstation, dataset factory |

## Commands

```bash
pnpm typecheck
pnpm --filter @dtp/api test
pnpm --filter @dtp/vision-contracts test
pnpm build
```
