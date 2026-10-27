# ADR-0002 — Central metadata lives in the existing NestJS API and Postgres

**Status**: proposed (Phase 0) · **Decides**: where FairPlay's cloud side runs

## Context

The PID asks for "existing DTP backend, not a new monolith" and leaves the framework to
discovery. Discovery found NestJS 10 + Prisma 6 + PostgreSQL 16 on one `t3.small`, with
RBAC, competition scoping, machine identity, R2 presigning and an audit service already
built for Vision (see [inventory](../inventory.md)). Vision faced the same choice and ruled
the same way (`docs/vision/02-DECISIONS.md` D1).

## Decision

- A new `services/api/src/fairplay/` module, registered in `app.module.ts`, under
  `/api/v1/fairplay`, using `AdminAuthGuard`, `PermissionsGuard`, `canAccessCompetition`
  and the `refusal()` error shape.
- New `FairPlay*` Prisma models mapped to `fairplay_*` tables, in one **additive** migration
  applied by the existing `prisma migrate deploy`. Existing tables gain Prisma
  back-relations only; no column changes.
- An audit table of FairPlay's own (`fairplay_audit_logs`), Vision's shape plus a per-device
  hash chain, with a trigger refusing UPDATE and DELETE. Vision's audit table is not
  reused: its action list is closed and Vision-specific, and FairPlay's evidence chain must
  be exportable on its own.
- The cloud handles JSON only. It never opens, proxies or transcodes video.

## Consequences

+$0 infrastructure. FairPlay ships with the API image, so its routes deploy and roll back
with everything else. The cost: a FairPlay bug can, in principle, affect the API process;
mitigated by small bounded routes and per-route body limits.

## Alternatives rejected

A separate FairPlay service or database: a second thing to deploy, secure, back up and pay
for on a 2 GB box, for a few KB per incident.
