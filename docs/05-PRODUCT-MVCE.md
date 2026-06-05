# Product: Market Value Confidence Engine (MVCE)

**Authoritative source:** [specs/DTP_Market_Value_Confidence_Engine_Documentation.pdf](./specs/DTP_Market_Value_Confidence_Engine_Documentation.pdf)

## Purpose

AI-assisted module to estimate **likely first Transfermarkt-style market value bands** for **Nigerian grassroots** players, emphasizing **visibility, verification, competition level, upside, and demand**—not statistics alone.

**Goal:** Become the African grassroots **market intelligence layer** that signals value readiness before the global market notices the player.

## User types

Scout, Academy Admin, DTP Admin, Analyst, Club Recruiter.

## Core flow

```
Player created → variables entered → scoring engine (100 pts)
  → multipliers applied → confidence band → market value range
  → dashboard + optional AI scout insights
```

## Frontend modules (from PDF)

| Module | Function |
|--------|----------|
| Player input form | Capture profile, competition, performance, DTP metrics, visibility, market signals |
| Player comparison engine | Compare valuation inputs/outputs |
| Valuation dashboard | Primary UX |
| Confidence analyzer | Band + score breakdown |
| Scout insights panel | Narrative / AI-assisted notes |

**Layout:** Left = profile/bio; center = confidence + predicted value; right = strengths, weaknesses, scout notes.

Route target: `/valuation` or `/mvce`.

## Scoring engine (100-point weighted)

| Factor | Weight |
|--------|--------|
| Age upside | 15% |
| Competition level | 15% |
| Match experience | 15% |
| Performance quality | 12% |
| Visibility signals | 10% |
| Market signals | 12% |
| Contract security | 6% |
| DTP athletic metrics | 10% |
| Risk adjustment | −15% |

## Confidence bands

| Score | Label |
|-------|--------|
| 0–24 | Very Low |
| 25–39 | Low |
| 40–54 | Moderate |
| 55–69 | Strong |
| 70–84 | Very Strong |
| 85–100 | Elite Prospect |

## Market value bands (EUR, indicative)

| Score | Band |
|-------|------|
| 0–24 | No reliable value |
| 25–39 | €10k–€25k |
| 40–54 | €25k–€75k |
| 55–69 | €75k–€150k |
| 70–84 | €150k–€350k |
| 85–100 | €350k–€750k+ |

## Multipliers

### Verification

| Proof level | Multiplier |
|-------------|------------|
| None | 0.6 |
| Video only | 0.8 |
| Video + match sheets | 1.0 |
| Video + stats + verified reports | 1.15 |
| National team proof | 1.25 |

### Market demand

| Signal | Multiplier |
|--------|------------|
| Local club interest | 1.05 |
| NPFL | 1.15 |
| African club | 1.3 |
| European club | 1.6 |
| Elite European club | 2.0 |

### Position

GK 0.85 · CB 1.0 · FB/WB 1.05 · DM 1.1 · CM 1.15 · AM 1.2 · Winger 1.35 · Striker 1.4

## Comparable player engine

Compare peers on: age, position, height, competition level, athletic profile, visibility profile, market signals.

## Input variables (summary)

- **Profile:** age, position, nationality, foot, height, weight  
- **Competition:** club type, level, academy reputation  
- **Performance:** goals, assists, tackles, dribbles, interceptions  
- **DTP metrics:** sprint speed, accelerations, turning speed, distance with ball, top speed, explosive metrics  
- **Visibility:** verified footage, scout reports, tournaments, social  
- **Market:** club interest, youth NT, rumors, professional contract  

Many DTP metrics should **pull from SIP** (`tactical_scores`, aggregated metrics, overall_rating) and match data from **ScoreBoard** (`player_match_metrics`) where available.

## API (from PDF — adapt under unified gateway)

```
POST /api/v1/mvce/players
POST /api/v1/mvce/valuation/generate
GET  /api/v1/mvce/valuation/compare
GET  /api/v1/mvce/valuation/report/:playerId
```

## Recommended stack (PDF vs platform decision)

| PDF suggests | Monorepo recommendation |
|--------------|-------------------------|
| React + Tailwind | `apps/web` + `packages/ui` (align with other modules) |
| Node/NestJS + Prisma + PostgreSQL | **Either** NestJS service **or** Java Spring module—pick one backend language for all services |
| OpenAI | Optional `packages/ai` for scout insights only; core scoring is **deterministic** |
| Recharts | Shared chart components in `packages/ui` |

**Rule:** MVCE **scoring/confidence/bands** must be **deterministic and testable**; AI is optional narrative layer.

## Domain entities

`ValuationRun`, `ValuationInput`, `ConfidenceBand`, `MarketValueBand`, `ComparableSet`, `MultiplierAudit` (store which multipliers applied).

## Success criteria

- Same inputs → same bands (regression tests).
- Dashboard explains **why** (factor breakdown).
- Integrates with shared `Player` id and SIP outputs.
