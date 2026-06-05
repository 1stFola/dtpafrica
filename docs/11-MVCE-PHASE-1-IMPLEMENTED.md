# MVCE — Phase 1 implemented

Market Value Confidence Engine: deterministic scoring, EUR bands, dashboard UI.

## Engine (`packages/engines/src/mvce/`)

- 100-point weighted factors (age, competition, experience, performance, visibility, market, contract, athletic, risk)
- Verification, market demand, and position multipliers (per product PDF)
- Confidence labels and EUR market value bands
- `computeValuation(input)` — fully deterministic

## API (`/api/v1/mvce`)

| Method | Path |
|--------|------|
| GET | `/mvce/players` |
| POST | `/mvce/valuation/generate` |
| GET | `/mvce/valuation/report/:playerId` |
| GET | `/mvce/valuation/compare?ids=` |

Auto-fills from DTP `Player` + SIP `tactical_scores` + aggregated match counts when generating.

## Web (`/valuation`)

| Route | Page |
|-------|------|
| `/valuation` | Hub + recent valuations |
| `/valuation/generate` | Input form → run engine |
| `/valuation/player/:playerId` | Dashboard (gauge, factors, multipliers, scout notes) |
| `/valuation/compare` | Compare up to 4 valued players |

## Seed

Valuation run for seed player **ALLI O. SANNI** (after `pnpm db:seed`).

## Run

```bash
pnpm --filter @dtp/engines build
pnpm db:push
pnpm db:seed
pnpm dev:api
pnpm dev
```

Open http://localhost:5173/valuation/player/00000000-0000-4000-8000-000000000001

## Not in Phase 1

- OpenAI scout insights layer
- Comparable peer search across full database
- Auth for academy admin / scout roles

See [05-PRODUCT-MVCE.md](./05-PRODUCT-MVCE.md) and the [PDF spec](./specs/DTP_Market_Value_Confidence_Engine_Documentation.pdf).
