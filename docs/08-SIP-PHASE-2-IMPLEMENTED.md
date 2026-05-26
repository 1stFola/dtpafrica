# SIP Phase 2 — Implemented

Philosophy fit, Strong XI, player comparison, and scouting UI.

## Engines (`packages/engines/src/sip/`)

- `formations.ts` — 7 formations with pitch coordinates
- `philosophies.ts` — 10 playing philosophies → tactical score keys
- `philosophy-fit-engine.ts` — `computePhilosophyFit`, `rankPlayersForPhilosophy`
- `strong-xi-engine.ts` — `generateStrongXi`
- `comparison-engine.ts` — `comparePlayers` (max 4 players)

## API (`/api/v1/scouting`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/scouting/meta` | Formation and philosophy IDs |
| GET | `/scouting/tactical-search` | Filter by position, age group, min gegenpress |
| GET | `/scouting/philosophy-fit` | Rank players for formation + philosophy |
| GET | `/scouting/strong-xi` | Auto-pick XI + bench alternatives |
| GET | `/scouting/player-comparison` | `?ids=uuid1,uuid2` (max 4) |

Philosophy fit results are persisted via `findFirst` → `update` or `create` (no broken upsert).

## Web (`/scouting`)

- Overview hub
- **Strong XI** — formation + philosophy, pitch visualization
- **Philosophy fit** — ranked table
- **Tactical search** — filters
- **Compare** — up to 4 players with tactical scores

## Run locally

```bash
pnpm install
pnpm db:up
pnpm db:push
pnpm db:seed
pnpm dev:api   # :3000
pnpm dev       # :5173 — proxies /api → API
```

Seed player: `00000000-0000-4000-8000-000000000001`

After seed, ingest metrics or call `POST /api/v1/sip/players/:id/recalculate` so tactical scores exist before using Strong XI / philosophy fit.

Open http://localhost:5173/scouting
