# Platform vision — one www.dtp.africa, four product modules

## Mission

DirectToPro Africa connects **African grassroots football talent** to **global opportunity** using **verified data**, **transparent ratings**, and **operational tools** for scouts, academies, and clubs.

The rebuilt platform is **one brand** and **one primary web origin** (`https://www.dtp.africa`) with **clear product modules** behind path- or subdomain-based routing—not four disconnected Trickle exports.

## Product modules

| Module | Code name | Primary users | Role |
|--------|-----------|---------------|------|
| **DirectToPro Home** | `directopro` | Public, players, parents, partners | Marketing, registration, featured talent, academies, blog, contact |
| **ScoreBoard** | `scoreboard` | Operators, spotters, public fans | Live match ops, competitions, highlights, search, exports |
| **Scouting Intelligence Platform** | `sip` | Scouts, clubs, analysts | Tactical metrics, philosophy fit, Strong XI, pitch viz, comparison, exports |
| **Market Value Confidence Engine** | `mvce` | Scouts, recruiters, academy admins | Valuation bands, confidence scores, comparables |

## Recommended host map (production)

| URL | Module |
|-----|--------|
| `https://www.dtp.africa` | Shell + DirectToPro Home (default) |
| `https://www.dtp.africa/scoreboard` | ScoreBoard (or `scoreboard.dtp.africa` if you prefer subdomain) |
| `https://www.dtp.africa/scouting` | Scouting Intelligence Platform |
| `https://www.dtp.africa/valuation` | MVCE |
| `https://api.dtp.africa` | Unified API gateway / BFF (routes to services) |

Subdomains (`scoreboard.dtp.africa`, `api.scoreboard.dtp.africa`) remain valid if you already market them; the **codebase** should still be **one monorepo** with shared auth, design system, and player identity.

## Target monorepo layout (greenfield — not built yet)

```
dtp.africa/
  docs/                          # This documentation
  specs/                         # PDFs, OpenAPI, ADRs
  apps/
    web/                         # Vite/React shell: routing, layout, auth UI
    directopro/                  # Home module pages
    scoreboard/                  # ScoreBoard module pages
    scouting/                    # SIP module pages
    mvce/                        # MVCE module pages
  services/
    api/                         # Single Spring Boot or Nest BFF (recommended)
    # OR split: directopro-service, scoreboard-service, sip-service, mvce-service
  packages/
    ui/                          # Design system (Tailwind, components)
    domain/                      # Shared types: Player, Club, Match, Valuation
    auth/                        # JWT/session client helpers
    engines/                     # Pure TS/Java: rating, calibration, MVCE scoring
  infra/                         # Docker, nginx, env templates
```

## Technical principles (non‑negotiable for rebuild)

1. **No Trickle runtime** — no `trickleListObjects`, no `resource.trickle.so` CDN bundles, no Babel-in-browser.
2. **Built frontend** — Vite (or Next.js) + TypeScript + tested components.
3. **Real backend auth** — server-side sessions or JWT; no `localStorage` admin flags or client-only passwords.
4. **One player graph** — same `player_id` across Home, SIP, MVCE; ScoreBoard links matches/events to players.
5. **Engines as libraries** — calibration, rating, MVCE scoring are **unit-tested** packages, not copy-pasted into HTML.
6. **PostgreSQL** (recommended) for production; SQLite only for local dev if desired.
7. **SIP scoring** — official spec recommends Python (FastAPI/Pandas) microservices + NestJS API + BullMQ; monorepo may host engines in `packages/engines` (TS) or `services/sip-scoring` (Python) with shared contracts.

## Shared domain entities

| Entity | Used by |
|--------|---------|
| `Player` | All modules |
| `Club` / `Academy` | Home, ScoreBoard, SIP |
| `Match` / `Event` | ScoreBoard, SIP |
| `PlayerMatchMetrics` / `TacticalScores` | ScoreBoard → SIP; Home/MVCE read summaries |
| `PhilosophyFitProfile` / `StrongXI` | SIP |
| `PlayerRating` / `AttributeSet` | SIP calibration + legacy rating engines; Home display |
| `ValuationRun` | MVCE |
| `Content` (blog, banners, static) | Home only |
| `User` / `Role` | All (admin, scout, operator, club) |

## Build phases (recommended order)

1. **Foundation** — monorepo, `apps/web` shell, design system, auth, PostgreSQL schema, CI.
2. **DirectToPro Home** — public pages + admin CMS (replace `Home/`).
3. **SIP** — Phase 1 per [specs/SCOUTING_INTELLIGENCE_PLATFORM.md](./specs/SCOUTING_INTELLIGENCE_PLATFORM.md): DB, metrics ingestion, tactical score engine, APIs (Python scoring services optional).
4. **ScoreBoard** — competitions, matches, spotter tablet, public match center.
5. **MVCE** — implement PDF scoring/confidence/bands + dashboard.
6. **Integration** — cross-links (player profile → valuation → match log).

## What we are throwing away

The legacy stack is a **Trickle AI export** (React via CDN + Babel + Trickle DB shape) plus **interim patches** (`trickle-shim`, `directopro-api` Trickle-compat layer, API-key filter). It is useful only as **requirements archaeology**—not as a foundation. See [06-LEGACY-DELETE-AND-MIGRATE.md](./06-LEGACY-DELETE-AND-MIGRATE.md).
