# DTP Africa (greenfield)

DirectToPro Africa connects grassroots football talent to scouts, academies, and clubs through verified data, tactical intelligence, and market-value insight.

Unified platform for **www.dtp.africa**:

| Module | Path (web) | Docs |
|--------|------------|------|
| DirectToPro Home | `/` | [docs/02-PRODUCT-DIRECTOPRO-HOME.md](docs/02-PRODUCT-DIRECTOPRO-HOME.md) |
| ScoreBoard | `/scoreboard` | [docs/03-PRODUCT-SCOREBOARD.md](docs/03-PRODUCT-SCOREBOARD.md) |
| Scouting Intelligence (SIP) | `/scouting` | [docs/specs/SCOUTING_INTELLIGENCE_PLATFORM.md](docs/specs/SCOUTING_INTELLIGENCE_PLATFORM.md) |
| Market Value Confidence (MVCE) | `/valuation` | [docs/specs/DTP_Market_Value_Confidence_Engine_Documentation.pdf](docs/specs/DTP_Market_Value_Confidence_Engine_Documentation.pdf) |
| Vision Engine *(Phase 0 built; off by default)* | `/admin/vision` | [docs/vision/README.md](docs/vision/README.md) |

**Architecture:** [docs/01-PLATFORM-VISION.md](docs/01-PLATFORM-VISION.md)
**Vision Engine:** [docs/vision/](docs/vision/) — football video intelligence: rights, ingestion, detection, tracking, identity, events, evidence

Legacy Trickle exports (`Home/`, `ScoreBoard project/`, `platform/`) have been removed.

## Quick start

```bash
pnpm install
pnpm db:up          # Postgres (Docker)
pnpm db:push
pnpm db:seed
pnpm dev:api        # API http://localhost:3000/api/v1/health
pnpm dev            # Web http://localhost:5173
```

## Repo layout

```
apps/web/           # Vite + React shell (routing, layout)
packages/domain/    # Shared types & constants
packages/ui/        # Design system components
packages/engines/   # Pure scoring logic (SIP, MVCE, calibration)
services/api/       # Backend API (NestJS + Prisma)
docs/               # Product & specs
infra/              # Docker, env templates
```

Planned for the Vision Engine — see [docs/vision/01-ARCHITECTURE.md](docs/vision/01-ARCHITECTURE.md):

```
services/api/src/vision/           # Vision control plane (NestJS module)
services/vision-worker/            # Python GPU/CPU worker, Docker/OCI, runs off-platform
packages/vision-contracts/         # Job spec + prediction schemas shared by API, web, worker
apps/web/src/modules/admin/vision/ # Admin screens inside the existing AdminApp
infra/vision/                      # R2 bucket config, worker image CI
```
