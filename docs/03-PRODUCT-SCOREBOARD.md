# Product: ScoreBoard by DTP Africa

Former codebase: `ScoreBoard project/` (Trickle export, 18 HTML pages). Backend stub: `platform/scoreboard/scoreboard-api` (only `/api/v1/info` today).

## Purpose

**Operational and public football data hub** for Nigerian leagues/tournaments: live match monitoring, incidents, standings, highlights, search, roster submission, and partner export/API console.

## Audiences

| Role | Needs |
|------|--------|
| Supervisor / operator | Live monitor, edit scores, incidents, flags |
| Spotter (stadium) | Tablet UI: lineup lock, events, offline queue |
| Content admin | Highlights, publication state |
| Competition admin | Standings engine, stats, entity CRUD |
| Public fan | Landing, match center, player/team profiles, browse/search |
| Partner / analyst | Export jobs, API catalog (read-only keys) |

## Module map (from legacy ScoreBoard notes)

| # | Module | Legacy pages (approx.) | Priority |
|---|--------|------------------------|----------|
| 1 | Live Supervisor Monitor | `admin-supervisor.html` | P1 |
| 2 | Player historical profile | `player-profile.html` | P1 |
| 3 | Match highlights (admin + public) | `admin-content.html`, `match-highlights.html` | P1 |
| 4 | Standings + competition stats | `admin-competition.html`, `competition-stats.html` | P1 |
| 5 | Search & browse | `admin-search.html`, `search-browse.html`, `team-profile.html` | P2 |
| 6 | Export / API console | `export-api.html` | P2 |
| 7 | Spotter tablet | `spotter-tablet.html` | P2 |
| 8 | Public match center | `match-center.html` | P1 |
| 9 | Roster submission | `admin-roster.html` | P2 |
| 10 | Entity management | `admin-entities.html`, `admin-roster.html` | P1 |
| — | Auth & shell | `login.html`, `admin.html`, `index.html` | P1 |

## Core domain entities

| Entity | Relationships |
|--------|----------------|
| `Competition` | Seasons, rules |
| `Season` | |
| `Team` | Competition, roster |
| `Player` | Team(s), links to DTP `Player` id |
| `Match` | Home/away, status, minute, score |
| `MatchEvent` | Goal, card, sub, injury; player, minute |
| `Incident` / `Alert` | Supervisor feed |
| `StandingRow` | Computed from results |
| `Highlight` | YouTube URL, match, publish state |
| `ExportJob` / `ApiFeed` | Partner delivery |
| `User` | Operator roles |

## Legacy data layer (`data/mockData.js`)

Today: **`window.DB`** tries Trickle APIs, else **rich mocks** (Jagaban Cup sample). Rebuild:

- **PostgreSQL** as source of truth.
- **REST** (or GraphQL) matching real operations—not fictional `/api/v1/competitions` strings in UI copy only.
- **WebSocket or SSE** for live supervisor (optional P2).

## API surface (target — replace stub)

Examples aligned with legacy export console narrative:

```
GET  /api/v1/scoreboard/competitions
GET  /api/v1/scoreboard/matches?status=live
GET  /api/v1/scoreboard/matches/:id
POST /api/v1/scoreboard/matches/:id/events
GET  /api/v1/scoreboard/players/:id/profile
GET  /api/v1/scoreboard/standings/:competitionId
POST /api/v1/scoreboard/exports/jobs
```

All **mutations** require authenticated operator roles.

## Greenfield implementation status

This monorepo keeps ScoreBoard in the current NestJS + Prisma + React/Vite architecture rather than rebuilding the legacy Trickle MPA.

Already implemented:

- Public live match cards and a scrolling live ribbon.
- Competition pages with standings, team/squad cards, and matchday-grouped matches.
- Match center with timeline events, assist/secondary-player display, stat bars from `SbMatch.stats`, roster lists, and linked highlights.
- Team profile pages with roster, linked public player profiles, form, and recent matches.
- Unified `/scoreboard/browse` search across competitions, teams, matches, and linked public players.
- Highlights list linked back to matches and timeline events.
- Supervisor/operator flow with admin guard, event tagging, score/status updates, and SIP ingest.

Deferred from the legacy spec:

- Offline-first spotter tablet and sync queue.
- Full lineup lock, substitution workflow, and roster-submission approval.
- Standings pending-QA/publication states.
- Entity management CRUD and partner export/API console.
- WebSocket/SSE live push.

These remain product-valid, but they need workflow and permission design before implementation.

## Integration with other modules

| Link | Behavior |
|------|----------|
| **Home** | “ScoreBoard” nav → `/scoreboard` or subdomain |
| **SIP** | Match tracking CSV / metrics feed into rating engine |
| **MVCE** | Performance + visibility signals from matches and verification |
| **Shared Player** | One ID; ScoreBoard stats enrich SIP/MVCE inputs |

## What not to rebuild from legacy

- `utils/errorHandler.js` fetch/console patching (hide failures).
- Client-only `window.Auth` + plaintext users in `mockData.js`.
- Trickle `trickle/` notes and asset JSON.
- Duplicate `player-profile-app.js` vs `player-profile-v2.js` — pick one pattern in greenfield.

## Success criteria

- Supervisor can run a live match end-to-end on staging.
- Public match center reads only **published** data.
- Spotter queue syncs after reconnect.
- No dependency on Trickle hosts.
