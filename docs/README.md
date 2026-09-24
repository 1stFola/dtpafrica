# DTP Africa — Platform documentation (greenfield rebuild)

This folder is the **source of truth** for replacing the legacy Trickle-exported codebase with a single, modular **www.dtp.africa** platform.

| Document | Contents |
|----------|----------|
| [01-PLATFORM-VISION.md](./01-PLATFORM-VISION.md) | Unified product, hosts, modules, target monorepo |
| [02-PRODUCT-DIRECTOPRO-HOME.md](./02-PRODUCT-DIRECTOPRO-HOME.md) | Public site + CMS (former `Home/`) |
| [03-PRODUCT-SCOREBOARD.md](./03-PRODUCT-SCOREBOARD.md) | Live data product (former `ScoreBoard project/`) |
| [04-PRODUCT-SCOUTING-INTELLIGENCE.md](./04-PRODUCT-SCOUTING-INTELLIGENCE.md) | Tactical scouting intelligence (SIP) — summary |
| [specs/SCOUTING_INTELLIGENCE_PLATFORM.md](./specs/SCOUTING_INTELLIGENCE_PLATFORM.md) | **Full SIP spec** (DB, engines, APIs, UI, phases) |
| [05-PRODUCT-MVCE.md](./05-PRODUCT-MVCE.md) | Market Value Confidence Engine (from PDF) |
| [06-LEGACY-DELETE-AND-MIGRATE.md](./06-LEGACY-DELETE-AND-MIGRATE.md) | **What to delete**, what to keep, migration steps |
| [07-SIP-PHASE-1-IMPLEMENTED.md](./07-SIP-PHASE-1-IMPLEMENTED.md) | SIP Phase 1 — run API & engines |
| [08-SIP-PHASE-2-IMPLEMENTED.md](./08-SIP-PHASE-2-IMPLEMENTED.md) | SIP Phase 2 — philosophy fit, Strong XI, scouting UI |
| [09-DIRECTOPRO-HOME-IMPLEMENTED.md](./09-DIRECTOPRO-HOME-IMPLEMENTED.md) | DirectToPro Home — public pages + Home API |
| [10-SCOREBOARD-PHASE-1-IMPLEMENTED.md](./10-SCOREBOARD-PHASE-1-IMPLEMENTED.md) | ScoreBoard — competitions, live, standings, supervisor |
| [11-MVCE-PHASE-1-IMPLEMENTED.md](./11-MVCE-PHASE-1-IMPLEMENTED.md) | MVCE — valuation engine, dashboard, compare |
| [12-ADMIN-CMS-IMPLEMENTED.md](./12-ADMIN-CMS-IMPLEMENTED.md) | Admin CMS — players, blog, featured flags |
| [14-ACADEMY-DASHBOARD-IMPLEMENTED.md](./14-ACADEMY-DASHBOARD-IMPLEMENTED.md) | Academy Dashboard — squad, fixtures, development, SIP, MVCE |

## Vision Engine (next build — design complete, not implemented)

Football video intelligence: rights-cleared footage → detections, tracks, identities, events,
evidence clips, scouting metrics.

| Document | Contents |
|----------|----------|
| [vision/README.md](./vision/README.md) | **Start here** — index and reading order for the Vision Engine documentation set |
| [vision/02-DECISIONS.md](./vision/02-DECISIONS.md) | How the PID, infrastructure handoff and coding-agent prompt were reconciled, and what was added or removed |
| [vision/11-PHASE-PLAN.md](./vision/11-PHASE-PLAN.md) | Phases, gates and the first 90 days |
| [vision/13-OPEN-QUESTIONS.md](./vision/13-OPEN-QUESTIONS.md) | Decisions still needing a human |
| [licenses/OSS_REGISTER.md](./licenses/OSS_REGISTER.md) | Third-party code, weights and dataset licences — nothing ships without an entry |

**Authoritative specs**

- SIP: [specs/SCOUTING_INTELLIGENCE_PLATFORM.md](./specs/SCOUTING_INTELLIGENCE_PLATFORM.md)
- MVCE: [specs/DTP_Market_Value_Confidence_Engine_Documentation.pdf](./specs/DTP_Market_Value_Confidence_Engine_Documentation.pdf)
- Vision Engine: [vision/](./vision/) (this repo is the source of truth; the Word/Markdown source documents are inputs, superseded where they conflict)

**Next step after you approve deletion:** scaffold the new monorepo (no Trickle runtime, no browser Babel, no `trickle-shim`).
