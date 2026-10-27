# ADR-0006 — Evidence goes to its own private R2 bucket, by presigned URL, from the Edge

**Status**: proposed (Phase 0) · **Decides**: where evidence bytes live and who can write them

## Context

R2 is already used: Vision's four logical buckets (`master`, `derived`, `models`, `clips`)
behind the `ObjectStore` port, and `dtp-db-backups`. The Vision worker holds **no storage
credentials**; it asks the API for a presigned URL per object, checked against its job's
output prefix. The PID allows either S3 credentials on the Edge or presigned operations, and
forbids relaying video through EC2.

## Decision

- A new private bucket, logical id `fairplay_evidence`, write-once like `master`, with no
  public access and no custom domain.
- A **second `R2ObjectStore` instance**, provided inside `FairPlayModule` from
  `FAIRPLAY_R2_*` settings with an R2 token scoped to this bucket only. Vision's
  `OBJECT_STORE` provider is not reused: it is built from `VisionConfig`, falls back to the
  in-memory store when Vision storage is off, and its key can reach Vision's buckets. How
  the adapter accepts a bucket id outside Vision's `BucketId` list without coupling the two
  contracts is settled in Phase 3 against `vision-boundaries.spec.ts`.
- **The Edge holds no R2 credentials.** It calls `POST /fairplay/evidence/presign` with its
  device token; the cloud returns a short-lived presigned PUT (multipart above a threshold,
  using the existing upload-session pattern) for a key under `sessions/{sessionId}/`.
- After upload the Edge calls `confirm`; the cloud `HEAD`s the object and checks the byte
  count. The SHA-256 is the Edge's, computed before upload and recorded in the manifest; a
  multipart ETag is never treated as a hash.
- Viewers get presigned GETs of ≤ 5 minutes after permission and scope checks; each issue is
  audited.
- Default upload set: approved evidence derivatives and manifests. Full-match upload is a
  per-session switch that records who turned it on and the storage estimate shown to them.

## Consequences

A stolen Edge laptop cannot list, read or write the bucket. The cloud does extra small
requests per clip, which a `t3.small` handles. Creating the bucket is a Cloudflare account
change that needs approval before Phase 3.

## Alternatives considered

- **Bucket-scoped R2 token on the Edge**: simpler uploads, works on a bad connection without
  a round trip per object. Rejected: a venue laptop is the device most likely to be lost.
- **Vision's `clips` bucket**: wrong policy — FairPlay evidence must never be reachable from
  the training or highlight paths ([ADR-0007](./0007-no-vision-training-path.md)).
