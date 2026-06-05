# @dtp/api — SIP Phase 1

NestJS + PostgreSQL (Prisma) + `@dtp/engines` tactical scoring.

## Prerequisites

- Node 20+, pnpm
- Docker (for Postgres) or any PostgreSQL 16 instance

## Setup

```bash
# From repo root
cd infra && docker compose up -d
cd ../services/api
cp .env.example .env
pnpm install
pnpm db:push
pnpm prisma:generate
pnpm prisma:seed
pnpm dev
```

API: http://localhost:3000/api/v1/health

## SIP Phase 1 endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/players` | List players |
| POST | `/api/v1/players` | Create player |
| GET | `/api/v1/players/:id` | Player detail |
| GET | `/api/v1/players/:id/tactical-scores` | Tactical scores |
| GET | `/api/v1/players/:id/position-fit` | Position fit |
| GET | `/api/v1/players/:id/tactical-profile` | Combined profile |
| POST | `/api/v1/sip/players/:id/match-metrics` | Ingest match metrics (+ auto recalc) |
| POST | `/api/v1/sip/players/:id/recalculate` | Re-run tactical pipeline |
| GET | `/api/v1/scouting/tactical-search` | Filter players by tactical scores |
| GET | `/api/v1/benchmarks` | List tactical benchmarks |
| POST | `/api/v1/benchmarks` | Create benchmark |

Phase 2 stubs: `/api/v1/scouting/philosophy-fit`, `strong-xi`, `player-comparison`.

## After seed — recalculate sample player

```bash
curl -X POST http://localhost:3000/api/v1/sip/players/00000000-0000-4000-8000-000000000001/recalculate
```

## Engines

Pure scoring logic lives in `packages/engines` (`runSipPipeline`, derived metrics, tactical styles, position fit).
