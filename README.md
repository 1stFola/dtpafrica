# DTP Africa (greenfield)

DirectToPro Africa connects grassroots football talent to scouts, academies, and clubs through verified data, tactical intelligence, and market-value insight.

Unified platform for **www.dtp.africa**:

| Module | Path (web) | Docs |
|--------|------------|------|
| DirectToPro Home | `/` | [docs/02-PRODUCT-DIRECTOPRO-HOME.md](docs/02-PRODUCT-DIRECTOPRO-HOME.md) |
| ScoreBoard | `/scoreboard` | [docs/03-PRODUCT-SCOREBOARD.md](docs/03-PRODUCT-SCOREBOARD.md) |
| Scouting Intelligence (SIP) | `/scouting` | [docs/specs/SCOUTING_INTELLIGENCE_PLATFORM.md](docs/specs/SCOUTING_INTELLIGENCE_PLATFORM.md) |
| Market Value Confidence (MVCE) | `/valuation` | [docs/specs/DTP_Market_Value_Confidence_Engine_Documentation.pdf](docs/specs/DTP_Market_Value_Confidence_Engine_Documentation.pdf) |

**Architecture:** [docs/01-PLATFORM-VISION.md](docs/01-PLATFORM-VISION.md)

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
services/api/       # Backend API (to be implemented)
docs/               # Product & specs
infra/              # Docker, env templates
```
