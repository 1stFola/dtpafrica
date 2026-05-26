# Product: Scouting Intelligence Platform (SIP)

**Full specification:** [specs/SCOUTING_INTELLIGENCE_PLATFORM.md](./specs/SCOUTING_INTELLIGENCE_PLATFORM.md)

## One-line purpose

Discover, profile, analyze, and **match grassroots players** to **tactical systems**, **playing philosophies**, and **club requirements** using tracking metrics, tactical scoring, and AI-assisted workflows—not just attribute ratings on a card.

## How SIP fits www.dtp.africa

| Module | Relationship to SIP |
|--------|---------------------|
| **DirectToPro Home** | Shows published player profiles; ratings/summaries **read from** SIP |
| **ScoreBoard** | Supplies `player_match_metrics` via matches/events ingestion |
| **MVCE** | Consumes SIP outputs (performance, DTP athletic metrics, visibility) for valuation bands |
| **Admin** | Unified or SIP-scoped admin for benchmarks and recalc jobs |

**Route target:** `https://www.dtp.africa/scouting/*` (module shell under `apps/web`).

---

## Capabilities (module map)

| # | Engine / module | User value |
|---|-----------------|------------|
| 1 | Player Metrics Engine | Tracking → derived + tactical inputs |
| 2 | Tactical Style Engine | Gegenpress, tiki-taka, counter, total football, high line, winger, low block scores |
| 3 | Philosophy Fit Engine | Philosophy + formation → fit rankings |
| 4 | Strong XI Generator | Auto XI + bench + insights |
| 5 | Tactical Match Engine | Similarity vs pro benchmarks |
| 6 | Position Suitability Engine | RW/LW/AM-style recommendations + confidence |
| 7 | Scout Dashboard | Search, filters, workflows |
| 8 | Tactical Pitch Visualization | Formation, markers, drawer |
| 9 | Export & Reporting | PDF / CSV / share links |
| 10 | Player Comparison | Up to 4 players, radar/bar/scatter |
| 11 | API Layer | REST (see spec) |
| 12 | Admin Management | Benchmarks, recalc, mappings |
| 13 | Benchmark Calibration | Pro profiles + recalibration jobs |
| 14 | Analytics & Aggregation | Season rolls, dashboard metrics |

---

## Core user goals

- Scouts find players for a **defined system**
- Clubs search **system-ready** talent
- **Strong XI** by philosophy in one flow
- **Tactical comparison** and **role** detection
- **Development gaps** and **position suitability**
- **Visual reports** + optional **AI profiling**

---

## Data model (PostgreSQL — summary)

Canonical tables from the SIP spec:

- `players` — shared identity with platform `Player` (single `player_id` across products)
- `player_match_metrics` — per match tracking (align columns with ScoreBoard ingestion)
- `player_aggregated_metrics` — season / rolling windows
- `tactical_scores` — philosophy style scores per player
- `philosophy_fit_profiles` — formation × philosophy × slot
- `tactical_benchmarks` — reference profiles for match engine

See the spec for full column lists and indexes (`player_id`, `position_primary`, `age_group`, score columns, `overall_rating`).

---

## Scoring pipeline (logical flow)

```
ScoreBoard / wearables / CSV import
  → player_match_metrics
  → Metrics Engine (derived metrics)
  → Tactical Style Engine (tactical_scores)
  → Philosophy Fit Engine + Position Suitability
  → Strong XI / Comparison / Match vs benchmarks
  → Export & Home display snapshots
```

**Deterministic engines first;** AI layers (profiling, recommendations) in Phase 4 per spec.

---

## Key formulas (reference)

Detailed weights live in the spec. Examples:

- **Philosophy fit:** `0.50 × primary_style + 0.25 × overall_rating + 0.15 × position_fit + 0.10 × offensive/defensive relevance`
- **Derived:** `turn_efficiency`, `workload_index`, `two_footedness_score`, `quick_release_score`, etc.
- **Tactical styles:** separate weighted blends for gegenpress, tiki-taka, counter, etc.

Port to `packages/engines/sip-*` or Python FastAPI with **golden fixtures** from spec examples.

---

## API surface (from spec — adapt under gateway)

| Area | Methods |
|------|---------|
| Players | `GET /api/players`, `GET /api/players/:id`, `.../tactical-scores`, `.../position-fit`, `.../tactical-profile` |
| Scouting | `GET /api/scouting/philosophy-fit`, `strong-xi`, `player-comparison`, `tactical-search` |
| Benchmarks | CRUD `/api/benchmarks` |

**Greenfield convention:** e.g. `/api/v1/sip/players` if using a versioned BFF.

**Security:** JWT + roles (Admin, Scout, Club Representative, Analyst, Read-only Viewer); admin-only recalc; rate limits.

**Jobs:** BullMQ (or equivalent) for recalc, aggregation, benchmarks, reports.

---

## UI requirements (summary)

- **Scout dashboard:** dark UI (`#1e293b`), primary `#2563eb`, pitch `#166534`
- **Pitch viz:** markers with photo, fit score, ratings; drawer with full tactical breakdown and archetype tags
- **Comparison:** radar, bar, scatter, percentiles (Recharts)
- **Responsive:** tablet/mobile, touch-friendly pitch

Align with shared `packages/ui` so Home/MVCE do not fork design tokens.

---

## Build phases (from official spec)

| Phase | Scope |
|-------|--------|
| **1** | Database, metrics ingestion, tactical score engine, APIs |
| **2** | Philosophy fit page, pitch viz, Strong XI |
| **3** | Comparison, export, admin |
| **4** | AI recommendations, benchmark calibration, analytics |

**Platform build order:** SIP Phase 1 can start after monorepo foundation; ScoreBoard metrics ingestion should align before or in parallel with SIP Phase 1.

---

## Legacy `Home/` mapping (do not reuse code)

| Old artifact | New SIP home |
|--------------|--------------|
| `calibration-engine.js` | Benchmark Calibration System (reimplement) |
| Match Rating Engine notes | Metrics Engine (partial overlap) |
| `comparison.html` | Player Comparison Engine |
| `calibration.html` | Admin/calibration tooling under SIP admin |

Archive notes to `docs/archive/legacy-notes-home/` before deleting `Home/` if needed.

---

## Success criteria

- Ingest one real match metric row → full `tactical_scores` row reproducible in tests
- Scout generates Strong XI for 4-3-3 + Gegenpressing from DB players
- Comparison and PDF export work without Trickle or client-only auth
- `player_id` consistent with Home profile and MVCE valuation input
