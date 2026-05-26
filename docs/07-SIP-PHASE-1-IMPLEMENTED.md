# SIP Phase 1 — implemented

## Delivered

- **PostgreSQL schema** (`services/api/prisma/schema.prisma`) — players, matches, match metrics, aggregates, tactical_scores, position_fit, benchmarks, philosophy_fit (table ready for Phase 2).
- **`@dtp/engines`** — derived metrics, tactical style scores, position fit, `runSipPipeline()`.
- **`@dtp/api`** (NestJS) — ingest metrics, recalculate, player + scouting + benchmark APIs.
- **Docker Postgres** — `infra/docker-compose.yml`.

## Run locally

```bash
pnpm install
pnpm db:up
pnpm db:push
pnpm --filter @dtp/api prisma:generate
pnpm db:seed
pnpm dev:api
```

## Next (Phase 2)

Philosophy fit engine, Strong XI, pitch visualization, player comparison UI wired to API.
