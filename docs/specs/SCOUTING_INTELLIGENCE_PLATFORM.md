# Scouting Intelligence Platform (SIP) — Full product specification

Authoritative product definition for the DTP Africa scouting intelligence layer. Use this document for schema, engines, APIs, and UI during the greenfield build.

---

## Product overview

DTP Africa is a **football scouting intelligence platform** focused on discovering, profiling, analyzing, and **matching grassroots players** to tactical systems, playing philosophies, and club requirements.

The system combines:

- Wearable / player tracking metrics
- Tactical intelligence scoring
- Philosophy fit analysis
- AI-driven Strong XI generation
- Position intelligence
- Player development analytics
- Club-fit scouting workflows
- Tactical role prediction
- Advanced scouting dashboards

This layer integrates into the unified **www.dtp.africa** platform alongside DirectToPro Home, ScoreBoard, and MVCE.

---

## Core product goals

The platform must allow:

- Scouts to identify players fitting **specific tactical systems**
- Clubs to search for **system-ready talent**
- Automatic **Strong XI** generation by philosophy
- **Tactical comparison** between players
- **Tactical role** detection
- **Development gap** analysis
- **Position suitability** analysis
- **Data-driven** player recommendations
- **Visual scouting reports**
- **AI-enhanced** player profiling

---

## System modules

| Module | Responsibility |
|--------|----------------|
| **Player Metrics Engine** | Raw tracking → derived metrics |
| **Tactical Style Engine** | Philosophy compatibility scores (gegenpress, tiki-taka, etc.) |
| **Philosophy Fit Engine** | Formation + philosophy → fit rankings |
| **Strong XI Generator** | Best XI + bench by philosophy/formation |
| **Tactical Match Engine** | Compare vs benchmark profiles |
| **Position Suitability Engine** | Primary/secondary/hybrid position recommendations |
| **Scout Dashboard** | Search, filters, workflows |
| **Tactical Pitch Visualization Engine** | Formation, markers, interactions |
| **Export & Reporting Engine** | PDF, CSV, shareable links |
| **Player Comparison Engine** | Up to 4 players, charts |
| **API Layer** | REST under `/api` |
| **Admin Management System** | Benchmarks, recalc, mappings |
| **Benchmark Calibration System** | Pro benchmarks, recalibration jobs |
| **Analytics & Aggregation Layer** | Season/rolling aggregates, dashboards |

---

## Recommended tech stack

### Frontend

- Next.js, React, TailwindCSS, Framer Motion, Recharts
- Zustand or Redux; React Query / TanStack Query

### Backend

- Node.js, NestJS or Express
- PostgreSQL, Prisma ORM
- Redis, BullMQ (background jobs)

### Data processing (scoring engines)

- Python microservices: Pandas, NumPy, FastAPI

### Infrastructure

- Docker; AWS or GCP; CloudFront; S3; managed PostgreSQL

**Monorepo note:** The greenfield plan may unify on one backend language; scoring engines can remain **Python microservices** called from NestJS/Java, or ports to TypeScript in `packages/engines` with golden tests.

---

## Database architecture

### `players`

Core profile: `id`, `first_name`, `last_name`, `display_name`, `date_of_birth`, `age`, `age_group`, `nationality`, `height_cm`, `weight_kg`, `dominant_foot`, `position_primary`, `position_secondary`, `player_photo_url`, `video_url`, `biography`, `created_at`, `updated_at`.

### `player_match_metrics`

Match-level tracking: `player_id`, `match_id`, `minutes_played`, `ball_touches`, one/multi-touch possessions, release/receive foot counts, kicking power, distance, sprints, accelerations, turns, ball-with-ball metrics, etc. (full field list in source spec).

### `player_aggregated_metrics`

Season or rolling averages per player.

### `tactical_scores`

Per player: `gegenpress_score`, `tiki_taka_score`, `counter_attack_score`, `total_football_score`, `high_line_score`, `winger_score`, `low_block_score`, `quick_release_score`, `ball_retention_score`, `technical_cleanliness_score`, `direct_play_score`, `flair_score`, `press_resistance_score`, `possession_hub_score`, `transition_explosiveness_score`, `isolation_threat_score`, `two_footedness_score`, timestamps.

### `philosophy_fit_profiles`

`player_id`, `formation`, `philosophy`, `position_slot`, `philosophy_fit_score`, `position_fit_score`, `confidence_score`.

### `tactical_benchmarks`

Professional benchmark profiles for tactical match engine.

---

## Metrics engine

**Purpose:** Convert raw tracking into tactical, technical, intelligence, position suitability, and tactical fit scores.

### Derived metrics (formulas)

| Metric | Formula (summary) |
|--------|-------------------|
| `turn_efficiency` | `avg_turn_exit_speed_mph / avg_turn_entry_speed_mph` |
| `turn_diversity` | `(left_turns + right_turns + back_turns) / 3` |
| `workload_index` | `(total_distance_miles * 1609 + sprint_distance_yards * 0.9144) / minutes_played` |
| `sprint_frequency` | `sprints / minutes_played` |
| `acceleration_density` | `(first_step_accelerations + intense_accelerations) / minutes_played` |
| `ball_activity_rate` | `ball_touches / minutes_played` |
| `two_footedness_score` | `100 - ABS(left_foot_touch_pct - right_foot_touch_pct)` |
| `quick_release_score` | `(one_touch_possessions / total_possessions) * 100` |
| `technical_cleanliness_score` | `release_inside_foot + controlled_receive + turn_efficiency` |
| `direct_play_score` | `release_laces + kicking_power_mph + sprint_distance_yards` |
| `flair_score` | `release_other_footzone + intense_turns_with_ball + turn_diversity` |

---

## Tactical style engine

Weighted formulas per philosophy (inputs from derived + raw metrics):

- **Gegenpressing** — accelerations, sprints, intense turns, sprint distance, workload index
- **Tiki-Taka** — ball touches, turn efficiency, distance with ball, left+right turns
- **Counter attack** — top speed, sprint distance, top speed with ball, distance with ball, kicking power
- **Total football** — distance, turn diversity, distance with ball, sprint frequency, acceleration density
- **High line** — top speed, sprint frequency, back turns, intense accelerations
- **Winger** — top speed with ball, intense turns with ball, distance with ball, sprints
- **Low block** — intense turns, first-step accelerations, back turns, inverse distance

---

## Philosophy fit engine

**Inputs:** playing philosophy, formation.

**Outputs:** Strong XI, best-fit players, tactical fit rankings.

**Supported philosophies:** Gegenpressing, Tiki-Taka, Counter-Attacking, Total Football, High Line, Low Block, Wing Play, Direct Vertical Football, Inverted Fullback, False 9 Fluid.

**Philosophy fit score:**

`philosophy_fit_score = primary_style_score * 0.50 + overall_rating * 0.25 + position_fit_score * 0.15 + offensive_or_defensive_relevance * 0.10`

**Formations:** 4-3-3, 4-2-3-1, 4-4-2, 3-4-3, 3-5-2, 4-1-4-1, 5-3-2.

### Strong XI generator process

1. Select formation and philosophy  
2. Load eligible players  
3. Calculate philosophy fit  
4. Apply positional weighting  
5. Rank and pick strongest per role  
6. Bench alternatives + tactical insights  

---

## Soccer pitch visualization engine

- Green pitch, white markings, responsive scale, animated markers, formation spacing, hover/click  
- **Marker:** photo, name, position, fit score, overall, offensive, defensive ratings  
- **Drawer:** full profile, tactical/physical/technical metrics, suitability, video, scout notes, tags  

**Archetype tags (auto):** e.g. One-Touch Specialist, Press Resistant Midfielder, Vertical Transition Threat, Elite Two-Footed, Possession Hub, Isolation Specialist.

---

## Tactical match engine

Compare players to benchmark profiles: nearest matches, similarity scores, archetypes, gaps. **Similarity:** weighted Euclidean.

---

## Scout dashboard

Features: tactical search, philosophy filter, position/tactical score filters, Strong XI, comparison, reports.

Filters: position, age group, tactical fit, offensive/defensive rating, foot, archetype.

---

## Player comparison engine

Up to **4** players. Metrics: tactical, physical, technical, fit, offensive, defensive. Viz: radar, bar, scatter, percentiles.

---

## Position suitability engine

Output example:

```json
{
  "primary_position_fit": "RW",
  "secondary_position_fit": "LW",
  "hybrid_fit": "AM",
  "confidence": 88
}
```

Factors: tactical scores, speed, technical, press resistance, direct play, flair, work rate.

---

## Export engine

PDF, CSV, shareable links. PDF includes Strong XI pitch image, tactical summary, player cards, fit scores, insights, bench.

---

## API architecture

**Base:** `/api`

| Group | Endpoints |
|-------|-----------|
| Players | `GET /api/players`, `GET /api/players/:id`, `GET /api/players/:id/tactical-scores`, `GET /api/players/:id/position-fit`, `GET /api/players/:id/tactical-profile` |
| Scouting | `GET /api/scouting/philosophy-fit`, `GET /api/scouting/strong-xi`, `GET /api/scouting/player-comparison`, `GET /api/scouting/tactical-search` |
| Benchmarks | `GET/POST /api/benchmarks`, `PUT/DELETE /api/benchmarks/:id` |

**Greenfield mapping:** Prefix with `/api/v1/sip/...` under unified gateway if desired.

---

## Admin system

Manage benchmarks, recalculate scores, edit profiles, trigger recalibration, tactical mappings.

**Background jobs (BullMQ):** tactical recalc, aggregation, benchmark updates, report generation.

---

## Performance

- Cache tactical scores and Strong XI queries  
- Paginate search  
- Precompute tactical fit  
- Indexes on: `player_id`, `position_primary`, `age_group`, tactical score columns, `overall_rating`

---

## Security

- JWT, RBAC, scout access controls, admin-only recalc, rate limiting  
- **Roles:** Admin, Scout, Club Representative, Analyst, Read-only Viewer

---

## Analytics layer

Track: most searched players, popular philosophies, top archetypes, score distributions, regional trends.

---

## UI design system

| Token | Value |
|-------|--------|
| Primary | `#2563eb` |
| Dark background | `#1e293b` |
| Pitch green | `#166534` |
| Elite score | `#22c55e` |
| Warning | `#f59e0b` |
| Danger | `#ef4444` |

Dark dashboard UI, green pitch, rounded cards, tactical heatmap colors. **Mobile/tablet:** responsive pitch, collapsible filters, touch.

---

## Development priority

| Phase | Deliverables |
|-------|----------------|
| **1** | DB expansion, metrics ingestion, tactical score engine, tactical APIs |
| **2** | Philosophy fit scout page, pitch visualization, Strong XI generator |
| **3** | Tactical comparison, export engine, admin system |
| **4** | AI tactical recommendations, benchmark calibration, advanced analytics |

---

## Future expansion

Injury risk, AI match simulation, club tactical compatibility, recruitment recommendations, video event tagging AI, GPS live ingestion, match event intelligence, xG/xA, team/chemistry engines.

---

## Final objective

A tactical intelligence platform comparable in ambition to Wyscout, Hudl, StatsBomb, Playermaker, FM scouting, and analyst tooling — **built for African grassroots football intelligence**.

---

## Legacy overlap (pre-Trickle teardown)

| Legacy `Home/` artifact | SIP module |
|-------------------------|------------|
| `calibration-engine.js` | Benchmark Calibration System (partial) |
| Match Rating Engine spec | Player Metrics Engine (partial) |
| `comparison.html` | Player Comparison Engine |
| `scoutingSummaryGenerator.js` | Export / AI profiling (partial) |

Reimplement formulas in tested `packages/engines` or Python services; do not port Trickle UI.
